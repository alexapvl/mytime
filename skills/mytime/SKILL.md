---
name: mytime
description: "Manage personal tasks and calendar through the mytime agent CLI — backlog, schedule, free slots, quick-add NLP, and Google Calendar sync. Use whenever a task touches todos, scheduling, calendar events, past-due items, or time blocking."
user-invocable: false
---

# mytime agent

Agent-ergonomic interface for mytime (tasks + calendar). Prefer `mytime agent` over mytime MCP and raw calendar CLIs.

Requires `mytime` on PATH (`pnpm build && pnpm link --global` from the mytime repo). Google Calendar sync needs `mytime auth` once.

## When to use

Use for: listing or adding tasks, scheduling/rescheduling, finding free slots, viewing today's agenda, searching by project/tag, completing or deleting tasks, adding calendar events, syncing with Google.

## Workflow

1. Run `mytime agent` with no args for a live dashboard — backlog preview, past due, today's schedule, counts.
2. Read lists with `backlog list`, `schedule list`, `past-due`, or `search <query>`.
3. Before scheduling timed work, run `mytime agent slots [--date <day>]` and pick a slot.
4. Add tasks with `task quick "<natural language>"` (supports `#tags`, `@project`, `p0`-`p3`, chrono dates).
5. Schedule with `task schedule <id> --start <iso> [--duration-minutes 60]`.
6. Follow `help:` lines in output for next steps.

## Commands

```
commands[9]:
  (none)=dashboard, backlog, schedule, past-due, slots, item, search, task, event, sync
```

### Reads

- `mytime agent` — dashboard
- `mytime agent backlog list` — all open tasks
- `mytime agent schedule list [--from <iso>] [--to <iso>]` — scheduled items (defaults to today)
- `mytime agent past-due` — overdue open tasks
- `mytime agent slots [--date <iso>] [--step-minutes 60] [--time-filter 09] [--exclude-id <id>]`
- `mytime agent item <id> [--full]` — item detail (notes truncated unless `--full`)
- `mytime agent search <query>` — search title, project, tags

### Writes

- `mytime agent task add --title <text> [--notes] [--project] [--tags a,b] [--priority 0-3]`
- `mytime agent task quick "<text>"` — NLP add (may include schedule)
- `mytime agent task update <id> [--title] [--notes] [--project] [--tags] [--priority]`
- `mytime agent task schedule <id> --start <iso> [--end] [--all-day] [--duration-minutes 60]`
- `mytime agent task done <id> [--done true|false]`
- `mytime agent task delete <id>`
- `mytime agent event add --title <text> --start <iso> [--end] [--all-day] [--notes] [--location]`
- `mytime agent event quick "<text>"`
- `mytime agent event update <id> [--title] [--notes] [--location]`
- `mytime agent event schedule <id> --start <iso> [--end] [--all-day]`
- `mytime agent event delete <id>`
- `mytime agent sync` — full Google Calendar sync

Run `mytime agent --help` or `mytime agent --help task` for concise reference.

## Tips

- Output is TOON-encoded and token-efficient; pipe through `grep` when filtering long lists.
- External Google Calendar events (`source: external`) are read-only — only mytime tasks/events can be edited.
- Write commands auto-sync to Google when authenticated.
- Prefer `slots` before `task schedule` to avoid conflicts.
- Use `--json` on any command for JSON instead of TOON.
