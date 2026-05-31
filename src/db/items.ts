import { getDb } from './schema.js';
import { Item, ItemRow, rowToItem, itemToRow } from './types.js';
import { nowISO } from '../lib/time.js';
import { v4 as uuidv4 } from 'uuid';

const SELECT = `
  SELECT id, title, notes, project, tags, priority, status, source, all_day,
         start, end, google_event_id, google_calendar_id, synced_at, updated_at, created_at, completed_at
  FROM items
`;

export function createItem(
  partial: Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'source' | 'allDay'> & {
    status?: Item['status'];
    source?: Item['source'];
    allDay?: boolean;
  },
): Item {
  const now = nowISO();
  const item: Item = {
    id: uuidv4(),
    title: partial.title,
    notes: partial.notes,
    project: partial.project,
    tags: partial.tags ?? [],
    priority: partial.priority ?? 0,
    status: partial.status ?? 'open',
    source: partial.source ?? 'task',
    start: partial.start,
    end: partial.end,
    allDay: partial.allDay ?? false,
    googleEventId: partial.googleEventId,
    googleCalendarId: partial.googleCalendarId,
    syncedAt: partial.syncedAt,
    createdAt: now,
    updatedAt: now,
    completedAt: partial.completedAt,
  };

  const row = itemToRow(item);
  getDb()
    .prepare(
      `INSERT INTO items (id, title, notes, project, tags, priority, status, source, start, end, all_day, google_event_id, google_calendar_id, synced_at, updated_at, created_at, completed_at)
       VALUES (@id, @title, @notes, @project, @tags, @priority, @status, @source, @start, @end, @all_day, @google_event_id, @google_calendar_id, @synced_at, @updated_at, @created_at, @completed_at)`,
    )
    .run(row);

  return item;
}

export function updateItem(id: string, updates: Partial<Item>): Item | null {
  const existing = getItem(id);
  if (!existing) return null;

  const item: Item = {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: nowISO(),
  };

  const row = itemToRow(item);
  getDb()
    .prepare(
      `UPDATE items SET title=@title, notes=@notes, project=@project, tags=@tags, priority=@priority,
       status=@status, source=@source, start=@start, end=@end, all_day=@all_day, google_event_id=@google_event_id,
       google_calendar_id=@google_calendar_id, synced_at=@synced_at, updated_at=@updated_at, completed_at=@completed_at
       WHERE id=@id`,
    )
    .run(row);

  return item;
}

export function deleteItem(id: string): boolean {
  const result = getDb().prepare('DELETE FROM items WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getItem(id: string): Item | null {
  const row = getDb().prepare(`${SELECT} WHERE id = ?`).get(id) as ItemRow | undefined;
  return row ? rowToItem(row) : null;
}

export function getItemByGoogleEvent(calendarId: string, eventId: string): Item | null {
  const row = getDb()
    .prepare(`${SELECT} WHERE google_calendar_id = ? AND google_event_id = ?`)
    .get(calendarId, eventId) as ItemRow | undefined;
  if (row) return rowToItem(row);

  // Legacy rows before google_calendar_id existed
  const legacy = getDb()
    .prepare(`${SELECT} WHERE google_event_id = ? AND google_calendar_id IS NULL`)
    .get(eventId) as ItemRow | undefined;
  return legacy ? rowToItem(legacy) : null;
}

export function listBacklog(): Item[] {
  const rows = getDb()
    .prepare(
      `${SELECT} WHERE status = 'open' AND source = 'task'
       ORDER BY (start IS NOT NULL), priority DESC, start ASC, created_at ASC`,
    )
    .all() as ItemRow[];
  return rows.map(rowToItem);
}

export function listScheduledInRange(start: string, end: string): Item[] {
  const rows = getDb()
    .prepare(
      `${SELECT}
       WHERE status = 'open'
         AND start IS NOT NULL
         AND (
           (all_day = 1 AND start <= date(?) AND (end IS NULL OR end > date(?)))
           OR (all_day = 0 AND start < ? AND (end IS NULL OR end > ?))
         )
       ORDER BY all_day DESC, start ASC`,
    )
    .all(end, start, end, start) as ItemRow[];
  return rows.map(rowToItem);
}

export function listAllScheduled(): Item[] {
  const rows = getDb()
    .prepare(`${SELECT} WHERE start IS NOT NULL ORDER BY start ASC`)
    .all() as ItemRow[];
  return rows.map(rowToItem);
}

export function listNeedsSync(): Item[] {
  const rows = getDb()
    .prepare(
      `${SELECT} WHERE source = 'task' AND start IS NOT NULL AND status = 'open' AND (synced_at IS NULL OR updated_at > synced_at)`,
    )
    .all() as ItemRow[];
  return rows.map(rowToItem);
}

export function toggleDone(id: string): Item | null {
  const item = getItem(id);
  if (!item || item.source !== 'task') return null;

  const done = item.status === 'done';
  return updateItem(id, {
    status: done ? 'open' : 'done',
    completedAt: done ? undefined : nowISO(),
  });
}

export function scheduleItem(id: string, start: string, end: string): Item | null {
  const item = getItem(id);
  if (!item || item.source !== 'task') return null;
  return updateItem(id, { start, end, allDay: false, syncedAt: undefined });
}

export function scheduleAllDayItem(id: string, start: string, end: string): Item | null {
  const item = getItem(id);
  if (!item || item.source !== 'task') return null;
  return updateItem(id, { start, end, allDay: true, syncedAt: undefined });
}

export function markSynced(id: string, googleEventId?: string, googleCalendarId?: string): Item | null {
  const now = nowISO();
  const updates: Partial<Item> = { syncedAt: now };
  if (googleEventId) updates.googleEventId = googleEventId;
  if (googleCalendarId) updates.googleCalendarId = googleCalendarId;
  return updateItem(id, updates);
}
