import { DateTime } from 'luxon';
import type { calendar_v3 } from '@googleapis/calendar';
import {
  deleteEvent,
  getGoogleEvent,
  getOrCreateMytimeCalendarId,
  getPrimaryGoogleCalendarId,
  listEventsIncremental,
  listSelectedCalendars,
  upsertEvent,
} from './calendar.js';
import { isAuthenticated } from './auth.js';
import {
  createItem,
  deleteItem,
  getItem,
  updateItem,
} from '../db/items.js';
import { META_KEYS, getMeta, getSyncTokens, setMeta, setSyncTokens, clearSyncToken } from '../db/meta.js';
import {
  deleteRemoteLink,
  findItemByRemote,
  findUnlinkedLocalItemMatch,
  getRemoteLink,
  listItemsNeedingProviderSync,
  upsertRemoteLink,
} from '../db/remoteLinks.js';
import type { RemoteEventAccess } from '../db/remoteLinks.js';
import { errorMessage, isSyncTokenExpired } from './errors.js';
import { nowISO } from '../lib/time.js';
import { cleanTitle } from '../lib/textClean.js';
import { parseGoogleReminders } from '../lib/reminders.js';
import { findMeetingUrl, meetingProviderForUrl } from '../lib/meetings.js';
import type {
  AttendeeResponseStatus,
  EventAttendee,
  EventOrganizer,
  Item,
  ItemSource,
} from '../db/types.js';
import type { SyncResult } from '../calendar/types.js';

export type { SyncResult } from '../calendar/types.js';

export async function syncWithGoogle(): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, deleted: 0, calendars: 0, errors: [] };

  if (!isAuthenticated()) {
    result.errors.push('Not authenticated. Run: mytime auth');
    return result;
  }

  try {
    const mytimeCalendarId = await getOrCreateMytimeCalendarId();
    const syncTokens = getSyncTokens();
    const refreshExternalAccess = getMeta(META_KEYS.googleExternalAccessVersion) !== '1';
    let externalAccessRefreshFailed = false;

    const toPush = listItemsNeedingProviderSync('google');
    for (const item of toPush) {
      try {
        if (item.source === 'task' && (await pushTask(item))) result.pushed++;
        else if (item.source === 'event' && (await pushEvent(item))) result.pushed++;
      } catch (e) {
        result.errors.push(`Push failed for "${item.title}": ${(e as Error).message}`);
      }
    }

    const calendars = await listSelectedCalendars();
    result.calendars = calendars.length;

    for (const cal of calendars) {
      try {
        let syncToken = refreshExternalAccess ? undefined : syncTokens[cal.id];
        let response;

        try {
          response = await listEventsIncremental(cal.id, syncToken);
        } catch (e) {
          if (isSyncTokenExpired(e)) {
            delete syncTokens[cal.id];
            clearSyncToken(cal.id);
            response = await listEventsIncremental(cal.id, undefined);
          } else {
            throw e;
          }
        }

        const events = response.data.items ?? [];
        const isMytimeCalendar = cal.id === mytimeCalendarId;

        for (const event of events) {
          if (!event.id) continue;

          let local = findItemByRemote('google', cal.id, event.id);
          if (!local) {
            const embeddedId = event.extendedProperties?.private?.mytime_id;
            const embedded = embeddedId ? getItem(embeddedId) : null;
            if (embedded?.source === 'task' || embedded?.source === 'event') {
              local = embedded;
              upsertRemoteLink(
                local.id,
                'google',
                cal.id,
                event.id,
                event.updated ?? '1970-01-01T00:00:00.000Z',
              );
            }
          }

          if (event.status === 'cancelled') {
            if (local) {
              deleteItem(local.id);
              deleteRemoteLink(local.id, 'google');
              result.deleted++;
            }
            continue;
          }

          const start = event.start?.dateTime ?? event.start?.date;
          const end = event.end?.dateTime ?? event.end?.date;
          if (!start || !end) continue;

          const allDay = !event.start?.dateTime;
          const startISO = parseEventTime(start, allDay);
          const endISO = parseEventTime(end, allDay);

          const rawSummary = event.summary ?? 'Untitled';
          const title = cleanPulledTitle(rawSummary, isMytimeCalendar);
          let source = resolveMytimeSource(event, isMytimeCalendar, local);
          const access = googleRemoteAccess(cal.accessRole, event);
          if (
            !local &&
            isMytimeCalendar &&
            (source === 'task' || source === 'event') &&
            /mytime/i.test(event.description ?? '')
          ) {
            local = findUnlinkedLocalItemMatch({ source, title, start: startISO, end: endISO, allDay });
            if (local) {
              source = local.source as 'task' | 'event';
              upsertRemoteLink(
                local.id,
                'google',
                cal.id,
                event.id,
                event.updated ?? '1970-01-01T00:00:00.000Z',
              );
            }
          }
          const reminders = source === 'event' || source === 'external'
            ? parseGoogleReminders(event.reminders?.overrides)
            : [];
          const notes = source === 'event'
            ? cleanPulledEventNotes(event.description)
            : event.description ?? undefined;
          const attendees = googleAttendees(event);
          const organizer = googleOrganizer(event);
          const selfResponseStatus = attendees.find((attendee) => attendee.self)?.responseStatus;
          const meetingUrl = googleMeetingUrl(event);
          const conferenceRequestId = event.conferenceData?.createRequest?.requestId ?? undefined;
          const meetingProvider = meetingUrl
            ? meetingProviderForUrl(meetingUrl)
            : conferenceRequestId
              ? 'google_meet'
              : undefined;

          if (local) {
            const remoteUpdated = event.updated ? DateTime.fromISO(event.updated).toMillis() : 0;
            const localUpdated = DateTime.fromISO(local.updatedAt).toMillis();
            const link = getRemoteLink(local.id, 'google');
            const hasUnpushedLocalEdits =
              (local.source === 'task' || local.source === 'event') &&
              (!link || local.updatedAt > link.syncedAt);

            if (hasUnpushedLocalEdits && localUpdated > remoteUpdated) {
              continue;
            }

            updateItem(local.id, {
              title,
              notes: notes ?? local.notes,
              location: event.location ?? local.location,
              reminders: source === 'event' ? reminders : local.reminders,
              attendees,
              organizer,
              selfResponseStatus,
              meetingProvider,
              meetingUrl,
              conferenceRequestId: conferenceRequestId ?? local.conferenceRequestId,
              start: startISO,
              end: endISO,
              allDay,
              source,
              originProvider: source === 'external' ? 'google' : undefined,
            });
            upsertRemoteLink(local.id, 'google', cal.id, event.id, nowISO(), access);
            result.pulled++;
          } else {
            const created = createItem({
              title,
              notes,
              location: event.location ?? undefined,
              reminders,
              attendees,
              organizer,
              selfResponseStatus,
              meetingProvider,
              meetingUrl,
              conferenceRequestId,
              tags: source === 'external' ? ['#gcal'] : [],
              priority: 0,
              source,
              originProvider: source === 'external' ? 'google' : undefined,
              start: startISO,
              end: endISO,
              allDay,
            });
            upsertRemoteLink(created.id, 'google', cal.id, event.id, nowISO(), access);
            result.pulled++;
          }
        }

        if (response.data.nextSyncToken) {
          syncTokens[cal.id] = response.data.nextSyncToken;
        }
      } catch (e) {
        if (refreshExternalAccess) externalAccessRefreshFailed = true;
        if (isSyncTokenExpired(e)) {
          delete syncTokens[cal.id];
          clearSyncToken(cal.id);
        }
        result.errors.push(`Pull failed for "${cal.summary}": ${errorMessage(e)}`);
      }
    }

    setSyncTokens(syncTokens);
    if (refreshExternalAccess && !externalAccessRefreshFailed) {
      setMeta(META_KEYS.googleExternalAccessVersion, '1');
    }
  } catch (e) {
    result.errors.push((e as Error).message);
  }

  return result;
}

function googleRemoteAccess(
  accessRole: string | undefined,
  event: calendar_v3.Schema$Event,
): RemoteEventAccess {
  const calendarWritable = accessRole === 'writer' || accessRole === 'owner';
  const organizerCopy = event.organizer?.self === true;
  const unlocked = event.locked !== true;
  return {
    canEditDetails: calendarWritable && unlocked && (organizerCopy || event.guestsCanModify === true),
    canEditReminders: calendarWritable,
    canEditGuests: calendarWritable && unlocked && organizerCopy,
    canDelete: calendarWritable,
    recurring: Boolean(event.recurringEventId || event.recurrence?.length),
    etag: event.etag ?? undefined,
  };
}

const DONE_PREFIX = '✓ ';

function stripDonePrefix(summary: string): string {
  return summary.replace(/^✓\s+/, '');
}

function cleanPulledTitle(summary: string, isMytimeCalendar: boolean): string {
  const withoutDone = isMytimeCalendar ? stripDonePrefix(summary) : summary;
  return cleanTitle(withoutDone);
}

function resolveMytimeSource(
  event: calendar_v3.Schema$Event,
  isMytimeCalendar: boolean,
  local: Item | null,
): ItemSource {
  const type = event.extendedProperties?.private?.mytime_type;
  if (type === 'event') return 'event';
  if (type === 'task') return 'task';
  if (local?.source === 'event' || local?.source === 'task') return local.source;
  if (!isMytimeCalendar) return 'external';
  return 'event';
}

export async function pushTask(item: Item): Promise<boolean> {
  if (!isAuthenticated()) return false;
  if (item.source !== 'task' || !item.start || !item.end) return false;

  const mytimeCalendarId = await getOrCreateMytimeCalendarId();
  const link = getRemoteLink(item.id, 'google');
  const summary = item.status === 'done' ? `${DONE_PREFIX}${item.title}` : item.title;
  const response = await upsertEvent(
    mytimeCalendarId,
    {
      summary,
      description: buildTaskDescription(item),
      start: item.start,
      end: item.end,
      allDay: item.allDay,
      mytimeType: 'task',
      mytimeId: item.id,
    },
    link?.remoteCalendarId === mytimeCalendarId ? link.remoteEventId : undefined,
  );
  const eventId = response.data.id ?? link?.remoteEventId;
  if (!eventId) throw new Error('Google Calendar did not return an event ID');
  upsertRemoteLink(item.id, 'google', mytimeCalendarId, eventId);
  return true;
}

export async function pushEvent(item: Item): Promise<boolean> {
  if (!isAuthenticated()) return false;
  if (item.source !== 'event' || !item.start || !item.end) return false;

  const primaryCalendarId = await getPrimaryGoogleCalendarId();
  const link = getRemoteLink(item.id, 'google');
  const targetCalendarId = link?.remoteCalendarId ?? primaryCalendarId;
  const requestedAttendees = item.attendees.map((attendee) =>
    attendee.email.toLowerCase() === primaryCalendarId.toLowerCase()
      ? { ...attendee, responseStatus: 'accepted' as const }
      : attendee,
  );
  const response = await upsertEvent(
    targetCalendarId,
    {
      summary: item.title,
      description: buildEventDescription(item),
      location: item.location,
      start: item.start,
      end: item.end,
      allDay: item.allDay,
      reminders: item.reminders,
      attendees: requestedAttendees,
      conferenceRequestId:
        item.meetingProvider === 'google_meet' && !item.meetingUrl ? item.conferenceRequestId : undefined,
      mytimeType: 'event',
      mytimeId: item.id,
    },
    link?.remoteEventId,
  );
  const eventId = response.data.id ?? link?.remoteEventId;
  if (!eventId) throw new Error('Google Calendar did not return an event ID');
  let remoteEvent = response.data;
  if (item.meetingProvider === 'google_meet' && !googleMeetingUrl(remoteEvent)) {
    remoteEvent = await waitForGoogleMeet(targetCalendarId, eventId, remoteEvent);
  }
  const remoteAttendees = googleAttendees(remoteEvent);
  const meetingUrl = googleMeetingUrl(remoteEvent);
  updateItem(item.id, {
    attendees: remoteAttendees,
    organizer: googleOrganizer(remoteEvent) ?? item.organizer,
    selfResponseStatus: remoteAttendees.find((attendee) => attendee.self)?.responseStatus ?? item.selfResponseStatus,
    meetingProvider: meetingUrl ? meetingProviderForUrl(meetingUrl) : item.meetingProvider,
    meetingUrl: meetingUrl ?? item.meetingUrl,
  });
  upsertRemoteLink(item.id, 'google', targetCalendarId, eventId);
  return true;
}

export async function pushLocalItem(item: Item): Promise<boolean> {
  if (item.source === 'task') return pushTask(item);
  if (item.source === 'event') return pushEvent(item);
  return false;
}

function parseEventTime(value: string, allDay: boolean): string {
  if (allDay) {
    return DateTime.fromISO(value).toISODate()!;
  }
  return DateTime.fromISO(value).toISO()!;
}

function buildTaskDescription(item: Item): string {
  const parts: string[] = [];
  if (item.notes) parts.push(item.notes);
  if (item.project) parts.push(`Project: @${item.project}`);
  if (item.tags.length) parts.push(`Tags: ${item.tags.join(' ')}`);
  if (item.priority) parts.push(`Priority: P${item.priority}`);
  parts.push('- synced via mytime');
  return parts.join('\n');
}

function buildEventDescription(item: Item): string {
  const parts: string[] = [];
  if (item.notes) parts.push(item.notes);
  parts.push('- mytime event');
  return parts.join('\n');
}

function cleanPulledEventNotes(description: string | null | undefined): string | undefined {
  if (!description) return undefined;
  const notes = description
    .split('\n')
    .filter((line) => line.trim().toLowerCase() !== '- mytime event')
    .join('\n')
    .trim();
  return notes || undefined;
}

function googleAttendees(event: calendar_v3.Schema$Event): EventAttendee[] {
  return (event.attendees ?? []).flatMap((attendee) => {
    if (!attendee.email) return [];
    const status = attendee.responseStatus;
    return [{
      email: attendee.email,
      displayName: attendee.displayName ?? undefined,
      responseStatus:
        status === 'needsAction' || status === 'declined' || status === 'tentative' || status === 'accepted'
          ? status as AttendeeResponseStatus
          : undefined,
      self: attendee.self ?? undefined,
      organizer: attendee.organizer ?? undefined,
      optional: attendee.optional ?? undefined,
    }];
  });
}

function googleOrganizer(event: calendar_v3.Schema$Event): EventOrganizer | undefined {
  const organizer = event.organizer;
  if (!organizer) return undefined;
  return {
    email: organizer.email ?? undefined,
    displayName: organizer.displayName ?? undefined,
    self: organizer.self ?? undefined,
  };
}

function googleMeetingUrl(event: calendar_v3.Schema$Event): string | undefined {
  const video = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri;
  return video ?? event.hangoutLink ?? findMeetingUrl(event.location, event.description);
}

async function waitForGoogleMeet(
  calendarId: string,
  eventId: string,
  initial: calendar_v3.Schema$Event,
): Promise<calendar_v3.Schema$Event> {
  let event = initial;
  for (let attempt = 0; attempt < 5; attempt++) {
    const status = event.conferenceData?.createRequest?.status?.statusCode;
    if (googleMeetingUrl(event) || status === 'failure') return event;
    await new Promise((resolve) => setTimeout(resolve, 400));
    event = (await getGoogleEvent(calendarId, eventId)).data;
  }
  return event;
}

export async function removeFromGoogle(item: Item): Promise<void> {
  if ((item.source !== 'task' && item.source !== 'event') || !isAuthenticated()) return;

  const storedMytimeCalendarId = getMeta(META_KEYS.googleCalendarId);
  const mytimeCalendarId = storedMytimeCalendarId ??
    (item.source === 'task' ? await getOrCreateMytimeCalendarId() : '');
  const storedLink = getRemoteLink(item.id, 'google');
  const link = storedLink ??
    (item.remoteReference?.provider === 'google'
      ? {
          remoteCalendarId: item.remoteReference.calendarId,
          remoteEventId: item.remoteReference.eventId,
        }
      : null);
  if (!link) return;
  if (item.source === 'task' && link.remoteCalendarId !== mytimeCalendarId) return;

  try {
    await deleteEvent(link.remoteCalendarId, link.remoteEventId, item.source === 'event' && item.attendees.length > 0);
  } catch (e) {
    const status = (e as { code?: number; response?: { status?: number } }).code ?? (e as { response?: { status?: number } }).response?.status;
    if (status !== 404 && status !== 410) throw e;
  }
  deleteRemoteLink(item.id, 'google');
}
