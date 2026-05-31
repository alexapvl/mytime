import { getDb } from './schema.js';

export function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function deleteMeta(key: string): void {
  getDb().prepare('DELETE FROM meta WHERE key = ?').run(key);
}

export const META_KEYS = {
  googleCalendarId: 'google_calendar_id',
  googleSyncTokens: 'google_sync_tokens',
  googleCalendarFetchPrefs: 'google_calendar_fetch_prefs',
} as const;

export function getCalendarFetchPrefs(): Record<string, boolean> {
  const raw = getMeta(META_KEYS.googleCalendarFetchPrefs);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function setCalendarFetchPref(calendarId: string, enabled: boolean): void {
  const prefs = getCalendarFetchPrefs();
  prefs[calendarId] = enabled;
  setMeta(META_KEYS.googleCalendarFetchPrefs, JSON.stringify(prefs));
}

export function getSyncTokens(): Record<string, string> {
  const raw = getMeta(META_KEYS.googleSyncTokens);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export function setSyncTokens(tokens: Record<string, string>): void {
  setMeta(META_KEYS.googleSyncTokens, JSON.stringify(tokens));
}

export function clearSyncToken(calendarId: string): void {
  const tokens = getSyncTokens();
  delete tokens[calendarId];
  setSyncTokens(tokens);
}
