import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { closeDb } from './db/schema.js';
import { createItem, createEvent } from './db/items.js';
import { parseQuickAdd } from './lib/nlp.js';
import { authenticate } from './google/auth.js';
import {
  getActiveProvider,
  getActiveProviderStatus,
  pushToActiveProvider,
  syncCalendar,
} from './calendar/provider.js';
import { listScheduledInRange } from './db/items.js';
import { enterTuiModes, exitTuiModes } from './lib/mouse.js';
import { todayStart, todayEnd, formatScheduleTime } from './lib/time.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  try {
    if (command === 'auth') {
      const provider = args[1] ?? getActiveProvider();
      if (provider === 'apple') {
        const { runAppleSetup } = await import('./apple/setup.js');
        process.exit(await runAppleSetup(args.slice(2)));
      }
      if (provider !== 'google') {
        console.error('Choose a provider: mytime auth google or mytime auth apple');
        process.exit(1);
      }
      await authenticate();
      process.exit(0);
    }

    if (command === 'setup' || command === 'doctor') {
      const { runSetup } = await import('./setup/cli.js');
      process.exit(await runSetup(args.slice(1), { doctor: command === 'doctor' }));
    }

    if (command === 'sync') {
      const result = await syncCalendar();
      console.log(`Pushed: ${result.pushed}, Pulled: ${result.pulled}, Deleted: ${result.deleted}, Calendars: ${result.calendars}`);
      if (result.errors.length) {
        console.error(result.errors.join('\n'));
        process.exit(1);
      }
      process.exit(0);
    }

    if (command === 'add') {
      const text = args.slice(1).join(' ');
      if (!text) {
        console.error('Usage: mytime add "task description tomorrow 3pm"');
        process.exit(1);
      }
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
      console.log(`Added: ${item.title}${item.start ? ` @ ${item.allDay ? 'all day ' : ''}${item.start}` : ''}`);
      if (item.start && (await getActiveProviderStatus())?.connected) {
        await pushToActiveProvider(item);
      }
      process.exit(0);
    }

    if (command === 'event') {
      const text = args.slice(1).join(' ');
      if (!text) {
        console.error('Usage: mytime event "meeting tomorrow 3pm"');
        process.exit(1);
      }
      const parsed = parseQuickAdd(text);
      if (!parsed.start) {
        console.error('Events require a date/time. Example: mytime event "dentist tomorrow 2pm"');
        process.exit(1);
      }
      const item = createEvent({
        title: parsed.title,
        start: parsed.start,
        end: parsed.end,
        allDay: parsed.allDay,
      });
      console.log(`Added event: ${item.title} @ ${parsed.allDay ? 'all day ' : ''}${item.start}`);
      if ((await getActiveProviderStatus())?.connected) {
        await pushToActiveProvider(item);
      }
      process.exit(0);
    }

    if (command === 'today') {
      const items = listScheduledInRange(todayStart(), todayEnd());
      if (items.length === 0) {
        console.log('Nothing scheduled today.');
      } else {
        for (const item of items) {
          console.log(`${formatScheduleTime(item.start!, item.end, item.allDay)}  ${item.title}`);
        }
      }
      process.exit(0);
    }

    if (command === 'mcp') {
      const { runMcpServer } = await import('./mcp/server.js');
      await runMcpServer();
      return;
    }

    if (command === 'agent') {
      const { runAgentCli } = await import('./agent/cli.js');
      const code = await runAgentCli(args.slice(1));
      process.exit(code);
    }

    if (command === 'settings') {
      await runTui('settings');
      return;
    }

    if (command === 'help' || command === '--help' || command === '-h') {
      printHelp();
      process.exit(0);
    }

    // Default: launch TUI
    await runTui();
  } finally {
    closeDb();
  }
}

async function runTui(initialScreen: 'main' | 'settings' = 'main') {
  let reopenForAuth = false;

  while (true) {
    reopenForAuth = false;

    const tty = process.stdout.isTTY;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      if (tty) exitTuiModes();
    };

    if (tty) enterTuiModes();
    process.once('exit', restore);

    try {
      const { waitUntilExit } = render(
        <App initialScreen={initialScreen} onNeedAuth={() => { reopenForAuth = true; }} />,
      );
      await waitUntilExit();
    } finally {
      restore();
    }

    if (!reopenForAuth) return;
  }
}

function printHelp() {
  console.log(`
mytime - unified tasks + calendar

Usage:
  mytime              Launch interactive TUI
  mytime add "<text>"   Quick-add task with natural language
  mytime event "<text>" Quick-add calendar event (requires date/time)
  mytime today        Print today's schedule
  mytime setup        Choose Google or Apple Calendar setup
  mytime setup google Set up Google Calendar OAuth
  mytime setup apple  Set up Apple Calendar (macOS 14+)
  mytime doctor       Check active calendar provider
  mytime auth         Connect selected calendar provider
  mytime settings     Choose which provider calendars to fetch locally
  mytime sync         Sync active calendar provider
  mytime agent        Agent-ergonomic CLI for AI agents (preferred over MCP)
  mytime mcp          Legacy MCP server (stdio)
  mytime help         Show this help

Setup flags:
  mytime setup google --links             Print Google Cloud Console URLs
  mytime setup apple --source <id>        Choose Calendar.app account/source
  mytime setup apple --list-sources       List writable Calendar.app accounts
  mytime setup apple --calendar <id>      Adopt one existing mytime calendar
  mytime setup apple --cleanup-duplicates Preview safe duplicate cleanup
  mytime setup apple --cleanup-duplicates --apply
  mytime setup <provider> --keep-old-calendar
  mytime setup <provider> --delete-old-calendar
  mytime setup --agent-prompt             Prompt for Google OAuth setup (paste into agent)
  mytime setup --agents                   AI agent + MCP integration guide
  mytime setup --agent-onboarding-prompt  Prompt to set up mytime agent in Cursor / Claude
  mytime setup --mcp-config               Cursor MCP JSON (legacy; prefer mytime agent)
  mytime setup --agent-skill              Command to install the mytime agent skill

TUI keys:
  1/2/3/4/5 Switch Backlog / Daily / Week / Month / Past Due
  r         Sync active calendar provider
  u         Undo
  esc       Quit

Backlog:
  ←/→       Move priority
  ↑/↓       Navigate
  a         Add task
  q         Quick-add (NLP)
  e         Edit
  s         Schedule
  x         Toggle done
  d         Delete
`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  closeDb();
  process.exit(1);
});
