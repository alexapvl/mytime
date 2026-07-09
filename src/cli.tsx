import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { closeDb } from './db/schema.js';
import { createItem, createEvent } from './db/items.js';
import { parseQuickAdd } from './lib/nlp.js';
import { authenticate, ensureAuthenticated, isAuthenticated } from './google/auth.js';
import { syncWithGoogle } from './google/sync.js';
import { listScheduledInRange } from './db/items.js';
import { enterTuiModes, exitTuiModes } from './lib/mouse.js';
import { todayStart, todayEnd, formatScheduleTime } from './lib/time.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  try {
    if (command === 'auth') {
      await authenticate();
      process.exit(0);
    }

    if (command === 'sync') {
      await ensureAuthenticated();
      const result = await syncWithGoogle();
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
      if (isAuthenticated() && item.start) {
        const result = await syncWithGoogle();
        if (result.errors.length) console.warn(result.errors.join('\n'));
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
      if (isAuthenticated()) {
        const result = await syncWithGoogle();
        if (result.errors.length) console.warn(result.errors.join('\n'));
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
    if (!isAuthenticated()) {
      await ensureAuthenticated();
    }

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
mytime — unified tasks + calendar

Usage:
  mytime              Launch interactive TUI
  mytime add "<text>"   Quick-add task with natural language
  mytime event "<text>" Quick-add calendar event (requires date/time)
  mytime today        Print today's schedule
  mytime auth         Connect Google Calendar
  mytime settings     Choose which Google calendars to fetch locally
  mytime sync         Sync with Google Calendar
  mytime mcp          Run the MCP server (stdio) for AI agents
  mytime help         Show this help

TUI keys:
  1/2/3/4/5 Switch Backlog / Daily / Week / Month / Past Due
  r         Sync with Google
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
