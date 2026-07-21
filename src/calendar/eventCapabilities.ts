import { getRemoteLink } from '../db/remoteLinks.js';
import type { Item } from '../db/types.js';
import { canRespondToInvitation } from '../lib/invitations.js';

export type EventCapabilities = {
  canEdit: boolean;
  canEditDetails: boolean;
  canEditReminders: boolean;
  canEditGuests: boolean;
  canReschedule: boolean;
  canDelete: boolean;
  canRespond: boolean;
  recurring: boolean;
  reason?: string;
};

export function eventCapabilities(item: Item): EventCapabilities {
  if (item.source !== 'external') {
    const event = item.source === 'event';
    return {
      canEdit: true,
      canEditDetails: true,
      canEditReminders: event,
      canEditGuests: event,
      canReschedule: Boolean(item.start && item.end),
      canDelete: true,
      canRespond: canRespondToInvitation(item),
      recurring: false,
    };
  }

  const provider = item.originProvider;
  const link = provider ? getRemoteLink(item.id, provider) : null;
  const canRespond = canRespondToInvitation(item);
  if (!link) {
    return {
      canEdit: false,
      canEditDetails: false,
      canEditReminders: false,
      canEditGuests: false,
      canReschedule: false,
      canDelete: false,
      canRespond,
      recurring: false,
      reason: 'Remote calendar link missing. Sync and try again.',
    };
  }

  const canEdit = link.canEditDetails || link.canEditReminders || link.canEditGuests;
  return {
    canEdit,
    canEditDetails: link.canEditDetails,
    canEditReminders: link.canEditReminders,
    canEditGuests: link.canEditGuests,
    canReschedule: link.canEditDetails && Boolean(item.start && item.end),
    canDelete: link.canDelete,
    canRespond,
    recurring: link.recurring,
    reason: canEdit || link.canDelete || canRespond ? undefined : 'Calendar is read-only.',
  };
}
