import type { Item } from '../db/types.js';
import { META_KEYS, getCalendarFreeTimeExcludePrefs, getMeta } from '../db/meta.js';

/** Whether an item should block free-slot detection when scheduling. */
export function itemBlocksFreeTime(item: Item): boolean {
  if (!item.start) return false;
  const calendarId = item.googleCalendarId;
  if (!calendarId) return true;

  const mytimeCalendarId = getMeta(META_KEYS.googleCalendarId);
  if (mytimeCalendarId && calendarId === mytimeCalendarId) return true;

  const excluded = getCalendarFreeTimeExcludePrefs();
  return !excluded[calendarId];
}

export function filterItemsForFreeTime(items: Item[]): Item[] {
  return items.filter(itemBlocksFreeTime);
}
