import { getItem, updateItem } from '../db/items.js';
import { getRemoteLink, upsertRemoteLink } from '../db/remoteLinks.js';
import type { AttendeeResponseStatus, Item } from '../db/types.js';
import { respondToGoogleEvent } from '../google/calendar.js';
import {
  canRespondToInvitation,
  responseStatusForChoice,
  selfAttendee,
  type InvitationResponse,
} from '../lib/invitations.js';

export async function respondToInvitation(item: Item, response: InvitationResponse): Promise<Item> {
  if (!canRespondToInvitation(item)) throw new Error('This event cannot be responded to from mytime');
  const responseStatus = responseStatusForChoice(response);
  return setInvitationResponseStatus(item, responseStatus);
}

export async function setInvitationResponseStatus(
  item: Item,
  responseStatus: AttendeeResponseStatus,
): Promise<Item> {
  if (!canRespondToInvitation(item)) throw new Error('This event cannot be responded to from mytime');
  const attendee = selfAttendee(item)!;
  const link = getRemoteLink(item.id, 'google');
  if (!link) throw new Error('Google Calendar link missing. Sync and try again.');

  const response = await respondToGoogleEvent(link.remoteCalendarId, link.remoteEventId, attendee.email, responseStatus);
  const attendees = item.attendees.map((entry) => entry.self ? { ...entry, responseStatus } : entry);
  updateItem(item.id, { attendees, selfResponseStatus: responseStatus });
  upsertRemoteLink(item.id, 'google', link.remoteCalendarId, link.remoteEventId, undefined, {
    canEditDetails: link.canEditDetails,
    canEditReminders: link.canEditReminders,
    canEditGuests: link.canEditGuests,
    canDelete: link.canDelete,
    recurring: link.recurring,
    etag: response.data.etag ?? undefined,
  });
  return getItem(item.id)!;
}
