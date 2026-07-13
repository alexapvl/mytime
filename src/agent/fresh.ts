import { getActiveProvider, getActiveProviderStatus, syncCalendar } from '../calendar/provider.js';

const FRESH_WINDOW_MS = 15_000;
let lastSyncAt = 0;
let lastProvider: string | null = null;

/** Pull fresh provider state before reads/writes. Debounced; failures never block. */
export async function ensureFresh(): Promise<void> {
  const status = await getActiveProviderStatus();
  if (!status?.connected) return;
  const provider = getActiveProvider();
  if (provider === lastProvider && Date.now() - lastSyncAt < FRESH_WINDOW_MS) return;
  lastProvider = provider;
  lastSyncAt = Date.now();
  try {
    await syncCalendar();
  } catch {
    // Keep serving local data rather than failing the operation.
  }
}

export function markSyncFresh(): void {
  lastProvider = getActiveProvider();
  lastSyncAt = Date.now();
}
