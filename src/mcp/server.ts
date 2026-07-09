import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Reminder } from '../db/types.js';
import {
  agentAddEvent,
  agentAddTask,
  agentBacklogList,
  agentCompleteTask,
  agentDeleteEvent,
  agentDeleteTask,
  agentFreeSlots,
  agentGetItem,
  agentPastDue,
  agentQuickAddEvent,
  agentQuickAddTask,
  agentScheduleEvent,
  agentScheduleList,
  agentScheduleTask,
  agentSearch,
  agentSync,
  agentUpdateEvent,
  agentUpdateTask,
} from '../agent/handlers.js';
import type { AgentResult } from '../agent/types.js';

const VERSION = '0.1.0';

function fromAgent(result: AgentResult): CallToolResult {
  if (result.kind === 'error') {
    return { content: [{ type: 'text', text: result.message }], isError: true };
  }
  const body = result.help?.length ? { ...result.payload, help: result.help } : result.payload;
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
}

function registerTools(server: McpServer): void {
  server.registerTool('list_backlog', { description: 'List all open tasks (scheduled and unscheduled). Returns item ids to use with other tools.', inputSchema: {} }, async () =>
    fromAgent(await agentBacklogList()),
  );

  server.registerTool(
    'list_schedule',
    {
      description: 'List scheduled items (tasks and Google Calendar events) in a time range. Defaults to today. Use ISO datetimes for from/to.',
      inputSchema: {
        from: z.string().optional().describe('ISO datetime for range start (default: start of today)'),
        to: z.string().optional().describe('ISO datetime for range end (default: end of today)'),
      },
    },
    async ({ from, to }) => fromAgent(await agentScheduleList(from, to)),
  );

  server.registerTool(
    'list_past_due',
    {
      description: 'List open tasks that are past due (scheduled before now and not completed). Tasks only, not external calendar events.',
      inputSchema: {},
    },
    async () => fromAgent(await agentPastDue()),
  );

  server.registerTool(
    'list_free_slots',
    {
      description: 'List completely free timed slots on a day (no overlap with existing timed events). Returns all-day events separately. Use before schedule_task to pick an open time.',
      inputSchema: {
        date: z.string().optional().describe('ISO date or datetime for the day (default: today)'),
        stepMinutes: z.number().int().positive().optional().describe('Slot step size in minutes (default: 60). Common values: 15, 30, 60, 120, 240.'),
        timeFilter: z.string().optional().describe('Optional HH:mm digit filter, e.g. "09" matches 09:00, 09:30, …'),
        excludeId: z.string().optional().describe('Item id to ignore when checking conflicts (use when rescheduling)'),
      },
    },
    async ({ date, stepMinutes, timeFilter, excludeId }) =>
      fromAgent(await agentFreeSlots({ date, stepMinutes, timeFilter, excludeId })),
  );

  server.registerTool('get_item', { description: 'Get a single item by id.', inputSchema: { id: z.string() } }, async ({ id }) =>
    fromAgent(await agentGetItem(id, true)),
  );

  server.registerTool(
    'search_tasks',
    { description: 'Search tasks and events by a substring of title, project, or tags (case-insensitive).', inputSchema: { query: z.string() } },
    async ({ query }) => fromAgent(await agentSearch(query)),
  );

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
    async (input) => fromAgent(await agentAddTask(input)),
  );

  server.registerTool(
    'quick_add',
    {
      description: 'Add a task from natural language. Parses date/time, #tags, @project and pN priority. e.g. "review PR tomorrow 3pm @work #swe p2".',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => fromAgent(await agentQuickAddTask(text)),
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
    async ({ id, ...updates }) => fromAgent(await agentUpdateTask(id, updates)),
  );

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
    { description: `Schedule a task at a given start date/time. Use allDay or an ISO date-only start for an all-day event. ${scheduleHint}`, inputSchema: scheduleSchema },
    async (input) => fromAgent(await agentScheduleTask(input)),
  );

  server.registerTool(
    'reschedule_task',
    { description: `Change the date/time of an already-scheduled task. Alias of schedule_task. ${scheduleHint}`, inputSchema: scheduleSchema },
    async (input) => fromAgent(await agentScheduleTask(input)),
  );

  server.registerTool(
    'complete_task',
    { description: 'Mark a task as done or not done. Omit "done" to toggle.', inputSchema: { id: z.string(), done: z.boolean().optional() } },
    async ({ id, done }) => fromAgent(await agentCompleteTask(id, done)),
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
        reminders: z.array(z.object({ method: z.literal('popup'), minutes: z.number().int().nonnegative() })).optional(),
      },
    },
    async (input) => fromAgent(await agentAddEvent({ ...input, reminders: input.reminders as Reminder[] | undefined })),
  );

  server.registerTool(
    'quick_add_event',
    {
      description: 'Add a calendar event from natural language. Parses date/time only (no priority/project). e.g. "team lunch tomorrow 12pm", "vacation jun 1-5".',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => fromAgent(await agentQuickAddEvent(text)),
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
        reminders: z.array(z.object({ method: z.literal('popup'), minutes: z.number().int().nonnegative() })).optional(),
      },
    },
    async ({ id, ...updates }) => fromAgent(await agentUpdateEvent(id, { ...updates, reminders: updates.reminders as Reminder[] | undefined })),
  );

  const eventScheduleSchema = {
    id: z.string(),
    start: z.string().describe('ISO datetime/date for the event start'),
    end: z.string().optional().describe('ISO datetime/date for the event end'),
    allDay: z.boolean().optional().describe('Schedule as an all-day event. Also inferred when start is an ISO date like 2026-05-30.'),
    durationMinutes: z.number().int().positive().optional().describe('Used when end is omitted (default 60)'),
  };

  server.registerTool(
    'schedule_event',
    { description: `Schedule or reschedule a mytime event. ${scheduleHint}`, inputSchema: eventScheduleSchema },
    async (input) => fromAgent(await agentScheduleEvent(input)),
  );

  server.registerTool(
    'reschedule_event',
    { description: `Change the date/time of an already-scheduled event. ${scheduleHint}`, inputSchema: eventScheduleSchema },
    async (input) => fromAgent(await agentScheduleEvent(input)),
  );

  server.registerTool(
    'delete_event',
    { description: 'Permanently delete a mytime event and its Google calendar entry.', inputSchema: { id: z.string() } },
    async ({ id }) => fromAgent(await agentDeleteEvent(id)),
  );

  server.registerTool(
    'delete_task',
    { description: 'Permanently delete a task and its Google event.', inputSchema: { id: z.string() } },
    async ({ id }) => fromAgent(await agentDeleteTask(id)),
  );

  server.registerTool(
    'sync',
    { description: 'Run a full two-way sync with Google Calendar (push local task changes, pull all calendars).', inputSchema: {} },
    async () => fromAgent(await agentSync()),
  );
}

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({ name: 'mytime', version: VERSION });
  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  await new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
}
