import { DateTime } from 'luxon';
import type { calendar_v3 } from '@googleapis/calendar';
import {
  deleteEvent,
  getOrCreateMytimeCalendarId,
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
import { META_KEYS, getMeta, getSyncTokens, setSyncTokens, clearSyncToken } from '../db/meta.js';
import {
  deleteRemoteLink,
  findItemByRemote,
  findUnlinkedLocalItemMatch,
  getRemoteLink,
  listItemsNeedingProviderSync,
  upsertRemoteLink,
} from '../db/remoteLinks.js';
import { errorMessage, isSyncTokenExpired } from './errors.js';
import { nowISO } from '../lib/time.js';
import { cleanTitle } from '../lib/textClean.js';
import { parseGoogleReminders } from '../lib/reminders.js';
import type { Item, ItemSource } from '../db/types.js';
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
        let syncToken = syncTokens[cal.id];
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
          if (!local && isMytimeCalendar) {
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
          const reminders = isMytimeCalendar && source === 'event' ? parseGoogleReminders(event.reminders?.overrides) : [];

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
              notes: event.description ?? local.notes,
              location: event.location ?? local.location,
              reminders: source === 'event' ? reminders : local.reminders,
              start: startISO,
              end: endISO,
              allDay,
              source,
              originProvider: source === 'external' ? 'google' : undefined,
            });
            upsertRemoteLink(local.id, 'google', cal.id, event.id, nowISO());
            result.pulled++;
          } else {
            const created = createItem({
              title,
              notes: event.description ?? undefined,
              location: event.location ?? undefined,
              reminders,
              tags: source === 'external' ? ['#gcal'] : [],
              priority: 0,
              source,
              originProvider: source === 'external' ? 'google' : undefined,
              start: startISO,
              end: endISO,
              allDay,
            });
            upsertRemoteLink(created.id, 'google', cal.id, event.id, nowISO());
            result.pulled++;
          }
        }

        if (response.data.nextSyncToken) {
          syncTokens[cal.id] = response.data.nextSyncToken;
        }
      } catch (e) {
        if (isSyncTokenExpired(e)) {
          delete syncTokens[cal.id];
          clearSyncToken(cal.id);
        }
        result.errors.push(`Pull failed for "${cal.summary}": ${errorMessage(e)}`);
      }
    }

    setSyncTokens(syncTokens);
  } catch (e) {
    result.errors.push((e as Error).message);
  }

  return result;
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
  if (!isMytimeCalendar) return 'external';
  const type = event.extendedProperties?.private?.mytime_type;
  if (type === 'event') return 'event';
  if (type === 'task') return 'task';
  if (local?.source === 'event' || local?.source === 'task') return local.source;
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

  const mytimeCalendarId = await getOrCreateMytimeCalendarId();
  const link = getRemoteLink(item.id, 'google');
  const response = await upsertEvent(
    mytimeCalendarId,
    {
      summary: item.title,
      description: buildEventDescription(item),
      location: item.location,
      start: item.start,
      end: item.end,
      allDay: item.allDay,
      reminders: item.reminders,
      mytimeType: 'event',
      mytimeId: item.id,
    },
    link?.remoteCalendarId === mytimeCalendarId ? link.remoteEventId : undefined,
  );
  const eventId = response.data.id ?? link?.remoteEventId;
  if (!eventId) throw new Error('Google Calendar did not return an event ID');
  upsertRemoteLink(item.id, 'google', mytimeCalendarId, eventId);
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

export async function removeFromGoogle(item: Item): Promise<void> {
  if ((item.source !== 'task' && item.source !== 'event') || !isAuthenticated()) return;

  const mytimeCalendarId = getMeta(META_KEYS.googleCalendarId) ?? (await getOrCreateMytimeCalendarId());
  const storedLink = getRemoteLink(item.id, 'google');
  const link = storedLink ??
    (item.remoteReference?.provider === 'google'
      ? {
          remoteCalendarId: item.remoteReference.calendarId,
          remoteEventId: item.remoteReference.eventId,
        }
      : null);
  if (!link || link.remoteCalendarId !== mytimeCalendarId) return;

  try {
    await deleteEvent(mytimeCalendarId, link.remoteEventId);
  } catch (e) {
    const status = (e as { code?: number; response?: { status?: number } }).code ?? (e as { response?: { status?: number } }).response?.status;
    if (status !== 404 && status !== 410) throw e;
  }
  deleteRemoteLink(item.id, 'google');
}
