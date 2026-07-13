import {
  agentAddEvent,
  agentAddTask,
  agentBacklogList,
  agentCalendarDashboard,
  agentCalendarGuide,
  agentCalendarSources,
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
import { AGENT_DESCRIPTION, emitHelp, emitResult, emitUsage } from './format.js';
import type { Reminder } from '../db/types.js';

const TOP_HELP = [
  'Run `mytime agent` for live dashboard',
  'Run `mytime agent backlog list` for open tasks',
  'Run `mytime agent schedule list` for today',
  'Run `mytime agent slots` before scheduling',
  'Run `mytime agent calendar` for calendar setup state and effects',
  'Run `mytime agent task quick "<text>"` to add from natural language',
  'Run `mytime agent --help <command>` for subcommand help',
];

const GLOBAL_FLAGS = ['help', 'json'];
const BOOLEAN_COMMAND_FLAGS = new Set(['all-day', 'done', 'full']);

function validateFlags(
  flags: Map<string, string | boolean>,
  allowed: string[],
  command: string,
  help: string[],
): void {
  const valid = new Set([...GLOBAL_FLAGS, ...allowed]);
  const unknown = [...flags.keys()].find((flag) => !valid.has(flag));
  const validList = [...valid].map((flag) => `--${flag}`).join(', ');
  if (unknown) {
    emitUsage(`Unknown flag --${unknown} for \`${command}\``, [`Valid flags: ${validList}`, ...help]);
  }
  const missingValue = allowed.find((flag) => flags.get(flag) === true && !BOOLEAN_COMMAND_FLAGS.has(flag));
  if (missingValue) {
    emitUsage(`Flag --${missingValue} requires a value for \`${command}\``, [`Valid flags: ${validList}`, ...help]);
  }
}

function printAgentHelp(topic?: string, requested = false, json = false): never {
  if (!topic) {
    const help = [
      ...TOP_HELP,
      'Commands: backlog, schedule, past-due, slots, item, search, task, event, calendar, sync',
    ];
    if (requested) emitHelp('mytime agent - agent-ergonomic tasks + calendar CLI', help, json);
    emitUsage('mytime agent - agent-ergonomic tasks + calendar CLI', help);
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
    calendar: [
      'mytime agent calendar',
      'mytime agent calendar sources',
      'mytime agent calendar setup',
      'mytime agent calendar switch',
      'mytime agent calendar cleanup',
      'mytime agent calendar guide [setup|switch|cleanup]',
    ],
    'calendar setup': [
      'Shows Google and Apple setup commands plus local, remote, and user effects',
      'Read-only. Use `mytime setup google` or `mytime setup apple` only after user chooses.',
    ],
    'calendar switch': [
      'Explains same-backend adoption, different-backend migration, keep, and delete effects',
      'Read-only. Remote deletion always requires explicit user approval.',
    ],
    'calendar cleanup': [
      'Explains duplicate preview and apply safety',
      'Preview is read-only. Apply is irreversible and requires explicit user approval.',
    ],
    'calendar sources': [
      'mytime agent calendar sources',
      'Lists Google API state and writable Calendar.app sources with inferred backend',
    ],
    'calendar guide': ['mytime agent calendar guide [setup|switch|cleanup]'],
  };

  const help = guides[topic];
  if (!help) {
    emitUsage(`Unknown help topic: ${topic}`, ['Topics: backlog, schedule, past-due, slots, item, search, task, event, calendar, sync']);
  }
  if (requested) emitHelp(`mytime agent ${topic}`, help, json);
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
    validateFlags(flags, [], 'mytime agent --help', TOP_HELP);
    printAgentHelp(positional.join(' ') || undefined, true, json);
  }

  if (positional.length === 0) {
    validateFlags(flags, [], 'mytime agent', TOP_HELP);
    return emitResult(await agentDashboard(), { json, description: AGENT_DESCRIPTION });
  }

  const [command, sub, ...rest] = positional;

  switch (command) {
    case 'backlog': {
      validateFlags(flags, [], 'mytime agent backlog list', ['Usage: mytime agent backlog list']);
      if (sub !== 'list') emitUsage('Usage: mytime agent backlog list', ['Run `mytime agent backlog list`']);
      return emitResult(await agentBacklogList(), { json });
    }

    case 'schedule': {
      validateFlags(flags, ['from', 'to'], 'mytime agent schedule list', ['Usage: mytime agent schedule list [--from <iso>] [--to <iso>]']);
      if (sub !== 'list') emitUsage('Usage: mytime agent schedule list [--from] [--to]', ['Run `mytime agent schedule list`']);
      return emitResult(await agentScheduleList(flagString(flags, 'from'), flagString(flags, 'to')), { json });
    }

    case 'past-due':
      validateFlags(flags, [], 'mytime agent past-due', ['Usage: mytime agent past-due']);
      if (sub) emitUsage('Usage: mytime agent past-due', ['Run `mytime agent past-due`']);
      return emitResult(await agentPastDue(), { json });

    case 'slots':
      validateFlags(flags, ['date', 'step-minutes', 'time-filter', 'exclude-id'], 'mytime agent slots', [
        'Usage: mytime agent slots [--date <iso>] [--step-minutes 60] [--time-filter 09] [--exclude-id <id>]',
      ]);
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
      validateFlags(flags, ['full'], 'mytime agent item', ['Usage: mytime agent item <id> [--full]']);
      const id = requirePos(positional, 1, 'item id', ['Usage: mytime agent item <id> [--full]']);
      return emitResult(await agentGetItem(id, flagBool(flags, 'full')), { json });
    }

    case 'search': {
      validateFlags(flags, [], 'mytime agent search', ['Usage: mytime agent search <query>']);
      const query = positional.slice(1).join(' ');
      if (!query) emitUsage('Usage: mytime agent search <query>', ['Example: mytime agent search meloDL']);
      return emitResult(await agentSearch(query), { json });
    }

    case 'task':
      return runTaskCommand(sub, rest, flags, json);

    case 'event':
      return runEventCommand(sub, rest, flags, json);

    case 'calendar':
      return runCalendarCommand(sub, rest, flags, json);

    case 'sync':
      validateFlags(flags, [], 'mytime agent sync', ['Usage: mytime agent sync']);
      if (sub) emitUsage('Usage: mytime agent sync', ['Run `mytime agent sync`']);
      return emitResult(await agentSync(), { json });

    default:
      emitUsage(`Unknown command: ${command}`, TOP_HELP);
  }
}

async function runCalendarCommand(
  sub: string | undefined,
  rest: string[],
  flags: ReturnType<typeof parseArgs>['flags'],
  json: boolean,
): Promise<number> {
  validateFlags(flags, [], `mytime agent calendar${sub ? ` ${sub}` : ''}`, [
    'Run `mytime agent calendar --help` for calendar commands',
  ]);
  if (!sub) {
    if (rest.length) emitUsage('Usage: mytime agent calendar', ['Run `mytime agent calendar --help`']);
    return emitResult(await agentCalendarDashboard(), { json });
  }
  if (sub === 'sources') {
    if (rest.length) emitUsage('Usage: mytime agent calendar sources', ['Run `mytime agent calendar sources --help`']);
    return emitResult(await agentCalendarSources(), { json });
  }
  if (sub === 'setup' || sub === 'switch' || sub === 'cleanup') {
    if (rest.length) emitUsage(`Usage: mytime agent calendar ${sub}`, [`Run \`mytime agent calendar ${sub} --help\``]);
    return emitResult(agentCalendarGuide(sub), { json });
  }
  if (sub === 'guide') {
    const topic = rest[0];
    if (rest.length > 1 || (topic && topic !== 'setup' && topic !== 'switch' && topic !== 'cleanup')) {
      emitUsage('Usage: mytime agent calendar guide [setup|switch|cleanup]', [
        'Run `mytime agent calendar guide` for complete reference',
      ]);
    }
    const guideTopic = topic === 'setup' || topic === 'switch' || topic === 'cleanup' ? topic : 'all';
    return emitResult(agentCalendarGuide(guideTopic), { json });
  }
  emitUsage(`Unknown calendar command: ${sub}`, ['Run `mytime agent calendar --help`']);
}

async function runTaskCommand(
  sub: string | undefined,
  rest: string[],
  flags: ReturnType<typeof parseArgs>['flags'],
  json: boolean,
): Promise<number> {
  switch (sub) {
    case 'add': {
      validateFlags(flags, ['title', 'notes', 'project', 'tags', 'priority'], 'mytime agent task add', [
        'Usage: mytime agent task add --title <text> [--notes] [--project] [--tags a,b] [--priority 0-3]',
      ]);
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
      validateFlags(flags, [], 'mytime agent task quick', ['Usage: mytime agent task quick "<natural language>"']);
      const text = rest.join(' ');
      if (!text) emitUsage('Usage: mytime agent task quick "<text>"', ['Example: mytime agent task quick "review PR tomorrow 3pm @work p2"']);
      return emitResult(await agentQuickAddTask(text), { json });
    }
    case 'update': {
      validateFlags(flags, ['title', 'notes', 'project', 'tags', 'priority'], 'mytime agent task update', [
        'Usage: mytime agent task update <id> [--title] [--notes] [--project] [--tags] [--priority]',
      ]);
      const id = requirePos([sub, ...rest], 1, 'task id', ['Usage: mytime agent task update <id> [--title] [--notes] [--project] [--tags] [--priority]']);
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
      validateFlags(flags, ['start', 'end', 'all-day', 'duration-minutes'], 'mytime agent task schedule', [
        'Usage: mytime agent task schedule <id> --start <iso> [--end] [--all-day] [--duration-minutes 60]',
      ]);
      const id = requirePos([sub, ...rest], 1, 'task id', ['Usage: mytime agent task schedule <id> --start <iso>']);
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
      validateFlags(flags, ['done'], 'mytime agent task done', ['Usage: mytime agent task done <id> [--done true|false]']);
      const id = requirePos([sub, ...rest], 1, 'task id', ['Usage: mytime agent task done <id> [--done true|false]']);
      return emitResult(await agentCompleteTask(id, flagDone(flags)), { json });
    }
    case 'delete': {
      validateFlags(flags, [], 'mytime agent task delete', ['Usage: mytime agent task delete <id>']);
      const id = requirePos([sub, ...rest], 1, 'task id', ['Usage: mytime agent task delete <id>']);
      return emitResult(await agentDeleteTask(id), { json });
    }
    default:
      validateFlags(flags, [], 'mytime agent task', ['Run `mytime agent --help task`']);
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
      validateFlags(flags, ['title', 'start', 'end', 'all-day', 'notes', 'location', 'reminders'], 'mytime agent event add', [
        'Usage: mytime agent event add --title <text> --start <iso> [--end] [--all-day] [--notes] [--location]',
      ]);
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
      validateFlags(flags, [], 'mytime agent event quick', ['Usage: mytime agent event quick "<natural language>"']);
      const text = rest.join(' ');
      if (!text) emitUsage('Usage: mytime agent event quick "<text>"', ['Example: mytime agent event quick "team lunch tomorrow 12pm"']);
      return emitResult(await agentQuickAddEvent(text), { json });
    }
    case 'update': {
      validateFlags(flags, ['title', 'notes', 'location', 'reminders'], 'mytime agent event update', [
        'Usage: mytime agent event update <id> [--title] [--notes] [--location] [--reminders]',
      ]);
      const id = requirePos([sub, ...rest], 1, 'event id', ['Usage: mytime agent event update <id> [--title] [--notes] [--location]']);
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
      validateFlags(flags, ['start', 'end', 'all-day', 'duration-minutes'], 'mytime agent event schedule', [
        'Usage: mytime agent event schedule <id> --start <iso> [--end] [--all-day] [--duration-minutes 60]',
      ]);
      const id = requirePos([sub, ...rest], 1, 'event id', ['Usage: mytime agent event schedule <id> --start <iso>']);
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
      validateFlags(flags, [], 'mytime agent event delete', ['Usage: mytime agent event delete <id>']);
      const id = requirePos([sub, ...rest], 1, 'event id', ['Usage: mytime agent event delete <id>']);
      return emitResult(await agentDeleteEvent(id), { json });
    }
    default:
      validateFlags(flags, [], 'mytime agent event', ['Run `mytime agent --help event`']);
      printAgentHelp('event');
  }
}
