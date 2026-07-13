import type { Item } from '../db/types.js';
import { deleteItem, restoreItem, updateItem } from '../db/items.js';
import { autoPush, autoRemove } from '../calendar/autoSync.js';

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

export function makeUndoAdd(snapshot: Item, onStatus: (msg: string) => void): () => void {
  return () => {
    autoRemove(snapshot, onStatus);
    deleteItem(snapshot.id);
  };
}

export function makeUndoToggleDone(before: Item, onStatus: (msg: string) => void): () => void {
  return () => {
    if (before.source !== 'task') return;
    updateItem(before.id, {
      status: before.status,
      completedAt: before.completedAt,
    });
    autoPush(before.id, onStatus);
  };
}
