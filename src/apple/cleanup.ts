import { DateTime } from 'luxon';
import { getMeta, META_KEYS } from '../db/meta.js';
import { listMytimeGoogleEventIdentities } from '../google/calendar.js';
import { deleteAppleEvent, listAppleCalendars, queryAppleEvents } from './client.js';
import { isMytimeCalendarName } from '../calendar/backend.js';

export type AppleDuplicateCandidate = {
  calendarId: string;
  calendarTitle: string;
  sourceTitle: string;
  eventId: string;
  title: string;
  start: string;
  mytimeItemId: string;
};

export type AppleDuplicatePreview = {
  activeCalendarId: string;
  scannedCalendars: number;
  candidates: AppleDuplicateCandidate[];
};

function fingerprint(event: {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}): string {
  return JSON.stringify([
    event.title.replace(/^✓\s+/, ''),
    event.start,
    event.end,
    event.allDay,
  ]);
}

export async function previewAppleDuplicateCleanup(): Promise<AppleDuplicatePreview> {
  const activeCalendarId = getMeta(META_KEYS.appleCalendarId);
  const activeSourceId = getMeta(META_KEYS.appleSourceId);
  if (!activeCalendarId || !activeSourceId) {
    throw new Error('Apple Calendar is not configured. Run: mytime setup apple');
  }

  const calendars = await listAppleCalendars();
  const active = calendars.find((calendar) => calendar.id === activeCalendarId);
  if (!active) throw new Error('Configured Apple mytime calendar is unavailable. Run: mytime setup apple');
  const otherMytimeCalendars = calendars.filter((calendar) =>
    calendar.id !== activeCalendarId &&
    calendar.sourceId === activeSourceId &&
    isMytimeCalendarName(calendar.title) &&
    calendar.writable,
  );
  const start = DateTime.local().minus({ days: 30 }).startOf('day').toISO()!;
  const end = DateTime.local().plus({ days: 365 }).endOf('day').toISO()!;
  const canonical = await queryAppleEvents(activeCalendarId, start, end);
  const canonicalItemIds = new Set(canonical.flatMap((event) => event.mytimeItemId ? [event.mytimeItemId] : []));
  const canonicalFingerprints = new Set(canonical.map(fingerprint));
  const googleIdentities = getMeta(META_KEYS.appleSharesGoogleCalendar) === 'true'
    ? await listMytimeGoogleEventIdentities()
    : [];
  const googleItemByUID = new Map(
    googleIdentities.flatMap((identity) =>
      identity.mytimeItemId ? [[identity.iCalUID.toLowerCase(), identity.mytimeItemId] as const] : [],
    ),
  );
  const verifiedOriginalItemIds = new Set(
    canonical.flatMap((event) => {
      const itemId = event.externalId ? googleItemByUID.get(event.externalId.toLowerCase()) : undefined;
      return itemId ? [itemId] : [];
    }),
  );
  const candidates: AppleDuplicateCandidate[] = [];

  for (const calendar of [active, ...otherMytimeCalendars]) {
    const events = calendar.id === activeCalendarId
      ? canonical
      : await queryAppleEvents(calendar.id, start, end);
    for (const event of events) {
      if (!event.id || !event.mytimeItemId) continue;
      const googleItemId = event.externalId
        ? googleItemByUID.get(event.externalId.toLowerCase())
        : undefined;
      if (googleItemId === event.mytimeItemId) continue;
      const verifiedSameCalendarCopy = verifiedOriginalItemIds.has(event.mytimeItemId);
      const matchingInactiveCopy =
        calendar.id !== activeCalendarId &&
        (canonicalItemIds.has(event.mytimeItemId) || canonicalFingerprints.has(fingerprint(event)));
      if (!verifiedSameCalendarCopy && !matchingInactiveCopy) continue;
      candidates.push({
        calendarId: calendar.id,
        calendarTitle: calendar.title,
        sourceTitle: calendar.sourceTitle,
        eventId: event.id,
        title: event.title,
        start: event.start,
        mytimeItemId: event.mytimeItemId,
      });
    }
  }

  return { activeCalendarId, scannedCalendars: 1 + otherMytimeCalendars.length, candidates };
}

export async function applyAppleDuplicateCleanup(
  preview: AppleDuplicatePreview,
): Promise<number> {
  let deleted = 0;
  for (const candidate of preview.candidates) {
    if (await deleteAppleEvent(candidate.calendarId, candidate.eventId)) deleted++;
  }
  return deleted;
}
