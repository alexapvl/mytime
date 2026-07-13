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
  activeCalendarProvider: 'active_calendar_provider',
  calendarProviderSwitching: 'calendar_provider_switching',
  googleCalendarId: 'google_calendar_id',
  googleSyncTokens: 'google_sync_tokens',
  googleCalendarFetchPrefs: 'google_calendar_fetch_prefs',
  appleCalendarId: 'apple_calendar_id',
  appleSourceId: 'apple_source_id',
  appleBackend: 'apple_backend',
  appleSharesGoogleCalendar: 'apple_shares_google_calendar',
  appleAllDayBoundaryVersion: 'apple_all_day_boundary_version',
  appleCalendarFetchPrefs: 'apple_calendar_fetch_prefs',
  defaultEventReminders: 'default_event_reminders',
  customEventReminderPresets: 'custom_event_reminder_presets',
  calendarFreeTimeExcludePrefs: 'calendar_free_time_exclude_prefs',
} as const;

export function getProviderCalendarFetchPrefs(provider: 'google' | 'apple'): Record<string, boolean> {
  const key = provider === 'google' ? META_KEYS.googleCalendarFetchPrefs : META_KEYS.appleCalendarFetchPrefs;
  const raw = getMeta(key);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function setProviderCalendarFetchPref(
  provider: 'google' | 'apple',
  calendarId: string,
  enabled: boolean,
): void {
  const prefs = getProviderCalendarFetchPrefs(provider);
  prefs[calendarId] = enabled;
  const key = provider === 'google' ? META_KEYS.googleCalendarFetchPrefs : META_KEYS.appleCalendarFetchPrefs;
  setMeta(key, JSON.stringify(prefs));
}

export function getCalendarFetchPrefs(): Record<string, boolean> {
  return getProviderCalendarFetchPrefs('google');
}

export function setCalendarFetchPref(calendarId: string, enabled: boolean): void {
  setProviderCalendarFetchPref('google', calendarId, enabled);
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

export function getDefaultEventReminders(): number[] {
  const raw = getMeta(META_KEYS.defaultEventReminders);
  if (!raw) return [1440, 60];
  try {
    const parsed = JSON.parse(raw) as number[];
    return Array.isArray(parsed) ? parsed : [1440, 60];
  } catch {
    return [1440, 60];
  }
}

export function setDefaultEventReminders(minutes: number[]): void {
  setMeta(META_KEYS.defaultEventReminders, JSON.stringify(minutes));
}

export function getCustomEventReminderPresets(): number[] {
  const raw = getMeta(META_KEYS.customEventReminderPresets);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as number[];
    return Array.isArray(parsed) ? parsed.filter((m) => Number.isFinite(m) && m > 0) : [];
  } catch {
    return [];
  }
}

export function setCustomEventReminderPresets(minutes: number[]): void {
  setMeta(META_KEYS.customEventReminderPresets, JSON.stringify(minutes));
}

export function getCalendarFreeTimeExcludePrefs(): Record<string, boolean> {
  const raw = getMeta(META_KEYS.calendarFreeTimeExcludePrefs);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function getProviderCalendarFreeTimeExcludePrefs(
  provider: 'google' | 'apple',
): Record<string, boolean> {
  const prefs = getCalendarFreeTimeExcludePrefs();
  const prefix = `${provider}:`;
  const scoped = Object.fromEntries(
    Object.entries(prefs)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );
  if (provider === 'google') {
    for (const [key, value] of Object.entries(prefs)) {
      if (!key.includes(':') && !(key in scoped)) scoped[key] = value;
    }
  }
  return scoped;
}

export function setProviderCalendarFreeTimeExcludePref(
  provider: 'google' | 'apple',
  calendarId: string,
  excluded: boolean,
): void {
  const prefs = getCalendarFreeTimeExcludePrefs();
  prefs[`${provider}:${calendarId}`] = excluded;
  setMeta(META_KEYS.calendarFreeTimeExcludePrefs, JSON.stringify(prefs));
}

export function setCalendarFreeTimeExcludePref(calendarId: string, excluded: boolean): void {
  const prefs = getCalendarFreeTimeExcludePrefs();
  prefs[calendarId] = excluded;
  setMeta(META_KEYS.calendarFreeTimeExcludePrefs, JSON.stringify(prefs));
}
