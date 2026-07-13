import type { calendar_v3 } from '@googleapis/calendar';
import { getMeta, META_KEYS } from '../db/meta.js';
import { findItemByRemote } from '../db/remoteLinks.js';
import { updateItem } from '../db/items.js';
import { DateTime } from 'luxon';
import { deleteEvent, listEventsIncremental } from './calendar.js';

export type GoogleDuplicateCandidate = {
  calendarId: string;
  eventId: string;
  title: string;
  start: string;
  canonicalEventId: string;
  type: 'task' | 'event';
};

export type GoogleDuplicatePreview = {
  calendarId: string;
  candidates: GoogleDuplicateCandidate[];
};

function eventStart(event: calendar_v3.Schema$Event): string {
  return event.start?.dateTime ?? event.start?.date ?? '';
}

function eventEnd(event: calendar_v3.Schema$Event): string {
  return event.end?.dateTime ?? event.end?.date ?? '';
}

function fingerprint(event: calendar_v3.Schema$Event): string {
  return JSON.stringify([
    event.summary?.replace(/^✓\s+/, '') ?? '',
    eventStart(event),
    eventEnd(event),
    Boolean(event.start?.date),
    event.location ?? '',
  ]);
}

function normalizedDescription(value: string | null | undefined): string[] {
  return (value ?? '').split('\n').map((line) =>
    line.replace(/^[—-]\s+(mytime event|synced via mytime)$/, '$1'),
  );
}

function descriptionsMatch(
  canonical: calendar_v3.Schema$Event,
  duplicate: calendar_v3.Schema$Event,
  type: 'task' | 'event',
): boolean {
  const expectedMarker = type === 'task' ? 'synced via mytime' : 'mytime event';
  const canonicalLines = normalizedDescription(canonical.description);
  const duplicateLines = normalizedDescription(duplicate.description);
  if (!duplicateLines.includes(expectedMarker)) return false;
  const canonicalNonMarkers = [...new Set(canonicalLines.filter((line) => line !== expectedMarker))].sort();
  const duplicateNonMarkers = [...new Set(duplicateLines.filter((line) => line !== expectedMarker))].sort();
  return JSON.stringify(canonicalNonMarkers) === JSON.stringify(duplicateNonMarkers);
}

function isEventKitImportedId(event: calendar_v3.Schema$Event): boolean {
  return Boolean(
    event.id?.startsWith('_') &&
    event.iCalUID &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.iCalUID),
  );
}

export async function previewGoogleDuplicateCleanup(): Promise<GoogleDuplicatePreview> {
  const calendarId = getMeta(META_KEYS.googleCalendarId);
  if (!calendarId) throw new Error('Google mytime calendar is not configured.');
  const response = await listEventsIncremental(calendarId, undefined);
  const events = (response.data.items ?? []).filter((event) => event.id && event.status !== 'cancelled');
  const groups = new Map<string, calendar_v3.Schema$Event[]>();
  for (const event of events) {
    const key = fingerprint(event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const candidates: GoogleDuplicateCandidate[] = [];

  for (const group of groups.values()) {
    const canonical = group.filter((event) => {
      const type = event.extendedProperties?.private?.mytime_type;
      return type === 'task' || type === 'event';
    });
    if (canonical.length !== 1) continue;
    const original = canonical[0]!;
    const type = original.extendedProperties!.private!.mytime_type as 'task' | 'event';
    for (const event of group) {
      if (event === original || event.extendedProperties?.private?.mytime_type) continue;
      if (!event.id || !isEventKitImportedId(event) || !descriptionsMatch(original, event, type)) continue;
      candidates.push({
        calendarId,
        eventId: event.id,
        title: event.summary ?? 'Untitled',
        start: eventStart(event),
        canonicalEventId: original.id!,
        type,
      });
    }
  }

  return { calendarId, candidates };
}

export async function applyGoogleDuplicateCleanup(preview: GoogleDuplicatePreview): Promise<number> {
  let deleted = 0;
  for (const candidate of preview.candidates) {
    await deleteEvent(preview.calendarId, candidate.eventId);
    deleted++;
  }
  return deleted;
}

export async function refreshGoogleLinkedItemRanges(): Promise<number> {
  const calendarId = getMeta(META_KEYS.googleCalendarId);
  if (!calendarId) return 0;
  const response = await listEventsIncremental(calendarId, undefined);
  let refreshed = 0;
  for (const event of response.data.items ?? []) {
    if (!event.id || event.status === 'cancelled') continue;
    const local = findItemByRemote('google', calendarId, event.id);
    if (!local || (local.source !== 'task' && local.source !== 'event')) continue;
    const allDay = Boolean(event.start?.date);
    const rawStart = event.start?.dateTime ?? event.start?.date;
    const rawEnd = event.end?.dateTime ?? event.end?.date;
    if (!rawStart || !rawEnd) continue;
    const start = allDay ? DateTime.fromISO(rawStart).toISODate()! : DateTime.fromISO(rawStart).toISO()!;
    const end = allDay ? DateTime.fromISO(rawEnd).toISODate()! : DateTime.fromISO(rawEnd).toISO()!;
    if (local.start === start && local.end === end && local.allDay === allDay) continue;
    updateItem(local.id, { start, end, allDay });
    refreshed++;
  }
  return refreshed;
}
