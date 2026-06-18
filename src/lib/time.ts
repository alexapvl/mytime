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
  if (isAllDaySchedule(start, end, allDay)) return 'all day';
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

  const structured = parseTimeInput(normalized, base.toISO()!);
  if (structured) return structured;

  const rangeSep = /\s*(?:[-–—]|\s+(?:to|till|until)\s+)\s*/i;
  const parts = normalized.split(rangeSep).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2) {
    const start = parseTimeNlp(parts[0]!, base);
    let end = parseTimeNlp(parts[1]!, base);
    if (start && end) {
      if (end <= start) end = end.plus({ days: 1 });
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

function parseSingleTime(input: string, base: DateTime): DateTime | null {
  const t = input.trim().toLowerCase().replace(/(\d)\.(\d{2})\b/g, '$1:$2');

  const hm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    return base.set({ hour: parseInt(hm[1]!, 10), minute: parseInt(hm[2]!, 10), second: 0, millisecond: 0 });
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
