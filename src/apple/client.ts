import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type HelperSuccess<T> = { ok: true; data: T };
type HelperFailure = { ok: false; error: { code: string; message: string; hint?: string } };

export type AppleAuthorizationStatus =
  | 'not_determined'
  | 'restricted'
  | 'denied'
  | 'full_access'
  | 'write_only'
  | 'unknown';

export type AppleSource = {
  id: string;
  title: string;
  type: string;
  canCreateCalendar: boolean;
  writableCalendarCount: number;
  default: boolean;
};

export type AppleCalendar = {
  id: string;
  title: string;
  type: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: string;
  writable: boolean;
  subscribed: boolean;
  immutable: boolean;
};

export type AppleEvent = {
  id: string;
  externalId?: string;
  calendarId: string;
  title: string;
  notes?: string;
  location?: string;
  url?: string;
  start: string;
  end: string;
  allDay: boolean;
  status: string;
  lastModified?: string;
  reminders?: { method: 'popup'; minutes: number }[];
  mytimeItemId?: string;
  mytimeItemType?: 'task' | 'event';
  occurrenceStart?: string;
  hasRecurrenceRules: boolean;
};

function helperPath(): string {
  const explicit = process.env.MYTIME_EVENTKIT_HELPER;
  if (explicit) return explicit;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'native', 'mytime-eventkit'),
    join(here, '..', 'native', 'mytime-eventkit'),
    join(here, '..', '..', 'dist', 'native', 'mytime-eventkit'),
  ];
  const found = candidates.find(existsSync);
  if (!found) {
    throw new Error('Apple Calendar helper not found. Reinstall mytime or run: pnpm build:native');
  }
  return found;
}

export async function callEventKit<T>(request: Record<string, unknown>): Promise<T> {
  const executable = helperPath();
  return new Promise<T>((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', () => {
      let response: HelperSuccess<T> | HelperFailure;
      try {
        response = JSON.parse(stdout) as HelperSuccess<T> | HelperFailure;
      } catch {
        reject(new Error(stderr.trim() || 'Apple Calendar helper returned invalid JSON'));
        return;
      }
      if (!response.ok) {
        const error = new Error(response.error.message) as Error & { code?: string; hint?: string };
        error.code = response.error.code;
        error.hint = response.error.hint;
        reject(error);
        return;
      }
      resolve(response.data);
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

export async function getAppleAuthorizationStatus(): Promise<AppleAuthorizationStatus> {
  const data = await callEventKit<{ status: AppleAuthorizationStatus }>({ command: 'auth.status' });
  return data.status;
}

export async function requestAppleAuthorization(): Promise<AppleAuthorizationStatus> {
  const data = await callEventKit<{ status: AppleAuthorizationStatus; granted: boolean }>({ command: 'auth.request' });
  return data.status;
}

export async function listAppleSources(): Promise<AppleSource[]> {
  const data = await callEventKit<{ sources: AppleSource[] }>({ command: 'source.list' });
  return data.sources;
}

export async function listAppleCalendars(): Promise<AppleCalendar[]> {
  const data = await callEventKit<{ calendars: AppleCalendar[] }>({ command: 'calendar.list' });
  return data.calendars;
}

export async function createAppleCalendar(sourceId: string, title = 'mytime'): Promise<AppleCalendar> {
  const data = await callEventKit<{ calendar: AppleCalendar }>({
    command: 'calendar.create',
    title,
    sourceId,
  });
  return data.calendar;
}

export async function renameAppleCalendar(calendarId: string, title: string): Promise<AppleCalendar> {
  const data = await callEventKit<{ calendar: AppleCalendar }>({
    command: 'calendar.rename',
    calendarId,
    title,
  });
  return data.calendar;
}

export async function deleteAppleCalendar(calendarId: string, confirmTitle = 'mytime'): Promise<boolean> {
  const data = await callEventKit<{ deleted: boolean }>({
    command: 'calendar.delete',
    calendarId,
    confirmTitle,
  });
  return data.deleted;
}

export async function queryAppleEvents(calendarId: string, start: string, end: string): Promise<AppleEvent[]> {
  const data = await callEventKit<{ events: AppleEvent[] }>({
    command: 'event.query',
    calendarIds: [calendarId],
    start,
    end,
  });
  return data.events;
}

export async function upsertAppleEvent(request: {
  calendarId: string;
  eventId?: string;
  occurrenceStart?: string;
  title: string;
  notes?: string;
  location?: string;
  mytimeItemId?: string;
  mytimeItemType?: 'task' | 'event';
  start: string;
  end: string;
  allDay: boolean;
  reminders?: { method: 'popup'; minutes: number }[];
  url?: string;
}): Promise<AppleEvent> {
  const data = await callEventKit<{ event: AppleEvent }>({ command: 'event.upsert', ...request });
  return data.event;
}

export async function getAppleEvent(calendarId: string, eventId: string, occurrenceStart?: string): Promise<AppleEvent> {
  const data = await callEventKit<{ event: AppleEvent }>({
    command: 'event.get',
    calendarId,
    eventId,
    occurrenceStart,
  });
  return data.event;
}

export async function deleteAppleEvent(
  calendarId: string,
  eventId: string,
  occurrenceStart?: string,
): Promise<boolean> {
  const data = await callEventKit<{ deleted: boolean }>({
    command: 'event.delete',
    calendarId,
    eventId,
    occurrenceStart,
  });
  return data.deleted;
}
