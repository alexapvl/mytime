import {
  deleteExternalItemsForCalendar,
  deleteExternalItemsForProvider,
  deleteProviderLinks,
} from '../db/remoteLinks.js';
import {
  deleteMeta,
  getMeta,
  getProviderCalendarFetchPrefs,
  META_KEYS,
  setMeta,
  setProviderCalendarFetchPref,
} from '../db/meta.js';
import { getDb } from '../db/schema.js';
import { isAuthenticated as isGoogleAuthenticated } from '../google/auth.js';
import { googleProvider } from './googleProvider.js';
import type {
  CalendarProvider,
  CalendarProviderAdapter,
  ProviderStatus,
  ProviderCalendarInfo,
  SyncResult,
} from './types.js';
import { listAccountCalendars, setCalendarEnabled as setGoogleCalendarEnabled } from '../google/calendar.js';
import { listAppleCalendars } from '../apple/client.js';
import { isMytimeCalendarName } from './backend.js';

export type ProviderSwitchOptions = {
  deleteOldCalendar?: boolean;
};

export type ProviderSwitchResult = {
  previousProvider: CalendarProvider | null;
  activeProvider: CalendarProvider;
  oldCalendarDeleted: boolean;
  localExternalDeleted: number;
  sync: SyncResult;
  warnings: string[];
};

export function providerLabel(provider: CalendarProvider): string {
  return provider === 'google' ? 'Google Calendar' : 'Apple Calendar';
}

export function getActiveProvider(): CalendarProvider | null {
  const configured = getMeta(META_KEYS.activeCalendarProvider);
  if (configured === 'google' || configured === 'apple') return configured;

  // Existing Google users keep their current behavior until they explicitly switch.
  if (isGoogleAuthenticated()) return 'google';
  return null;
}

export function setActiveProvider(provider: CalendarProvider): void {
  setMeta(META_KEYS.activeCalendarProvider, provider);
}

async function adapterFor(provider: CalendarProvider): Promise<CalendarProviderAdapter> {
  if (provider === 'google') return googleProvider;
  const module = await import('../apple/provider.js');
  return module.appleProvider;
}

export async function getActiveProviderStatus(): Promise<ProviderStatus | null> {
  const provider = getActiveProvider();
  if (!provider) return null;
  return (await adapterFor(provider)).status();
}

export async function listActiveProviderCalendars(): Promise<ProviderCalendarInfo[]> {
  const provider = getActiveProvider();
  if (!provider) return [];
  const prefs = getProviderCalendarFetchPrefs(provider);
  if (provider === 'google') {
    const mytimeId = getMeta(META_KEYS.googleCalendarId);
    return (await listAccountCalendars()).map((calendar) => ({
      id: calendar.id,
      summary: calendar.summary,
      primary: calendar.primary,
      enabled: calendar.id === mytimeId ||
        (!isMytimeCalendarName(calendar.summary) &&
          (calendar.id in prefs ? prefs[calendar.id]! : calendar.googleSelected !== false)),
      locked: calendar.id === mytimeId || isMytimeCalendarName(calendar.summary),
      writable: calendar.accessRole === 'writer' || calendar.accessRole === 'owner',
    }));
  }
  const mytimeId = getMeta(META_KEYS.appleCalendarId);
  return (await listAppleCalendars()).map((calendar) => ({
    id: calendar.id,
    summary: calendar.title,
    sourceTitle: calendar.sourceTitle,
    enabled: calendar.id === mytimeId || (!isMytimeCalendarName(calendar.title) && prefs[calendar.id] !== false),
    locked: calendar.id === mytimeId || isMytimeCalendarName(calendar.title),
    writable: calendar.writable && !calendar.immutable,
  }));
}

export function setActiveProviderCalendarEnabled(calendarId: string, enabled: boolean): number {
  const provider = getActiveProvider();
  if (!provider) return 0;
  const mytimeId = getMeta(
    provider === 'google' ? META_KEYS.googleCalendarId : META_KEYS.appleCalendarId,
  );
  if (calendarId === mytimeId) return 0;
  if (provider === 'google') setGoogleCalendarEnabled(calendarId, enabled);
  else setProviderCalendarFetchPref('apple', calendarId, enabled);
  return enabled ? 0 : deleteExternalItemsForCalendar(provider, calendarId);
}

function assertNoProviderSwitch(): void {
  const lock = getMeta(META_KEYS.calendarProviderSwitching);
  if (!lock) return;
  const age = Date.now() - Date.parse(lock);
  if (!Number.isFinite(age) || age > 10 * 60_000) {
    deleteMeta(META_KEYS.calendarProviderSwitching);
    return;
  }
  throw new Error('Calendar provider switch in progress. Try again when it finishes.');
}

export async function syncCalendar(): Promise<SyncResult> {
  assertNoProviderSwitch();
  const provider = getActiveProvider();
  if (!provider) {
    return {
      pushed: 0,
      pulled: 0,
      deleted: 0,
      calendars: 0,
      errors: ['No calendar provider selected. Run: mytime setup google or mytime setup apple'],
    };
  }
  return (await adapterFor(provider)).sync();
}

export async function pushToActiveProvider(item: Parameters<CalendarProviderAdapter['push']>[0]): Promise<boolean> {
  assertNoProviderSwitch();
  const provider = getActiveProvider();
  if (!provider) return false;
  const adapter = await adapterFor(provider);
  const status = await adapter.status();
  if (!status.connected) return false;
  return adapter.push(item);
}

export async function removeFromActiveProvider(
  item: Parameters<CalendarProviderAdapter['remove']>[0],
): Promise<void> {
  assertNoProviderSwitch();
  const provider = getActiveProvider();
  if (!provider) return;
  const adapter = await adapterFor(provider);
  const status = await adapter.status();
  if (!status.connected) return;
  await adapter.remove(item);
}

export async function switchCalendarProvider(
  nextProvider: CalendarProvider,
  options: ProviderSwitchOptions = {},
): Promise<ProviderSwitchResult> {
  assertNoProviderSwitch();
  const previousProvider = getActiveProvider();
  const googleAdapterPair =
    (previousProvider === 'google' && nextProvider === 'apple') ||
    (previousProvider === 'apple' && nextProvider === 'google');
  const sameGoogleCalendar =
    getMeta(META_KEYS.appleSharesGoogleCalendar) === 'true' &&
    googleAdapterPair;
  const googleBackendRelationship =
    googleAdapterPair && getMeta(META_KEYS.appleBackend) === 'google';
  if (googleBackendRelationship && options.deleteOldCalendar) {
    throw new Error(
      'Apple EventKit uses a Google backend, so deleting either calendar could remove the shared remote calendar. ' +
      'Use --keep-old-calendar. Delete a confirmed separate calendar manually if needed.',
    );
  }
  if (previousProvider === 'google' && nextProvider === 'apple' && !sameGoogleCalendar) {
    const { refreshGoogleLinkedItemRanges } = await import('../google/cleanup.js');
    await refreshGoogleLinkedItemRanges();
  }
  const nextAdapter = await adapterFor(nextProvider);
  const nextStatus = await nextAdapter.status();
  if (!nextStatus.connected) {
    throw new Error(`${providerLabel(nextProvider)} is not connected. ${nextStatus.detail ?? ''}`.trim());
  }

  setMeta(META_KEYS.calendarProviderSwitching, new Date().toISOString());
  try {
    const sync = await nextAdapter.sync();
    if (sync.errors.length) {
      if (previousProvider !== nextProvider) deleteExternalItemsForProvider(nextProvider);
      throw new Error(
        `${providerLabel(nextProvider)} verification failed: ${sync.errors.join('; ')}. ` +
        'Previous provider remains active.',
      );
    }

    let localExternalDeleted = 0;
    getDb().transaction(() => {
      if (previousProvider && previousProvider !== nextProvider) {
        localExternalDeleted = deleteExternalItemsForProvider(previousProvider);
      }
      setActiveProvider(nextProvider);
    })();

    const warnings: string[] = sameGoogleCalendar
      ? ['Google API and Apple EventKit share one verified remote mytime calendar; no calendar was copied or deleted.']
      : googleBackendRelationship
        ? ['Apple EventKit uses a Google backend, but the remote calendar relationship is unverified; automatic deletion is disabled.']
        : [];
    let oldCalendarDeleted = false;
    if (previousProvider && previousProvider !== nextProvider && options.deleteOldCalendar) {
      try {
        oldCalendarDeleted = await (await adapterFor(previousProvider)).deleteMytimeCalendar();
        if (oldCalendarDeleted) deleteProviderLinks(previousProvider);
      } catch (error) {
        const typed = error as Error & { hint?: string };
        warnings.push(
          `${providerLabel(previousProvider)} mytime calendar was kept: ${typed.message}. ` +
          (typed.hint ?? 'Delete it manually from the calendar provider if wanted.'),
        );
      }
    }

    return {
      previousProvider,
      activeProvider: nextProvider,
      oldCalendarDeleted,
      localExternalDeleted,
      sync,
      warnings,
    };
  } finally {
    deleteMeta(META_KEYS.calendarProviderSwitching);
  }
}
