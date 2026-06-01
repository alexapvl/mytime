# mytime

One terminal app for tasks and calendar. Open tasks live in your **Backlog**; schedule them and they sync to a dedicated **Google Calendar**.

## Install

```bash
pnpm install
pnpm build
pnpm link --global   # optional: global `mytime` command
```

Dev mode (no build):

```bash
pnpm dev
```

## Google Calendar setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or pick an existing one)
3. Enable **Google Calendar API**
4. Configure **OAuth consent screen** (External is fine for personal use; add yourself as a test user)
5. Create **Credentials → OAuth client ID → Desktop app**
6. Download the JSON and save it as:

   ```
   ~/.mytime/credentials.json
   ```

7. Authenticate:

   ```bash
   mytime auth
   ```

   This opens your browser, completes OAuth, and saves a token to `~/.mytime/token.json`.

8. Sync:

   ```bash
   mytime sync
   ```

   mytime creates a calendar named **"mytime"** and only writes to that calendar.

9. Choose which calendars to fetch locally (requires auth):

   ```bash
   mytime settings
   ```

   Toggle external Google calendars on or off. Disabled calendars are not pulled during sync, and their events are removed from the local database. The dedicated **mytime** calendar is always enabled.

## Usage

```bash
mytime                          # interactive TUI
mytime add "review PR tomorrow 3pm @work p2 #swe"
mytime today                    # print today's blocks
mytime sync                     # push/pull Google Calendar
mytime auth                     # (re)connect Google
mytime settings                 # choose which Google calendars to fetch locally
mytime mcp                      # run the MCP server (stdio) for AI agents
mytime help                     # show CLI help
```

### TUI

| Key | Action |
|-----|--------|
| `1` / `2` / `3` / `4` | Backlog / Daily / Week / Past Due |
| `r` | Sync with Google |
| `u` | Undo last delete or done toggle |
| `esc` | Quit |

Mouse clicks work in supported terminals (tabs, items, calendar cells).

**Backlog:** `←/→` priority column · `⇧←/→` move task between priorities · `↑/↓` navigate · `a` add · `q` quick-add (NLP) · `e` edit · `s` schedule/reschedule · `x` done · `d` delete

Opens on the lowest non-empty priority column (P0 first, then P1, P2, P3).

**Past Due:** open tasks that missed their scheduled time · `↑/↓` navigate · `e` edit · `s` reschedule · `x` done · `d` delete

**Daily:** `←/→` prev/next day · `t` today · `↑/↓` select · `a`/`q` add · `⇧↑/↓` move selected task by 1h · `+/-` resize · `s` reschedule · `x` done · `d` delete

Defaults to the first open (not done) item for the day, including all-day tasks.

**Week:** `←/→` prev/next day · `⇧←/→` prev/next week · `t` this week/today · `↑/↓` select · `a`/`q` add · `s` reschedule · `x` done · `d` delete

Defaults to today with the first event on that day selected.

**Schedule editor** (when you press `s`): shows existing events on the chosen day · `←/→` change day · `↑/↓` pick slot · type digits to filter times · `f` free slots only · `+/-` slot step (15–240 min) · `a` all-day · `enter` confirm · `esc` cancel

External Google events appear in Daily/Week but are read-only (`s`/`x`/`d` only apply to your tasks).

## MCP server

`mytime mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio, letting an AI agent (Claude Desktop, Cursor, etc.) read and manage your tasks. It reuses the same local database and Google auth, and pushes/deletes Google Calendar events automatically per action.

Register it in your client's MCP config (the global `mytime` command must be on your PATH):

```json
{
  "mcpServers": {
    "mytime": { "command": "mytime", "args": ["mcp"] }
  }
}
```

### Tools

| Tool | Description |
|------|-------------|
| `list_backlog` | List all open tasks (scheduled and unscheduled) |
| `list_schedule` | List scheduled items in a time range (defaults to today) |
| `list_past_due` | List open overdue tasks with an `overdue` label |
| `list_free_slots` | List free timed slots on a day (all-day events listed separately) |
| `get_item` | Get a single item by id |
| `search_tasks` | Search by title / project / tags |
| `add_task` | Create an unscheduled task |
| `quick_add` | Add from natural language (`#tag @project pN`, dates) |
| `update_task` | Update fields of a task |
| `schedule_task` / `reschedule_task` | Set/change a task's start (and end or duration) |
| `complete_task` | Mark done / not done (omit `done` to toggle) |
| `delete_task` | Permanently delete a task |
| `sync` | Full two-way Google Calendar sync |

Write tools sync to Google automatically when authenticated (no-ops otherwise). Google Calendar events (`source: external`) are read-only via MCP. Call `list_free_slots` before scheduling to find open times. If the TUI is open at the same time, it won't reflect MCP changes until you navigate or sync.

## Data

Everything is stored locally at `~/.mytime/db.sqlite`. Scheduled items sync to Google; unscheduled backlog tasks stay local until you schedule them.

External calendar events are pulled into the local DB for display. Their titles are stored without emoji so terminal layout stays aligned. Tasks you create in mytime are never modified this way.

## Quick-add syntax

Natural language via [chrono-node](https://github.com/wanasit/chrono):

- `buy groceries tomorrow 5pm`
- `dentist Friday 10am-11am`
- `review PR @work p2 #swe`

Tags: `#context` · Projects: `@name` · Priority: `p0`–`p3`
