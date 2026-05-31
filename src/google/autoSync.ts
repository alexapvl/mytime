import type { Item } from '../db/types.js';
import { getItem } from '../db/items.js';
import { isAuthenticated } from './auth.js';
import { pushTask, removeFromGoogle } from './sync.js';

type Notify = (msg: string) => void;

/**
 * Push a task to Google in the background after a local change (schedule, edit,
 * resize, toggle done). Re-reads the item so it always pushes the latest state.
 * Failures keep the local change and surface a brief status message.
 */
export function autoPush(itemId: string, onStatus: Notify): void {
  if (!isAuthenticated()) return;
  const item = getItem(itemId);
  if (!item || item.source !== 'task' || !item.start) return;

  void pushTask(item).catch((e) => onStatus(`Google sync failed: ${(e as Error).message}`));
}

/** Remove a task's event from Google in the background after deletion. */
export function autoRemove(item: Item, onStatus: Notify): void {
  if (!isAuthenticated()) return;
  if (item.source !== 'task' || !item.googleEventId) return;

  void removeFromGoogle(item).catch((e) => onStatus(`Google sync failed: ${(e as Error).message}`));
}
