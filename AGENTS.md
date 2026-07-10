# AGENTS.md

## Project Overview

**mytime** is a personal terminal app that unifies tasks and calendar. Open tasks live in a local SQLite backlog; scheduled tasks sync to a dedicated Google Calendar named **"mytime"**. External Google calendars can be pulled read-only into the local DB for display in Daily/Week views.

Treat this as a small, single-user CLI/TUI — prefer focused diffs, reuse existing patterns, and avoid over-engineering.

## Stack

- Node 20+, ESM TypeScript
- **Ink 5** + React 18 for the TUI
- **better-sqlite3** for local storage (`~/.mytime/db.sqlite`)
- **google-auth-library** + **@googleapis/calendar** for Calendar sync (not the full `googleapis` metapackage)
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
  app.tsx              Tab shell (Backlog / Daily / Week / Month / Past Due)
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
- **`mytime help`** text lives in `printHelp()` (`src/cli.tsx`) — keep it in sync when adding tabs, CLI commands, or other user-visible features (alongside `shortcuts.ts` and view help bars)

### Views

| Tab | File | Notes |
|-----|------|-------|
| Backlog | `views/Backlog.tsx` | P0–P3 columns; default selection = lowest non-empty priority |
| Daily | `views/Calendar.tsx` (`DayView`) | Hour grid + all-day; default = first open (not done) item |
| Week | `views/Calendar.tsx` (`WeekView`) | 7-column grid; default = today + first event that day |
| Month | `views/Month.tsx` (`MonthView`) | Month grid; drill to Daily with enter |
| Past Due | `views/PastDue.tsx` | Open tasks past deadline |

`ScheduleEditor` shows day context, overlap hints, digit time filter, and `f` for free slots only. Overlap logic lives in `src/lib/scheduleOverlap.ts`.

### MCP (`src/mcp/server.ts`)

Legacy stdio MCP server. Prefer **`mytime agent`** for AI agents — same handlers, lower token cost.

- Thin adapter over `src/agent/handlers.ts`
- External items are read-only for write tools
- Prefer `list_free_slots` / `mytime agent slots` before scheduling

### Agent CLI (`src/agent/`)

AXI-shaped agent interface: `mytime agent`.

```
src/agent/
  handlers.ts   Shared read/write logic (used by MCP + agent CLI)
  cli.ts        Command router
  format.ts     TOON stdout, structured errors
  views.ts      Compact list vs detail item shapes
  fresh.ts      Debounced Google sync before reads/writes
```

- No-args dashboard with counts and previews
- TOON output via `@toon-format/toon`; `--json` escape hatch
- Contextual `help:` hints after responses
- Installable skill at `skills/mytime/SKILL.md`

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

## Releases

When stable user-visible work lands on `main` (feature, fix batch, or anything you would expect Homebrew/source users to upgrade for), **cut a GitHub release** before treating the work as shipped. Do not leave stable improvements only on `main` without a tag unless the user explicitly defers.

### Versioning

- Keep `package.json` `version` in sync with the release tag (`v0.1.0` → `"0.1.0"`).
- While `0.x`: **minor** for new features/capabilities, **patch** for fixes and small polish.

### Release checklist

1. Ensure `main` is clean and `pnpm build` passes.
2. Bump `package.json` `version`; commit and push to `main`.
3. Push tag — CI builds **slim macOS packs** (Homebrew) and uploads to the release:
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
   Assets: `mytime-X.Y.Z-macos-arm64.tar.gz` and `mytime-X.Y.Z-macos-x86_64.tar.gz`.

   Local build (both arches):
   ```bash
   ./scripts/build-macos-pack.sh X.Y.Z arm64 slim
   ./scripts/build-macos-pack.sh X.Y.Z x86_64 slim
   ```
   Slim packs are ~8–9MB; formula **`depends_on "node@20"`**. Optional standalone: `… standalone` (~40MB, vendored Node).

4. Update `Formula/mytime.rb` with release URLs + sha256 from both packs.

5. Commit and push formula changes.
6. Install smoke test: `brew update && brew reinstall mytime`

### What not to release

- WIP branches, unreleased experiments, or doc-only commits that do not change the installed app (unless the user asks).
- Every single commit — batch stable changes into sensible `v0.x.y` releases.
