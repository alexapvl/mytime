# AGENTS.md

## Project Overview

**mytime** is a personal terminal app that unifies tasks and calendar. Open tasks live in a local SQLite backlog; scheduled tasks sync to a dedicated Google Calendar named **"mytime"**. External Google calendars can be pulled read-only into the local DB for display in Daily/Week views.

Treat this as a small, single-user CLI/TUI — prefer focused diffs, reuse existing patterns, and avoid over-engineering.

## Stack

- Node 20+, ESM TypeScript
- **Ink 5** + React 18 for the TUI
- **better-sqlite3** for local storage (`~/.mytime/db.sqlite`)
- **googleapis** for Calendar sync
- **chrono-node** for quick-add NLP
- **luxon** for dates/times
- **string-width** for terminal-safe text width (emoji, wide chars)
- **@modelcontextprotocol/sdk** for the MCP server
- **tsup** bundles `src/cli.tsx` → `dist/cli.js`
- Package manager: **pnpm**

Commands:

```bash
pnpm install
pnpm build          # required before `mytime` / global link
pnpm dev            # tsx src/cli.tsx, no build
node dist/cli.js    # run built CLI
```

CLI entry points (`src/cli.tsx`):

- default → TUI
- `auth`, `sync`, `add`, `today`, `settings`, `mcp`, `help`

## Project Structure

```
src/
  cli.tsx              CLI router + TUI bootstrap
  app.tsx              Tab shell (Backlog / Daily / Week / Past Due)
  views/               Full-screen Ink views
  components/          Reusable TUI pieces (editors, MarqueeText, mouse)
  db/                  SQLite schema, items CRUD, meta, types
  google/              OAuth, calendar API, sync, auto-push on local edits
  mcp/server.ts        MCP stdio server (tools for agents)
  lib/                 Shared helpers (time, nlp, shortcuts, text width, overlap)
  hooks/               useAppInput (keyboard routing)
  context/             InputFocus, Undo
```

## Architecture

### Data model (`src/db/types.ts`)

Items have `source: 'task' | 'external'`:

- **task** — created in mytime; editable; syncs to the mytime Google calendar when scheduled
- **external** — pulled from other Google calendars; read-only in TUI/MCP write paths; tagged `#gcal`

Tasks have `status: 'open' | 'done'`, `priority: 0–3`, optional `start`/`end`, `allDay`.

### Sync (`src/google/sync.ts`)

- **Push**: only open/scheduled tasks with local edits newer than `syncedAt`
- **Pull**: incremental sync per calendar via sync tokens
- mytime calendar events map back to tasks; other calendars become `external`
- Done tasks get a `✓` prefix on Google only; local titles stay clean
- External event titles are stripped of emoji on pull (`src/lib/textClean.ts`) for aligned terminal layout

### TUI input

- `useAppInput` in views/components; respect `InputFocusContext` so typing in editors doesn't trigger global shortcuts
- `MouseProvider` + `useClickRegions` for click targets; mouse modes re-applied on terminal refocus (`src/lib/mouse.ts`)
- `ShortcutBar` reads from `src/lib/shortcuts.ts` — update shortcuts there when adding keybinds

### Views

| Tab | File | Notes |
|-----|------|-------|
| Backlog | `views/Backlog.tsx` | P0–P3 columns; default selection = lowest non-empty priority |
| Daily | `views/Calendar.tsx` (`DayView`) | Hour grid + all-day; default = first open (not done) item |
| Week | `views/Calendar.tsx` (`WeekView`) | 7-column grid; default = today + first event that day |
| Past Due | `views/PastDue.tsx` | Open tasks past deadline |

`ScheduleEditor` shows day context, overlap hints, digit time filter, and `f` for free slots only. Overlap logic lives in `src/lib/scheduleOverlap.ts`.

### MCP (`src/mcp/server.ts`)

- stdio transport; debounced `ensureFresh()` sync before reads/writes
- External items are read-only for write tools
- Prefer `list_free_slots` before `schedule_task` / `reschedule_task`

### Undo

Session undo (`u` in TUI) covers delete and done-toggle via `UndoContext` + `lib/undoActions.ts`.

## Conventions

- **ESM imports**: use `.js` extensions in TypeScript import paths (e.g. `'../db/items.js'`)
- **Terminal text width**: use `string-width` via `lib/textWidth.ts` (`textWidth`, `truncateToWidth`, `padToWidth`, `sliceByWidth`) — never rely on JS string `.length` for layout
- **MarqueeText**: scrolling titles; only pad to full width when actively scrolling
- **Time**: luxon + helpers in `lib/time.ts`; all-day uses ISO dates, timed uses ISO datetimes
- **Layout rows**: `VIEW_ROW0` / `TAB_ROW` in `lib/layout.ts` must stay in sync with click regions
- **Google side effects**: after local task mutations in views, call `autoPush` / `autoRemove` from `google/autoSync.ts`
- **Schema migrations**: additive changes in `db/schema.ts` `migrateSchema()` — no heavy one-off data migrations unless explicitly requested

## What To Avoid

- Writing to Google calendars other than the dedicated mytime calendar
- Letting MCP or TUI edit `source: external` items
- Fixed-width UI based on character count without `string-width`
- Broad refactors or new abstractions for one-off fixes
- Committing unless the user asks
- Editing `README.md` or docs unless requested

## Verification

After code changes:

```bash
pnpm build
```

There is no automated test suite yet. Manually exercise affected TUI tabs and MCP tools when behavior changes.

## User Preferences (maintainer)

- Minimize scope; match existing file style and naming
- Do not co-author commits
- Do not use plan mode — output plans inline if asked
- For implementation tasks: make edits, then reply **Done.** unless explanation was requested
- Use `/caveman` skill when asked to explain something
