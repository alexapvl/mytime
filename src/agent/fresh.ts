import { isAuthenticated } from '../google/auth.js';
import { syncWithGoogle } from '../google/sync.js';

const FRESH_WINDOW_MS = 15_000;
let lastSyncAt = 0;

/** Pull fresh state from Google before reads/writes. Debounced; failures never block. */
export async function ensureFresh(): Promise<void> {
  if (!isAuthenticated()) return;
  if (Date.now() - lastSyncAt < FRESH_WINDOW_MS) return;
  lastSyncAt = Date.now();
  try {
    await syncWithGoogle();
  } catch {
    // Keep serving local data rather than failing the operation.
  }
}

export function markSyncFresh(): void {
  lastSyncAt = Date.now();
}
