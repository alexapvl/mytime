import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { deleteItemsByGoogleCalendar } from '../db/items.js';
import { getCalendarFetchPrefs } from '../db/meta.js';
import {
  getOrCreateMytimeCalendarId,
  isCalendarFetchEnabled,
  listAccountCalendars,
  setCalendarEnabled,
  type CalendarInfo,
} from '../google/calendar.js';
import { useViewport } from '../context/ViewportContext.js';
import { useAppInput } from '../hooks/useAppInput.js';
import { SETTINGS_VIEW_HEADER_ROWS } from '../lib/layout.js';

type Props = {
  onStatus: (msg: string) => void;
};

type CalendarRow = CalendarInfo & {
  enabled: boolean;
  locked: boolean;
};

export function SettingsView({ onStatus }: Props) {
  const { exit } = useApp();
  const { contentRows } = useViewport();
  const [calendars, setCalendars] = useState<CalendarRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCalendars = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [all, mytimeCalendarId] = await Promise.all([
        listAccountCalendars(),
        getOrCreateMytimeCalendarId(),
      ]);
      const prefs = getCalendarFetchPrefs();
      const rows = all
        .map((cal) => ({
          ...cal,
          enabled: isCalendarFetchEnabled(cal, mytimeCalendarId, prefs),
          locked: cal.id === mytimeCalendarId,
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

  const toggleSelected = useCallback(() => {
    const cal = calendars[selected];
    if (!cal || cal.locked) return;

    const nextEnabled = !cal.enabled;
    setCalendarEnabled(cal.id, nextEnabled);

    let removed = 0;
    if (!nextEnabled) removed = deleteItemsByGoogleCalendar(cal.id);

    setCalendars((rows) =>
      rows.map((row) => (row.id === cal.id ? { ...row, enabled: nextEnabled } : row)),
    );

    onStatus(
      nextEnabled
        ? `Enabled "${cal.summary}" — will sync on next pull`
        : `Disabled "${cal.summary}"${removed ? `, removed ${removed} local event${removed === 1 ? '' : 's'}` : ''}`,
    );
  }, [calendars, onStatus, selected]);

  useAppInput(
    (input, key) => {
      if (key.escape) {
        exit();
        return;
      }
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
      if (input === ' ' || input === 'x') toggleSelected();
    },
    { isActive: !loading && calendars.length > 0 },
  );

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Calendar fetch settings</Text>
      </Box>
      <Text dimColor>
        Choose which Google calendars are pulled into the local database. Disabled calendars are not stored locally.
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
            const suffix = cal.locked ? ' (always on)' : cal.primary ? ' (primary)' : '';
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
    </Box>
  );
}
