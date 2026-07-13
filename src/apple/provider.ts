import { DateTime } from 'luxon';
import type { CalendarProviderAdapter, ProviderStatus, SyncResult } from '../calendar/types.js';
import {
  createItem,
  deleteItem,
  getItem,
  updateItem,
} from '../db/items.js';
import {
  deleteRemoteLink,
  findItemByRemote,
  getRemoteLink,
  listExternalRemoteLinks,
  listItemsNeedingProviderSync,
  upsertRemoteLink,
} from '../db/remoteLinks.js';
import {
  deleteMeta,
  getMeta,
  getProviderCalendarFetchPrefs,
  META_KEYS,
} from '../db/meta.js';
import type { Item, ItemSource } from '../db/types.js';
import { cleanTitle } from '../lib/textClean.js';
import {
  deleteAppleCalendar,
  deleteAppleEvent,
  getAppleAuthorizationStatus,
  listAppleCalendars,
  queryAppleEvents,
  upsertAppleEvent,
  type AppleEvent,
} from './client.js';

const DONE_PREFIX = '✓ ';

function appleError(error: unknown): string {
  const typed = error as Error & { hint?: string };
  return typed.hint ? `${typed.message}. ${typed.hint}` : typed.message;
}

async function status(): Promise<ProviderStatus> {
  if (process.platform !== 'darwin') {
    return {
      provider: 'apple',
      configured: false,
      connected: false,
      detail: 'Apple Calendar requires macOS 14 or newer',
    };
  }
  try {
    const authorization = await getAppleAuthorizationStatus();
    const configured = Boolean(getMeta(META_KEYS.appleCalendarId));
    return {
      provider: 'apple',
      configured,
      connected: authorization === 'full_access' && configured,
      detail:
        authorization === 'full_access'
          ? configured
            ? 'Apple Calendar connected'
            : 'Run: mytime setup apple'
          : 'Run: mytime setup apple and approve Full Calendar access',
    };
  } catch (error) {
    return { provider: 'apple', configured: false, connected: false, detail: appleError(error) };
  }
}

function eventSource(event: AppleEvent, isMytimeCalendar: boolean, local: Item | null): ItemSource {
  if (!isMytimeCalendar) return 'external';
  if (event.mytimeItemType === 'task' || event.mytimeItemType === 'event') return event.mytimeItemType;
  if (local?.source === 'task' || local?.source === 'event') return local.source;
  return 'event';
}

function cleanPulledTitle(title: string, isMytimeCalendar: boolean): string {
  return cleanTitle(isMytimeCalendar ? title.replace(/^✓\s+/, '') : title);
}

function remoteEventId(event: AppleEvent, isMytimeCalendar: boolean): string {
  return !isMytimeCalendar && event.occurrenceStart
    ? `${event.id}::${event.occurrenceStart}`
    : event.id;
}

function localFromAppleEvent(
  event: AppleEvent,
  isMytimeCalendar: boolean,
  scopedEventId: string,
): Item | null {
  let local = findItemByRemote('apple', event.calendarId, scopedEventId);
  if (!local && isMytimeCalendar && event.mytimeItemId) {
    const embedded = getItem(event.mytimeItemId);
    if (embedded?.source === 'task' || embedded?.source === 'event') {
      local = embedded;
      upsertRemoteLink(
        local.id,
        'apple',
        event.calendarId,
        scopedEventId,
        event.lastModified ?? '1970-01-01T00:00:00.000Z',
      );
    }
  }
  return local;
}

async function syncWithApple(): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, deleted: 0, calendars: 0, errors: [] };
  const providerStatus = await status();
  if (!providerStatus.connected) {
    result.errors.push(providerStatus.detail ?? 'Apple Calendar is not connected');
    return result;
  }

  const mytimeCalendarId = getMeta(META_KEYS.appleCalendarId)!;

  for (const item of listItemsNeedingProviderSync('apple')) {
    try {
      if (await pushAppleItem(item)) result.pushed++;
    } catch (error) {
      result.errors.push(`Push failed for "${item.title}": ${appleError(error)}`);
    }
  }

  let calendars;
  try {
    calendars = await listAppleCalendars();
  } catch (error) {
    result.errors.push(appleError(error));
    return result;
  }

  const prefs = getProviderCalendarFetchPrefs('apple');
  const selected = calendars.filter((calendar) =>
    calendar.id === mytimeCalendarId || prefs[calendar.id] !== false,
  );
  result.calendars = selected.length;

  const rangeStart = DateTime.local().minus({ days: 30 }).startOf('day').toISO()!;
  const rangeEnd = DateTime.local().plus({ days: 365 }).endOf('day').toISO()!;
  const seen = new Set<string>();

  for (const calendar of selected) {
    try {
      const events = await queryAppleEvents(calendar.id, rangeStart, rangeEnd);
      const isMytimeCalendar = calendar.id === mytimeCalendarId;

      for (const event of events) {
        if (!event.id) continue;
        const scopedEventId = remoteEventId(event, isMytimeCalendar);
        seen.add(`${calendar.id}\0${scopedEventId}`);
        const local = localFromAppleEvent(event, isMytimeCalendar, scopedEventId);

        if (event.status === 'canceled') {
          if (local) {
            deleteItem(local.id);
            result.deleted++;
          }
          continue;
        }

        const source = eventSource(event, isMytimeCalendar, local);
        if (local) {
          const link = getRemoteLink(local.id, 'apple');
          const remoteUpdated = event.lastModified ? DateTime.fromISO(event.lastModified).toMillis() : 0;
          const localUpdated = DateTime.fromISO(local.updatedAt).toMillis();
          const hasUnpushedLocalEdits =
            (local.source === 'task' || local.source === 'event') &&
            (!link || local.updatedAt > link.syncedAt);
          if (hasUnpushedLocalEdits && localUpdated > remoteUpdated) continue;

          updateItem(local.id, {
            title: cleanPulledTitle(event.title || 'Untitled', isMytimeCalendar),
            notes: event.notes ?? local.notes,
            location: event.location ?? local.location,
            reminders: source === 'event' ? event.reminders ?? [] : local.reminders,
            start: event.start,
            end: event.end,
            allDay: event.allDay,
            source,
            originProvider: source === 'external' ? 'apple' : undefined,
          });
          upsertRemoteLink(local.id, 'apple', calendar.id, scopedEventId);
          result.pulled++;
        } else {
          const created = createItem({
            title: cleanPulledTitle(event.title || 'Untitled', isMytimeCalendar),
            notes: event.notes,
            location: event.location,
            reminders: source === 'event' ? event.reminders ?? [] : [],
            tags: source === 'external' ? ['#apple'] : [],
            priority: 0,
            source,
            originProvider: source === 'external' ? 'apple' : undefined,
            start: event.start,
            end: event.end,
            allDay: event.allDay,
          });
          upsertRemoteLink(created.id, 'apple', calendar.id, scopedEventId);
          result.pulled++;
        }
      }
    } catch (error) {
      result.errors.push(`Pull failed for "${calendar.title}": ${appleError(error)}`);
    }
  }

  const selectedIds = new Set(selected.map((calendar) => calendar.id));
  for (const link of listExternalRemoteLinks('apple')) {
    if (selectedIds.has(link.remoteCalendarId) && !seen.has(`${link.remoteCalendarId}\0${link.remoteEventId}`)) {
      if (deleteItem(link.itemId)) result.deleted++;
    }
  }

  return result;
}

function taskNotes(item: Item): string {
  const parts: string[] = [];
  if (item.notes) parts.push(item.notes);
  if (item.project) parts.push(`Project: @${item.project}`);
  if (item.tags.length) parts.push(`Tags: ${item.tags.join(' ')}`);
  if (item.priority) parts.push(`Priority: P${item.priority}`);
  parts.push('- synced via mytime');
  return parts.join('\n');
}

async function pushAppleItem(item: Item): Promise<boolean> {
  if ((item.source !== 'task' && item.source !== 'event') || !item.start || !item.end) return false;
  const calendarId = getMeta(META_KEYS.appleCalendarId);
  if (!calendarId) return false;
  const storedLink = getRemoteLink(item.id, 'apple');
  const link = storedLink ??
    (item.remoteReference?.provider === 'apple'
      ? {
          remoteCalendarId: item.remoteReference.calendarId,
          remoteEventId: item.remoteReference.eventId,
        }
      : null);
  const event = await upsertAppleEvent({
    calendarId,
    eventId: link?.remoteCalendarId === calendarId ? link.remoteEventId : undefined,
    title: item.source === 'task' && item.status === 'done' ? `${DONE_PREFIX}${item.title}` : item.title,
    notes: item.source === 'task' ? taskNotes(item) : [item.notes, '- mytime event'].filter(Boolean).join('\n'),
    location: item.location,
    mytimeItemId: item.id,
    mytimeItemType: item.source,
    start: item.start,
    end: item.end,
    allDay: item.allDay,
    reminders: item.source === 'event' ? item.reminders : undefined,
  });
  if (!event.id) throw new Error('Apple Calendar did not return an event ID');
  upsertRemoteLink(item.id, 'apple', calendarId, event.id);
  return true;
}

async function removeFromApple(item: Item): Promise<void> {
  if (item.source !== 'task' && item.source !== 'event') return;
  const link = getRemoteLink(item.id, 'apple');
  const calendarId = getMeta(META_KEYS.appleCalendarId);
  if (!link || !calendarId || link.remoteCalendarId !== calendarId) return;
  await deleteAppleEvent(calendarId, link.remoteEventId);
  deleteRemoteLink(item.id, 'apple');
}

async function deleteMytimeAppleCalendar(): Promise<boolean> {
  const calendarId = getMeta(META_KEYS.appleCalendarId);
  if (!calendarId) return false;
  let deleted: boolean;
  try {
    deleted = await deleteAppleCalendar(calendarId);
  } catch (error) {
    if ((error as Error & { code?: string }).code !== 'calendar_not_found') throw error;
    deleted = true;
  }
  if (deleted) deleteMeta(META_KEYS.appleCalendarId);
  return deleted;
}

export const appleProvider: CalendarProviderAdapter = {
  status,
  sync: syncWithApple,
  push: pushAppleItem,
  remove: removeFromApple,
  deleteMytimeCalendar: deleteMytimeAppleCalendar,
};
