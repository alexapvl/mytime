import React, { useCallback, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { InboxView } from './views/Inbox.js';
import { DayView, WeekView } from './views/Calendar.js';
import { syncWithGoogle } from './google/sync.js';
import { isAuthenticated } from './google/auth.js';
import { MouseProvider, useClickRegions } from './components/Mouse.js';
import { InputFocusProvider, useInputFocus } from './context/InputFocusContext.js';
import { useAppInput } from './hooks/useAppInput.js';
import { TAB_ROW } from './lib/layout.js';

type Tab = 'inbox' | 'today' | 'week';

const TABS: { id: Tab; label: string; key: string }[] = [
  { id: 'inbox', label: 'Backlog', key: '1' },
  { id: 'today', label: 'Daily', key: '2' },
  { id: 'week', label: 'Week', key: '3' },
];

function AppShell() {
  const { exit } = useApp();
  const { inputFocused } = useInputFocus();
  const [tab, setTab] = useState<Tab>('inbox');
  const [status, setStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useClickRegions('tabs', [
    { row: TAB_ROW, col: 1, endCol: 11, onClick: () => setTab('inbox') },
    { row: TAB_ROW, col: 12, endCol: 22, onClick: () => setTab('today') },
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
      if (input === '1') setTab('inbox');
      if (input === '2') setTab('today');
      if (input === '3') setTab('week');
      if (input === 'r') void doSync();
    },
    { isActive: !inputFocused },
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">
          mytime
        </Text>
        <Text dimColor> — tasks + calendar</Text>
      </Box>

      <Box marginBottom={1}>
        {TABS.map((t) => (
          <Box key={t.id} marginRight={2}>
            <Text color={tab === t.id ? 'cyan' : 'gray'} bold={tab === t.id} underline={tab === t.id}>
              [{t.key}] {t.label}
            </Text>
          </Box>
        ))}
        <Text dimColor> · r sync · esc quit</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1} minHeight={10}>
        {tab === 'inbox' && <InboxView onRefresh={refresh} onStatus={setStatus} />}
        {tab === 'today' && <DayView onRefresh={refresh} onStatus={setStatus} />}
        {tab === 'week' && <WeekView onRefresh={refresh} onStatus={setStatus} />}
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

export function App() {
  return (
    <InputFocusProvider>
      <MouseProvider>
        <AppShell />
      </MouseProvider>
    </InputFocusProvider>
  );
}
