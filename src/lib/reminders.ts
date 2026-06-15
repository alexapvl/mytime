import type { Reminder } from '../db/types.js';
import {
  getCustomEventReminderPresets,
  getDefaultEventReminders,
  setCustomEventReminderPresets,
  setDefaultEventReminders,
} from '../db/meta.js';

export const REMINDER_PRESETS: { label: string; minutes: number }[] = [
  { label: '15 min', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '1 day', minutes: 1440 },
  { label: '1 week', minutes: 10080 },
];

export type ReminderPresetRow = {
  label: string;
  minutes: number;
  custom: boolean;
};

export function parseReminderMinutes(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const match = s.match(/^(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
  if (!match) return null;
  const n = parseInt(match[1]!, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = match[2] ?? 'm';
  if (unit.startsWith('h')) return n * 60;
  if (unit.startsWith('d')) return n * 1440;
  return n;
}

export function listReminderPresets(): ReminderPresetRow[] {
  const builtinMinutes = new Set(REMINDER_PRESETS.map((p) => p.minutes));
  const builtin = REMINDER_PRESETS.map((p) => ({ ...p, custom: false }));
  const custom = getCustomEventReminderPresets()
    .filter((m) => !builtinMinutes.has(m))
    .map((m) => ({ label: reminderLabel(m), minutes: m, custom: true }));
  return [...builtin, ...custom].sort((a, b) => b.minutes - a.minutes);
}

export function popupReminder(minutes: number): Reminder {
  return { method: 'popup', minutes };
}

export function defaultReminders(): Reminder[] {
  return getDefaultEventReminders().map((minutes) => popupReminder(minutes));
}

export function reminderLabel(minutes: number): string {
  const preset = REMINDER_PRESETS.find((p) => p.minutes === minutes);
  if (preset) return preset.label;
  if (minutes % 1440 === 0 && minutes >= 1440) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0 && minutes >= 60) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} min`;
}

export function remindersSummary(reminders: Reminder[]): string {
  if (!reminders.length) return '';
  return reminders.map((r) => reminderLabel(r.minutes)).join(', ');
}

export function parseGoogleReminders(
  overrides: { method?: string | null; minutes?: number | null }[] | null | undefined,
): Reminder[] {
  if (!overrides?.length) return [];
  return overrides
    .filter((o) => o.minutes != null && o.minutes >= 0)
    .map((o) => ({
      method: 'popup' as const,
      minutes: o.minutes!,
    }));
}

export function remindersToGoogle(reminders: Reminder[]) {
  return {
    useDefault: false,
    overrides: reminders.map((r) => ({ method: 'popup' as const, minutes: r.minutes })),
  };
}

export function togglePresetInDefaults(minutes: number): number[] {
  const current = getDefaultEventReminders();
  const next = current.includes(minutes) ? current.filter((m) => m !== minutes) : [...current, minutes].sort((a, b) => b - a);
  setDefaultEventReminders(next);
  return next;
}

export function addCustomReminderPreset(minutes: number): number[] {
  const custom = getCustomEventReminderPresets();
  if (REMINDER_PRESETS.some((p) => p.minutes === minutes) || custom.includes(minutes)) return custom;
  const next = [...custom, minutes].sort((a, b) => b - a);
  setCustomEventReminderPresets(next);
  return next;
}

export function removeCustomReminderPreset(minutes: number): number[] {
  const next = getCustomEventReminderPresets().filter((m) => m !== minutes);
  setCustomEventReminderPresets(next);
  const defaults = getDefaultEventReminders().filter((m) => m !== minutes);
  setDefaultEventReminders(defaults);
  return next;
}
