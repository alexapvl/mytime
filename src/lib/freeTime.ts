import type { Item } from '../db/types.js';
import { getProviderCalendarFreeTimeExcludePrefs } from '../db/meta.js';
import { getRemoteLink } from '../db/remoteLinks.js';

/** Whether an item should block free-slot detection when scheduling. */
export function itemBlocksFreeTime(item: Item): boolean {
  if (!item.start) return false;
  if (item.source !== 'external' || !item.originProvider) return true;
  const link = getRemoteLink(item.id, item.originProvider);
  if (!link) return true;
  const excluded = getProviderCalendarFreeTimeExcludePrefs(item.originProvider);
  return !excluded[link.remoteCalendarId];
}

export function filterItemsForFreeTime(items: Item[]): Item[] {
  return items.filter(itemBlocksFreeTime);
}
