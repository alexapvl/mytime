import { DateTime } from 'luxon';
import {
  createEvent,
  createItem,
  deleteItem,
  getItem,
  listAllScheduled,
  listBacklog,
  listPastDue,
  listScheduledInRange,
  rescheduleLocalItem,
  scheduleAllDayItem,
  scheduleItem,
  toggleDone,
  updateItem,
} from '../db/items.js';
import type { Item, ItemPriority, Reminder } from '../db/types.js';
import {
  getActiveProvider,
  getActiveProviderStatus,
  providerLabel,
  pushToActiveProvider,
  removeFromActiveProvider,
  syncCalendar,
} from '../calendar/provider.js';
import { parseQuickAdd } from '../lib/nlp.js';
import { listFreeSlots } from '../lib/scheduleOverlap.js';
import { allDayRange, defaultEnd, multiDayAllDayRange, todayEnd, todayStart } from '../lib/time.js';
import { parseDayArg } from './dates.js';
import { ensureFresh, markSyncFresh } from './fresh.js';
import { ok, err, type AgentResult } from './types.js';
import { detailItem, listScheduleItem, listTask, pastDueItem } from './views.js';
import { getMeta, META_KEYS } from '../db/meta.js';
import { inferEventKitBackend, mytimeCalendarName } from '../calendar/backend.js';
import { getAppleAuthorizationStatus, listAppleCalendars, listAppleSources } from '../apple/client.js';
import { isAuthenticated as isGoogleAuthenticated } from '../google/auth.js';

const SCHEDULE_HINT =
  'Run `mytime agent slots --date <day>` before scheduling, or `mytime agent schedule list` to inspect the day.';

async function syncPush(id: string): Promise<string> {
  const provider = getActiveProvider();
  const status = await getActiveProviderStatus();
  if (!provider || !status?.connected) return '';
  const item = getItem(id);
  if (!item || (item.source !== 'task' && item.source !== 'event') || !item.start) return '';
  try {
    await pushToActiveProvider(item);
    return ` (synced to ${providerLabel(provider)})`;
  } catch (e) {
    return ` (${providerLabel(provider)} sync failed: ${(e as Error).message})`;
  }
}

async function syncRemove(item: Item): Promise<string> {
  const provider = getActiveProvider();
  const status = await getActiveProviderStatus();
  if (!provider || !status?.connected) return '';
  if (item.source !== 'task' && item.source !== 'event') return '';
  try {
    await removeFromActiveProvider(item);
    return ` (removed from ${providerLabel(provider)})`;
  } catch (e) {
    return ` (${providerLabel(provider)} removal failed: ${(e as Error).message})`;
  }
}

export async function agentDashboard(): Promise<AgentResult> {
  await ensureFresh();
  const provider = getActiveProvider();
  const providerStatus = await getActiveProviderStatus();
  const backlog = listBacklog();
  const pastDue = listPastDue();
  const today = listScheduledInRange(todayStart(), todayEnd());

  return ok(
    {
      calendar: {
        provider: provider ?? 'none',
        status: providerStatus?.connected ? 'connected' : 'disconnected',
      },
      counts: {
        backlog: backlog.length,
        pastDue: pastDue.length,
        today: today.length,
      },
      backlog: backlog.slice(0, 12).map(listTask),
      pastDue: pastDue.slice(0, 8).map(pastDueItem),
      today: today.map(listScheduleItem),
    },
    [
      'Run `mytime agent backlog list` for all open tasks',
      'Run `mytime agent past-due` for overdue tasks',
      'Run `mytime agent task quick "<text>"` to add from natural language',
      'Run `mytime agent slots` before scheduling timed tasks',
      'Run `mytime agent calendar` for provider, backend, and setup effects',
      'Run `mytime setup --agents` to set up Cursor / Claude integration',
    ],
  );
}

export async function agentCalendarDashboard(): Promise<AgentResult> {
  const provider = getActiveProvider();
  const status = await getActiveProviderStatus();
  if (!provider) {
    return ok(
      {
        calendar: {
          adapter: 'none',
          backend: 'none',
          connected: false,
          writes: 'No remote calendar writes until user chooses Google or Apple setup',
        },
      },
      [
        'Ask user whether they want Google API or Apple EventKit access',
        'Run `mytime agent calendar setup` to explain both setup paths',
        'Run `mytime setup google` or `mytime setup apple` only after user chooses',
      ],
    );
  }

  const backend = provider === 'google' ? 'google' : getMeta(META_KEYS.appleBackend) ?? 'unknown';
  const calendarId = getMeta(
    provider === 'google' ? META_KEYS.googleCalendarId : META_KEYS.appleCalendarId,
  );
  let calendarName = mytimeCalendarName(backend as Parameters<typeof mytimeCalendarName>[0]);
  let sourceTitle: string | null = provider === 'google' ? 'Google API' : null;
  if (provider === 'apple' && status?.connected && calendarId) {
    try {
      const calendar = (await listAppleCalendars()).find((candidate) => candidate.id === calendarId);
      if (calendar) {
        calendarName = calendar.title;
        sourceTitle = calendar.sourceTitle;
      }
    } catch {
      // Status already carries the actionable permission error.
    }
  }
  const sharedGoogleCalendar =
    provider === 'apple' && getMeta(META_KEYS.appleSharesGoogleCalendar) === 'true';
  const separateBackend = provider === 'apple' && backend !== 'google';
  const googleBackendRelation = provider !== 'apple' || backend !== 'google'
    ? 'not-applicable'
    : sharedGoogleCalendar
      ? 'verified-same'
      : 'unknown';

  return ok(
    {
      calendar: {
        adapter: provider === 'google' ? 'google-api' : 'apple-eventkit',
        backend,
        source: sourceTitle,
        calendar: calendarName,
        connected: status?.connected ?? false,
        detail: status?.detail ?? null,
        sharedGoogleCalendar,
        googleBackendRelation,
        writes: `Only ${calendarName} is writable through the active adapter`,
        switchingEffect: sharedGoogleCalendar
          ? 'Google API and EventKit share one remote calendar; switching adapter does not copy or delete events'
          : googleBackendRelation === 'unknown'
            ? 'EventKit uses Google storage, but calendar identity is unverified; remote calendar deletion is disabled'
          : separateBackend
            ? 'Google and Apple use separate backend calendars; switching migrates owned items once'
            : 'Only one adapter writes at a time',
        visibility: separateBackend
          ? 'If both backend calendars are visible, the same migrated schedule appears twice by design'
          : 'One backend calendar should produce one visible schedule',
      },
    },
    [
      'Run `mytime agent calendar setup` for setup commands and effects',
      'Run `mytime agent calendar switch` before changing active backend',
      'Run `mytime agent calendar cleanup` before deleting duplicate copies',
      'Run `mytime agent calendar sources` to inspect Calendar.app accounts',
    ],
  );
}

export async function agentCalendarSources(): Promise<AgentResult> {
  let authorization = 'unavailable';
  let sources: Array<Record<string, unknown>> = [];
  let sourceError: string | null = null;
  if (process.platform === 'darwin') {
    try {
      authorization = await getAppleAuthorizationStatus();
      if (authorization === 'full_access') {
        sources = (await listAppleSources())
          .filter((source) => source.canCreateCalendar)
          .map((source) => ({
            id: source.id,
            title: source.title,
            backend: inferEventKitBackend(source),
            type: source.type,
            default: source.default,
            writableCalendars: source.writableCalendarCount,
          }));
      }
    } catch (error) {
      sourceError = (error as Error).message;
    }
  }
  return ok(
    {
      googleApi: {
        connected: isGoogleAuthenticated(),
        calendarConfigured: Boolean(getMeta(META_KEYS.googleCalendarId)),
      },
      eventKit: {
        permission: authorization,
        error: sourceError,
        count: sources.length,
        sources: sources.length ? sources : '0 writable sources available',
      },
    },
    authorization === 'full_access'
      ? ['Use `mytime setup apple --source <id>` only after user chooses the account/backend']
      : ['User must run `mytime setup apple` and approve Full Calendar access'],
  );
}

export function agentCalendarGuide(topic: 'all' | 'setup' | 'switch' | 'cleanup' = 'all'): AgentResult {
  const setup = {
    purpose: 'Configure one writable calendar adapter after user chooses Google or Apple',
    commands: [
      {
        command: 'mytime setup google',
        effect: 'Checks Google OAuth files and selects Google API when ready',
        remote: 'Creates or adopts mytime-google only when authenticated sync needs it',
        userAction: 'User completes Google browser OAuth with mytime auth google',
      },
      {
        command: 'mytime setup apple',
        effect: 'Requests EventKit permission and selects or creates a backend-named calendar',
        remote: 'Uses mytime-google, mytime-icloud, mytime-local, or backend equivalent',
        userAction: 'User approves Full Calendar access and chooses source when needed',
      },
      {
        command: 'mytime setup apple --source <id> [--calendar <id>]',
        effect: 'Chooses exact Calendar.app account and optionally adopts exact existing calendar',
        remote: 'Does not guess when multiple matching calendars exist',
        userAction: 'Agent summarizes source/backend before running',
      },
    ],
  };
  const switching = {
    purpose: 'Change active writer while preserving local owned tasks and events',
    rules: [
      'Same Google backend through Google API and EventKit: adopt same calendar; no event copy',
      'Different backends such as Google and iCloud: migrate owned items once into separate calendars',
      'Google-backed EventKit with unknown calendar identity: never delete a remote calendar automatically',
      'Only active adapter may push, update, or delete remote owned events',
      'Old-provider external cache is removed locally and new-provider calendars are fetched',
    ],
    commands: [
      {
        command: 'mytime setup <provider> --keep-old-calendar',
        effect: 'Switches active writer and preserves old remote dedicated calendar',
        reversible: true,
        warning: 'Both separate backend calendars may show the same migrated schedule when visible',
      },
      {
        command: 'mytime setup <provider> --delete-old-calendar',
        effect: 'Switches, verifies new backend, then deletes old remote dedicated calendar last',
        reversible: false,
        confirmation: 'Agent must obtain explicit user approval',
      },
    ],
  };
  const cleanup = {
    purpose: 'Remove only verified copies while preserving canonical events',
    commands: [
      {
        command: 'mytime setup apple --cleanup-duplicates',
        effect: 'Read-only preview of verified duplicate candidates',
        remote: 'No events deleted',
      },
      {
        command: 'mytime setup apple --cleanup-duplicates --apply',
        effect: 'Deletes only candidates from preview and keeps canonical events',
        reversible: false,
        confirmation: 'Agent must show preview and obtain explicit user approval',
      },
    ],
  };
  const selected = topic === 'setup' ? { setup } : topic === 'switch' ? { switching } : topic === 'cleanup' ? { cleanup } : {
    concepts: {
      adapter: 'How mytime accesses a calendar: Google API or Apple EventKit',
      backend: 'Where calendar data lives: Google, iCloud, Exchange, CalDAV, or local',
      naming: 'Dedicated calendars are named by backend, not adapter',
    },
    setup,
    switching,
    cleanup,
  };
  return ok(selected, ['Run `mytime agent calendar` for current live state']);
}

export async function agentBacklogList(): Promise<AgentResult> {
  await ensureFresh();
  const items = listBacklog();
  if (items.length === 0) {
    return ok({ count: 0, tasks: '0 open tasks in backlog' }, ['Run `mytime agent task quick "<title>"` to add a task']);
  }
  return ok(
    { count: items.length, tasks: items.map(listTask) },
    [
      'Run `mytime agent item <id>` for details',
      'Run `mytime agent task schedule <id> --start <iso>` to schedule',
    ],
  );
}

export async function agentScheduleList(from?: string, to?: string): Promise<AgentResult> {
  if (from && !DateTime.fromISO(from).isValid) return err(`Invalid "from" datetime: ${from}`, undefined, 2);
  if (to && !DateTime.fromISO(to).isValid) return err(`Invalid "to" datetime: ${to}`, undefined, 2);
  await ensureFresh();
  const start = from ?? todayStart();
  const end = to ?? todayEnd();
  const items = listScheduledInRange(start, end);
  if (items.length === 0) {
    return ok({ from: start, to: end, count: 0, items: '0 scheduled items in range' }, [
      'Run `mytime agent slots --date <day>` to find open times',
      'Run `mytime agent task quick "<title> tomorrow 3pm"` to add and schedule',
    ]);
  }
  return ok(
    { from: start, to: end, count: items.length, items: items.map(listScheduleItem) },
    ['Run `mytime agent item <id> --full` for notes and tags', 'Run `mytime agent slots --date <day>` before rescheduling'],
  );
}

export async function agentPastDue(): Promise<AgentResult> {
  await ensureFresh();
  const items = listPastDue();
  if (items.length === 0) {
    return ok({ count: 0, tasks: '0 past-due open tasks' });
  }
  return ok(
    { count: items.length, tasks: items.map(pastDueItem) },
    ['Run `mytime agent task schedule <id> --start <iso>` to reschedule', 'Run `mytime agent task done <id>` to complete'],
  );
}

export async function agentFreeSlots(options: {
  date?: string;
  stepMinutes?: number;
  timeFilter?: string;
  excludeId?: string;
}): Promise<AgentResult> {
  const { date, stepMinutes, timeFilter, excludeId } = options;
  const parsedDay = parseDayArg(date);
  if (!parsedDay.ok) return err(parsedDay.message, undefined, 2);
  if (excludeId) {
    const excluded = getItem(excludeId);
    if (!excluded) return err(`No item with id ${excludeId}`);
  }
  await ensureFresh();
  const day = parsedDay.day;
  const step = stepMinutes ?? 60;
  const { allDayEvents, slots } = listFreeSlots(day, step, { excludeId, timeFilter });
  if (slots.length === 0) {
    return ok(
      {
        date: day.toISODate(),
        stepMinutes: step,
        timeFilter: timeFilter ?? null,
        count: 0,
        freeSlots: '0 free timed slots on this day',
        allDayEvents: allDayEvents.map(listScheduleItem),
      },
      ['Try another day with `--date <iso>`', 'Use `--step-minutes 30` for finer slots'],
    );
  }
  return ok(
    {
      date: day.toISODate(),
      stepMinutes: step,
      timeFilter: timeFilter ?? null,
      count: slots.length,
      allDayEvents: allDayEvents.map(listScheduleItem),
      freeSlots: slots,
    },
    ['Run `mytime agent task schedule <id> --start <slot.start>` using a slot above'],
  );
}

export async function agentGetItem(id: string, full = false): Promise<AgentResult> {
  await ensureFresh();
  const item = getItem(id);
  if (!item) return err(`No item with id ${id}`);
  const help =
    item.source === 'task'
      ? ['Run `mytime agent task schedule <id> --start <iso>` to schedule', 'Run `mytime agent task done <id>` to complete']
      : item.source === 'event'
        ? ['Run `mytime agent event schedule <id> --start <iso>` to reschedule']
        : [];
  return ok({ item: detailItem(item, full) }, help);
}

export async function agentSearch(query: string): Promise<AgentResult> {
  await ensureFresh();
  const all = new Map<string, Item>();
  for (const item of listBacklog()) all.set(item.id, item);
  for (const item of listAllScheduled()) all.set(item.id, item);
  const q = query.toLowerCase();
  const matches = [...all.values()].filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.project?.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q)),
  );
  if (matches.length === 0) {
    return ok({ count: 0, query, items: `0 matches for "${query}"` }, ['Try a shorter query or `mytime agent backlog list`']);
  }
  return ok(
    { count: matches.length, query, items: matches.map(listScheduleItem) },
    ['Run `mytime agent item <id>` for details'],
  );
}

export async function agentAddTask(input: {
  title: string;
  notes?: string;
  project?: string;
  tags?: string[];
  priority?: number;
}): Promise<AgentResult> {
  await ensureFresh();
  const item = createItem({
    title: input.title,
    notes: input.notes,
    project: input.project,
    tags: input.tags ?? [],
    priority: (input.priority ?? 0) as ItemPriority,
  });
  return ok(
    { message: 'Task added', item: detailItem(item) },
    ['Run `mytime agent task schedule <id> --start <iso>` to schedule', 'Run `mytime agent slots` to pick a time'],
  );
}

export async function agentQuickAddTask(text: string): Promise<AgentResult> {
  await ensureFresh();
  const parsed = parseQuickAdd(text);
  const item = createItem({
    title: parsed.title,
    tags: parsed.tags,
    project: parsed.project,
    priority: parsed.priority,
    start: parsed.start,
    end: parsed.end,
    allDay: parsed.allDay,
  });
  const note = item.start ? await syncPush(item.id) : '';
  return ok(
    { message: `Added: ${item.title}${note}`, item: detailItem(item) },
    item.start ? ['Run `mytime agent schedule list` to review today'] : ['Run `mytime agent task schedule <id> --start <iso>` to schedule'],
  );
}

export async function agentUpdateTask(
  id: string,
  updates: { title?: string; notes?: string; project?: string; tags?: string[]; priority?: number },
): Promise<AgentResult> {
  await ensureFresh();
  const existing = getItem(id);
  if (!existing) return err(`No item with id ${id}`);
  if (existing.source !== 'task') return err('Only tasks can be updated with task update');
  const patch: Partial<Item> = {};
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.notes !== undefined) patch.notes = updates.notes;
  if (updates.project !== undefined) patch.project = updates.project;
  if (updates.tags !== undefined) patch.tags = updates.tags;
  if (updates.priority !== undefined) patch.priority = updates.priority as ItemPriority;
  const updated = updateItem(id, patch);
  const note = await syncPush(id);
  return ok({ message: `Task updated${note}`, item: updated ? detailItem(updated) : null });
}

export async function agentScheduleTask(input: {
  id: string;
  start: string;
  end?: string;
  allDay?: boolean;
  durationMinutes?: number;
}): Promise<AgentResult> {
  const { id, start, end, allDay, durationMinutes } = input;
  if (!DateTime.fromISO(start).isValid) return err(`Invalid start datetime: ${start}`, undefined, 2);
  if (end && !DateTime.fromISO(end).isValid) return err(`Invalid end datetime: ${end}`, undefined, 2);
  await ensureFresh();
  const useAllDay = allDay === true || !start.includes('T');
  if (useAllDay) {
    const range = allDayRange(start);
    const finalEnd = end ? allDayRange(end).end : range.end;
    if (DateTime.fromISO(finalEnd) <= DateTime.fromISO(range.start)) return err('end must be after start', undefined, 2);
    const result = scheduleAllDayItem(id, range.start, finalEnd);
    if (!result) return err(`Cannot schedule: no task with id ${id} (external events are read-only)`, [SCHEDULE_HINT]);
    const note = await syncPush(id);
    return ok({ message: `Scheduled all day${note}`, item: detailItem(result) });
  }
  const finalEnd = end ?? defaultEnd(start, durationMinutes ?? 60);
  if (DateTime.fromISO(finalEnd) <= DateTime.fromISO(start)) return err('end must be after start', undefined, 2);
  const result = scheduleItem(id, start, finalEnd);
  if (!result) return err(`Cannot schedule: no task with id ${id} (external events are read-only)`, [SCHEDULE_HINT]);
  const note = await syncPush(id);
  return ok({ message: `Scheduled${note}`, item: detailItem(result) }, ['Run `mytime agent schedule list` to review']);
}

export async function agentCompleteTask(id: string, done?: boolean): Promise<AgentResult> {
  await ensureFresh();
  const item = getItem(id);
  if (!item) return err(`No item with id ${id}`);
  if (item.source !== 'task') return err('Only tasks can be completed');
  const isDone = item.status === 'done';
  const target = done === undefined ? !isDone : done;
  if (target !== isDone) toggleDone(id);
  const note = await syncPush(id);
  const updated = getItem(id);
  return ok({ message: `Task ${target ? 'completed' : 'reopened'}${note}`, item: updated ? detailItem(updated) : null });
}

export async function agentDeleteTask(id: string): Promise<AgentResult> {
  await ensureFresh();
  const item = getItem(id);
  if (!item) return err(`No item with id ${id}`);
  if (item.source !== 'task') return err('Use `mytime agent event delete <id>` for events');
  const note = await syncRemove(item);
  deleteItem(id);
  return ok({ message: `Deleted "${item.title}"${note}` });
}

export async function agentAddEvent(input: {
  title: string;
  notes?: string;
  location?: string;
  start: string;
  end?: string;
  allDay?: boolean;
  reminders?: Reminder[];
}): Promise<AgentResult> {
  const { title, notes, location, start, end, allDay, reminders } = input;
  if (!DateTime.fromISO(start).isValid) return err(`Invalid start: ${start}`, undefined, 2);
  await ensureFresh();
  const useAllDay = allDay === true || !start.includes('T');
  let finalStart = start;
  let finalEnd = end ?? defaultEnd(start);
  if (useAllDay) {
    const startDay = start.includes('T') ? DateTime.fromISO(start).toISODate()! : start.slice(0, 10);
    finalStart = allDayRange(startDay).start;
    if (end && !end.includes('T')) {
      const endDay = end.slice(0, 10);
      finalEnd = endDay > startDay ? multiDayAllDayRange(startDay, endDay).end : allDayRange(startDay).end;
    } else if (!end) {
      finalEnd = allDayRange(startDay).end;
    }
  }
  if (!DateTime.fromISO(finalEnd).isValid) return err(`Invalid end: ${finalEnd}`, undefined, 2);
  const item = createEvent({
    title,
    notes,
    location,
    start: finalStart,
    end: finalEnd,
    allDay: useAllDay,
    reminders,
  });
  const note = await syncPush(item.id);
  return ok({ message: `Event added${note}`, item: detailItem(item) });
}

export async function agentQuickAddEvent(text: string): Promise<AgentResult> {
  await ensureFresh();
  const parsed = parseQuickAdd(text);
  if (!parsed.start) return err('Events require a date/time in the text', ['Example: `mytime agent event quick "team lunch tomorrow 12pm"`'], 2);
  const item = createEvent({
    title: parsed.title,
    start: parsed.start,
    end: parsed.end,
    allDay: parsed.allDay,
  });
  const note = await syncPush(item.id);
  return ok({ message: `Added event: ${item.title}${note}`, item: detailItem(item) });
}

export async function agentUpdateEvent(
  id: string,
  updates: { title?: string; notes?: string; location?: string; reminders?: Reminder[] },
): Promise<AgentResult> {
  await ensureFresh();
  const existing = getItem(id);
  if (!existing) return err(`No item with id ${id}`);
  if (existing.source !== 'event') return err('Item is not an event');
  const patch: Partial<Item> = {};
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.notes !== undefined) patch.notes = updates.notes;
  if (updates.location !== undefined) patch.location = updates.location;
  if (updates.reminders !== undefined) patch.reminders = updates.reminders;
  const updated = updateItem(id, patch);
  const note = await syncPush(id);
  return ok({ message: `Event updated${note}`, item: updated ? detailItem(updated) : null });
}

export async function agentScheduleEvent(input: {
  id: string;
  start: string;
  end?: string;
  allDay?: boolean;
  durationMinutes?: number;
}): Promise<AgentResult> {
  const { id, start, end, allDay, durationMinutes } = input;
  if (!DateTime.fromISO(start).isValid) return err(`Invalid start datetime: ${start}`, undefined, 2);
  if (end && !DateTime.fromISO(end).isValid) return err(`Invalid end datetime: ${end}`, undefined, 2);
  await ensureFresh();
  const item = getItem(id);
  if (!item) return err(`No item with id ${id}`);
  if (item.source !== 'event') return err('Item is not an event');
  const useAllDay = allDay === true || !start.includes('T');
  if (useAllDay) {
    const range = allDayRange(start);
    const finalEnd = end ? allDayRange(end).end : range.end;
    if (DateTime.fromISO(finalEnd) <= DateTime.fromISO(range.start)) return err('end must be after start', undefined, 2);
    const result = rescheduleLocalItem(id, range.start, finalEnd, true);
    if (!result) return err(`Cannot reschedule event ${id}`);
    const note = await syncPush(id);
    return ok({ message: `Event rescheduled all day${note}`, item: detailItem(result) });
  }
  const finalEnd = end ?? defaultEnd(start, durationMinutes ?? 60);
  if (DateTime.fromISO(finalEnd) <= DateTime.fromISO(start)) return err('end must be after start', undefined, 2);
  const result = rescheduleLocalItem(id, start, finalEnd, false);
  if (!result) return err(`Cannot reschedule event ${id}`);
  const note = await syncPush(id);
  return ok({ message: `Event rescheduled${note}`, item: detailItem(result) }, [SCHEDULE_HINT]);
}

export async function agentDeleteEvent(id: string): Promise<AgentResult> {
  await ensureFresh();
  const item = getItem(id);
  if (!item) return err(`No item with id ${id}`);
  if (item.source !== 'event') return err('Item is not an event');
  const note = await syncRemove(item);
  deleteItem(id);
  return ok({ message: `Deleted event "${item.title}"${note}` });
}

export async function agentSync(): Promise<AgentResult> {
  const status = await getActiveProviderStatus();
  if (!status?.connected) {
    return err('No connected calendar provider.', [
      'Ask the user whether they want Google or Apple Calendar',
      'Run `mytime setup google` or `mytime setup apple`',
    ]);
  }
  const result = await syncCalendar();
  markSyncFresh();
  return ok({ ...result }, ['Run `mytime agent` for dashboard', 'Run `mytime agent schedule list` for today']);
}
