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

Google sync needs two local files under `~/.mytime/`:

| File | Created by | Purpose |
|------|------------|---------|
| `credentials.json` | You (from Google Cloud) | OAuth client ID + secret |
| `token.json` | `mytime auth` | Your signed-in Google account |

mytime only **writes** to a dedicated calendar named **"mytime"**. Other Google calendars can be pulled read-only for display in Daily, Week, and Month views.

### Google Cloud Console (manual)

You only do this once per machine (or per Google Cloud project).

1. **Open Google Cloud Console** — [console.cloud.google.com](https://console.cloud.google.com/)

2. **Create or select a project**
   - Top bar → project picker → **New Project** (e.g. `mytime-personal`) or pick an existing one.

3. **Enable the Google Calendar API**
   - **APIs & Services → Library** ([direct link](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com))
   - Search for **Google Calendar API** → **Enable**.

4. **Configure the OAuth consent screen**
   - **APIs & Services → OAuth consent screen** ([direct link](https://console.cloud.google.com/apis/credentials/consent))
   - User type: **External** (fine for personal use) → **Create**.
   - **App information:** app name (e.g. `mytime`), user support email, developer contact email → **Save and Continue**.
   - **Scopes:** **Save and Continue** (mytime requests `calendar` scope at sign-in; you do not need to add scopes here).
   - **Test users:** **Add users** → your Google account email → **Save and Continue**.
   - Leave the app in **Testing** — that is enough for a single-user setup.

   > **Note:** While the app is in Testing, only test users you add can sign in. If auth fails with *access blocked*, add your account under **OAuth consent screen → Test users**.

5. **Create OAuth credentials (Desktop app)**
   - **APIs & Services → Credentials** ([direct link](https://console.cloud.google.com/apis/credentials))
   - **Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Name: e.g. `mytime desktop` → **Create**
   - **Download JSON** (or use the download icon on the new client).

6. **Install the credentials file**

   ```bash
   mkdir -p ~/.mytime
   mv ~/Downloads/client_secret_*.json ~/.mytime/credentials.json
   ```

   The JSON must contain an `installed` object with `client_id` and `client_secret` (the default format for Desktop app downloads). Do not commit this file.

7. **Authenticate**

   ```bash
   mytime auth
   ```

   This starts a local server on `127.0.0.1:3847`, opens your browser for Google sign-in, and saves a token to `~/.mytime/token.json`. Complete the flow in the browser; you can close the tab when you see *mytime authenticated*.

8. **Sync**

   ```bash
   mytime sync
   ```

   mytime creates the **"mytime"** calendar if it does not exist and runs the first two-way sync.

9. **Choose which calendars to fetch locally**

   ```bash
   mytime settings
   ```

   Toggle external Google calendars on or off. Disabled calendars are not pulled during sync, and their events are removed from the local database. The dedicated **mytime** calendar is always enabled.

### Agent-assisted setup

If you use Cursor, Claude Code, or another agent with browser access, paste this prompt and let it walk you through (or drive) the Cloud Console steps above:

```text
Help me set up Google Calendar for mytime (https://github.com/alexapvl/mytime).

Goal: mytime needs a Google Cloud OAuth Desktop client saved at ~/.mytime/credentials.json, then I will run `mytime auth` and `mytime sync` locally.

Please do the following:

1. In Google Cloud Console (https://console.cloud.google.com/):
   - Create or select a project for personal mytime use.
   - Enable the Google Calendar API (APIs & Services → Library → "Google Calendar API").
   - Configure OAuth consent screen: External user type, app name "mytime", add my Google account as a Test user. Testing mode is fine.
   - Create Credentials → OAuth client ID → Application type "Desktop app".
   - Download the client JSON.

2. On my machine:
   - Create ~/.mytime if it does not exist.
   - Save the downloaded JSON as ~/.mytime/credentials.json (must have an "installed" key with client_id and client_secret).
   - Do NOT commit credentials.json to git.

3. Tell me when credentials.json is in place. I will run `mytime auth` myself in the terminal (browser OAuth — you cannot complete this step for me). After auth succeeds, I will run `mytime sync` to verify.

If you can control a browser (e.g. chrome-devtools-axi), navigate the Console for me step by step. Otherwise, give exact click-by-click instructions and pause after each step for confirmation.
```

After the agent finishes step 2, run `mytime auth` and `mytime sync` as described in the manual steps above.

## Usage

```bash
mytime                          # interactive TUI
mytime add "review PR tomorrow 3pm @work p2 #swe"
mytime event "dentist tomorrow 2pm"   # calendar event (requires date/time)
mytime today                    # print today's blocks
mytime sync                     # push/pull Google Calendar
mytime auth                     # (re)connect Google
mytime settings                 # choose which Google calendars to fetch locally
mytime agent                    # agent CLI for AI assistants (preferred)
mytime mcp                      # run the MCP server (stdio) for AI agents
mytime help                     # show CLI help
```

### TUI

Five tabs — switch with number keys or click the tab bar:

| Tab | Key | What it shows |
|-----|-----|---------------|
| Backlog | `1` | Open tasks in P0–P3 columns (scheduled and unscheduled) |
| Daily | `2` | Hour grid + all-day row for one day |
| Week | `3` | Seven-day grid with timed blocks |
| Month | `4` | Month calendar grid; press `enter` to open a day in Daily |
| Past Due | `5` | Open tasks that missed their scheduled time |

**Global keys**

| Key | Action |
|-----|--------|
| `1` / `2` / `3` / `4` / `5` | Backlog / Daily / Week / Month / Past Due |
| `r` | Sync with Google |
| `u` | Undo last delete or done toggle |
| `esc` | Quit |

Mouse clicks work in supported terminals (tabs, items, calendar cells).

**Backlog** — `←/→` priority column · `⇧←/→` move task between priorities · `↑/↓` navigate · `a` add · `q` quick-add (NLP) · `e` edit · `s` schedule/reschedule · `x` done · `d` delete

Opens on the lowest non-empty priority column (P0 first, then P1, P2, P3).

**Daily** — `←/→` prev/next day · `t` today · `↑/↓` select · `a`/`q` add task / quick-add · `⇧a`/`⇧q` add event / quick-event · `e` edit · `s` reschedule · `⇧↑/↓` move selected task by 1h · `+/-` end ±15m · `⇧+/-` start ±15m · `x` done · `d` delete

Defaults to the first open (not done) item for the day, including all-day tasks.

**Week** — `←/→` prev/next day · `⇧←/→` prev/next week · `t` this week/today · `↑/↓` select · `a`/`q` add task / quick-add · `⇧a`/`⇧q` add event / quick-event · `e` edit · `s` reschedule · `⇧↑/↓` move 1h · `+/-` end ±15m · `⇧+/-` start ±15m · `x` done · `d` delete

Defaults to today with the first event on that day selected.

**Month** — `←/→` prev/next day · `↑/↓` prev/next week · `⇧←/→` prev/next month · `t` today · `enter` open focused day in Daily · `a`/`q` add task / quick-add on focused day · `⇧a`/`⇧q` add event / quick-event on focused day

Shows a month grid with event previews per day. Navigation wraps within the visible month when changing months.

**Past Due** — `↑/↓` navigate · `e` edit · `s` reschedule · `x` done · `d` delete

**Schedule editor** (when you press `s`): shows existing events on the chosen day · `←/→` change day · `↑/↓` pick slot · type digits to filter times · `f` free slots only · `+/-` slot step (15–240 min) · `a` all-day · `enter` confirm · `esc` cancel

External Google events appear in Daily/Week/Month but are read-only (`s`/`x`/`d` only apply to your tasks).

## Agent CLI (preferred)

`mytime agent` is the [AXI](https://axi.md)-shaped interface for AI agents. Same database and Google sync as the TUI, with token-efficient TOON output and contextual next-step hints.

```bash
mytime agent                              # dashboard: backlog, past due, today
mytime agent backlog list
mytime agent schedule list                # today by default
mytime agent slots --date tomorrow
mytime agent task quick "review PR tomorrow 3pm @work p2"
mytime agent search meloDL
mytime agent sync
```

Install the agent skill (optional):

```bash
npx skills add /Users/alex/GitHub/mytime --skill mytime -g
```

See `skills/mytime/SKILL.md` for the full command reference.

## MCP server (legacy)

`mytime mcp` still runs a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio for clients that only support MCP. **Prefer `mytime agent` in Cursor and other shell-capable agents** — same behavior, fewer tokens, no schema overhead.

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
