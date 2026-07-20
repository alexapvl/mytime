import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import { allDayRange, defaultEnd, findAllDayDateRangeInText, findTimeRangeInText, multiDayAllDayRange } from './time.js';
import { extractFirstUrl } from './links.js';

export type ParsedItem = {
  title: string;
  start?: string;
  end?: string;
  allDay: boolean;
  tags: string[];
  project?: string;
  priority: 0 | 1 | 2 | 3;
  url?: string;
};

type EmbeddedDuration = {
  start: string;
  end: string;
  match: string;
  index: number;
};

function findAllDayDurationInText(text: string, referenceDate: Date): EmbeddedDuration | null {
  const durationPattern = /\b(?:for\s+)?(\d+)(?:\s+|-\s*)days?\b/gi;

  for (const match of text.matchAll(durationPattern)) {
    const index = match.index;
    if (index == null) continue;

    const prefix = text.slice(0, index).trimEnd();
    const suffix = text.slice(index + match[0].length).trimStart();
    if (/\b(?:in|within|after|every|each|last)\s*$/i.test(prefix)) continue;
    if (/^(?:from|after|later|ago|before)\b/i.test(suffix)) continue;

    const days = Number(match[1]);
    if (!Number.isSafeInteger(days) || days < 1) continue;

    const start = DateTime.fromJSDate(referenceDate).startOf('day');
    return {
      start: start.toISODate()!,
      end: start.plus({ days }).toISODate()!,
      match: match[0],
      index,
    };
  }

  return null;
}

function removeTextSpan(text: string, index: number, length: number): string {
  return `${text.slice(0, index).trim()} ${text.slice(index + length).trim()}`.replace(/\s+/g, ' ').trim();
}

export function parseQuickAdd(input: string, referenceDate: Date = new Date()): ParsedItem {
  const extractedUrl = extractFirstUrl(input.trim());
  let text = extractedUrl.text;
  const fallbackTitle = text;
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
    text = removeTextSpan(text, embeddedDateRange.index, embeddedDateRange.match.length);
  }

  const embeddedDuration = embeddedDateRange ? null : findAllDayDurationInText(text, referenceDate);
  if (embeddedDuration) {
    text = removeTextSpan(text, embeddedDuration.index, embeddedDuration.match.length);
  }

  const embeddedRange = findTimeRangeInText(text, referenceDate);
  if (embeddedRange) {
    text = removeTextSpan(text, embeddedRange.index, embeddedRange.match.length);
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
  } else if (embeddedDuration) {
    start = embeddedDuration.start;
    end = embeddedDuration.end;
    allDay = true;
  } else if (embeddedRange) {
    let day = DateTime.fromJSDate(referenceDate).startOf('day');
    if (results.length > 0) {
      const r = results[0]!;
      day = DateTime.fromJSDate(r.start.date()).startOf('day');
      title = removeTextSpan(text, r.index, r.text.length);
      if (!title) title = text.trim();
    }
    const startParts = DateTime.fromISO(embeddedRange.start);
    const endParts = DateTime.fromISO(embeddedRange.end);
    const endDayOffset = Math.round(endParts.startOf('day').diff(startParts.startOf('day'), 'days').days);
    start = day.set({ hour: startParts.hour, minute: startParts.minute, second: 0, millisecond: 0 }).toISO()!;
    end = day
      .plus({ days: endDayOffset })
      .set({ hour: endParts.hour, minute: endParts.minute, second: 0, millisecond: 0 })
      .toISO()!;
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

    title = removeTextSpan(text, r.index, r.text.length);
  }

  if (!title) {
    title = fallbackTitle || 'Untitled';
  }

  return { title, start, end, allDay, tags, project, priority, url: extractedUrl.url };
}
