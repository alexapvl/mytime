import { DateTime } from 'luxon';
import type { calendar_v3 } from 'googleapis';
import { getCalendarClient } from './auth.js';
import { META_KEYS, getMeta, setMeta } from '../db/meta.js';
import { isSyncTokenExpired } from './errors.js';

const CALENDAR_NAME = 'mytime';
const CALENDAR_COLOR = '#4285F4';

export type CalendarInfo = {
  id: string;
  summary: string;
  primary?: boolean;
};

export async function getOrCreateMytimeCalendarId(): Promise<string> {
  const cached = getMeta(META_KEYS.googleCalendarId);
  if (cached) return cached;

  const calendar = getCalendarClient();
  const list = await calendar.calendarList.list();
  const existing = list.data.items?.find((c) => c.summary === CALENDAR_NAME);
  if (existing?.id) {
    setMeta(META_KEYS.googleCalendarId, existing.id);
    return existing.id;
  }

  const created = await calendar.calendars.insert({
    requestBody: {
      summary: CALENDAR_NAME,
      description: 'Tasks scheduled via mytime CLI',
    },
  });

  const calendarId = created.data.id!;
  await calendar.calendarList.insert({
    requestBody: {
      id: calendarId,
      backgroundColor: CALENDAR_COLOR,
      foregroundColor: '#ffffff',
    },
  });

  setMeta(META_KEYS.googleCalendarId, calendarId);
  return calendarId;
}

export async function listSelectedCalendars(): Promise<CalendarInfo[]> {
  const calendar = getCalendarClient();
  const list = await calendar.calendarList.list();
  return (list.data.items ?? [])
    .filter((c) => c.id && c.selected !== false)
    .map((c) => ({
      id: c.id!,
      summary: c.summaryOverride ?? c.summary ?? c.id!,
      primary: c.primary ?? false,
    }));
}

export type GoogleEventPayload = {
  id?: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  allDay?: boolean;
};

export async function upsertEvent(calendarId: string, event: GoogleEventPayload, eventId?: string) {
  const calendar = getCalendarClient();
  const start = event.allDay
    ? { date: event.start }
    : { dateTime: event.start };
  const end = event.allDay
    ? { date: event.end }
    : { dateTime: event.end };
  const body = {
    summary: event.summary,
    description: event.description,
    start,
    end,
  };

  if (eventId) {
    return calendar.events.update({ calendarId, eventId, requestBody: body });
  }
  return calendar.events.insert({ calendarId, requestBody: body });
}

export async function deleteEvent(calendarId: string, eventId: string) {
  const calendar = getCalendarClient();
  return calendar.events.delete({ calendarId, eventId });
}

export async function listEventsIncremental(calendarId: string, syncToken?: string) {
  const calendar = getCalendarClient();

  if (syncToken) {
    try {
      return await calendar.events.list({ calendarId, syncToken, showDeleted: true });
    } catch (err: unknown) {
      if (!isSyncTokenExpired(err)) throw err;
    }
  }

  return listEventsFull(calendarId);
}

type CalendarEvent = calendar_v3.Schema$Event;

async function listEventsFull(calendarId: string) {
  const calendar = getCalendarClient();
  const timeMin = DateTime.local().minus({ days: 30 }).toISO();
  const timeMax = DateTime.local().plus({ days: 365 }).toISO();

  const allItems: CalendarEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const response = await calendar.events.list({
      calendarId,
      showDeleted: true,
      singleEvents: true,
      timeMin: timeMin ?? undefined,
      timeMax: timeMax ?? undefined,
      maxResults: 250,
      pageToken,
    });

    allItems.push(...(response.data.items ?? []));
    pageToken = response.data.nextPageToken ?? undefined;
    nextSyncToken = response.data.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  return {
    data: {
      items: allItems,
      nextSyncToken,
    },
  };
}
