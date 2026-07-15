import type { Item } from '../db/types.js';
import { overdueLabel } from '../lib/overdue.js';

const NOTES_PREVIEW = 500;

export function listTask(item: Item) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    start: item.start ?? null,
    project: item.project ?? null,
  };
}

export function listEvent(item: Item) {
  return {
    id: item.id,
    title: item.title,
    source: item.source,
    start: item.start ?? null,
    end: item.end ?? null,
    allDay: item.allDay,
    meetingUrl: item.meetingUrl ?? null,
    response: item.selfResponseStatus ?? null,
  };
}

export function listScheduleItem(item: Item) {
  if (item.source === 'external') {
    return { id: item.id, title: item.title, source: item.source, start: item.start ?? null, end: item.end ?? null, allDay: item.allDay };
  }
  if (item.source === 'event') {
    return listEvent(item);
  }
  return { ...listTask(item), end: item.end ?? null, allDay: item.allDay };
}

export function detailItem(item: Item, full = false) {
  const base =
    item.source === 'event' || item.source === 'external'
      ? {
          id: item.id,
          title: item.title,
          source: item.source,
          location: item.location ?? null,
          reminders: item.reminders,
          organizer: item.organizer ?? null,
          attendees: item.attendees,
          response: item.selfResponseStatus ?? null,
          meetingProvider: item.meetingProvider ?? null,
          meetingUrl: item.meetingUrl ?? null,
          start: item.start ?? null,
          end: item.end ?? null,
          allDay: item.allDay,
          notes: formatNotes(item.notes, full),
        }
      : {
          id: item.id,
          title: item.title,
          status: item.status,
          source: item.source,
          priority: item.priority,
          project: item.project ?? null,
          tags: item.tags,
          start: item.start ?? null,
          end: item.end ?? null,
          allDay: item.allDay,
          notes: formatNotes(item.notes, full),
        };
  return base;
}

export function pastDueItem(item: Item) {
  return { ...listTask(item), overdue: overdueLabel(item) };
}

function formatNotes(notes: string | undefined, full: boolean): string | null {
  if (!notes) return null;
  if (full || notes.length <= NOTES_PREVIEW) return notes;
  return `${notes.slice(0, NOTES_PREVIEW)}... (truncated, ${notes.length} chars total — use --full)`;
}
