import type { Item } from '../db/types.js';
import { restoreItem, updateItem } from '../db/items.js';
import { autoPush } from '../google/autoSync.js';

export function cloneItem(item: Item): Item {
  return { ...item, tags: [...item.tags], reminders: [...item.reminders] };
}

export function makeUndoDelete(snapshot: Item, onStatus: (msg: string) => void): () => void {
  return () => {
    restoreItem({
      ...snapshot,
      googleEventId: undefined,
      googleCalendarId: undefined,
      syncedAt: undefined,
    });
    if (snapshot.start) autoPush(snapshot.id, onStatus);
  };
}

export function makeUndoToggleDone(before: Item, onStatus: (msg: string) => void): () => void {
  return () => {
    updateItem(before.id, {
      status: before.status,
      completedAt: before.completedAt,
    });
    autoPush(before.id, onStatus);
  };
}
