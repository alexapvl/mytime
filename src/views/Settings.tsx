import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import {
  getProviderCalendarFreeTimeExcludePrefs,
  setProviderCalendarFreeTimeExcludePref,
} from '../db/meta.js';
import {
  getActiveProvider,
  listActiveProviderCalendars,
  providerLabel,
  setActiveProviderCalendarEnabled,
} from '../calendar/provider.js';
import type { ProviderCalendarInfo } from '../calendar/types.js';
import { useViewport } from '../context/ViewportContext.js';
import { useAppInput } from '../hooks/useAppInput.js';
import { useInputFocus } from '../context/InputFocusContext.js';
import { SETTINGS_VIEW_HEADER_ROWS } from '../lib/layout.js';
import {
  addCustomReminderPreset,
  listReminderPresets,
  parseReminderMinutes,
  reminderLabel,
  removeCustomReminderPreset,
  togglePresetInDefaults,
} from '../lib/reminders.js';
import { getDefaultEventReminders } from '../db/meta.js';

type Props = {
  onStatus: (msg: string) => void;
};

type SettingsTab = 'calendars' | 'reminders' | 'freeTime';

type CalendarRow = ProviderCalendarInfo & {
  freeTimeExcluded: boolean;
};

const TABS: { id: SettingsTab; key: string; label: string }[] = [
  { id: 'calendars', key: '1', label: 'Calendars' },
  { id: 'reminders', key: '2', label: 'Event Reminders' },
  { id: 'freeTime', key: '3', label: 'Free Time' },
];

export function SettingsView({ onStatus }: Props) {
  const { exit } = useApp();
  const { setInputFocused } = useInputFocus();
  const { contentRows } = useViewport();
  const [tab, setTab] = useState<SettingsTab>('calendars');
  const [calendars, setCalendars] = useState<CalendarRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [defaultReminders, setDefaultReminders] = useState<number[]>(() => getDefaultEventReminders());
  const [customPresetVersion, setCustomPresetVersion] = useState(0);
  const [addingReminder, setAddingReminder] = useState(false);
  const [addInput, setAddInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reminderPresets = useMemo(() => {
    void customPresetVersion;
    return listReminderPresets();
  }, [customPresetVersion]);

  const loadCalendars = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const provider = getActiveProvider();
      if (!provider) throw new Error('No calendar provider selected. Run: mytime setup');
      const all = await listActiveProviderCalendars();
      const freeTimePrefs = getProviderCalendarFreeTimeExcludePrefs(provider);
      const rows = all
        .map((cal) => ({
          ...cal,
          freeTimeExcluded: Boolean(freeTimePrefs[cal.id]),
        }))
        .sort((a, b) => {
          if (a.locked !== b.locked) return a.locked ? -1 : 1;
          if (a.primary !== b.primary) return a.primary ? -1 : 1;
          return a.summary.localeCompare(b.summary);
        });
      setCalendars(rows);
      setSelected((idx) => Math.min(idx, Math.max(0, rows.length - 1)));
    } catch (e) {
      setError((e as Error).message);
      setCalendars([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCalendars();
  }, [loadCalendars]);

  useEffect(() => {
    setInputFocused(addingReminder);
    return () => setInputFocused(false);
  }, [addingReminder, setInputFocused]);

  useAppInput(
    (_input, key) => {
      if (key.escape) {
        setAddingReminder(false);
        setAddInput('');
      }
    },
    { isActive: addingReminder },
  );

  const fetchedCalendars = useMemo(
    () => calendars.filter((cal) => cal.enabled),
    [calendars],
  );

  const toggleSelectedCalendar = useCallback(() => {
    const cal = calendars[selected];
    if (!cal || cal.locked) return;

    const nextEnabled = !cal.enabled;
    const removed = setActiveProviderCalendarEnabled(cal.id, nextEnabled);

    setCalendars((rows) =>
      rows.map((row) => (row.id === cal.id ? { ...row, enabled: nextEnabled } : row)),
    );

    onStatus(
      nextEnabled
        ? `Enabled "${cal.summary}" - will sync on next pull`
        : `Disabled "${cal.summary}"${removed ? `, removed ${removed} local event${removed === 1 ? '' : 's'}` : ''}`,
    );
  }, [calendars, onStatus, selected]);

  const toggleFreeTimeExclude = useCallback(() => {
    const cal = fetchedCalendars[selected];
    if (!cal || cal.locked) return;

    const nextExcluded = !cal.freeTimeExcluded;
    const provider = getActiveProvider();
    if (!provider) return;
    setProviderCalendarFreeTimeExcludePref(provider, cal.id, nextExcluded);
    setCalendars((rows) =>
      rows.map((row) => (row.id === cal.id ? { ...row, freeTimeExcluded: nextExcluded } : row)),
    );
    onStatus(
      nextExcluded
        ? `"${cal.summary}" excluded from free-time blocking`
        : `"${cal.summary}" blocks free time again`,
    );
  }, [fetchedCalendars, onStatus, selected]);

  const toggleReminderPreset = useCallback(() => {
    const preset = reminderPresets[selected];
    if (!preset) return;
    const next = togglePresetInDefaults(preset.minutes);
    setDefaultReminders(next);
    const enabled = next.includes(preset.minutes);
    onStatus(`${enabled ? 'Enabled' : 'Disabled'} default reminder: ${reminderLabel(preset.minutes)}`);
  }, [onStatus, reminderPresets, selected]);

  const submitCustomReminder = useCallback(
    (raw: string) => {
      const minutes = parseReminderMinutes(raw);
      if (!minutes) {
        onStatus('Invalid reminder — use e.g. 30m, 2h, 1d, or minutes');
        setAddingReminder(false);
        setAddInput('');
        return;
      }
      addCustomReminderPreset(minutes);
      setCustomPresetVersion((v) => v + 1);
      setAddingReminder(false);
      setAddInput('');
      onStatus(`Added custom reminder: ${reminderLabel(minutes)}`);
    },
    [onStatus],
  );

  const deleteCustomReminder = useCallback(() => {
    const preset = reminderPresets[selected];
    if (!preset?.custom) return;
    removeCustomReminderPreset(preset.minutes);
    setDefaultReminders(getDefaultEventReminders());
    setCustomPresetVersion((v) => v + 1);
    setSelected((idx) => Math.max(0, idx - 1));
    onStatus(`Removed custom reminder: ${reminderLabel(preset.minutes)}`);
  }, [onStatus, reminderPresets, selected]);

  useAppInput(
    (input, key) => {
      if (addingReminder) return;
      if (key.escape) {
        exit();
        return;
      }
      if (input === '1') {
        setTab('calendars');
        setSelected(0);
      }
      if (input === '2') {
        setTab('reminders');
        setSelected(0);
      }
      if (input === '3') {
        setTab('freeTime');
        setSelected(0);
      }

      if (tab === 'calendars') {
        if (input === 'r') {
          void loadCalendars();
          onStatus('Reloaded calendars');
          return;
        }
        if (key.upArrow || input === 'k') {
          setSelected((idx) => Math.max(0, idx - 1));
          return;
        }
        if (key.downArrow || input === 'j') {
          setSelected((idx) => Math.min(calendars.length - 1, idx + 1));
          return;
        }
        if (input === ' ' || input === 'x') toggleSelectedCalendar();
        return;
      }

      if (tab === 'freeTime') {
        if (input === 'r') {
          void loadCalendars();
          onStatus('Reloaded calendars');
          return;
        }
        if (key.upArrow || input === 'k') {
          setSelected((idx) => Math.max(0, idx - 1));
          return;
        }
        if (key.downArrow || input === 'j') {
          setSelected((idx) => Math.min(fetchedCalendars.length - 1, idx + 1));
          return;
        }
        if (input === ' ' || input === 'x') toggleFreeTimeExclude();
        return;
      }

      if (input === 'a') {
        setAddingReminder(true);
        setAddInput('');
        return;
      }
      if (input === 'd') {
        deleteCustomReminder();
        return;
      }
      if (key.upArrow || input === 'k') {
        setSelected((idx) => Math.max(0, idx - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setSelected((idx) => Math.min(reminderPresets.length - 1, idx + 1));
        return;
      }
      if (input === ' ' || input === 'x') toggleReminderPreset();
    },
    { isActive: ((tab === 'calendars' && !loading && calendars.length > 0) || tab === 'reminders' || (tab === 'freeTime' && !loading && fetchedCalendars.length > 0)) && !addingReminder },
  );

  if (addingReminder) {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          {TABS.map((t) => (
            <Box key={t.id} marginRight={2}>
              <Text color={tab === t.id ? 'cyanBright' : undefined} bold={tab === t.id} dimColor={tab !== t.id}>
                [{t.key}] {t.label}
              </Text>
            </Box>
          ))}
        </Box>
        <Text color="cyanBright">Add custom reminder:</Text>
        <Text dimColor>e.g. 30m · 2h · 1d · 90 (minutes)</Text>
        <Box marginTop={1}>
          <Text>&gt; </Text>
          <TextInput
            value={addInput}
            onChange={setAddInput}
            onSubmit={submitCustomReminder}
          />
        </Box>
        <Text dimColor>enter save · esc cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        {TABS.map((t) => (
          <Box key={t.id} marginRight={2}>
            <Text
              color={tab === t.id ? 'cyanBright' : undefined}
              bold={tab === t.id}
              dimColor={tab !== t.id}
            >
              [{t.key}] {t.label}
            </Text>
          </Box>
        ))}
      </Box>

      {tab === 'calendars' ? (
        <>
          <Text dimColor>
            Choose which {getActiveProvider() ? providerLabel(getActiveProvider()!) : 'provider'} calendars are pulled locally. Disabled calendars are not stored locally.
          </Text>
          <Box marginTop={1} marginBottom={1} flexDirection="column">
            {loading && <Text dimColor>Loading calendars...</Text>}
            {!loading && error && <Text color="red">{error}</Text>}
            {!loading && !error && calendars.length === 0 && <Text dimColor>No calendars found.</Text>}
            {!loading &&
              !error &&
              calendars.slice(0, Math.max(1, contentRows - SETTINGS_VIEW_HEADER_ROWS)).map((cal, idx) => {
                const active = idx === selected;
                const check = cal.enabled ? '[x]' : '[ ]';
                const suffix = cal.locked
                  ? ' (always on)'
                  : cal.primary
                    ? ' (primary)'
                    : cal.sourceTitle
                      ? ` (${cal.sourceTitle})`
                      : '';
                return (
                  <Box key={cal.id}>
                    <Text color={active ? 'cyanBright' : undefined} bold={active}>
                      {active ? '> ' : '  '}
                      {check} {cal.summary}
                      {suffix}
                    </Text>
                  </Box>
                );
              })}
          </Box>
          <Text dimColor>↑/↓ navigate · space/x toggle · r reload · esc quit</Text>
        </>
      ) : tab === 'freeTime' ? (
        <>
          <Text dimColor>
            Fetched calendars still appear in Daily/Week. Excluded ones do not block free slots when scheduling.
          </Text>
          <Box marginTop={1} marginBottom={1} flexDirection="column">
            {loading && <Text dimColor>Loading calendars...</Text>}
            {!loading && error && <Text color="red">{error}</Text>}
            {!loading && !error && fetchedCalendars.length === 0 && (
              <Text dimColor>No fetched calendars. Enable calendars on tab [1] first.</Text>
            )}
            {!loading &&
              !error &&
              fetchedCalendars.slice(0, Math.max(1, contentRows - SETTINGS_VIEW_HEADER_ROWS)).map((cal, idx) => {
                const active = idx === selected;
                const blocks = cal.locked || !cal.freeTimeExcluded;
                const check = blocks ? '[x]' : '[ ]';
                const suffix = cal.locked ? ' (always blocks)' : cal.primary ? ' (primary)' : '';
                return (
                  <Box key={cal.id}>
                    <Text color={active ? 'cyanBright' : undefined} bold={active}>
                      {active ? '> ' : '  '}
                      {check} {cal.summary}
                      {suffix}
                    </Text>
                  </Box>
                );
              })}
          </Box>
          <Text dimColor>↑/↓ navigate · space/x toggle exclude · r reload · esc quit</Text>
        </>
      ) : (
        <>
          <Text dimColor>Default popup reminders applied when creating new events.</Text>
          <Box marginTop={1} marginBottom={1} flexDirection="column">
            {reminderPresets.slice(0, Math.max(1, contentRows - SETTINGS_VIEW_HEADER_ROWS)).map((preset, idx) => {
              const active = idx === selected;
              const enabled = defaultReminders.includes(preset.minutes);
              return (
                <Box key={`${preset.minutes}-${preset.custom ? 'c' : 'b'}`}>
                  <Text color={active ? 'cyanBright' : undefined} bold={active}>
                    {active ? '> ' : '  '}
                    [{enabled ? 'x' : ' '}] {preset.label} before{preset.custom ? ' (custom)' : ''}
                  </Text>
                </Box>
              );
            })}
          </Box>
          <Text dimColor>
            ↑/↓ navigate · space/x toggle · a add custom
            {reminderPresets[selected]?.custom ? ' · d remove custom' : ''} · esc quit
          </Text>
        </>
      )}
    </Box>
  );
}
