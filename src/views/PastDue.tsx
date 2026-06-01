import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { DateTime } from 'luxon';
import { ItemEditor } from '../components/ItemEditor.js';
import { ScheduleEditor } from '../components/ScheduleEditor.js';
import { MarqueeText } from '../components/MarqueeText.js';
import { ShortcutBar } from '../components/ShortcutBar.js';
import { useClickRegions } from '../components/Mouse.js';
import { useInputFocus } from '../context/InputFocusContext.js';
import { useUndo } from '../context/UndoContext.js';
import { useAppInput } from '../hooks/useAppInput.js';
import type { ClickRegion } from '../lib/mouse.js';
import { VIEW_ROW0 } from '../lib/layout.js';
import type { Item } from '../db/types.js';
import {
  deleteItem,
  listPastDue,
  scheduleAllDayItem,
  scheduleItem,
  toggleDone,
  updateItem,
} from '../db/items.js';
import { autoPush, autoRemove } from '../google/autoSync.js';
import { formatDate, formatScheduleTime } from '../lib/time.js';
import { PAST_DUE_SHORTCUTS } from '../lib/shortcuts.js';
import { cloneItem, makeUndoDelete, makeUndoToggleDone } from '../lib/undoActions.js';

type Props = {
  onRefresh: () => void;
  onStatus: (msg: string) => void;
  refreshToken?: number;
};

type Mode = 'list' | 'edit' | 'schedule';

function metaLabel(item: Item): string {
  const parts: string[] = [];
  if (item.project) parts.push(`@${item.project.replace(/^@/, '')}`);
  if (item.tags.length) parts.push(...item.tags);
  return parts.join(' ');
}

function scheduleLabel(item: Item): string {
  if (!item.start) return '';
  return `${formatDate(item.start)} ${formatScheduleTime(item.start, item.end, item.allDay)}`;
}

function overdueLabel(item: Item, now = DateTime.local()): string {
  if (!item.start) return '';
  const start = DateTime.fromISO(item.start);

  if (item.allDay || !item.start.includes('T')) {
    const days = Math.floor(now.startOf('day').diff(start.startOf('day'), 'days').days);
    return days === 1 ? '1 day overdue' : `${days} days overdue`;
  }

  const deadline = item.end ? DateTime.fromISO(item.end) : start;
  if (deadline.hasSame(now, 'day')) {
    return deadline.toRelative({ base: now }) ?? 'overdue today';
  }
  const days = Math.floor(now.startOf('day').diff(deadline.startOf('day'), 'days').days);
  return days === 1 ? '1 day overdue' : `${days} days overdue`;
}

export function PastDueView({ onRefresh, onStatus, refreshToken }: Props) {
  const { setInputFocused } = useInputFocus();
  const { pushUndo } = useUndo();
  const { stdout } = useStdout();
  const [items, setItems] = useState<Item[]>(() => listPastDue());
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>('list');

  useEffect(() => {
    setInputFocused(mode !== 'list');
    return () => setInputFocused(false);
  }, [mode, setInputFocused]);

  useEffect(() => {
    if (refreshToken === undefined || refreshToken === 0) return;
    setItems(listPastDue());
  }, [refreshToken]);

  const refresh = () => {
    setItems(listPastDue());
    onRefresh();
  };

  const sel = Math.min(selected, Math.max(0, items.length - 1));
  const selectedItem = items[sel];
  const viewWidth = Math.max(80, stdout.columns ?? 80) - 4;

  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  const regions = useMemo<ClickRegion[]>(() => {
    if (mode !== 'list') return [];
    return items.map((_, rowIndex) => ({
      row: VIEW_ROW0 + 2 + rowIndex,
      col: 2,
      endCol: viewWidth,
      onClick: () => setSelected(rowIndex),
    }));
  }, [mode, items, viewWidth]);
  useClickRegions('past-due', regions);

  useAppInput(
    (input, key) => {
      if (mode !== 'list') return;

      if (input === 'j' || key.downArrow) setSelected((s) => Math.min(s + 1, items.length - 1));
      if (input === 'k' || key.upArrow) setSelected((s) => Math.max(s - 1, 0));
      if (input === 'e' && selectedItem) setMode('edit');
      if (input === 'x' && selectedItem) {
        const before = cloneItem(selectedItem);
        const id = selectedItem.id;
        toggleDone(id);
        pushUndo(
          before.status === 'open' ? `Marked done: ${before.title}` : `Marked open: ${before.title}`,
          makeUndoToggleDone(before, onStatus),
        );
        refresh();
        autoPush(id, onStatus);
        onStatus('Toggled done');
      }
      if (input === 'd' && selectedItem) {
        const victim = cloneItem(selectedItem);
        deleteItem(victim.id);
        pushUndo(`Deleted: ${victim.title}`, makeUndoDelete(victim, onStatus));
        setSelected((s) => Math.max(0, s - 1));
        refresh();
        autoRemove(victim, onStatus);
        onStatus('Deleted');
      }
      if (input === 's' && selectedItem) setMode('schedule');
    },
    { isActive: mode === 'list' },
  );

  if (mode === 'edit' && selectedItem) {
    const item = selectedItem;
    return (
      <ItemEditor
        mode="edit"
        item={item}
        onCancel={() => setMode('list')}
        onSubmit={(data) => {
          updateItem(item.id, {
            title: data.title,
            notes: data.notes,
            project: data.project,
            tags: data.tags,
            priority: data.priority,
          });
          refresh();
          autoPush(item.id, onStatus);
          onStatus('Task updated');
          setMode('list');
        }}
      />
    );
  }

  if (mode === 'schedule' && selectedItem) {
    const item = selectedItem;
    return (
      <ScheduleEditor
        item={item}
        onCancel={() => setMode('list')}
        onSubmit={(start, end, allDay) => {
          if (allDay) scheduleAllDayItem(item.id, start, end);
          else scheduleItem(item.id, start, end);
          refresh();
          autoPush(item.id, onStatus);
          onStatus(`Scheduled for ${formatDate(start)} ${allDay ? 'all day' : formatScheduleTime(start, end, false)}`);
          setMode('list');
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <ShortcutBar shortcuts={PAST_DUE_SHORTCUTS} context={{}} />
      <Box marginTop={1} flexDirection="column">
        {items.length === 0 ? (
          <Text dimColor>No past due tasks</Text>
        ) : (
          items.map((item, rowIndex) => {
            const selectedHere = rowIndex === sel;
            return (
              <Box key={item.id} flexDirection="column">
                <MarqueeText
                  text={item.title}
                  maxWidth={viewWidth}
                  prefix={selectedHere ? '▸ ' : '  '}
                  active={selectedHere}
                  color={selectedHere ? 'cyan' : 'red'}
                  bold={selectedHere}
                  underline={selectedHere}
                />
                {selectedHere ? (
                  <>
                    <Text color="red" wrap="truncate">
                      {'    ↳ '}
                      {overdueLabel(item)}
                    </Text>
                    <Text dimColor wrap="truncate">
                      {'    ↳ '}
                      {scheduleLabel(item)}
                    </Text>
                    {metaLabel(item) ? (
                      <Text dimColor wrap="truncate">
                        {'    ↳ '}
                        {metaLabel(item)}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text color="red" dimColor={!selectedHere} wrap="truncate">
                    {'  '}
                    {overdueLabel(item)} · {scheduleLabel(item)}
                  </Text>
                )}
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
