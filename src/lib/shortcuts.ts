export type Shortcut<C> = {
  keys: string;
  label: string | ((ctx: C) => string);
  show?: (ctx: C) => boolean;
};

export type BacklogHelpContext = {
  scheduled: boolean;
};

export type CalendarHelpContext = {
  isTask: boolean;
  isEvent: boolean;
  isLocal: boolean;
  hasTime: boolean;
};

export function formatShortcuts<C>(shortcuts: Shortcut<C>[], ctx: C): string {
  return shortcuts
    .filter((s) => !s.show || s.show(ctx))
    .map((s) => `${s.keys} ${typeof s.label === 'function' ? s.label(ctx) : s.label}`)
    .join(' · ');
}

export const BACKLOG_SHORTCUTS: Shortcut<BacklogHelpContext>[] = [
  { keys: '←/→', label: 'priority' },
  { keys: '↑/↓', label: 'navigate' },
  { keys: '⇧←/→', label: 'move priority' },
  { keys: 'a', label: 'add' },
  { keys: 'q', label: 'quick-add' },
  { keys: 'e', label: 'edit' },
  { keys: 's', label: (ctx) => (ctx.scheduled ? 'reschedule' : 'schedule') },
  { keys: 'x', label: 'done' },
  { keys: 'd', label: 'delete' },
];

export const DAILY_SHORTCUTS: Shortcut<CalendarHelpContext>[] = [
  { keys: '←/→', label: 'day' },
  { keys: 't', label: 'today' },
  { keys: '↑/↓', label: 'select' },
  { keys: 'a', label: 'add task' },
  { keys: 'q', label: 'quick-add' },
  { keys: '⇧a', label: 'add event' },
  { keys: '⇧q', label: 'quick-event' },
  { keys: 'e', label: 'edit', show: (ctx) => ctx.isLocal },
  { keys: 's', label: 'reschedule', show: (ctx) => ctx.isLocal },
  { keys: '⇧↑/↓', label: 'move 1h', show: (ctx) => ctx.isLocal && ctx.hasTime },
  { keys: '+/-', label: 'end ±15m', show: (ctx) => ctx.isLocal && ctx.hasTime },
  { keys: '⇧+/-', label: 'start ±15m', show: (ctx) => ctx.isLocal && ctx.hasTime },
  { keys: 'x', label: 'done', show: (ctx) => ctx.isTask },
  { keys: 'd', label: 'delete', show: (ctx) => ctx.isLocal },
];

export const PAST_DUE_SHORTCUTS: Shortcut<Record<string, never>>[] = [
  { keys: '↑/↓', label: 'navigate' },
  { keys: 'e', label: 'edit' },
  { keys: 's', label: 'reschedule' },
  { keys: 'x', label: 'done' },
  { keys: 'd', label: 'delete' },
];

export const WEEK_SHORTCUTS: Shortcut<CalendarHelpContext>[] = [
  { keys: '←/→', label: 'day' },
  { keys: '⇧←/→', label: 'week' },
  { keys: 't', label: 'today' },
  { keys: '↑/↓', label: 'select' },
  { keys: 'a', label: 'add task' },
  { keys: 'q', label: 'quick-add' },
  { keys: '⇧a', label: 'add event' },
  { keys: '⇧q', label: 'quick-event' },
  { keys: 'e', label: 'edit', show: (ctx) => ctx.isLocal },
  { keys: 's', label: 'reschedule', show: (ctx) => ctx.isLocal },
  { keys: '⇧↑/↓', label: 'move 1h', show: (ctx) => ctx.isLocal && ctx.hasTime },
  { keys: '+/-', label: 'end ±15m', show: (ctx) => ctx.isLocal && ctx.hasTime },
  { keys: '⇧+/-', label: 'start ±15m', show: (ctx) => ctx.isLocal && ctx.hasTime },
  { keys: 'x', label: 'done', show: (ctx) => ctx.isTask },
  { keys: 'd', label: 'delete', show: (ctx) => ctx.isLocal },
];
