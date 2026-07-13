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
  stripEmojiFromStoredTitles(database);
  normalizeEventTaskFields(database);
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
