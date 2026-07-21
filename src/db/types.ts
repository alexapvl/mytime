export type ItemStatus = 'open' | 'done';
export type ItemPriority = 0 | 1 | 2 | 3;

export type ItemSource = 'task' | 'event' | 'external';

export type ReminderMethod = 'popup';

export type Reminder = {
  method: ReminderMethod;
  minutes: number;
};

export type MeetingProvider = 'google_meet' | 'other';

export type AttendeeResponseStatus = 'needsAction' | 'declined' | 'tentative' | 'accepted';

export type EventAttendee = {
  email: string;
  displayName?: string;
  responseStatus?: AttendeeResponseStatus;
  self?: boolean;
  organizer?: boolean;
  optional?: boolean;
};

export type EventOrganizer = {
  email?: string;
  displayName?: string;
  self?: boolean;
};

export type Item = {
  id: string;
  title: string;
  notes?: string;
  project?: string;
  tags: string[];
  priority: ItemPriority;
  status: ItemStatus;
  source: ItemSource;
  originProvider?: 'google' | 'apple';
  location?: string;
  url?: string;
  reminders: Reminder[];
  attendees: EventAttendee[];
  organizer?: EventOrganizer;
  selfResponseStatus?: AttendeeResponseStatus;
  meetingProvider?: MeetingProvider;
  meetingUrl?: string;
  conferenceRequestId?: string;
  start?: string;
  end?: string;
  allDay: boolean;
  googleEventId?: string;
  googleCalendarId?: string;
  syncedAt?: string;
  updatedAt: string;
  createdAt: string;
  completedAt?: string;
  remoteReference?: {
    provider: 'google' | 'apple';
    calendarId: string;
    eventId: string;
  };
};

export type ItemRow = {
  id: string;
  title: string;
  notes: string | null;
  project: string | null;
  tags: string;
  priority: number;
  status: string;
  source: string;
  origin_provider: string | null;
  location: string | null;
  url: string | null;
  reminders: string | null;
  attendees: string | null;
  organizer: string | null;
  self_response_status: string | null;
  meeting_provider: string | null;
  meeting_url: string | null;
  conference_request_id: string | null;
  start: string | null;
  end: string | null;
  all_day: number;
  google_event_id: string | null;
  google_calendar_id: string | null;
  synced_at: string | null;
  updated_at: string;
  created_at: string;
  completed_at: string | null;
};

function parseReminders(raw: string | null): Reminder[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Reminder[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function rowToItem(row: ItemRow): Item {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? undefined,
    project: row.project ?? undefined,
    tags: row.tags ? JSON.parse(row.tags) : [],
    priority: row.priority as ItemPriority,
    status: row.status as ItemStatus,
    source: (row.source as ItemSource) || 'task',
    originProvider: (row.origin_provider as 'google' | 'apple' | null) ?? undefined,
    location: row.location ?? undefined,
    url: row.url ?? undefined,
    reminders: parseReminders(row.reminders),
    attendees: parseJson<EventAttendee[]>(row.attendees, []),
    organizer: parseJson<EventOrganizer | undefined>(row.organizer, undefined),
    selfResponseStatus: (row.self_response_status as AttendeeResponseStatus | null) ?? undefined,
    meetingProvider: (row.meeting_provider as MeetingProvider | null) ?? undefined,
    meetingUrl: row.meeting_url ?? undefined,
    conferenceRequestId: row.conference_request_id ?? undefined,
    start: row.start ?? undefined,
    end: row.end ?? undefined,
    allDay: Boolean(row.all_day),
    googleEventId: row.google_event_id ?? undefined,
    googleCalendarId: row.google_calendar_id ?? undefined,
    syncedAt: row.synced_at ?? undefined,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export function itemToRow(item: Item): ItemRow {
  return {
    id: item.id,
    title: item.title,
    notes: item.notes ?? null,
    project: item.project ?? null,
    tags: JSON.stringify(item.tags),
    priority: item.priority,
    status: item.status,
    source: item.source,
    origin_provider: item.originProvider ?? null,
    location: item.location ?? null,
    url: item.url ?? null,
    reminders: item.reminders.length ? JSON.stringify(item.reminders) : null,
    attendees: item.attendees.length ? JSON.stringify(item.attendees) : null,
    organizer: item.organizer ? JSON.stringify(item.organizer) : null,
    self_response_status: item.selfResponseStatus ?? null,
    meeting_provider: item.meetingProvider ?? null,
    meeting_url: item.meetingUrl ?? null,
    conference_request_id: item.conferenceRequestId ?? null,
    start: item.start ?? null,
    end: item.end ?? null,
    all_day: item.allDay ? 1 : 0,
    google_event_id: item.googleEventId ?? null,
    google_calendar_id: item.googleCalendarId ?? null,
    synced_at: item.syncedAt ?? null,
    updated_at: item.updatedAt,
    created_at: item.createdAt,
    completed_at: item.completedAt ?? null,
  };
}

export function isLocalItem(item: Item): boolean {
  return item.source === 'task' || item.source === 'event';
}
