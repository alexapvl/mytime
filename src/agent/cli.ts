import {
  agentAddEvent,
  agentAddTask,
  agentBacklogList,
  agentCompleteTask,
  agentDashboard,
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
} from './handlers.js';
import { flagBool, flagDone, flagInt, flagString, flagStringList, parseArgs, requirePos } from './argv.js';
import { AGENT_DESCRIPTION, emitResult, emitUsage } from './format.js';
import type { Reminder } from '../db/types.js';

const TOP_HELP = [
  'Run `mytime agent` for live dashboard',
  'Run `mytime agent backlog list` for open tasks',
  'Run `mytime agent schedule list` for today',
  'Run `mytime agent slots` before scheduling',
  'Run `mytime agent task quick "<text>"` to add from natural language',
  'Run `mytime agent --help <command>` for subcommand help',
];

function printAgentHelp(topic?: string): never {
  if (!topic) {
    emitUsage('mytime agent — agent-ergonomic tasks + calendar CLI', [
      ...TOP_HELP,
      'Commands: backlog, schedule, past-due, slots, item, search, task, event, sync',
    ]);
  }

  const guides: Record<string, string[]> = {
    backlog: ['mytime agent backlog list'],
    schedule: ['mytime agent schedule list [--from <iso>] [--to <iso>]'],
    'past-due': ['mytime agent past-due'],
    slots: ['mytime agent slots [--date <iso>] [--step-minutes 60] [--time-filter 09] [--exclude-id <id>]'],
    item: ['mytime agent item <id> [--full]'],
    search: ['mytime agent search <query>'],
    task: [
      'mytime agent task add --title <text> [--notes] [--project] [--tags a,b] [--priority 0-3]',
      'mytime agent task quick "<natural language>"',
      'mytime agent task update <id> [--title] [--notes] [--project] [--tags] [--priority]',
      'mytime agent task schedule <id> --start <iso> [--end] [--all-day] [--duration-minutes 60]',
      'mytime agent task done <id> [--done true|false]',
      'mytime agent task delete <id>',
    ],
    event: [
      'mytime agent event add --title <text> --start <iso> [--end] [--all-day] [--notes] [--location]',
      'mytime agent event quick "<natural language>"',
      'mytime agent event update <id> [--title] [--notes] [--location]',
      'mytime agent event schedule <id> --start <iso> [--end] [--all-day] [--duration-minutes 60]',
      'mytime agent event delete <id>',
    ],
    sync: ['mytime agent sync'],
  };

  const help = guides[topic];
  if (!help) {
    emitUsage(`Unknown help topic: ${topic}`, ['Topics: backlog, schedule, past-due, slots, item, search, task, event, sync']);
  }
  emitUsage(`mytime agent ${topic}`, help);
}

function parseReminders(flags: ReturnType<typeof parseArgs>['flags']): Reminder[] | undefined {
  const raw = flagString(flags, 'reminders');
  if (!raw) return undefined;
  return raw.split(';').map((part) => {
    const [method, minutes] = part.split(':');
    return { method: 'popup' as const, minutes: Number.parseInt(minutes ?? '0', 10) };
  }).filter((r) => r.method === 'popup' && Number.isFinite(r.minutes));
}

export async function runAgentCli(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const json = flagBool(flags, 'json');

  if (flagBool(flags, 'help')) {
    printAgentHelp(positional[0]);
  }

  if (positional.length === 0) {
    return emitResult(await agentDashboard(), { json, description: AGENT_DESCRIPTION });
  }

  const [command, sub, ...rest] = positional;

  switch (command) {
    case 'backlog': {
      if (sub !== 'list') emitUsage('Usage: mytime agent backlog list', ['Run `mytime agent backlog list`']);
      return emitResult(await agentBacklogList(), { json });
    }

    case 'schedule': {
      if (sub !== 'list') emitUsage('Usage: mytime agent schedule list [--from] [--to]', ['Run `mytime agent schedule list`']);
      return emitResult(await agentScheduleList(flagString(flags, 'from'), flagString(flags, 'to')), { json });
    }

    case 'past-due':
      if (sub) emitUsage('Usage: mytime agent past-due', ['Run `mytime agent past-due`']);
      return emitResult(await agentPastDue(), { json });

    case 'slots':
      if (sub) emitUsage('Usage: mytime agent slots [--date] [--step-minutes] [--time-filter] [--exclude-id]', ['Run `mytime agent slots`']);
      return emitResult(
        await agentFreeSlots({
          date: flagString(flags, 'date'),
          stepMinutes: flagInt(flags, 'step-minutes'),
          timeFilter: flagString(flags, 'time-filter'),
          excludeId: flagString(flags, 'exclude-id'),
        }),
        { json },
      );

    case 'item': {
      const id = requirePos(positional, 1, 'item id');
      return emitResult(await agentGetItem(id, flagBool(flags, 'full')), { json });
    }

    case 'search': {
      const query = positional.slice(1).join(' ');
      if (!query) emitUsage('Usage: mytime agent search <query>', ['Example: mytime agent search meloDL']);
      return emitResult(await agentSearch(query), { json });
    }

    case 'task':
      return runTaskCommand(sub, rest, flags, json);

    case 'event':
      return runEventCommand(sub, rest, flags, json);

    case 'sync':
      if (sub) emitUsage('Usage: mytime agent sync', ['Run `mytime agent sync`']);
      return emitResult(await agentSync(), { json });

    default:
      emitUsage(`Unknown command: ${command}`, TOP_HELP);
  }
}

async function runTaskCommand(
  sub: string | undefined,
  rest: string[],
  flags: ReturnType<typeof parseArgs>['flags'],
  json: boolean,
): Promise<number> {
  switch (sub) {
    case 'add': {
      const title = flagString(flags, 'title');
      if (!title) emitUsage('Usage: mytime agent task add --title <text>', ['Run `mytime agent task add --title "Fix bug"`']);
      return emitResult(
        await agentAddTask({
          title,
          notes: flagString(flags, 'notes'),
          project: flagString(flags, 'project'),
          tags: flagStringList(flags, 'tags'),
          priority: flagInt(flags, 'priority'),
        }),
        { json },
      );
    }
    case 'quick': {
      const text = rest.join(' ');
      if (!text) emitUsage('Usage: mytime agent task quick "<text>"', ['Example: mytime agent task quick "review PR tomorrow 3pm @work p2"']);
      return emitResult(await agentQuickAddTask(text), { json });
    }
    case 'update': {
      const id = requirePos([sub, ...rest], 1, 'task id');
      return emitResult(
        await agentUpdateTask(id, {
          title: flagString(flags, 'title'),
          notes: flagString(flags, 'notes'),
          project: flagString(flags, 'project'),
          tags: flagStringList(flags, 'tags'),
          priority: flagInt(flags, 'priority'),
        }),
        { json },
      );
    }
    case 'schedule': {
      const id = requirePos([sub, ...rest], 1, 'task id');
      const start = flagString(flags, 'start');
      if (!start) emitUsage('Usage: mytime agent task schedule <id> --start <iso>', ['Run `mytime agent slots` first']);
      return emitResult(
        await agentScheduleTask({
          id,
          start,
          end: flagString(flags, 'end'),
          allDay: flagBool(flags, 'all-day'),
          durationMinutes: flagInt(flags, 'duration-minutes'),
        }),
        { json },
      );
    }
    case 'done': {
      const id = requirePos([sub, ...rest], 1, 'task id');
      return emitResult(await agentCompleteTask(id, flagDone(flags)), { json });
    }
    case 'delete': {
      const id = requirePos([sub, ...rest], 1, 'task id');
      return emitResult(await agentDeleteTask(id), { json });
    }
    default:
      printAgentHelp('task');
  }
}

async function runEventCommand(
  sub: string | undefined,
  rest: string[],
  flags: ReturnType<typeof parseArgs>['flags'],
  json: boolean,
): Promise<number> {
  switch (sub) {
    case 'add': {
      const title = flagString(flags, 'title');
      const start = flagString(flags, 'start');
      if (!title || !start) {
        emitUsage('Usage: mytime agent event add --title <text> --start <iso>', ['Example: mytime agent event add --title "Dentist" --start "2026-07-10T14:00"']);
      }
      return emitResult(
        await agentAddEvent({
          title,
          start,
          end: flagString(flags, 'end'),
          allDay: flagBool(flags, 'all-day'),
          notes: flagString(flags, 'notes'),
          location: flagString(flags, 'location'),
          reminders: parseReminders(flags),
        }),
        { json },
      );
    }
    case 'quick': {
      const text = rest.join(' ');
      if (!text) emitUsage('Usage: mytime agent event quick "<text>"', ['Example: mytime agent event quick "team lunch tomorrow 12pm"']);
      return emitResult(await agentQuickAddEvent(text), { json });
    }
    case 'update': {
      const id = requirePos([sub, ...rest], 1, 'event id');
      return emitResult(
        await agentUpdateEvent(id, {
          title: flagString(flags, 'title'),
          notes: flagString(flags, 'notes'),
          location: flagString(flags, 'location'),
          reminders: parseReminders(flags),
        }),
        { json },
      );
    }
    case 'schedule': {
      const id = requirePos([sub, ...rest], 1, 'event id');
      const start = flagString(flags, 'start');
      if (!start) emitUsage('Usage: mytime agent event schedule <id> --start <iso>', ['Run `mytime agent slots` first']);
      return emitResult(
        await agentScheduleEvent({
          id,
          start,
          end: flagString(flags, 'end'),
          allDay: flagBool(flags, 'all-day'),
          durationMinutes: flagInt(flags, 'duration-minutes'),
        }),
        { json },
      );
    }
    case 'delete': {
      const id = requirePos([sub, ...rest], 1, 'event id');
      return emitResult(await agentDeleteEvent(id), { json });
    }
    default:
      printAgentHelp('event');
  }
}
