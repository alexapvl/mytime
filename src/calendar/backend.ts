import type { CalendarBackend } from './types.js';

export function mytimeCalendarName(backend: CalendarBackend): string {
  return backend === 'unknown' ? 'mytime-apple' : `mytime-${backend}`;
}

export function isMytimeCalendarName(title: string): boolean {
  return title === 'mytime' || /^mytime-(google|icloud|exchange|local|caldav|apple)$/.test(title);
}

export function inferEventKitBackend(source: { title: string; type: string }): CalendarBackend {
  if (/^icloud$/i.test(source.title.trim())) return 'icloud';
  if (source.type === 'icloud') return 'icloud';
  if (source.type === 'exchange') return 'exchange';
  if (source.type === 'local') return 'local';
  if (source.type === 'caldav') {
    return /google|gmail/i.test(source.title) ? 'google' : 'caldav';
  }
  return 'unknown';
}
