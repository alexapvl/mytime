import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { closeDb } from './db/schema.js';
import { createItem } from './db/items.js';
import { parseQuickAdd } from './lib/nlp.js';
import { authenticate, isAuthenticated } from './google/auth.js';
import { syncWithGoogle } from './google/sync.js';
import { listScheduledInRange } from './db/items.js';
import { todayStart, todayEnd, formatTime } from './lib/time.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  try {
    if (command === 'auth') {
      await authenticate();
      process.exit(0);
    }

    if (command === 'sync') {
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
      });
      console.log(`Added: ${item.title}${item.start ? ` @ ${item.start}` : ''}`);
      if (isAuthenticated() && item.start) {
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
          console.log(`${formatTime(item.start!)}–${formatTime(item.end!)}  ${item.title}`);
        }
      }
      process.exit(0);
    }

    if (command === 'mcp') {
      const { runMcpServer } = await import('./mcp/server.js');
      await runMcpServer();
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

const ENTER_TUI = '\x1b[?1049h\x1b[2J\x1b[H\x1b[?1000h\x1b[?1006h';
const EXIT_TUI = '\x1b[?1000l\x1b[?1006l\x1b[?1049l';

async function runTui() {
  const tty = process.stdout.isTTY;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (tty) process.stdout.write(EXIT_TUI);
  };

  if (tty) process.stdout.write(ENTER_TUI);
  process.once('exit', restore);

  try {
    const { waitUntilExit } = render(<App />);
    await waitUntilExit();
  } finally {
    restore();
  }
}

function printHelp() {
  console.log(`
mytime — unified tasks + calendar

Usage:
  mytime              Launch interactive TUI
  mytime add "<text>" Quick-add with natural language
  mytime today        Print today's schedule
  mytime auth         Connect Google Calendar
  mytime sync         Sync with Google Calendar
  mytime mcp          Run the MCP server (stdio) for AI agents
  mytime help         Show this help

TUI keys:
  1/2/3     Switch Backlog / Today / Week
  r         Sync with Google
  esc       Quit

Backlog:
  j/k       Navigate
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
