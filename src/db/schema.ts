import Database from 'better-sqlite3';
import { DateTime } from 'luxon';
import { ensureMytimeDir, DB_PATH } from '../lib/config.js';
import { cleanTitle } from '../lib/textClean.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    ensureMytimeDir();
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      project TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      source TEXT NOT NULL DEFAULT 'task',
      origin_provider TEXT,
      start TEXT,
      end TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      google_event_id TEXT,
      google_calendar_id TEXT,
      synced_at TEXT,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_items_start ON items(start);
    CREATE INDEX IF NOT EXISTS idx_items_google_event ON items(google_event_id);
    CREATE INDEX IF NOT EXISTS idx_items_google_lookup ON items(google_calendar_id, google_event_id);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS remote_links (
      item_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      remote_calendar_id TEXT NOT NULL,
      remote_event_id TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (item_id, provider),
      UNIQUE (provider, remote_calendar_id, remote_event_id),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_remote_links_lookup
      ON remote_links(provider, remote_calendar_id, remote_event_id);
  `);

  migrateSchema(database);
}

function migrateSchema(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(items)').all() as { name: string }[];
  const names = new Set(columns.map((c) => c.name));

  if (!names.has('source')) {
    database.exec("ALTER TABLE items ADD COLUMN source TEXT NOT NULL DEFAULT 'task'");
  }
  if (!names.has('origin_provider')) {
    database.exec('ALTER TABLE items ADD COLUMN origin_provider TEXT');
  }
  if (!names.has('google_calendar_id')) {
    database.exec('ALTER TABLE items ADD COLUMN google_calendar_id TEXT');
  }
  if (!names.has('all_day')) {
    database.exec('ALTER TABLE items ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0');
  }
  if (!names.has('location')) {
    database.exec('ALTER TABLE items ADD COLUMN location TEXT');
  }
  if (!names.has('reminders')) {
    database.exec('ALTER TABLE items ADD COLUMN reminders TEXT');
  }
  migrateGoogleRemoteLinks(database);
  normalizeAllDayDates(database);
  normalizeAllDayRanges(database);
  normalizeTimedOvernightRanges(database);
  removeLegacyRemoteEventDuplicates(database);
  stripEmojiFromStoredTitles(database);
  normalizeEventTaskFields(database);
}

function normalizeAllDayRanges(database: Database.Database): void {
  const rows = database
    .prepare(
      `SELECT id, start, end
       FROM items
       WHERE all_day = 1 AND start IS NOT NULL AND end IS NOT NULL AND end <= start`,
    )
    .all() as { id: string; start: string; end: string }[];
  const update = database.prepare('UPDATE items SET end = ?, updated_at = ? WHERE id = ?');
  const updatedAt = DateTime.local().toISO();

  for (const row of rows) {
    const exclusiveEnd = DateTime.fromISO(row.start).plus({ days: 1 }).toISODate();
    if (exclusiveEnd) update.run(exclusiveEnd, updatedAt, row.id);
  }
}

function normalizeTimedOvernightRanges(database: Database.Database): void {
  const rows = database
    .prepare(
      `SELECT id, start, end
       FROM items
       WHERE all_day = 0 AND start IS NOT NULL AND end IS NOT NULL`,
    )
    .all() as { id: string; start: string; end: string }[];
  const update = database.prepare('UPDATE items SET end = ?, updated_at = ? WHERE id = ?');

  for (const row of rows) {
    const start = DateTime.fromISO(row.start);
    const end = DateTime.fromISO(row.end);
    if (!start.isValid || !end.isValid || end > start || end.toISODate() !== start.toISODate()) continue;

    const repairedEnd = end.plus({ days: 1 }).toISO();
    if (repairedEnd) update.run(repairedEnd, DateTime.local().toISO(), row.id);
  }
}

function normalizedEventNotes(value: string | null): string {
  return (value ?? '')
    .split('\n')
    .filter((line) => !/^\s*[\u2014-]\s*mytime event\s*$/i.test(line))
    .join('\n')
    .trim();
}

function normalizedReminderMinutes(value: string | null): string {
  if (!value) return '';
  try {
    const reminders = JSON.parse(value) as { method?: string; minutes?: number }[];
    return reminders
      .filter((reminder) => reminder.method === 'popup' && Number.isFinite(reminder.minutes))
      .map((reminder) => reminder.minutes!)
      .sort((a, b) => a - b)
      .join(',');
  } catch {
    return value;
  }
}

function removeLegacyRemoteEventDuplicates(database: Database.Database): void {
  const rows = database
    .prepare(
      `SELECT
         orphan.id AS orphan_id,
         orphan.notes AS orphan_notes,
         orphan.location AS orphan_location,
         orphan.reminders AS orphan_reminders,
         linked.id AS linked_id,
         linked.notes AS linked_notes,
         linked.location AS linked_location,
         linked.reminders AS linked_reminders
       FROM items orphan
       JOIN items linked
         ON linked.id != orphan.id
        AND linked.source = 'event'
        AND linked.title = orphan.title
        AND linked.start = orphan.start
        AND linked.end = orphan.end
        AND linked.all_day = orphan.all_day
       WHERE orphan.source = 'event'
         AND NOT EXISTS (SELECT 1 FROM remote_links WHERE item_id = orphan.id)
         AND EXISTS (SELECT 1 FROM remote_links WHERE item_id = linked.id)
         AND linked.notes GLOB '*mytime event*'`,
    )
    .all() as {
      orphan_id: string;
      orphan_notes: string | null;
      orphan_location: string | null;
      orphan_reminders: string | null;
      linked_id: string;
      linked_notes: string | null;
      linked_location: string | null;
      linked_reminders: string | null;
    }[];

  const matches = new Map<string, string[]>();
  for (const row of rows) {
    if (normalizedEventNotes(row.orphan_notes) !== normalizedEventNotes(row.linked_notes)) continue;
    if ((row.orphan_location ?? '') !== (row.linked_location ?? '')) continue;
    if (normalizedReminderMinutes(row.orphan_reminders) !== normalizedReminderMinutes(row.linked_reminders)) continue;
    matches.set(row.orphan_id, [...(matches.get(row.orphan_id) ?? []), row.linked_id]);
  }

  const remove = database.prepare('DELETE FROM items WHERE id = ?');
  for (const [orphanId, linkedIds] of matches) {
    if (new Set(linkedIds).size === 1) remove.run(orphanId);
  }
}

function migrateGoogleRemoteLinks(database: Database.Database): void {
  database.exec(`
    INSERT OR IGNORE INTO remote_links (
      item_id, provider, remote_calendar_id, remote_event_id, synced_at
    )
    SELECT
      id,
      'google',
      COALESCE(
        google_calendar_id,
        (SELECT value FROM meta WHERE key = 'google_calendar_id'),
        ''
      ),
      google_event_id,
      COALESCE(synced_at, updated_at)
    FROM items
    WHERE google_event_id IS NOT NULL
  `);
  database.exec(`
    UPDATE items
    SET origin_provider = 'google'
    WHERE source = 'external'
      AND origin_provider IS NULL
      AND google_event_id IS NOT NULL
  `);
  database.exec(`
    UPDATE remote_links
    SET remote_calendar_id = COALESCE(
      (SELECT google_calendar_id FROM items WHERE items.id = remote_links.item_id),
      (SELECT value FROM meta WHERE key = 'google_calendar_id'),
      remote_calendar_id
    )
    WHERE provider = 'google' AND remote_calendar_id = ''
  `);
  database.exec(`
    INSERT OR IGNORE INTO meta (key, value)
    SELECT 'active_calendar_provider', 'google'
    WHERE EXISTS (SELECT 1 FROM remote_links WHERE provider = 'google')
  `);
}

function normalizeEventTaskFields(database: Database.Database): void {
  database.exec(`
    UPDATE items SET
      status = 'open',
      completed_at = NULL,
      project = NULL,
      priority = 0,
      tags = '[]'
    WHERE source = 'event'
      AND (
        status != 'open'
        OR completed_at IS NOT NULL
        OR project IS NOT NULL
        OR priority != 0
        OR tags != '[]'
      )
  `);
}

function stripEmojiFromStoredTitles(database: Database.Database): void {
  const rows = database.prepare('SELECT id, title FROM items').all() as { id: string; title: string }[];
  const update = database.prepare('UPDATE items SET title = ? WHERE id = ?');
  for (const row of rows) {
    const title = cleanTitle(row.title);
    if (title !== row.title) update.run(title, row.id);
  }
}

function normalizeAllDayDates(database: Database.Database): void {
  const rows = database
    .prepare("SELECT id, start, end FROM items WHERE all_day = 1 AND (start LIKE '%T%' OR end LIKE '%T%')")
    .all() as { id: string; start: string | null; end: string | null }[];

  const update = database.prepare('UPDATE items SET start = ?, end = ? WHERE id = ?');
  for (const row of rows) {
    const start = row.start ? DateTime.fromISO(row.start).toISODate() : null;
    const end = row.end ? DateTime.fromISO(row.end).toISODate() : null;
    update.run(start, end, row.id);
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
