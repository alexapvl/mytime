import type { CalendarProvider } from '../calendar/types.js';
import { nowISO } from '../lib/time.js';
import { getDb } from './schema.js';
import type { Item, ItemRow } from './types.js';
import { rowToItem } from './types.js';

export type RemoteLink = {
  itemId: string;
  provider: CalendarProvider;
  remoteCalendarId: string;
  remoteEventId: string;
  syncedAt: string;
};

type RemoteLinkRow = {
  item_id: string;
  provider: string;
  remote_calendar_id: string;
  remote_event_id: string;
  synced_at: string;
};

const ITEM_SELECT = `
  SELECT i.id, i.title, i.notes, i.project, i.tags, i.priority, i.status, i.source, i.origin_provider,
         i.location, i.reminders, i.all_day, i.start, i.end, i.google_event_id,
         i.google_calendar_id, i.synced_at, i.updated_at, i.created_at, i.completed_at
  FROM items i
`;

function rowToLink(row: RemoteLinkRow): RemoteLink {
  return {
    itemId: row.item_id,
    provider: row.provider as CalendarProvider,
    remoteCalendarId: row.remote_calendar_id,
    remoteEventId: row.remote_event_id,
    syncedAt: row.synced_at,
  };
}

export function getRemoteLink(itemId: string, provider: CalendarProvider): RemoteLink | null {
  const row = getDb()
    .prepare('SELECT * FROM remote_links WHERE item_id = ? AND provider = ?')
    .get(itemId, provider) as RemoteLinkRow | undefined;
  return row ? rowToLink(row) : null;
}

export function findItemByRemote(
  provider: CalendarProvider,
  calendarId: string,
  eventId: string,
): Item | null {
  const row = getDb()
    .prepare(
      `${ITEM_SELECT}
       JOIN remote_links r ON r.item_id = i.id
       WHERE r.provider = ? AND r.remote_calendar_id = ? AND r.remote_event_id = ?`,
    )
    .get(provider, calendarId, eventId) as ItemRow | undefined;
  if (row) return rowToItem(row);

  const legacy = getDb()
    .prepare(
      `${ITEM_SELECT}
       JOIN remote_links r ON r.item_id = i.id
       WHERE r.provider = ? AND r.remote_calendar_id = '' AND r.remote_event_id = ?`,
    )
    .get(provider, eventId) as ItemRow | undefined;
  return legacy ? rowToItem(legacy) : null;
}

export function upsertRemoteLink(
  itemId: string,
  provider: CalendarProvider,
  remoteCalendarId: string,
  remoteEventId: string,
  syncedAt = nowISO(),
): void {
  getDb()
    .prepare(
      `INSERT INTO remote_links (item_id, provider, remote_calendar_id, remote_event_id, synced_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_id, provider) DO UPDATE SET
         remote_calendar_id = excluded.remote_calendar_id,
         remote_event_id = excluded.remote_event_id,
         synced_at = excluded.synced_at`,
    )
    .run(itemId, provider, remoteCalendarId, remoteEventId, syncedAt);

  if (provider === 'google') {
    getDb()
      .prepare(
        'UPDATE items SET google_calendar_id = ?, google_event_id = ?, synced_at = ? WHERE id = ?',
      )
      .run(remoteCalendarId, remoteEventId, syncedAt, itemId);
  }
}

export function deleteRemoteLink(itemId: string, provider: CalendarProvider): void {
  getDb().prepare('DELETE FROM remote_links WHERE item_id = ? AND provider = ?').run(itemId, provider);
}

export function listItemsNeedingProviderSync(provider: CalendarProvider): Item[] {
  const rows = getDb()
    .prepare(
      `${ITEM_SELECT}
       LEFT JOIN remote_links r ON r.item_id = i.id AND r.provider = ?
       WHERE i.start IS NOT NULL
         AND (r.synced_at IS NULL OR i.updated_at > r.synced_at)
         AND ((i.source = 'task' AND i.status = 'open') OR i.source = 'event')
       ORDER BY i.updated_at ASC`,
    )
    .all(provider) as ItemRow[];
  return rows.map(rowToItem);
}

export function deleteExternalItemsForProvider(provider: CalendarProvider): number {
  const result = getDb()
    .prepare(
      `DELETE FROM items
       WHERE source = 'external'
         AND (
           origin_provider = ?
           OR id IN (SELECT item_id FROM remote_links WHERE provider = ?)
         )`,
    )
    .run(provider, provider);
  return result.changes;
}

export function deleteProviderLinks(provider: CalendarProvider): number {
  const result = getDb().prepare('DELETE FROM remote_links WHERE provider = ?').run(provider);
  return result.changes;
}

export function deleteExternalItemsForCalendar(provider: CalendarProvider, calendarId: string): number {
  const result = getDb()
    .prepare(
      `DELETE FROM items
       WHERE source = 'external'
         AND id IN (
           SELECT item_id FROM remote_links
           WHERE provider = ? AND remote_calendar_id = ?
         )`,
    )
    .run(provider, calendarId);
  return result.changes;
}

export function listExternalRemoteLinks(provider: CalendarProvider): RemoteLink[] {
  const rows = getDb()
    .prepare(
      `SELECT r.*
       FROM remote_links r
       JOIN items i ON i.id = r.item_id
       WHERE r.provider = ? AND i.source = 'external'`,
    )
    .all(provider) as RemoteLinkRow[];
  return rows.map(rowToLink);
}
