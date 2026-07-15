import type { AttendeeResponseStatus, EventAttendee, Item } from '../db/types.js';

export type InvitationResponse = 'yes' | 'maybe' | 'no';

export function responseStatusForChoice(response: InvitationResponse): AttendeeResponseStatus {
  if (response === 'yes') return 'accepted';
  if (response === 'maybe') return 'tentative';
  return 'declined';
}

export function selfAttendee(item: Item): EventAttendee | undefined {
  return item.attendees.find((attendee) => attendee.self);
}

export function canRespondToInvitation(item: Item): boolean {
  return item.originProvider === 'google' && item.organizer?.self !== true && Boolean(selfAttendee(item));
}

export function needsInvitationResponse(item: Item): boolean {
  return canRespondToInvitation(item) && (item.selfResponseStatus ?? selfAttendee(item)?.responseStatus) === 'needsAction';
}

export function responseLabel(status: AttendeeResponseStatus | undefined): string {
  if (status === 'accepted') return 'yes';
  if (status === 'tentative') return 'maybe';
  if (status === 'declined') return 'no';
  return 'needs response';
}
