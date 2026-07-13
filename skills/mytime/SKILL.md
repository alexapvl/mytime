---
name: mytime
description: "Manage personal tasks and calendar through the mytime agent CLI: backlog, schedule, free slots, quick-add NLP, and Google or Apple Calendar sync. Use whenever a task touches todos, scheduling, calendar events, past-due items, or time blocking."
---

# mytime agent

Agent-ergonomic interface for mytime (tasks + calendar). When shell execution works and `mytime` is on PATH, always use `mytime agent`. Do not use mytime MCP in that environment. Use MCP only when the client cannot execute shell commands.

Requires `mytime` on PATH (`brew tap alexapvl/mytime https://github.com/alexapvl/mytime && brew install mytime`, or build from source). Calendar setup: `mytime setup google` or `mytime setup apple` (macOS 14+). Agent onboarding: `mytime setup --agent-onboarding-prompt`.

## When to use

Use for: listing or adding tasks, scheduling/rescheduling, finding free slots, viewing today's agenda, searching by project/tag, completing or deleting tasks, adding calendar events, and syncing with the active Google or Apple provider.

## Workflow

1. Run `command -v mytime`, then use `mytime agent` when it succeeds. Only fall back to mytime MCP when shell execution or the binary is unavailable.
2. Check the configured calendar provider. Infer Google or Apple from the conversation's origin when that origin makes the choice explicit, even if the provider is not repeated in the immediate request. Otherwise ask the user which provider they want before setup. Never silently default to Google.
3. Run `mytime setup google` for Google OAuth, or `mytime setup apple` for EventKit on macOS 14+. The user must complete browser sign-in or approve the macOS Calendar permission prompt when requested.
4. Run `mytime agent` with no args for a live dashboard: backlog preview, past due, today's schedule, counts.
5. Read lists with `backlog list`, `schedule list`, `past-due`, or `search <query>`.
6. Before scheduling timed work, run `mytime agent slots [--date <day>]` and pick a slot.
7. Give every new task a project. Infer it from the conversation's origin first, including the current repository, workspace, issue, PR, or named product, even when the user does not repeat it in the task text. Add it as `@project` with `task quick`, or `--project <project>` with `task add`. If no project can be inferred, ask the user before creating the task. Never silently create a projectless task.
8. Schedule with `task schedule <id> --start <iso> [--duration-minutes 60]`.
9. Follow `help:` lines in output for next steps.

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
- `mytime agent sync` - full sync with the active calendar provider

Run `mytime agent --help` or `mytime agent --help task` for concise reference.

## Tips

- Treat conversation origin as project context. For example, work requested while operating in the `mytime` repository belongs to `@mytime` unless the user indicates another project.
- Output is TOON-encoded and token-efficient; pipe through `grep` when filtering long lists.
- External calendar events (`source: external`) are read-only. Only mytime tasks/events can be edited.
- Write commands auto-sync only to the currently active provider.
- Only one provider is writable at a time. When switching, setup removes old-provider external events from the local cache and asks whether to delete the old dedicated mytime calendar. The default is to keep it. Never delete unrelated calendars.
- Confirm the user's choice, then switch with `mytime setup <provider> --keep-old-calendar` or `--delete-old-calendar`. If Apple setup lists multiple sources, ask which account they want and rerun with `--source <source-id>`.
- Prefer `slots` before `task schedule` to avoid conflicts.
- Use `--json` on any command for JSON instead of TOON.
