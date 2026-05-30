import { DateTime } from 'luxon';
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
  getItemByGoogleEvent,
  listNeedsSync,
  markSynced,
  updateItem,
} from '../db/items.js';
import { META_KEYS, getMeta, getSyncTokens, setSyncTokens, clearSyncToken } from '../db/meta.js';
import { errorMessage, isSyncTokenExpired } from './errors.js';
import { nowISO } from '../lib/time.js';
import type { Item, ItemSource } from '../db/types.js';

export type SyncResult = {
  pushed: number;
  pulled: number;
  deleted: number;
  calendars: number;
  errors: string[];
};

export async function syncWithGoogle(): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, deleted: 0, calendars: 0, errors: [] };

  if (!isAuthenticated()) {
    result.errors.push('Not authenticated. Run: mytime auth');
    return result;
  }

  try {
    const mytimeCalendarId = await getOrCreateMytimeCalendarId();
    const syncTokens = getSyncTokens();

    // Push local task changes to the mytime calendar only
    const toPush = listNeedsSync();
    for (const item of toPush) {
      try {
        if (await pushTask(item)) result.pushed++;
      } catch (e) {
        result.errors.push(`Push failed for "${item.title}": ${(e as Error).message}`);
      }
    }

    // Pull from all selected Google calendars
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
        const source: ItemSource = isMytimeCalendar ? 'task' : 'external';

        for (const event of events) {
          if (!event.id) continue;

          const local = getItemByGoogleEvent(cal.id, event.id);

          if (event.status === 'cancelled') {
            if (local) {
              deleteItem(local.id);
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

          // The done marker lives only on Google; keep local titles clean.
          const rawSummary = event.summary ?? 'Untitled';
          const title = isMytimeCalendar ? stripDonePrefix(rawSummary) : rawSummary;

          if (local) {
            const remoteUpdated = event.updated ? DateTime.fromISO(event.updated).toMillis() : 0;
            const localUpdated = DateTime.fromISO(local.updatedAt).toMillis();
            const hasUnpushedLocalEdits =
              local.source === 'task' && (!local.syncedAt || local.updatedAt > local.syncedAt);

            if (hasUnpushedLocalEdits && localUpdated > remoteUpdated) {
              continue;
            }

            updateItem(local.id, {
                title,
                notes: event.description ?? local.notes,
                start: startISO,
                end: endISO,
                allDay,
                source,
                googleCalendarId: cal.id,
                googleEventId: event.id,
                syncedAt: nowISO(),
            });
            result.pulled++;
          } else {
            createItem({
              title,
              notes: event.description ?? undefined,
              tags: source === 'external' ? ['@gcal'] : [],
              priority: 0,
              source,
              start: startISO,
              end: endISO,
              allDay,
              googleEventId: event.id,
              googleCalendarId: cal.id,
              syncedAt: nowISO(),
            });
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

/**
 * Push a single task to the mytime calendar (create or update). Returns false
 * when there is nothing to push (not authed, not a task, or unscheduled).
 * Done tasks keep their event but get a ✓ prefix on Google.
 */
export async function pushTask(item: Item): Promise<boolean> {
  if (!isAuthenticated()) return false;
  if (item.source !== 'task' || !item.start || !item.end) return false;

  const mytimeCalendarId = await getOrCreateMytimeCalendarId();
  const summary = item.status === 'done' ? `${DONE_PREFIX}${item.title}` : item.title;
  const response = await upsertEvent(
    mytimeCalendarId,
    {
      summary,
      description: buildDescription(item),
      start: item.start,
      end: item.end,
      allDay: item.allDay,
    },
    item.googleCalendarId === mytimeCalendarId ? item.googleEventId : undefined,
  );
  markSynced(item.id, response.data.id ?? item.googleEventId, mytimeCalendarId);
  return true;
}

function parseEventTime(value: string, allDay: boolean): string {
  if (allDay) {
    return DateTime.fromISO(value).toISODate()!;
  }
  return DateTime.fromISO(value).toISO()!;
}

function buildDescription(item: Item): string {
  const parts: string[] = [];
  if (item.notes) parts.push(item.notes);
  if (item.project) parts.push(`Project: #${item.project}`);
  if (item.tags.length) parts.push(`Tags: ${item.tags.join(' ')}`);
  if (item.priority) parts.push(`Priority: P${item.priority}`);
  parts.push('— synced via mytime');
  return parts.join('\n');
}

export async function removeFromGoogle(item: Item): Promise<void> {
  if (item.source !== 'task' || !item.googleEventId || !isAuthenticated()) return;

  const mytimeCalendarId = getMeta(META_KEYS.googleCalendarId) ?? (await getOrCreateMytimeCalendarId());
  if (item.googleCalendarId && item.googleCalendarId !== mytimeCalendarId) return;

  try {
    await deleteEvent(mytimeCalendarId, item.googleEventId);
  } catch (e) {
    // A 404/410 means the event is already gone — that's fine. Surface anything else.
    const status = (e as { code?: number; response?: { status?: number } }).code ?? (e as { response?: { status?: number } }).response?.status;
    if (status !== 404 && status !== 410) throw e;
  }
}
