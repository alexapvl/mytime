import type { Item } from '../db/types.js';
import { formatDate, formatScheduleTime, isAllDaySchedule } from './time.js';

export function metaLabel(item: Item): string {
  const parts: string[] = [];
  if (item.project) parts.push(`@${item.project.replace(/^@/, '')}`);
  if (item.tags.length) parts.push(...item.tags);
  return parts.join(' ');
}

export function scheduleLabel(item: Item): string {
  if (!item.start) return '';
  const date = formatDate(item.start);
  if (isAllDaySchedule(item.start, item.end ?? undefined, item.allDay)) return date;
  return `${date} ${formatScheduleTime(item.start, item.end, item.allDay)}`;
}
