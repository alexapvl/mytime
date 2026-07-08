import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DateTime } from 'luxon';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Item, ItemPriority } from '../db/types.js';
import {
  createItem,
  createEvent,
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
import type { Reminder } from '../db/types.js';
import { parseQuickAdd } from '../lib/nlp.js';
import { overdueLabel } from '../lib/overdue.js';
import { listFreeSlots } from '../lib/scheduleOverlap.js';
import { allDayRange, defaultEnd, multiDayAllDayRange, todayEnd, todayStart } from '../lib/time.js';
import { isAuthenticated } from '../google/auth.js';
import { pushLocalItem, removeFromGoogle, syncWithGoogle } from '../google/sync.js';

const VERSION = '0.1.0';

function text(value: unknown): CallToolResult {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text: body }] };
}

function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Compact, agent-friendly view of an item. */
function view(item: Item) {
  if (item.source === 'event') {
    return {
      id: item.id,
      title: item.title,
      source: item.source,
      location: item.location,
      reminders: item.reminders,
      start: item.start,
      end: item.end,
      allDay: item.allDay,
      notes: item.notes,
    };
  }
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    source: item.source,
    priority: item.priority,
    project: item.project,
    tags: item.tags,
    start: item.start,
    end: item.end,
    allDay: item.allDay,
    notes: item.notes,
  };
}

async function syncPush(id: string): Promise<string> {
  if (!isAuthenticated()) return '';
  const item = getItem(id);
  if (!item || (item.source !== 'task' && item.source !== 'event') || !item.start) return '';
  try {
    await pushLocalItem(item);
    return ' (synced to Google)';
  } catch (e) {
    return ` (Google sync failed: ${(e as Error).message})`;
  }
}

async function syncRemove(item: Item): Promise<string> {
  if (!isAuthenticated()) return '';
  if ((item.source !== 'task' && item.source !== 'event') || !item.googleEventId) return '';
  try {
    await removeFromGoogle(item);
    return ' (removed from Google)';
  } catch (e) {
    return ` (Google removal failed: ${(e as Error).message})`;
  }
}

// Pull fresh state from Google before serving reads/writes so the agent never
// works on stale data. Debounced so a burst of tool calls doesn't re-pull every
// calendar each time. A failed sync never blocks the operation (serve local).
const FRESH_WINDOW_MS = 15_000;
let lastSyncAt = 0;

async function ensureFresh(): Promise<void> {
  if (!isAuthenticated()) return;
  if (Date.now() - lastSyncAt < FRESH_WINDOW_MS) return;
  lastSyncAt = Date.now();
  try {
    await syncWithGoogle();
  } catch {
    // Keep serving local data rather than failing the tool call.
  }
}

function registerTools(server: McpServer): void {
  // ---- Read tools ----

  server.registerTool(
    'list_backlog',
    {
      description: 'List all open tasks (scheduled and unscheduled). Returns item ids to use with other tools.',
      inputSchema: {},
    },
    async () => {
      await ensureFresh();
      return text(listBacklog().map(view));
    },
  );

  server.registerTool(
    'list_schedule',
    {
      description:
        'List scheduled items (tasks and Google Calendar events) in a time range. Defaults to today. Use ISO datetimes for from/to.',
      inputSchema: {
        from: z.string().optional().describe('ISO datetime for range start (default: start of today)'),
        to: z.string().optional().describe('ISO datetime for range end (default: end of today)'),
      },
    },
    async ({ from, to }) => {
      if (from && !DateTime.fromISO(from).isValid) return toolError(`Invalid "from" datetime: ${from}`);
      if (to && !DateTime.fromISO(to).isValid) return toolError(`Invalid "to" datetime: ${to}`);
      await ensureFresh();
      const start = from ?? todayStart();
      const end = to ?? todayEnd();
      return text(listScheduledInRange(start, end).map(view));
    },
  );

  server.registerTool(
    'list_past_due',
    {
      description:
        'List open tasks that are past due (scheduled before now and not completed). Tasks only, not external calendar events.',
      inputSchema: {},
    },
    async () => {
      await ensureFresh();
      return text(listPastDue().map((item) => ({ ...view(item), overdue: overdueLabel(item) })));
    },
  );

  server.registerTool(
    'list_free_slots',
    {
      description:
        'List completely free timed slots on a day (no overlap with existing timed events). Returns all-day events separately. Use before schedule_task to pick an open time.',
      inputSchema: {
        date: z.string().optional().describe('ISO date or datetime for the day (default: today)'),
        stepMinutes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Slot step size in minutes (default: 60). Common values: 15, 30, 60, 120, 240.'),
        timeFilter: z.string().optional().describe('Optional HH:mm digit filter, e.g. "09" matches 09:00, 09:30, …'),
        excludeId: z.string().optional().describe('Item id to ignore when checking conflicts (use when rescheduling)'),
      },
    },
    async ({ date, stepMinutes, timeFilter, excludeId }) => {
      if (date && !DateTime.fromISO(date).isValid) return toolError(`Invalid date: ${date}`);
      if (excludeId) {
        const excluded = getItem(excludeId);
        if (!excluded) return toolError(`No item with id ${excludeId}`);
      }
      await ensureFresh();
      const day = date ? DateTime.fromISO(date).startOf('day') : DateTime.local().startOf('day');
      const step = stepMinutes ?? 60;
      const { allDayEvents, slots } = listFreeSlots(day, step, { excludeId, timeFilter });
      return text({
        date: day.toISODate(),
        stepMinutes: step,
        timeFilter: timeFilter ?? null,
        allDayEvents: allDayEvents.map(view),
        freeSlots: slots,
      });
    },
  );

  server.registerTool(
    'get_item',
    {
      description: 'Get a single item by id.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      await ensureFresh();
      const item = getItem(id);
      return item ? text(view(item)) : toolError(`No item with id ${id}`);
    },
  );

  server.registerTool(
    'search_tasks',
    {
      description: 'Search tasks and events by a substring of title, project, or tags (case-insensitive).',
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
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
      return text(matches.map(view));
    },
  );

  // ---- Write tools (auto-sync to Google per action) ----

  server.registerTool(
    'add_task',
    {
      description: 'Create a new unscheduled task in the backlog.',
      inputSchema: {
        title: z.string(),
        notes: z.string().optional(),
        project: z.string().optional(),
        tags: z.array(z.string()).optional(),
        priority: z.number().int().min(0).max(3).optional(),
      },
    },
    async ({ title, notes, project, tags, priority }) => {
      await ensureFresh();
      const item = createItem({
        title,
        notes,
        project,
        tags: tags ?? [],
        priority: (priority ?? 0) as ItemPriority,
      });
      return text({ message: 'Task added', item: view(item) });
    },
  );

  server.registerTool(
    'quick_add',
    {
      description:
        'Add a task from natural language. Parses date/time, #tags, @project and pN priority. e.g. "review PR tomorrow 3pm @work #swe p2".',
      inputSchema: { text: z.string() },
    },
    async ({ text: input }) => {
      await ensureFresh();
      const parsed = parseQuickAdd(input);
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
      return text({ message: `Added: ${item.title}${note}`, item: view(item) });
    },
  );

  server.registerTool(
    'update_task',
    {
      description: 'Update fields of an existing task. Only provided fields change.',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        notes: z.string().optional(),
        project: z.string().optional(),
        tags: z.array(z.string()).optional(),
        priority: z.number().int().min(0).max(3).optional(),
      },
    },
    async ({ id, title, notes, project, tags, priority }) => {
      await ensureFresh();
      const existing = getItem(id);
      if (!existing) return toolError(`No item with id ${id}`);
      if (existing.source !== 'task') return toolError('Only tasks can be updated with update_task');
      const updates: Partial<Item> = {};
      if (title !== undefined) updates.title = title;
      if (notes !== undefined) updates.notes = notes;
      if (project !== undefined) updates.project = project;
      if (tags !== undefined) updates.tags = tags;
      if (priority !== undefined) updates.priority = priority as ItemPriority;
      const updated = updateItem(id, updates);
      const note = await syncPush(id);
      return text({ message: `Task updated${note}`, item: updated ? view(updated) : null });
    },
  );

  const scheduleHandler = async ({
    id,
    start,
    end,
    allDay,
    durationMinutes,
  }: {
    id: string;
    start: string;
    end?: string;
    allDay?: boolean;
    durationMinutes?: number;
  }): Promise<CallToolResult> => {
    if (!DateTime.fromISO(start).isValid) return toolError(`Invalid start datetime: ${start}`);
    if (end && !DateTime.fromISO(end).isValid) return toolError(`Invalid end datetime: ${end}`);
    await ensureFresh();
    const useAllDay = allDay === true || !start.includes('T');
    if (useAllDay) {
      const range = allDayRange(start);
      const finalEnd = end ? allDayRange(end).end : range.end;
      if (DateTime.fromISO(finalEnd) <= DateTime.fromISO(range.start)) return toolError('end must be after start');
      const result = scheduleAllDayItem(id, range.start, finalEnd);
      if (!result) return toolError(`Cannot schedule: no task with id ${id} (external events are read-only)`);
      const note = await syncPush(id);
      return text({ message: `Scheduled all day${note}`, item: view(result) });
    }
    const finalEnd = end ?? defaultEnd(start, durationMinutes ?? 60);
    if (DateTime.fromISO(finalEnd) <= DateTime.fromISO(start)) return toolError('end must be after start');
    const result = scheduleItem(id, start, finalEnd);
    if (!result) return toolError(`Cannot schedule: no task with id ${id} (external events are read-only)`);
    const note = await syncPush(id);
    return text({ message: `Scheduled${note}`, item: view(result) });
  };

  const scheduleSchema = {
    id: z.string(),
    start: z.string().describe('ISO datetime/date for the event start'),
    end: z.string().optional().describe('ISO datetime/date for the event end'),
    allDay: z.boolean().optional().describe('Schedule as an all-day event. Also inferred when start is an ISO date like 2026-05-30.'),
    durationMinutes: z.number().int().positive().optional().describe('Used when end is omitted (default 60)'),
  };

  const scheduleHint = 'Call list_free_slots for the target day to see open times, or list_schedule to see all events.';

  server.registerTool(
    'schedule_task',
    {
      description: `Schedule a task at a given start date/time. Use allDay or an ISO date-only start for an all-day event. ${scheduleHint}`,
      inputSchema: scheduleSchema,
    },
    scheduleHandler,
  );

  server.registerTool(
    'reschedule_task',
    {
      description: `Change the date/time of an already-scheduled task. Alias of schedule_task. ${scheduleHint}`,
      inputSchema: scheduleSchema,
    },
    scheduleHandler,
  );

  server.registerTool(
    'complete_task',
    {
      description: 'Mark a task as done or not done. Omit "done" to toggle.',
      inputSchema: { id: z.string(), done: z.boolean().optional() },
    },
    async ({ id, done }) => {
      await ensureFresh();
      const item = getItem(id);
      if (!item) return toolError(`No item with id ${id}`);
      if (item.source !== 'task') return toolError('Only tasks can be completed');
      const isDone = item.status === 'done';
      const target = done === undefined ? !isDone : done;
      if (target !== isDone) toggleDone(id);
      const note = await syncPush(id);
      const updated = getItem(id);
      return text({ message: `Task ${target ? 'completed' : 'reopened'}${note}`, item: updated ? view(updated) : null });
    },
  );

  server.registerTool(
    'add_event',
    {
      description: 'Create a new calendar event on the mytime calendar. Requires start/end (use NLP via quick_add_event or provide ISO times).',
      inputSchema: {
        title: z.string(),
        notes: z.string().optional(),
        location: z.string().optional(),
        start: z.string().describe('ISO datetime or date for event start'),
        end: z.string().optional().describe('ISO datetime or date for event end'),
        allDay: z.boolean().optional(),
        reminders: z
          .array(z.object({ method: z.literal('popup'), minutes: z.number().int().nonnegative() }))
          .optional(),
      },
    },
    async ({ title, notes, location, start, end, allDay, reminders }) => {
      if (!DateTime.fromISO(start).isValid) return toolError(`Invalid start: ${start}`);
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
      if (!DateTime.fromISO(finalEnd).isValid) return toolError(`Invalid end: ${finalEnd}`);
      const item = createEvent({
        title,
        notes,
        location,
        start: finalStart,
        end: finalEnd,
        allDay: useAllDay,
        reminders: reminders as Reminder[] | undefined,
      });
      const note = await syncPush(item.id);
      return text({ message: `Event added${note}`, item: view(item) });
    },
  );

  server.registerTool(
    'quick_add_event',
    {
      description:
        'Add a calendar event from natural language. Parses date/time only (no priority/project). e.g. "team lunch tomorrow 12pm", "vacation jun 1-5".',
      inputSchema: { text: z.string() },
    },
    async ({ text: input }) => {
      await ensureFresh();
      const parsed = parseQuickAdd(input);
      if (!parsed.start) return toolError('Events require a date/time in the text');
      const item = createEvent({
        title: parsed.title,
        start: parsed.start,
        end: parsed.end,
        allDay: parsed.allDay,
      });
      const note = await syncPush(item.id);
      return text({ message: `Added event: ${item.title}${note}`, item: view(item) });
    },
  );

  server.registerTool(
    'update_event',
    {
      description: 'Update fields of an existing mytime event. Only provided fields change.',
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        notes: z.string().optional(),
        location: z.string().optional(),
        reminders: z
          .array(z.object({ method: z.literal('popup'), minutes: z.number().int().nonnegative() }))
          .optional(),
      },
    },
    async ({ id, title, notes, location, reminders }) => {
      await ensureFresh();
      const existing = getItem(id);
      if (!existing) return toolError(`No item with id ${id}`);
      if (existing.source !== 'event') return toolError('Item is not an event');
      const updates: Partial<Item> = {};
      if (title !== undefined) updates.title = title;
      if (notes !== undefined) updates.notes = notes;
      if (location !== undefined) updates.location = location;
      if (reminders !== undefined) updates.reminders = reminders as Reminder[];
      const updated = updateItem(id, updates);
      const note = await syncPush(id);
      return text({ message: `Event updated${note}`, item: updated ? view(updated) : null });
    },
  );

  const eventScheduleHandler = async ({
    id,
    start,
    end,
    allDay,
    durationMinutes,
  }: {
    id: string;
    start: string;
    end?: string;
    allDay?: boolean;
    durationMinutes?: number;
  }): Promise<CallToolResult> => {
    if (!DateTime.fromISO(start).isValid) return toolError(`Invalid start datetime: ${start}`);
    if (end && !DateTime.fromISO(end).isValid) return toolError(`Invalid end datetime: ${end}`);
    await ensureFresh();
    const item = getItem(id);
    if (!item) return toolError(`No item with id ${id}`);
    if (item.source !== 'event') return toolError('Item is not an event');
    const useAllDay = allDay === true || !start.includes('T');
    if (useAllDay) {
      const range = allDayRange(start);
      const finalEnd = end ? allDayRange(end).end : range.end;
      if (DateTime.fromISO(finalEnd) <= DateTime.fromISO(range.start)) return toolError('end must be after start');
      const result = rescheduleLocalItem(id, range.start, finalEnd, true);
      if (!result) return toolError(`Cannot reschedule event ${id}`);
      const note = await syncPush(id);
      return text({ message: `Event rescheduled all day${note}`, item: view(result) });
    }
    const finalEnd = end ?? defaultEnd(start, durationMinutes ?? 60);
    if (DateTime.fromISO(finalEnd) <= DateTime.fromISO(start)) return toolError('end must be after start');
    const result = rescheduleLocalItem(id, start, finalEnd, false);
    if (!result) return toolError(`Cannot reschedule event ${id}`);
    const note = await syncPush(id);
    return text({ message: `Event rescheduled${note}`, item: view(result) });
  };

  const eventScheduleSchema = {
    id: z.string(),
    start: z.string().describe('ISO datetime/date for the event start'),
    end: z.string().optional().describe('ISO datetime/date for the event end'),
    allDay: z.boolean().optional().describe('Schedule as an all-day event. Also inferred when start is an ISO date like 2026-05-30.'),
    durationMinutes: z.number().int().positive().optional().describe('Used when end is omitted (default 60)'),
  };

  server.registerTool(
    'schedule_event',
    {
      description: `Schedule or reschedule a mytime event. ${scheduleHint}`,
      inputSchema: eventScheduleSchema,
    },
    eventScheduleHandler,
  );

  server.registerTool(
    'reschedule_event',
    {
      description: `Change the date/time of an already-scheduled event. ${scheduleHint}`,
      inputSchema: eventScheduleSchema,
    },
    eventScheduleHandler,
  );

  server.registerTool(
    'delete_event',
    {
      description: 'Permanently delete a mytime event and its Google calendar entry.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      await ensureFresh();
      const item = getItem(id);
      if (!item) return toolError(`No item with id ${id}`);
      if (item.source !== 'event') return toolError('Item is not an event');
      deleteItem(id);
      const note = await syncRemove(item);
      return text({ message: `Deleted event "${item.title}"${note}` });
    },
  );

  server.registerTool(
    'delete_task',
    {
      description: 'Permanently delete a task and its Google event.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      await ensureFresh();
      const item = getItem(id);
      if (!item) return toolError(`No item with id ${id}`);
      if (item.source !== 'task') return toolError('Use delete_event for events');
      deleteItem(id);
      const note = await syncRemove(item);
      return text({ message: `Deleted "${item.title}"${note}` });
    },
  );

  server.registerTool(
    'sync',
    {
      description: 'Run a full two-way sync with Google Calendar (push local task changes, pull all calendars).',
      inputSchema: {},
    },
    async () => {
      if (!isAuthenticated()) return toolError('Not authenticated. Run: mytime auth');
      const result = await syncWithGoogle();
      lastSyncAt = Date.now();
      return text(result);
    },
  );
}

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({ name: 'mytime', version: VERSION });
  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive until the client disconnects (stdin closes).
  await new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
}
