import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DateTime } from 'luxon';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Item, ItemPriority } from '../db/types.js';
import {
  createItem,
  deleteItem,
  getItem,
  listAllScheduled,
  listInbox,
  listScheduledInRange,
  scheduleItem,
  toggleDone,
  unscheduleItem,
  updateItem,
} from '../db/items.js';
import { parseQuickAdd } from '../lib/nlp.js';
import { defaultEnd, todayEnd, todayStart } from '../lib/time.js';
import { isAuthenticated } from '../google/auth.js';
import { pushTask, removeFromGoogle, syncWithGoogle } from '../google/sync.js';

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
    notes: item.notes,
  };
}

/** Push a task to Google after a local change; returns a short status suffix. */
async function syncPush(id: string): Promise<string> {
  if (!isAuthenticated()) return '';
  const item = getItem(id);
  if (!item || item.source !== 'task' || !item.start) return '';
  try {
    await pushTask(item);
    return ' (synced to Google)';
  } catch (e) {
    return ` (Google sync failed: ${(e as Error).message})`;
  }
}

/** Remove a task's Google event after a local change; returns a short status suffix. */
async function syncRemove(item: Item): Promise<string> {
  if (!isAuthenticated()) return '';
  if (item.source !== 'task' || !item.googleEventId) return '';
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
      return text(listInbox().map(view));
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
      for (const item of listInbox()) all.set(item.id, item);
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
        'Add a task from natural language. Parses date/time, @tags, #project and pN priority. e.g. "review PR tomorrow 3pm @work #swe p2".',
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
    durationMinutes,
  }: {
    id: string;
    start: string;
    end?: string;
    durationMinutes?: number;
  }): Promise<CallToolResult> => {
    if (!DateTime.fromISO(start).isValid) return toolError(`Invalid start datetime: ${start}`);
    if (end && !DateTime.fromISO(end).isValid) return toolError(`Invalid end datetime: ${end}`);
    await ensureFresh();
    const finalEnd = end ?? defaultEnd(start, durationMinutes ?? 60);
    if (DateTime.fromISO(finalEnd) <= DateTime.fromISO(start)) return toolError('end must be after start');
    const result = scheduleItem(id, start, finalEnd);
    if (!result) return toolError(`Cannot schedule: no task with id ${id} (external events are read-only)`);
    const note = await syncPush(id);
    return text({ message: `Scheduled${note}`, item: view(result) });
  };

  const scheduleSchema = {
    id: z.string(),
    start: z.string().describe('ISO datetime for the event start'),
    end: z.string().optional().describe('ISO datetime for the event end'),
    durationMinutes: z.number().int().positive().optional().describe('Used when end is omitted (default 60)'),
  };

  server.registerTool(
    'schedule_task',
    {
      description: 'Schedule a task at a given start time. Provide end or durationMinutes (default 60 min).',
      inputSchema: scheduleSchema,
    },
    scheduleHandler,
  );

  server.registerTool(
    'reschedule_task',
    {
      description: 'Change the date/time of an already-scheduled task. Alias of schedule_task.',
      inputSchema: scheduleSchema,
    },
    scheduleHandler,
  );

  server.registerTool(
    'unschedule_task',
    {
      description: 'Remove the scheduled time from a task and delete its Google event. Returns it to the backlog.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      await ensureFresh();
      const before = getItem(id);
      if (!before) return toolError(`No item with id ${id}`);
      const result = unscheduleItem(id);
      if (!result) return toolError(`Cannot unschedule: ${id} is not a task (external events are read-only)`);
      const note = await syncRemove(before);
      return text({ message: `Unscheduled${note}`, item: view(result) });
    },
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
      if (item.source !== 'task') return toolError('External events cannot be completed');
      const isDone = item.status === 'done';
      const target = done === undefined ? !isDone : done;
      if (target !== isDone) toggleDone(id);
      const note = await syncPush(id);
      const updated = getItem(id);
      return text({ message: `Task ${target ? 'completed' : 'reopened'}${note}`, item: updated ? view(updated) : null });
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
