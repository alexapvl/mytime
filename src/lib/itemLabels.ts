import type { Item } from '../db/types.js';
import { formatDate, formatAllDaySchedule, formatScheduleTime, isAllDaySchedule } from './time.js';
import { remindersSummary } from './reminders.js';
import { meetingUrlForItem } from './meetings.js';
import { canRespondToInvitation, responseLabel } from './invitations.js';

export function metaLabel(item: Item): string {
  const parts: string[] = [];
  if (item.source === 'task' && item.project) parts.push(`@${item.project.replace(/^@/, '')}`);
  if (item.source === 'task' && item.tags.length) parts.push(...item.tags);
  return parts.join(' ');
}

export function eventDetailLines(item: Item): string[] {
  if (item.source === 'task') return [];
  const lines: string[] = [];
  if (item.location) lines.push(`location: ${item.location}`);
  if (item.url) lines.push(`link: ${item.url}`);
  const meetingUrl = meetingUrlForItem(item);
  if (meetingUrl) lines.push(`meeting: ${meetingUrl}`);
  const canRespond = canRespondToInvitation(item);
  if ((meetingUrl || canRespond) && (item.organizer?.displayName || item.organizer?.email)) {
    lines.push(`organizer: ${item.organizer.displayName ?? item.organizer.email}`);
  }
  if (canRespond) lines.push(`response: ${responseLabel(item.selfResponseStatus)}`);
  if (item.attendees.length) {
    const participantEmails = new Set<string>();
    if (item.organizer?.email) participantEmails.add(item.organizer.email.toLowerCase());
    for (const attendee of item.attendees) participantEmails.add(attendee.email.toLowerCase());
    const accepted = item.attendees.filter((attendee) => attendee.responseStatus === 'accepted').length;
    const pending = item.attendees.filter((attendee) => attendee.responseStatus === 'needsAction').length;
    lines.push(`participants: ${participantEmails.size}${accepted ? `, ${accepted} yes` : ''}${pending ? `, ${pending} pending` : ''}`);
  }
  if (item.source === 'event' && item.reminders.length) lines.push(`reminders: ${remindersSummary(item.reminders)}`);
  return lines;
}

export function scheduleLabel(item: Item): string {
  if (!item.start) return '';
  if (isAllDaySchedule(item.start, item.end ?? undefined, item.allDay)) {
    return formatAllDaySchedule(item.start, item.end);
  }
  const date = formatDate(item.start);
  return `${date} ${formatScheduleTime(item.start, item.end, item.allDay)}`;
}

export function detailLines(
  item: Item,
  { showSchedule = true, showMeta = true }: { showSchedule?: boolean; showMeta?: boolean } = {},
): string[] {
  const lines: string[] = [];
  if (showSchedule && scheduleLabel(item)) lines.push(scheduleLabel(item));
  if (showMeta) {
    if (item.source === 'event' || item.source === 'external') lines.push(...eventDetailLines(item));
    else {
      const meta = metaLabel(item);
      if (meta) lines.push(meta);
      if (item.url) lines.push(`link: ${item.url}`);
    }
  }
  return lines;
}
