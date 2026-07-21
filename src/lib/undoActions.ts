import type { Item } from '../db/types.js';
import { deleteItem, getItem, restoreItem, updateItem } from '../db/items.js';
import { autoPush, autoRemove } from '../calendar/autoSync.js';
import {
  externalPatchFromSnapshot,
  restoreDeletedExternalEvent,
  updateExternalEvent,
  type ExternalDeleteSnapshot,
} from '../calendar/externalEvents.js';
import { setInvitationResponseStatus } from '../calendar/invitations.js';
import { selfAttendee } from './invitations.js';

export function cloneItem(item: Item): Item {
  return { ...item, tags: [...item.tags], reminders: [...item.reminders], attendees: [...item.attendees] };
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

export function makeUndoExternalUpdate(before: Item, notifyGuests = false): () => Promise<void> {
  return async () => {
    const current = getItem(before.id);
    if (!current) throw new Error(`Event no longer exists: ${before.title}`);
    await updateExternalEvent(current, externalPatchFromSnapshot(before), { notifyGuests });
  };
}

export function makeUndoExternalDelete(
  snapshot: ExternalDeleteSnapshot,
  notifyGuests = false,
): () => Promise<void> {
  return async () => {
    await restoreDeletedExternalEvent(snapshot, { notifyGuests });
  };
}

export function makeUndoInvitationResponse(before: Item): () => Promise<void> {
  const previous = before.selfResponseStatus ?? selfAttendee(before)?.responseStatus ?? 'needsAction';
  return async () => {
    const current = getItem(before.id);
    if (!current) throw new Error(`Event no longer exists: ${before.title}`);
    await setInvitationResponseStatus(current, previous);
  };
}
