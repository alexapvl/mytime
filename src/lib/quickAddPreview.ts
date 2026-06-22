import { DateTime } from 'luxon';
import type { Item, ItemPriority } from '../db/types.js';
import { metaLabel } from './itemLabels.js';
import { parseQuickAdd } from './nlp.js';
import { allDayRange, formatDate, formatScheduleTime, isAllDaySchedule } from './time.js';

export type QuickAddPreviewOptions = {
  referenceDate?: Date;
  defaultPriority?: ItemPriority;
  kind?: 'task' | 'event';
  fallbackDay?: string;
  useDefaultPriority?: boolean;
};

export function buildQuickAddDraft(input: string, opts: QuickAddPreviewOptions = {}): Item | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const kind = opts.kind ?? 'task';
  const parsed = parseQuickAdd(trimmed, opts.referenceDate ?? new Date());

  let start = parsed.start;
  let end = parsed.end;
  let allDay = parsed.allDay;
  if (opts.fallbackDay && !start) {
    const range = allDayRange(opts.fallbackDay);
    start = range.start;
    end = range.end;
    allDay = true;
  }

  const priority =
    kind === 'event' || opts.useDefaultPriority ? (opts.defaultPriority ?? parsed.priority) : parsed.priority;

  return {
    id: 'preview',
    title: parsed.title,
    notes: '',
    tags: kind === 'event' ? [] : parsed.tags,
    project: kind === 'event' ? undefined : parsed.project,
    priority: kind === 'event' ? 0 : priority,
    status: 'open',
    source: kind === 'event' ? 'event' : 'task',
    location: undefined,
    reminders: [],
    start,
    end,
    allDay: Boolean(start && allDay),
    updatedAt: '',
    createdAt: '',
  };
}

export function formatQuickAddPreviewLine(item: Item): string {
  const parts: string[] = [item.title];

  if (item.start) {
    if (isAllDaySchedule(item.start, item.end, item.allDay)) {
      parts.push(formatDate(item.start));
    } else {
      parts.push(`${formatDate(item.start)} ${formatScheduleTime(item.start, item.end, item.allDay)}`);
    }
  }

  if (item.source === 'task') {
    const meta = metaLabel(item);
    if (meta) parts.push(meta);
    parts.push(`P${item.priority}`);
  }

  return parts.join(' · ');
}

export function quickAddPreviewLine(input: string, opts: QuickAddPreviewOptions = {}): string | null {
  const draft = buildQuickAddDraft(input, opts);
  if (!draft) return null;
  return formatQuickAddPreviewLine(draft);
}

export function calendarQuickAddReference(day: DateTime): { referenceDate: Date; fallbackDay: string } {
  const start = day.startOf('day');
  return { referenceDate: start.toJSDate(), fallbackDay: start.toISO()! };
}
