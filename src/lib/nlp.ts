import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import { allDayRange, defaultEnd, findAllDayDateRangeInText, findTimeRangeInText, multiDayAllDayRange } from './time.js';

export type ParsedItem = {
  title: string;
  start?: string;
  end?: string;
  allDay: boolean;
  tags: string[];
  project?: string;
  priority: 0 | 1 | 2 | 3;
};

export function parseQuickAdd(input: string, referenceDate: Date = new Date()): ParsedItem {
  let text = input.trim();
  const tags: string[] = [];
  let project: string | undefined;
  let priority: 0 | 1 | 2 | 3 = 0;

  const tagMatches = text.match(/(?:^|\s)(@\w+|#\w+)/g);
  if (tagMatches) {
    for (const m of tagMatches) {
      const tag = m.trim();
      if (tag.startsWith('@')) {
        project = tag.slice(1);
      } else if (tag.startsWith('#')) {
        tags.push(tag);
      }
    }
    text = text.replace(/(?:^|\s)(@\w+|#\w+)/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const prioMatch = text.match(/\bp([0-3])\b/i);
  if (prioMatch) {
    priority = parseInt(prioMatch[1]!, 10) as 0 | 1 | 2 | 3;
    text = text.replace(/\bp[0-3]\b/i, '').replace(/\s+/g, ' ').trim();
  }

  const embeddedDateRange = findAllDayDateRangeInText(text, referenceDate);
  if (embeddedDateRange) {
    text = (text.slice(0, embeddedDateRange.index) + text.slice(embeddedDateRange.index + embeddedDateRange.match.length))
      .replace(/\s+/g, ' ')
      .trim();
  }

  const embeddedRange = findTimeRangeInText(text, referenceDate);
  if (embeddedRange) {
    text = (text.slice(0, embeddedRange.index) + text.slice(embeddedRange.index + embeddedRange.match.length))
      .replace(/\s+/g, ' ')
      .trim();
  }

  const results = chrono.parse(text, referenceDate, { forwardDate: true });
  let start: string | undefined;
  let end: string | undefined;
  let allDay = false;
  let title = text;

  if (embeddedDateRange) {
    start = embeddedDateRange.start;
    end = embeddedDateRange.end;
    allDay = true;
  } else if (embeddedRange) {
    let day = DateTime.fromJSDate(referenceDate).startOf('day');
    if (results.length > 0) {
      const r = results[0]!;
      day = DateTime.fromJSDate(r.start.date()).startOf('day');
      title = text.slice(0, r.index).trim() + text.slice(r.index + r.text.length).trim();
      title = title.replace(/\s+/g, ' ').trim();
      if (!title) title = text.trim();
    }
    const startParts = DateTime.fromISO(embeddedRange.start);
    const endParts = DateTime.fromISO(embeddedRange.end);
    start = day.set({ hour: startParts.hour, minute: startParts.minute, second: 0, millisecond: 0 }).toISO()!;
    end = day.set({ hour: endParts.hour, minute: endParts.minute, second: 0, millisecond: 0 }).toISO()!;
    allDay = false;
  } else if (results.length > 0) {
    const r = results[0]!;
    const startDate = r.start.date();
    const hasTime = r.start.isCertain('hour') || r.start.isCertain('minute');
    if (hasTime) {
      start = DateTime.fromJSDate(startDate).toISO()!;

      if (r.end) {
        end = DateTime.fromJSDate(r.end.date()).toISO()!;
      } else {
        end = defaultEnd(start, 60);
      }
    } else {
      allDay = true;
      const startDay = DateTime.fromJSDate(startDate).startOf('day');
      start = startDay.toISODate()!;
      if (r.end && !(r.end.isCertain('hour') || r.end.isCertain('minute'))) {
        const endDay = DateTime.fromJSDate(r.end.date()).startOf('day');
        end = multiDayAllDayRange(startDay.toISODate()!, endDay.toISODate()!).end;
      } else {
        end = allDayRange(start).end;
      }
    }

    title = text.slice(0, r.index).trim() + text.slice(r.index + r.text.length).trim();
    title = title.replace(/\s+/g, ' ').trim();
  }

  if (!title) {
    title = input.trim();
  }

  return { title, start, end, allDay, tags, project, priority };
}
