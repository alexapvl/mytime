# mytime

One terminal app for tasks and calendar. Open tasks live in your **Backlog**; schedule them and they sync to a dedicated **Google Calendar** so they show up on your phone.

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

## Usage

```bash
mytime                          # interactive TUI
mytime add "review PR tomorrow 3pm @work p2 #swe"
mytime today                    # print today's blocks
mytime sync                     # push/pull Google Calendar
mytime auth                     # (re)connect Google
mytime mcp                      # run the MCP server (stdio) for AI agents
```

### TUI

| Key | Action |
|-----|--------|
| `1` / `2` / `3` | Backlog / Daily / Week |
| `r` | Sync with Google |
| `esc` | Quit |

**Backlog:** `←/→` priority · `↑/↓` navigate · `a` add · `q` quick-add (NLP) · `e` edit · `s` schedule · `x` done · `d` delete

**Daily / Week:** `←/→` prev/next · `t` jump to today/this week · `↑/↓` select · `⇧↑/↓` move selected task by 1h in Daily · `+/-` resize · `s` reschedule · `x` done · `d` delete

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
| `get_item` | Get a single item by id |
| `search_tasks` | Search by title / project / tags |
| `add_task` | Create an unscheduled task |
| `quick_add` | Add from natural language (`@tag #project pN`, dates) |
| `update_task` | Update fields of a task |
| `schedule_task` / `reschedule_task` | Set/change a task's start (and end or duration) |
| `complete_task` | Mark done / not done (omit `done` to toggle) |
| `delete_task` | Permanently delete a task |
| `sync` | Full two-way Google Calendar sync |

Write tools sync to Google automatically when authenticated (no-ops otherwise). Google Calendar events (`source: external`) are read-only via MCP. Note: if the TUI is open at the same time, it won't reflect MCP changes until you navigate or sync.

## Data

Everything is stored locally at `~/.mytime/db.sqlite`. Scheduled items sync to Google; unscheduled backlog tasks stay local until you schedule them.

## Quick-add syntax

Natural language via [chrono-node](https://github.com/wanasit/chrono):

- `buy groceries tomorrow 5pm`
- `dentist Friday 10am-11am`
- `review PR @work p2 #swe`

Tags: `@context` · Projects: `#name` · Priority: `p0`–`p3`
