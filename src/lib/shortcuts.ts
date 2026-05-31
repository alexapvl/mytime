export type Shortcut<C> = {
  keys: string;
  label: string | ((ctx: C) => string);
  show?: (ctx: C) => boolean;
};

export type BacklogHelpContext = {
  scheduled: boolean;
};

export type DailyHelpContext = {
  isTask: boolean;
  hasTime: boolean;
};

export type WeekHelpContext = {
  isTask: boolean;
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

export const DAILY_SHORTCUTS: Shortcut<DailyHelpContext>[] = [
  { keys: '←/→', label: 'day' },
  { keys: 't', label: 'today' },
  { keys: '↑/↓', label: 'select' },
  { keys: 'a', label: 'add' },
  { keys: 'q', label: 'quick-add' },
  { keys: 's', label: 'reschedule', show: (ctx) => ctx.isTask },
  { keys: '⇧↑/↓', label: 'move 1h', show: (ctx) => ctx.isTask && ctx.hasTime },
  { keys: '+/-', label: 'resize', show: (ctx) => ctx.isTask && ctx.hasTime },
  { keys: 'x', label: 'done', show: (ctx) => ctx.isTask },
  { keys: 'd', label: 'delete', show: (ctx) => ctx.isTask },
];

export const WEEK_SHORTCUTS: Shortcut<WeekHelpContext>[] = [
  { keys: '←/→', label: 'day' },
  { keys: '⇧←/→', label: 'week' },
  { keys: 't', label: 'today' },
  { keys: '↑/↓', label: 'select' },
  { keys: 'a', label: 'add' },
  { keys: 'q', label: 'quick-add' },
  { keys: 's', label: 'reschedule', show: (ctx) => ctx.isTask },
  { keys: 'x', label: 'done', show: (ctx) => ctx.isTask },
  { keys: 'd', label: 'delete', show: (ctx) => ctx.isTask },
];
