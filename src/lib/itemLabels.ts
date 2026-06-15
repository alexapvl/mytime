import type { Item } from '../db/types.js';
import { formatDate, formatScheduleTime, isAllDaySchedule } from './time.js';
import { remindersSummary } from './reminders.js';

export function metaLabel(item: Item): string {
  const parts: string[] = [];
  if (item.source === 'task' && item.project) parts.push(`@${item.project.replace(/^@/, '')}`);
  if (item.source === 'task' && item.tags.length) parts.push(...item.tags);
  return parts.join(' ');
}

export function eventDetailLines(item: Item): string[] {
  if (item.source !== 'event') return [];
  const lines: string[] = [];
  if (item.location) lines.push(`location: ${item.location}`);
  if (item.reminders.length) lines.push(`reminders: ${remindersSummary(item.reminders)}`);
  return lines;
}

export function scheduleLabel(item: Item): string {
  if (!item.start) return '';
  const date = formatDate(item.start);
  if (isAllDaySchedule(item.start, item.end ?? undefined, item.allDay)) return date;
  return `${date} ${formatScheduleTime(item.start, item.end, item.allDay)}`;
}

export function detailLines(
  item: Item,
  { showSchedule = true, showMeta = true }: { showSchedule?: boolean; showMeta?: boolean } = {},
): string[] {
  const lines: string[] = [];
  if (showSchedule && scheduleLabel(item)) lines.push(scheduleLabel(item));
  if (showMeta) {
    if (item.source === 'event') lines.push(...eventDetailLines(item));
    else {
      const meta = metaLabel(item);
      if (meta) lines.push(meta);
    }
  }
  return lines;
}
