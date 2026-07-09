import { DateTime } from 'luxon';

export type ParsedDay =
  | { ok: true; day: DateTime }
  | { ok: false; message: string };

/** Parse agent --date values: ISO dates, "today", or "tomorrow". */
export function parseDayArg(value?: string): ParsedDay {
  if (!value) return { ok: true, day: DateTime.local().startOf('day') };
  const lower = value.toLowerCase();
  if (lower === 'today') return { ok: true, day: DateTime.local().startOf('day') };
  if (lower === 'tomorrow') return { ok: true, day: DateTime.local().plus({ days: 1 }).startOf('day') };
  const iso = DateTime.fromISO(value);
  if (iso.isValid) return { ok: true, day: iso.startOf('day') };
  return { ok: false, message: `Invalid date: ${value}` };
}
