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
  `);

  migrateSchema(database);
}

function migrateSchema(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(items)').all() as { name: string }[];
  const names = new Set(columns.map((c) => c.name));

  if (!names.has('source')) {
    database.exec("ALTER TABLE items ADD COLUMN source TEXT NOT NULL DEFAULT 'task'");
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
  normalizeAllDayDates(database);
  stripEmojiFromStoredTitles(database);
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
