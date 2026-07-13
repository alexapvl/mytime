import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { DateTime } from 'luxon';
import { BacklogView } from './views/Backlog.js';
import { DayView, WeekView } from './views/Calendar.js';
import { MonthView } from './views/Month.js';
import { PastDueView } from './views/PastDue.js';
import { SettingsView } from './views/Settings.js';
import {
  getActiveProvider,
  getActiveProviderStatus,
  providerLabel,
  syncCalendar,
} from './calendar/provider.js';
import type { ProviderStatus } from './calendar/types.js';
import { MouseProvider, useClickRegions } from './components/Mouse.js';
import { InputFocusProvider, useInputFocus } from './context/InputFocusContext.js';
import { UndoProvider, useUndo } from './context/UndoContext.js';
import { useAppInput } from './hooks/useAppInput.js';
import { ViewportProvider, useViewport } from './context/ViewportContext.js';
import { TAB_ROW } from './lib/layout.js';
import { checkForUpdatesOnceDaily, type UpdateNotice } from './lib/updateCheck.js';

type Tab = 'backlog' | 'daily' | 'week' | 'month' | 'pastdue';
type Screen = 'main' | 'settings';

const TABS: { id: Tab; label: string; key: string }[] = [
  { id: 'backlog', label: 'Backlog', key: '1' },
  { id: 'daily', label: 'Daily', key: '2' },
  { id: 'week', label: 'Week', key: '3' },
  { id: 'month', label: 'Month', key: '4' },
  { id: 'pastdue', label: 'Past Due', key: '5' },
];

type AppProps = {
  initialScreen?: Screen;
  onNeedAuth?: () => void;
};

function AppShell({ screen, onNeedAuth }: { screen: Screen; onNeedAuth?: () => void }) {
  const { rows } = useViewport();
  const { exit } = useApp();
  const { inputFocused } = useInputFocus();
  const { undoLast } = useUndo();
  const [tab, setTab] = useState<Tab>('backlog');
  const [focusedDateISO, setFocusedDateISO] = useState(() => DateTime.local().toISODate()!);
  const [status, setStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [updateNotice, setUpdateNotice] = useState<UpdateNotice | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);

  const refresh = useCallback(() => setRefreshToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    void checkForUpdatesOnceDaily().then((notice) => {
      if (!cancelled) setUpdateNotice(notice);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void getActiveProviderStatus().then(setProviderStatus);
  }, []);

  useClickRegions('tabs', [
    { row: TAB_ROW, col: 1, endCol: 11, onClick: () => setTab('backlog') },
    { row: TAB_ROW, col: 12, endCol: 22, onClick: () => setTab('daily') },
    { row: TAB_ROW, col: 23, endCol: 33, onClick: () => setTab('week') },
    { row: TAB_ROW, col: 34, endCol: 44, onClick: () => setTab('month') },
    { row: TAB_ROW, col: 45, endCol: 57, onClick: () => setTab('pastdue') },
  ]);

  const doSync = useCallback(async () => {
    const currentStatus = await getActiveProviderStatus();
    setProviderStatus(currentStatus);
    if (!currentStatus?.connected) {
      setStatus(currentStatus?.detail ?? 'No calendar provider selected - run: mytime setup');
      return;
    }
    setSyncing(true);
    setStatus('Syncing...');
    const result = await syncCalendar();
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
        if (input === '4') setTab('month');
        if (input === '5') setTab('pastdue');
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

  const activeProvider = getActiveProvider();
  const activeLabel = activeProvider ? providerLabel(activeProvider) : 'Calendar';
  const statusMessage =
    syncing
      ? `Syncing with ${activeLabel}...`
      : status ||
        (providerStatus?.connected
          ? `${activeLabel} connected`
          : providerStatus?.detail ?? 'No calendar provider selected - run: mytime setup');

  return (
    <Box flexDirection="column" height={rows} overflow="hidden" padding={1}>
      <Box flexShrink={0} marginBottom={1}>
        <Text bold color="cyanBright">
          mytime
        </Text>
        <Text dimColor> - {screen === 'settings' ? 'settings' : 'tasks + calendar'}</Text>
      </Box>

      {screen === 'main' && !providerStatus?.connected && (
        <Box flexShrink={0} marginBottom={1}>
          <Text color="yellow">
            {providerStatus?.detail ??
              'Calendar not set up - run: mytime setup, then choose Google or Apple'}
          </Text>
        </Box>
      )}

      {updateNotice && (
        <Box flexShrink={0} marginBottom={1}>
          <Text color="green">
            {updateNotice.message} - {updateNotice.command}
          </Text>
        </Box>
      )}

      {screen === 'main' && (
        <Box flexShrink={0} marginBottom={1}>
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
          <Text dimColor> · r sync · u undo · esc quit</Text>
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {screen === 'settings' && <SettingsView onStatus={setStatus} />}
        {screen === 'main' && tab === 'backlog' && (
          <BacklogView refreshToken={refreshToken} onRefresh={refresh} onStatus={setStatus} />
        )}
        {screen === 'main' && tab === 'daily' && (
          <DayView
            refreshToken={refreshToken}
            onRefresh={refresh}
            onStatus={setStatus}
            focusedDateISO={focusedDateISO}
            onFocusedDateChange={setFocusedDateISO}
          />
        )}
        {screen === 'main' && tab === 'week' && (
          <WeekView refreshToken={refreshToken} onRefresh={refresh} onStatus={setStatus} />
        )}
        {screen === 'main' && tab === 'month' && (
          <MonthView
            refreshToken={refreshToken}
            onRefresh={refresh}
            onStatus={setStatus}
            focusedDateISO={focusedDateISO}
            onFocusedDateChange={setFocusedDateISO}
            onDrillToDaily={() => setTab('daily')}
          />
        )}
        {screen === 'main' && tab === 'pastdue' && (
          <PastDueView refreshToken={refreshToken} onRefresh={refresh} onStatus={setStatus} />
        )}
      </Box>

      <Box flexShrink={0} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>{statusMessage}</Text>
      </Box>
    </Box>
  );
}

export function App({ initialScreen = 'main', onNeedAuth }: AppProps) {
  return (
    <InputFocusProvider>
      <UndoProvider>
        <MouseProvider>
          <ViewportProvider screen={initialScreen}>
            <AppShell screen={initialScreen} onNeedAuth={onNeedAuth} />
          </ViewportProvider>
        </MouseProvider>
      </UndoProvider>
    </InputFocusProvider>
  );
}
