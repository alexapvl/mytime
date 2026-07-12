import { DateTime } from 'luxon';
import { getDb } from './schema.js';
import { Item, ItemRow, Reminder, rowToItem, itemToRow } from './types.js';
import { nowISO } from '../lib/time.js';
import { cleanTitle } from '../lib/textClean.js';
import { defaultReminders } from '../lib/reminders.js';
import { v4 as uuidv4 } from 'uuid';

const SELECT = `
  SELECT id, title, notes, project, tags, priority, status, source, location, reminders, all_day,
         start, end, google_event_id, google_calendar_id, synced_at, updated_at, created_at, completed_at
  FROM items
`;

const INSERT_SQL = `INSERT INTO items (id, title, notes, project, tags, priority, status, source, location, reminders, start, end, all_day, google_event_id, google_calendar_id, synced_at, updated_at, created_at, completed_at)
       VALUES (@id, @title, @notes, @project, @tags, @priority, @status, @source, @location, @reminders, @start, @end, @all_day, @google_event_id, @google_calendar_id, @synced_at, @updated_at, @created_at, @completed_at)`;

const UPDATE_SQL = `UPDATE items SET title=@title, notes=@notes, project=@project, tags=@tags, priority=@priority,
       status=@status, source=@source, location=@location, reminders=@reminders, start=@start, end=@end, all_day=@all_day, google_event_id=@google_event_id,
       google_calendar_id=@google_calendar_id, synced_at=@synced_at, updated_at=@updated_at, completed_at=@completed_at
       WHERE id=@id`;

export function createItem(
  partial: Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'source' | 'allDay' | 'reminders'> & {
    status?: Item['status'];
    source?: Item['source'];
    allDay?: boolean;
    reminders?: Reminder[];
  },
): Item {
  const now = nowISO();
  const item: Item = {
    id: uuidv4(),
    title: cleanTitle(partial.title),
    notes: partial.notes,
    project: partial.project,
    tags: partial.tags ?? [],
    priority: partial.priority ?? 0,
    status: partial.status ?? 'open',
    source: partial.source ?? 'task',
    location: partial.location,
    reminders: partial.reminders ?? [],
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

  getDb().prepare(INSERT_SQL).run(itemToRow(item));
  return item;
}

export function createEvent(
  partial: Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'source' | 'allDay' | 'reminders' | 'priority' | 'project' | 'tags'> & {
    allDay?: boolean;
    reminders?: Reminder[];
  },
): Item {
  return createItem({
    ...partial,
    source: 'event',
    status: 'open',
    tags: [],
    priority: 0,
    reminders: partial.reminders ?? defaultReminders(),
  });
}

function eventSafeUpdates(updates: Partial<Item>): Partial<Item> {
  const { status: _status, completedAt: _completedAt, project: _project, priority: _priority, tags: _tags, ...rest } =
    updates;
  return rest;
}

function normalizeEventFields(item: Item): Item {
  return {
    ...item,
    status: 'open',
    completedAt: undefined,
    project: undefined,
    priority: 0,
    tags: [],
  };
}

export function updateItem(id: string, updates: Partial<Item>): Item | null {
  const existing = getItem(id);
  if (!existing) return null;

  const safeUpdates = existing.source === 'event' ? eventSafeUpdates(updates) : updates;

  let item: Item = {
    ...existing,
    ...safeUpdates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: nowISO(),
    ...(safeUpdates.title !== undefined ? { title: cleanTitle(safeUpdates.title) } : {}),
  };

  if (item.source === 'event') item = normalizeEventFields(item);

  getDb().prepare(UPDATE_SQL).run(itemToRow(item));
  return item;
}

export function deleteItem(id: string): boolean {
  const result = getDb().prepare('DELETE FROM items WHERE id = ?').run(id);
  return result.changes > 0;
}

export function deleteItemsByGoogleCalendar(calendarId: string): number {
  const result = getDb().prepare('DELETE FROM items WHERE google_calendar_id = ?').run(calendarId);
  return result.changes;
}

export function restoreItem(item: Item): Item {
  getDb().prepare(INSERT_SQL).run(itemToRow(item));
  return item;
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

  const legacy = getDb()
    .prepare(`${SELECT} WHERE google_event_id = ? AND google_calendar_id IS NULL`)
    .get(eventId) as ItemRow | undefined;
  return legacy ? rowToItem(legacy) : null;
}

export function isPastDue(item: Item, now: DateTime = DateTime.local()): boolean {
  if (item.status !== 'open' || item.source !== 'task' || !item.start) return false;

  if (item.allDay || !item.start.includes('T')) {
    return DateTime.fromISO(item.start).startOf('day') < now.startOf('day');
  }

  const deadline = item.end ? DateTime.fromISO(item.end) : DateTime.fromISO(item.start);
  return deadline < now;
}

export function listPastDue(now: DateTime = DateTime.local()): Item[] {
  const rows = getDb()
    .prepare(
      `${SELECT} WHERE status = 'open' AND source = 'task' AND start IS NOT NULL ORDER BY start ASC`,
    )
    .all() as ItemRow[];
  return rows.map(rowToItem).filter((item) => isPastDue(item, now));
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
  // Use local date-only bounds for all-day rows. SQLite date() misparses ISO strings with
  // timezone offsets (e.g. midnight +03:00 becomes the previous UTC day).
  const rangeStartDate = DateTime.fromISO(start).toISODate()!;
  const rangeEndDate = DateTime.fromISO(end).toISODate()!;
  const rows = getDb()
    .prepare(
      `${SELECT}
       WHERE start IS NOT NULL
         AND (
           (all_day = 1 AND start <= ? AND (end IS NULL OR end > ?))
           OR (all_day = 0 AND start < ? AND (end IS NULL OR end > ?))
         )
       ORDER BY all_day DESC, start ASC`,
    )
    .all(rangeEndDate, rangeStartDate, end, start) as ItemRow[];
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
      `${SELECT}
       WHERE start IS NOT NULL AND (synced_at IS NULL OR updated_at > synced_at)
         AND (
           (source = 'task' AND status = 'open')
           OR source = 'event'
         )`,
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

export function rescheduleLocalItem(id: string, start: string, end: string, allDay: boolean): Item | null {
  const item = getItem(id);
  if (!item || item.source === 'external') return null;
  return updateItem(id, { start, end, allDay, syncedAt: undefined });
}

export function markSynced(id: string, googleEventId?: string, googleCalendarId?: string): Item | null {
  const now = nowISO();
  const updates: Partial<Item> = { syncedAt: now };
  if (googleEventId) updates.googleEventId = googleEventId;
  if (googleCalendarId) updates.googleCalendarId = googleCalendarId;
  return updateItem(id, updates);
}
