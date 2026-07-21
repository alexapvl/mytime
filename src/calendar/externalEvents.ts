import type { calendar_v3 } from '@googleapis/calendar';
import { getItem, restoreItem, updateItem } from '../db/items.js';
import {
  getRemoteLink,
  upsertRemoteLink,
  type RemoteEventAccess,
  type RemoteLink,
} from '../db/remoteLinks.js';
import type { Item, Reminder } from '../db/types.js';
import {
  deleteGoogleEvent,
  getGoogleEvent,
  patchGoogleEvent,
  restoreGoogleEvent,
} from '../google/calendar.js';
import { remindersToGoogle } from '../lib/reminders.js';
import {
  deleteAppleEvent,
  getAppleEvent,
  upsertAppleEvent,
  type AppleEvent,
} from '../apple/client.js';
import { eventCapabilities } from './eventCapabilities.js';

export type ExternalEventPatch = {
  title?: string;
  notes?: string;
  location?: string;
  url?: string;
  reminders?: Reminder[];
  attendees?: Item['attendees'];
  start?: string;
  end?: string;
  allDay?: boolean;
};

export type ExternalDeleteSnapshot = {
  item: Item;
  link: RemoteLink;
  remote: calendar_v3.Schema$Event | AppleEvent;
};

function requireExternalLink(item: Item): RemoteLink {
  if (item.source !== 'external' || !item.originProvider) {
    throw new Error('Item is not an external calendar event');
  }
  const link = getRemoteLink(item.id, item.originProvider);
  if (!link) throw new Error('Remote calendar link missing. Sync and try again.');
  return link;
}

function accessFromLink(link: RemoteLink, etag = link.etag): RemoteEventAccess {
  return {
    canEditDetails: link.canEditDetails,
    canEditReminders: link.canEditReminders,
    canEditGuests: link.canEditGuests,
    canDelete: link.canDelete,
    recurring: link.recurring,
    etag,
  };
}

function validatePatch(item: Item, patch: ExternalEventPatch): void {
  const capabilities = eventCapabilities(item);
  const editsDetails = ['title', 'notes', 'location', 'url'].some((field) => field in patch);
  const editsSchedule = ['start', 'end', 'allDay'].some((field) => field in patch);
  if (editsDetails && !capabilities.canEditDetails) throw new Error('Event details are read-only.');
  if (editsSchedule && !capabilities.canReschedule) throw new Error('Event schedule is read-only.');
  if ('reminders' in patch && !capabilities.canEditReminders) throw new Error('Event reminders are read-only.');
  if ('attendees' in patch && !capabilities.canEditGuests) throw new Error('Event guest list is read-only.');
}

function googlePatch(item: Item, patch: ExternalEventPatch): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = {};
  if ('title' in patch) body.summary = patch.title;
  if ('notes' in patch) body.description = patch.notes ?? '';
  if ('location' in patch) body.location = patch.location ?? '';
  if ('reminders' in patch) body.reminders = remindersToGoogle(patch.reminders ?? []);
  if ('attendees' in patch) {
    body.attendees = (patch.attendees ?? []).map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
      optional: attendee.optional,
      responseStatus: attendee.responseStatus,
    }));
  }
  if ('start' in patch || 'end' in patch || 'allDay' in patch) {
    const start = patch.start ?? item.start;
    const end = patch.end ?? item.end;
    const allDay = patch.allDay ?? item.allDay;
    if (!start || !end) throw new Error('External event must have a start and end');
    body.start = allDay ? { date: start } : { dateTime: start };
    body.end = allDay ? { date: end } : { dateTime: end };
  }
  return body;
}

function appleEventIdentity(remoteEventId: string): { eventId: string; occurrenceStart?: string } {
  const separator = remoteEventId.indexOf('::');
  return separator === -1
    ? { eventId: remoteEventId }
    : {
        eventId: remoteEventId.slice(0, separator),
        occurrenceStart: remoteEventId.slice(separator + 2),
      };
}

export async function updateExternalEvent(
  item: Item,
  patch: ExternalEventPatch,
  options: { notifyGuests?: boolean } = {},
): Promise<Item> {
  validatePatch(item, patch);
  const link = requireExternalLink(item);

  if (link.provider === 'google') {
    if ('url' in patch) throw new Error('Google Calendar events do not expose a separate URL field.');
    const response = await patchGoogleEvent(
      link.remoteCalendarId,
      link.remoteEventId,
      googlePatch(item, patch),
      { etag: link.etag, notifyGuests: options.notifyGuests },
    );
    const updated = updateItem(item.id, patch);
    if (!updated) throw new Error('Local event disappeared during update');
    upsertRemoteLink(
      item.id,
      'google',
      link.remoteCalendarId,
      link.remoteEventId,
      undefined,
      accessFromLink(link, response.data.etag ?? undefined),
    );
    return getItem(item.id)!;
  }

  const next = { ...item, ...patch };
  const identity = appleEventIdentity(link.remoteEventId);
  if (!next.start || !next.end) throw new Error('External event must have a start and end');
  const response = await upsertAppleEvent({
    calendarId: link.remoteCalendarId,
    eventId: identity.eventId,
    occurrenceStart: identity.occurrenceStart,
    title: next.title,
    notes: next.notes,
    location: next.location,
    url: next.url,
    start: next.start,
    end: next.end,
    allDay: next.allDay,
    reminders: next.reminders,
  });
  const updated = updateItem(item.id, patch);
  if (!updated) throw new Error('Local event disappeared during update');
  upsertRemoteLink(
    item.id,
    'apple',
    link.remoteCalendarId,
    response.id
      ? response.occurrenceStart
        ? `${response.id}::${response.occurrenceStart}`
        : response.id
      : link.remoteEventId,
    undefined,
    accessFromLink(link),
  );
  return getItem(item.id)!;
}

export async function deleteExternalEvent(
  item: Item,
  options: { notifyGuests?: boolean } = {},
): Promise<ExternalDeleteSnapshot> {
  const capabilities = eventCapabilities(item);
  if (!capabilities.canDelete) throw new Error(capabilities.reason ?? 'Event cannot be deleted.');
  const link = requireExternalLink(item);

  if (link.provider === 'google') {
    const remote = (await getGoogleEvent(link.remoteCalendarId, link.remoteEventId)).data;
    await deleteGoogleEvent(link.remoteCalendarId, link.remoteEventId, {
      etag: link.etag,
      notifyGuests: options.notifyGuests,
    });
    return { item, link, remote };
  }

  const identity = appleEventIdentity(link.remoteEventId);
  const remote = await getAppleEvent(link.remoteCalendarId, identity.eventId, identity.occurrenceStart);
  await deleteAppleEvent(link.remoteCalendarId, identity.eventId, identity.occurrenceStart);
  return { item, link, remote };
}

export async function restoreDeletedExternalEvent(
  snapshot: ExternalDeleteSnapshot,
  options: { notifyGuests?: boolean } = {},
): Promise<Item> {
  const { item, link } = snapshot;
  let eventId = link.remoteEventId;
  let etag = link.etag;
  let recurring = link.recurring;

  if (link.provider === 'google') {
    const response = await restoreGoogleEvent(
      link.remoteCalendarId,
      link.remoteEventId,
      snapshot.remote as calendar_v3.Schema$Event,
      options.notifyGuests,
    );
    etag = response.data.etag ?? undefined;
  } else {
    const remote = snapshot.remote as AppleEvent;
    const response = await upsertAppleEvent({
      calendarId: link.remoteCalendarId,
      title: remote.title,
      notes: remote.notes,
      location: remote.location,
      url: remote.url,
      start: remote.start,
      end: remote.end,
      allDay: remote.allDay,
      reminders: remote.reminders,
    });
    if (!response.id) throw new Error('Apple Calendar did not return restored event ID');
    eventId = response.id;
    recurring = false;
  }

  restoreItem(item);
  upsertRemoteLink(
    item.id,
    link.provider,
    link.remoteCalendarId,
    eventId,
    undefined,
    { ...accessFromLink(link, etag), recurring },
  );
  return getItem(item.id)!;
}

export function externalPatchFromSnapshot(item: Item): ExternalEventPatch {
  const capabilities = eventCapabilities(item);
  return {
    ...(capabilities.canEditDetails
      ? {
          title: item.title,
          notes: item.notes,
          location: item.location,
          ...(item.originProvider === 'apple' ? { url: item.url } : {}),
        }
      : {}),
    ...(capabilities.canEditReminders ? { reminders: item.reminders } : {}),
    ...(capabilities.canEditGuests ? { attendees: item.attendees } : {}),
    ...(capabilities.canReschedule
      ? { start: item.start, end: item.end, allDay: item.allDay }
      : {}),
  };
}

export function hasOtherAttendees(item: Item): boolean {
  return item.attendees.some((attendee) => !attendee.self);
}

export function externalPatchMayNotifyGuests(item: Item, patch: ExternalEventPatch): boolean {
  if (item.originProvider !== 'google' || !hasOtherAttendees(item)) return false;
  return ['title', 'notes', 'location', 'attendees', 'start', 'end', 'allDay'].some((field) => field in patch);
}

export function externalDeleteMayNotifyGuests(item: Item): boolean {
  return item.originProvider === 'google' && item.organizer?.self === true && hasOtherAttendees(item);
}
