import type { Item } from '../db/types.js';
import { getItem } from '../db/items.js';
import { isAuthenticated } from './auth.js';
import { pushLocalItem, removeFromGoogle } from './sync.js';

type Notify = (msg: string) => void;

export function autoPush(itemId: string, onStatus: Notify): void {
  if (!isAuthenticated()) return;
  const item = getItem(itemId);
  if (!item || (item.source !== 'task' && item.source !== 'event') || !item.start) return;

  void pushLocalItem(item).catch((e) => onStatus(`Google sync failed: ${(e as Error).message}`));
}

export function autoRemove(item: Item, onStatus: Notify): void {
  if (!isAuthenticated()) return;
  if ((item.source !== 'task' && item.source !== 'event') || !item.googleEventId) return;

  void removeFromGoogle(item).catch((e) => onStatus(`Google sync failed: ${(e as Error).message}`));
}
