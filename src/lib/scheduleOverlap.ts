import { DateTime } from 'luxon';
import { listAllScheduled, listScheduledInRange } from '../db/items.js';
import type { Item } from '../db/types.js';
import { filterItemsForFreeTime } from './freeTime.js';
import { defaultEnd, isAllDaySchedule } from './time.js';

function dateOnly(iso: string): string {
  return iso.includes('T') ? DateTime.fromISO(iso).toISODate()! : iso.slice(0, 10);
}

export function isAllDayEvent(event: Item): boolean {
  if (!event.start) return false;
  return isAllDaySchedule(event.start, event.end, event.allDay);
}

/** All-day events use an exclusive end date (Google Calendar convention). */
export function allDayEventSpansDay(event: Item, day: DateTime): boolean {
  if (!event.start || !isAllDayEvent(event)) return false;
  const dayISO = day.toISODate()!;
  const start = dateOnly(event.start);
  const end = event.end ? dateOnly(event.end) : DateTime.fromISO(start).plus({ days: 1 }).toISODate()!;
  return start <= dayISO && end > dayISO;
}

/** Events on a day for scheduling, including multi-day all-day items that span the day. */
export function listDayEventsForSchedule(day: DateTime, excludeId?: string): Item[] {
  const dayStart = day.startOf('day').toISO()!;
  const dayEnd = day.endOf('day').toISO()!;
  const byId = new Map<string, Item>();

  for (const event of listScheduledInRange(dayStart, dayEnd)) {
    if (event.id !== excludeId && event.start) byId.set(event.id, event);
  }

  for (const event of listAllScheduled()) {
    if (event.id === excludeId || !event.start || byId.has(event.id)) continue;
    if (allDayEventSpansDay(event, day)) byId.set(event.id, event);
  }

  return filterItemsForFreeTime([...byId.values()]).sort((a, b) => {
    const aAllDay = isAllDayEvent(a);
    const bAllDay = isAllDayEvent(b);
    if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
    return (a.start ?? '').localeCompare(b.start ?? '');
  });
}

export function splitDayEvents(events: Item[]): { allDayEvents: Item[]; timedEvents: Item[] } {
  const allDayEvents: Item[] = [];
  const timedEvents: Item[] = [];
  for (const event of events) {
    if (isAllDayEvent(event)) allDayEvents.push(event);
    else timedEvents.push(event);
  }
  return { allDayEvents, timedEvents };
}

function eventRange(event: Item): { start: DateTime; end: DateTime } | null {
  if (!event.start) return null;
  if (isAllDayEvent(event)) return null;
  const start = DateTime.fromISO(event.start);
  const end = event.end ? DateTime.fromISO(event.end) : DateTime.fromISO(defaultEnd(event.start, 60));
  return { start, end };
}

export function slotOverlapsEvent(slotStart: DateTime, slotEnd: DateTime, event: Item): boolean {
  if (!event.start) return false;
  if (isAllDayEvent(event)) return true;
  const range = eventRange(event);
  if (!range) return false;
  return slotStart < range.end && slotEnd > range.start;
}

export function overlappingEvents(slotStart: DateTime, stepMinutes: number, events: Item[]): Item[] {
  const slotEnd = slotStart.plus({ minutes: stepMinutes });
  return events
    .filter((event) => !isAllDayEvent(event) && slotOverlapsEvent(slotStart, slotEnd, event))
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
}

export function isSlotFree(slotStart: DateTime, stepMinutes: number, timedEvents: Item[]): boolean {
  return overlappingEvents(slotStart, stepMinutes, timedEvents).length === 0;
}

/** Step-aligned slots for a day. Today starts at the next slot boundary at or after now. */
export function buildScheduleSlots(day: DateTime, stepMinutes: number, now = DateTime.local()): DateTime[] {
  const isToday = day.hasSame(now, 'day');
  const dayStart = day.startOf('day');
  const startMinute = isToday
    ? Math.ceil(now.diff(dayStart, 'minutes').minutes / stepMinutes) * stepMinutes
    : 0;
  const slots: DateTime[] = [];
  for (let minute = startMinute; minute < 24 * 60; minute += stepMinutes) {
    slots.push(dayStart.plus({ minutes: minute }));
  }
  return slots;
}

export type FreeSlot = { start: string; end: string };

export function listFreeSlots(
  day: DateTime,
  stepMinutes: number,
  opts?: { excludeId?: string; timeFilter?: string; now?: DateTime },
): { allDayEvents: Item[]; slots: FreeSlot[] } {
  const { allDayEvents, timedEvents } = splitDayEvents(listDayEventsForSchedule(day, opts?.excludeId));
  let slotStarts = buildScheduleSlots(day, stepMinutes, opts?.now);
  const filter = opts?.timeFilter?.trim();
  if (filter) slotStarts = slotStarts.filter((slot) => slot.toFormat('HH:mm').includes(filter));
  const slots = slotStarts
    .filter((slot) => isSlotFree(slot, stepMinutes, timedEvents))
    .map((slot) => ({
      start: slot.toISO()!,
      end: slot.plus({ minutes: stepMinutes }).toISO()!,
    }));
  return { allDayEvents, slots };
}
