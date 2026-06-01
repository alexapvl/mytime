import { DateTime } from 'luxon';
import type { Item } from '../db/types.js';

export function overdueLabel(item: Item, now = DateTime.local()): string {
  if (!item.start) return '';
  const start = DateTime.fromISO(item.start);

  if (item.allDay || !item.start.includes('T')) {
    const days = Math.floor(now.startOf('day').diff(start.startOf('day'), 'days').days);
    return days === 1 ? '1 day overdue' : `${days} days overdue`;
  }

  const deadline = item.end ? DateTime.fromISO(item.end) : start;
  if (deadline.hasSame(now, 'day')) {
    return deadline.toRelative({ base: now }) ?? 'overdue today';
  }
  const days = Math.floor(now.startOf('day').diff(deadline.startOf('day'), 'days').days);
  return days === 1 ? '1 day overdue' : `${days} days overdue`;
}
