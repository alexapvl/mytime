import React, { useCallback, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { BacklogView } from './views/Backlog.js';
import { DayView, WeekView } from './views/Calendar.js';
import { SettingsView } from './views/Settings.js';
import { syncWithGoogle } from './google/sync.js';
import { isAuthenticated } from './google/auth.js';
import { MouseProvider, useClickRegions } from './components/Mouse.js';
import { InputFocusProvider, useInputFocus } from './context/InputFocusContext.js';
import { UndoProvider, useUndo } from './context/UndoContext.js';
import { useAppInput } from './hooks/useAppInput.js';
import { TAB_ROW } from './lib/layout.js';

type Tab = 'backlog' | 'daily' | 'week';
type Screen = 'main' | 'settings';

const TABS: { id: Tab; label: string; key: string }[] = [
  { id: 'backlog', label: 'Backlog', key: '1' },
  { id: 'daily', label: 'Daily', key: '2' },
  { id: 'week', label: 'Week', key: '3' },
];

function AppShell({ screen }: { screen: Screen }) {
  const { exit } = useApp();
  const { inputFocused } = useInputFocus();
  const { undoLast } = useUndo();
  const [tab, setTab] = useState<Tab>('backlog');
  const [status, setStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((t) => t + 1), []);

  useClickRegions('tabs', [
    { row: TAB_ROW, col: 1, endCol: 11, onClick: () => setTab('backlog') },
    { row: TAB_ROW, col: 12, endCol: 22, onClick: () => setTab('daily') },
    { row: TAB_ROW, col: 23, endCol: 33, onClick: () => setTab('week') },
  ]);

  const doSync = useCallback(async () => {
    if (!isAuthenticated()) {
      setStatus('Not authenticated — run: mytime auth');
      return;
    }
    setSyncing(true);
    setStatus('Syncing...');
    const result = await syncWithGoogle();
    setSyncing(false);
    refresh();
    setStatus(
      result.errors.length
        ? `Sync errors: ${result.errors.join('; ')}`
        : `Synced: ${result.pushed} pushed, ${result.pulled} pulled from ${result.calendars} calendars`,
    );
  }, [refresh]);

  useAppInput(
    (input, key) => {
      if (key.escape) {
        exit();
        return;
      }
      if (screen === 'main') {
        if (input === '1') setTab('backlog');
        if (input === '2') setTab('daily');
        if (input === '3') setTab('week');
        if (input === 'r') void doSync();
        if (input === 'u') {
          const label = undoLast();
          if (label) {
            refresh();
            setStatus(`Undid: ${label}`);
          } else {
            setStatus('Nothing to undo');
          }
        }
      }
    },
    { isActive: !inputFocused },
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">
          mytime
        </Text>
        <Text dimColor> — {screen === 'settings' ? 'settings' : 'tasks + calendar'}</Text>
      </Box>

      {screen === 'main' && (
        <Box marginBottom={1}>
          {TABS.map((t) => (
            <Box key={t.id} marginRight={2}>
              <Text color={tab === t.id ? 'cyan' : 'gray'} bold={tab === t.id} underline={tab === t.id}>
                [{t.key}] {t.label}
              </Text>
            </Box>
          ))}
          <Text dimColor> · r sync · u undo · esc quit</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1} minHeight={10}>
        {screen === 'settings' && <SettingsView onStatus={setStatus} />}
        {screen === 'main' && tab === 'backlog' && (
          <BacklogView refreshToken={refreshToken} onRefresh={refresh} onStatus={setStatus} />
        )}
        {screen === 'main' && tab === 'daily' && (
          <DayView refreshToken={refreshToken} onRefresh={refresh} onStatus={setStatus} />
        )}
        {screen === 'main' && tab === 'week' && (
          <WeekView refreshToken={refreshToken} onRefresh={refresh} onStatus={setStatus} />
        )}
      </Box>

      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          {syncing
            ? 'Syncing with Google...'
            : status || (isAuthenticated() ? 'Google connected' : 'Run mytime auth to connect Google')}
        </Text>
      </Box>
    </Box>
  );
}

export function App({ initialScreen = 'main' }: { initialScreen?: Screen }) {
  return (
    <InputFocusProvider>
      <UndoProvider>
        <MouseProvider>
          <AppShell screen={initialScreen} />
        </MouseProvider>
      </UndoProvider>
    </InputFocusProvider>
  );
}
