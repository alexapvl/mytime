import type { Item } from '../db/types.js';
import { getItem } from '../db/items.js';
import { getRemoteLink } from '../db/remoteLinks.js';
import { getActiveProvider, providerLabel, pushToActiveProvider, removeFromActiveProvider } from './provider.js';

type Notify = (msg: string) => void;

function errorPrefix(): string {
  const provider = getActiveProvider();
  return provider ? `${providerLabel(provider)} sync failed` : 'Calendar sync failed';
}

export function autoPush(itemId: string, onStatus: Notify, onComplete?: () => void): void {
  const item = getItem(itemId);
  if (!item || (item.source !== 'task' && item.source !== 'event') || !item.start) return;

  void pushToActiveProvider(item)
    .then(() => onComplete?.())
    .catch((error) => onStatus(`${errorPrefix()}: ${(error as Error).message}`));
}

export function autoRemove(item: Item, onStatus: Notify): void {
  if (item.source !== 'task' && item.source !== 'event') return;
  const provider = getActiveProvider();
  const link = provider ? getRemoteLink(item.id, provider) : null;
  const removalItem = link
    ? {
        ...item,
        remoteReference: {
          provider: link.provider,
          calendarId: link.remoteCalendarId,
          eventId: link.remoteEventId,
        },
      }
    : item;

  void removeFromActiveProvider(removalItem).catch((error) =>
    onStatus(`${errorPrefix()}: ${(error as Error).message}`),
  );
}
