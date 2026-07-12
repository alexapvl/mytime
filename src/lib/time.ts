import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';

export const DEFAULT_TIMEZONE = DateTime.local().zoneName;

export function formatTime(iso: string): string {
  return DateTime.fromISO(iso).toFormat('HH:mm');
}

export function isAllDaySchedule(start: string, end: string | undefined, allDay: boolean): boolean {
  if (allDay) return true;
  if (!start.includes('T')) return true;
  if (!end) return false;
  const s = DateTime.fromISO(start);
  const e = DateTime.fromISO(end);
  return s.hour === 0 && s.minute === 0 && e.hour === 0 && e.minute === 0;
}

export function formatScheduleTime(start: string, end: string | undefined, allDay: boolean): string {
  if (isAllDaySchedule(start, end, allDay)) return formatAllDaySchedule(start, end);
  return end ? `${formatTime(start)}-${formatTime(end)}` : formatTime(start);
}

export function formatDate(iso: string): string {
  return DateTime.fromISO(iso).toFormat('EEE MMM d');
}

export function formatDateTime(iso: string): string {
  return DateTime.fromISO(iso).toFormat('EEE MMM d, HH:mm');
}

export function todayStart(): string {
  return DateTime.local().startOf('day').toISO()!;
}

export function todayEnd(): string {
  return DateTime.local().endOf('day').toISO()!;
}

export function weekStart(): string {
  return DateTime.local().startOf('week').toISO()!;
}

export function weekEnd(): string {
  return DateTime.local().endOf('week').toISO()!;
}

export function addMinutes(iso: string, minutes: number): string {
  return DateTime.fromISO(iso).plus({ minutes }).toISO()!;
}

export function addHours(iso: string, hours: number): string {
  return DateTime.fromISO(iso).plus({ hours }).toISO()!;
}

export function roundToNextHour(iso?: string): string {
  const dt = iso ? DateTime.fromISO(iso) : DateTime.local();
  const rounded = dt.minute > 0 || dt.second > 0 ? dt.plus({ hours: 1 }).startOf('hour') : dt.startOf('hour');
  return rounded.toISO()!;
}

export function defaultEnd(start: string, durationMinutes = 60): string {
  return DateTime.fromISO(start).plus({ minutes: durationMinutes }).toISO()!;
}

export function allDayRange(day: string): { start: string; end: string } {
  const start = DateTime.fromISO(day).startOf('day');
  return { start: start.toISODate()!, end: start.plus({ days: 1 }).toISODate()! };
}

/** Inclusive start/end dates → exclusive end (Google Calendar all-day convention). */
export function multiDayAllDayRange(startDay: string, endDayInclusive: string): { start: string; end: string } {
  const start = DateTime.fromISO(startDay).startOf('day');
  const end = DateTime.fromISO(endDayInclusive).startOf('day').plus({ days: 1 });
  return { start: start.toISODate()!, end: end.toISODate()! };
}

function dateOnlyISO(iso: string): string {
  return iso.includes('T') ? DateTime.fromISO(iso).toISODate()! : iso.slice(0, 10);
}

export function isMultiDayAllDay(start: string, end: string | undefined, allDay: boolean): boolean {
  if (!allDay && !isAllDaySchedule(start, end, allDay)) return false;
  if (!end) return false;
  return allDayRange(dateOnlyISO(start)).end !== dateOnlyISO(end);
}

export function formatAllDaySchedule(start: string, end?: string): string {
  if (!end) return 'all day';
  const startISO = dateOnlyISO(start);
  if (allDayRange(startISO).end === dateOnlyISO(end)) return 'all day';
  const startDay = DateTime.fromISO(startISO);
  const endInclusive = DateTime.fromISO(dateOnlyISO(end)).minus({ days: 1 });
  if (startDay.hasSame(endInclusive, 'day')) return 'all day';
  if (startDay.year === endInclusive.year && startDay.month === endInclusive.month) {
    return `${startDay.toFormat('MMM d')}–${endInclusive.toFormat('d')}`;
  }
  return `${startDay.toFormat('MMM d')}–${endInclusive.toFormat('MMM d')}`;
}

/** Whether a scheduled item overlaps a calendar day (timed or all-day, including multi-day). */
export function itemSpansDay(
  item: { start?: string; end?: string; allDay: boolean },
  day: DateTime | string,
): boolean {
  if (!item.start) return false;
  const d = typeof day === 'string' ? DateTime.fromISO(day).startOf('day') : day.startOf('day');
  const dayISO = d.toISODate()!;

  if (isAllDaySchedule(item.start, item.end, item.allDay)) {
    const start = dateOnlyISO(item.start);
    const end = item.end ? dateOnlyISO(item.end) : DateTime.fromISO(start).plus({ days: 1 }).toISODate()!;
    return start <= dayISO && end > dayISO;
  }

  const start = DateTime.fromISO(item.start);
  const end = item.end ? DateTime.fromISO(item.end) : start;
  return start < d.endOf('day') && end > d.startOf('day');
}

/** Parse an all-day date or date range (e.g. "Jun 1-5", "mon to wed"). */
export function parseAllDayDateRangeInput(input: string, baseDate: string): { start: string; end: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const base = DateTime.fromISO(baseDate).startOf('day');
  const ref = base.toJSDate();

  const monthDayRange =
    /\b(?:(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?(\d{1,2})\s*[-–—]\s*(\d{1,2})(?:\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?))?\b/i;
  const m = monthDayRange.exec(trimmed);
  if (m) {
    const monthWord = m[1] ?? m[4];
    const startDay = parseSingleDate(`${monthWord ? `${monthWord} ` : ''}${m[2]}`, base);
    const endDay = parseSingleDate(`${monthWord ? `${monthWord} ` : ''}${m[3]}`, base);
    if (startDay && endDay && endDay >= startDay) {
      return multiDayAllDayRange(startDay.toISODate()!, endDay.toISODate()!);
    }
  }

  const rangeSep = /\s*(?:[-–—]|\s+(?:to|till|until)\s+)\s*/i;
  const parts = trimmed.split(rangeSep).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2) {
    const startDay = parseSingleDate(parts[0]!, base);
    const endDay = parseSingleDate(parts[1]!, base);
    if (startDay && endDay && endDay >= startDay) {
      return multiDayAllDayRange(startDay.toISODate()!, endDay.toISODate()!);
    }
  }

  const results = chrono.parse(trimmed, ref, { forwardDate: true });
  if (results.length === 0) return null;

  const r = results[0]!;
  const hasTime = r.start.isCertain('hour') || r.start.isCertain('minute');
  if (hasTime) return null;

  const startDay = DateTime.fromJSDate(r.start.date()).startOf('day');
  if (r.end && !(r.end.isCertain('hour') || r.end.isCertain('minute'))) {
    const endDay = DateTime.fromJSDate(r.end.date()).startOf('day');
    if (endDay < startDay) return null;
    return multiDayAllDayRange(startDay.toISODate()!, endDay.toISODate()!);
  }

  return allDayRange(startDay.toISODate()!);
}

function parseSingleDate(input: string, base: DateTime): DateTime | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const results = chrono.parse(trimmed, base.toJSDate(), { forwardDate: true });
  if (!results[0]) return null;
  if (results[0].start.isCertain('hour') || results[0].start.isCertain('minute')) return null;
  return DateTime.fromJSDate(results[0].start.date()).startOf('day');
}

export type ParsedEmbeddedDateRange = {
  start: string;
  end: string;
  match: string;
  index: number;
};

/** Find an all-day date range embedded in quick-add text (e.g. "vacation jun 1-5"). */
export function findAllDayDateRangeInText(text: string, baseDate: string | Date): ParsedEmbeddedDateRange | null {
  const base =
    typeof baseDate === 'string'
      ? DateTime.fromISO(baseDate).startOf('day')
      : DateTime.fromJSDate(baseDate).startOf('day');

  const monthDayRange =
    /\b(?:(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?(\d{1,2})\s*[-–—]\s*(\d{1,2})(?:\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?))?\b/gi;

  for (const match of text.matchAll(monthDayRange)) {
    const index = match.index;
    if (index == null) continue;
    const monthWord = match[1] ?? match[4];
    const startDay = parseSingleDate(`${monthWord ? `${monthWord} ` : ''}${match[2]}`, base);
    const endDay = parseSingleDate(`${monthWord ? `${monthWord} ` : ''}${match[3]}`, base);
    if (startDay && endDay && endDay >= startDay) {
      const range = multiDayAllDayRange(startDay.toISODate()!, endDay.toISODate()!);
      return { ...range, match: match[0], index };
    }
  }

  const results = chrono.parse(text, base.toJSDate(), { forwardDate: true });
  for (const r of results) {
    if (r.start.isCertain('hour') || r.start.isCertain('minute')) continue;
    const startDay = DateTime.fromJSDate(r.start.date()).startOf('day');
    if (r.end && !(r.end.isCertain('hour') || r.end.isCertain('minute'))) {
      const endDay = DateTime.fromJSDate(r.end.date()).startOf('day');
      if (endDay >= startDay) {
        const range = multiDayAllDayRange(startDay.toISODate()!, endDay.toISODate()!);
        return { ...range, match: r.text, index: r.index };
      }
    }
  }

  return null;
}

export function hourLabels(): string[] {
  return Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
}

export function isSameDay(a: string, b: string): boolean {
  const da = DateTime.fromISO(a);
  const db = DateTime.fromISO(b);
  return da.hasSame(db, 'day');
}

export function parseTimeInput(input: string, baseDate?: string): { start: string; end: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const base = baseDate ? DateTime.fromISO(baseDate) : DateTime.local();

  // "14:30" or "14:30-15:30" or "2pm-3pm" or "11:30 to 7pm"
  const rangeMatch = trimmed.match(/^(.+?)\s*(?:[-–—]|(?:\s+(?:to|till|until)\s+))\s*(.+)$/i);
  if (rangeMatch) {
    const start = parseSingleTime(rangeMatch[1]!, base);
    const end = parseSingleTime(rangeMatch[2]!, base);
    if (start && end && end > start) {
      return { start: start.toISO()!, end: end.toISO()! };
    }
  }

  const single = parseSingleTime(trimmed, base);
  if (single) {
    return { start: single.toISO()!, end: defaultEnd(single.toISO()!) };
  }

  return null;
}

/** Parse a custom start–end range for scheduling (supports NLP fallback). */
export function parseScheduleRangeInput(input: string, baseDate: string): { start: string; end: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const base = DateTime.fromISO(baseDate).startOf('day');
  const normalized = trimmed.replace(/(\d)\.(\d{2})\b/g, '$1:$2');

  const allDayRangeParsed = parseAllDayDateRangeInput(normalized, base.toISO()!);
  if (allDayRangeParsed) return allDayRangeParsed;

  const structured = parseTimeInput(normalized, base.toISO()!);
  if (structured) return structured;

  const rangeSep = /\s*(?:[-–—]|\s+(?:to|till|until)\s+)\s*/i;
  const parts = normalized.split(rangeSep).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2) {
    const start = parseTimeNlp(parts[0]!, base);
    let end = parseTimeNlp(parts[1]!, base);
    if (start && end) {
      if (end <= start && parts[1]!.trim().toLowerCase() !== 'eod') end = end.plus({ days: 1 });
      return { start: start.toISO()!, end: end.toISO()! };
    }
  }

  const ref = base.toJSDate();
  const results = chrono.parse(normalized, ref, { forwardDate: true });
  if (results.length === 0) return null;

  const r = results[0]!;
  if (!r.start.isCertain('hour')) return null;
  const start = DateTime.fromJSDate(r.start.date());
  if (!r.end || !(r.end.isCertain('hour') || r.end.isCertain('minute'))) return null;

  let end = DateTime.fromJSDate(r.end.date());
  if (end <= start) end = end.plus({ days: 1 });
  return { start: start.toISO()!, end: end.toISO()! };
}

function parseTimeNlp(input: string, base: DateTime): DateTime | null {
  const fromStructured = parseSingleTime(input, base);
  if (fromStructured) return fromStructured;

  const results = chrono.parse(input.trim(), base.toJSDate(), { forwardDate: true });
  if (!results[0]?.start.isCertain('hour')) return null;
  return DateTime.fromJSDate(results[0]!.start.date());
}

export type ParsedEmbeddedTimeRange = {
  start: string;
  end: string;
  match: string;
  index: number;
};

const MONTH_BEFORE_HOUR_RANGE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*$/i;

function finalizeRangeEnd(start: DateTime, end: DateTime, endToken: string): DateTime {
  if (end <= start && endToken.toLowerCase() !== 'eod') return end.plus({ days: 1 });
  return end;
}

function buildEmbeddedTimeRange(
  start: DateTime,
  end: DateTime,
  endToken: string,
  match: string,
  index: number,
): ParsedEmbeddedTimeRange {
  return {
    start: start.toISO()!,
    end: finalizeRangeEnd(start, end, endToken).toISO()!,
    match,
    index,
  };
}

/** Find a start–end time range embedded in quick-add text (e.g. 19:00-eod, sod-08:00, 1300-1400, 13-14). */
export function findTimeRangeInText(text: string, baseDate: string | Date): ParsedEmbeddedTimeRange | null {
  const base =
    typeof baseDate === 'string'
      ? DateTime.fromISO(baseDate).startOf('day')
      : DateTime.fromJSDate(baseDate).startOf('day');

  const colonOrEdgeRange = /(\d{1,2}:\d{2}|sod|eod)\s*[-–—]\s*(sod|eod|\d{1,2}(?::\d{2})?)\b/i;
  const mColonOrEdge = colonOrEdgeRange.exec(text);
  if (mColonOrEdge?.index != null) {
    const start = parseSingleTime(mColonOrEdge[1]!, base);
    const end = parseSingleTime(mColonOrEdge[2]!, base);
    if (start && end) {
      return buildEmbeddedTimeRange(start, end, mColonOrEdge[2]!, mColonOrEdge[0], mColonOrEdge.index);
    }
  }

  const military = /(\d{3,4})\s*[-–—]\s*(\d{3,4})/;
  const mMil = military.exec(text);
  if (mMil?.index != null) {
    const start = parseSingleTime(mMil[1]!, base);
    let end = parseSingleTime(mMil[2]!, base);
    if (start && end) {
      if (end <= start) end = end.plus({ days: 1 });
      return { start: start.toISO()!, end: end.toISO()!, match: mMil[0], index: mMil.index };
    }
  }

  const hourRange = /\b(\d{1,2})\s*[-–—]\s*(sod|eod|\d{1,2})\b/gi;
  for (const match of text.matchAll(hourRange)) {
    const index = match.index;
    if (index == null) continue;
    const before = text.slice(0, index);
    if (MONTH_BEFORE_HOUR_RANGE.test(before)) continue;
    // Skip minutes inside HH:MM (e.g. don't match 00-22 inside 19:00-22:00).
    if (/\d:$/.test(before)) continue;

    const start = parseSingleTime(match[1]!, base);
    const end = parseSingleTime(match[2]!, base);
    if (start && end) {
      return buildEmbeddedTimeRange(start, end, match[2]!, match[0], index);
    }
  }

  return null;
}

function parseSingleTime(input: string, base: DateTime): DateTime | null {
  const t = input.trim().toLowerCase().replace(/(\d)\.(\d{2})\b/g, '$1:$2');

  if (t === 'sod') return base.startOf('day');
  if (t === 'eod') return base.endOf('day');

  const hm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    return base.set({ hour: parseInt(hm[1]!, 10), minute: parseInt(hm[2]!, 10), second: 0, millisecond: 0 });
  }

  const military = t.match(/^(\d{3,4})$/);
  if (military) {
    const n = parseInt(military[1]!, 10);
    const hour = Math.floor(n / 100);
    const minute = n % 100;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return base.set({ hour, minute, second: 0, millisecond: 0 });
    }
  }

  // Bare hour like "12" -> 12:00
  const hourOnly = t.match(/^(\d{1,2})$/);
  if (hourOnly) {
    const hour = parseInt(hourOnly[1]!, 10);
    if (hour >= 0 && hour <= 23) {
      return base.set({ hour, minute: 0, second: 0, millisecond: 0 });
    }
  }

  const ampm = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)$/);
  if (ampm) {
    let hour = parseInt(ampm[1]!, 10);
    const minute = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const meridiem = ampm[3]!;
    if ((meridiem === 'pm' || meridiem === 'p') && hour < 12) hour += 12;
    if ((meridiem === 'am' || meridiem === 'a') && hour === 12) hour = 0;
    return base.set({ hour, minute, second: 0, millisecond: 0 });
  }

  const chronoResults = chrono.parse(t, base.toJSDate(), { forwardDate: true });
  if (chronoResults[0]?.start.isCertain('hour')) {
    return DateTime.fromJSDate(chronoResults[0]!.start.date());
  }

  return null;
}

export function nowISO(): string {
  return DateTime.local().toISO()!;
}
