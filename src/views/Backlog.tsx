import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { DateTime } from 'luxon';
import { ItemEditor } from '../components/ItemEditor.js';
import { ScheduleEditor } from '../components/ScheduleEditor.js';
import { COLUMN_DIVIDER_WIDTH, ColumnDivider } from '../components/ColumnDivider.js';
import { ItemDetailLines, itemDetailLineCount } from '../components/ItemDetailLines.js';
import { MarqueeText } from '../components/MarqueeText.js';
import { ShortcutBar } from '../components/ShortcutBar.js';
import { useClickRegions } from '../components/Mouse.js';
import { useInputFocus } from '../context/InputFocusContext.js';
import { useUndo } from '../context/UndoContext.js';
import { useAppInput } from '../hooks/useAppInput.js';
import type { ClickRegion } from '../lib/mouse.js';
import { useViewport } from '../context/ViewportContext.js';
import { BACKLOG_VIEW_HEADER_ROWS, VIEW_ROW0 } from '../lib/layout.js';
import type { Item } from '../db/types.js';
import { createItem, deleteItem, listBacklog, scheduleAllDayItem, scheduleItem, toggleDone, updateItem } from '../db/items.js';
import { autoPush, autoRemove } from '../google/autoSync.js';
import { parseQuickAdd } from '../lib/nlp.js';
import { BACKLOG_SHORTCUTS } from '../lib/shortcuts.js';
import { padToWidth } from '../lib/textWidth.js';
import { formatDate, formatScheduleTime } from '../lib/time.js';
import { cloneItem, makeUndoDelete, makeUndoToggleDone } from '../lib/undoActions.js';

type Props = {
  onRefresh: () => void;
  onStatus: (msg: string) => void;
  refreshToken?: number;
};

type Mode = 'list' | 'add' | 'edit' | 'schedule' | 'quick';

const PRIORITIES: Item['priority'][] = [0, 1, 2, 3];

function itemSortValue(item: Item): number {
  return item.start ? DateTime.fromISO(item.start).toMillis() : Number.POSITIVE_INFINITY;
}

function compareItems(a: Item, b: Item): number {
  const aScheduled = Boolean(a.start);
  const bScheduled = Boolean(b.start);
  if (aScheduled !== bScheduled) return aScheduled ? -1 : 1;

  if (a.start && b.start) {
    const aDay = DateTime.fromISO(a.start).startOf('day').toMillis();
    const bDay = DateTime.fromISO(b.start).startOf('day').toMillis();
    if (aDay !== bDay) return aDay - bDay;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;

    const aTime = itemSortValue(a);
    const bTime = itemSortValue(b);
    if (aTime !== bTime) return aTime - bTime;
  }

  return DateTime.fromISO(a.createdAt).toMillis() - DateTime.fromISO(b.createdAt).toMillis();
}

function itemLabel(item: Item): string {
  return item.title;
}

function selectedIndexInColumn(items: Item[], priority: Item['priority'], itemId: string): number {
  const column = items.filter((item) => item.priority === priority).sort(compareItems);
  const index = column.findIndex((item) => item.id === itemId);
  return Math.max(0, index);
}

function defaultBacklogSelection(items: Item[]): { priority: Item['priority']; index: number } {
  for (const priority of PRIORITIES) {
    if (items.some((item) => item.priority === priority)) return { priority, index: 0 };
  }
  return { priority: 0, index: 0 };
}

export function BacklogView({ onRefresh, onStatus, refreshToken }: Props) {
  const { setInputFocused } = useInputFocus();
  const { pushUndo } = useUndo();
  const { columns: terminalColumns, contentRows } = useViewport();
  const [boot] = useState(() => {
    const items = listBacklog();
    const { priority, index } = defaultBacklogSelection(items);
    return { items, index, priority };
  });
  const [items, setItems] = useState<Item[]>(boot.items);
  const [selected, setSelected] = useState(boot.index);
  const [selectedPriority, setSelectedPriority] = useState<Item['priority']>(boot.priority);
  const [mode, setMode] = useState<Mode>('list');
  const [quickInput, setQuickInput] = useState('');

  useEffect(() => {
    setInputFocused(mode !== 'list');
    return () => setInputFocused(false);
  }, [mode, setInputFocused]);

  useEffect(() => {
    if (refreshToken === undefined || refreshToken === 0) return;
    setItems(listBacklog());
  }, [refreshToken]);

  const refresh = () => {
    setItems(listBacklog());
    onRefresh();
  };

  const focusItem = (item: Item) => {
    const backlog = listBacklog();
    setSelectedPriority(item.priority);
    setSelected(selectedIndexInColumn(backlog, item.priority, item.id));
  };

  const priorityColumns = useMemo(
    () => PRIORITIES.map((priority) => items.filter((item) => item.priority === priority).sort(compareItems)),
    [items],
  );
  const selectedColumnIndex = PRIORITIES.indexOf(selectedPriority);
  const selectedColumn = priorityColumns[selectedColumnIndex] ?? [];
  const selectedItem = selectedColumn[selected];
  const viewWidth = Math.max(80, terminalColumns) - 4;
  const availableWidth = viewWidth - COLUMN_DIVIDER_WIDTH * (PRIORITIES.length - 1);
  const columnWidth = Math.max(16, Math.floor(availableWidth / PRIORITIES.length));
  const columnStarts = PRIORITIES.map(
    (_, columnIndex) => 2 + columnIndex * (columnWidth + COLUMN_DIVIDER_WIDTH),
  );
  const maxItemsPerColumn = Math.max(1, contentRows - BACKLOG_VIEW_HEADER_ROWS - 1);
  const backlogBodyLines = useMemo(
    () =>
      priorityColumns.map((column, columnIndex) => {
        const visible = column.slice(0, maxItemsPerColumn);
        if (visible.length === 0) return 1;
        let lines = 0;
        visible.forEach((item, rowIndex) => {
          lines += 1;
          if (columnIndex === selectedColumnIndex && rowIndex === selected) {
            lines += itemDetailLineCount(item);
          }
        });
        return lines;
      }),
    [priorityColumns, maxItemsPerColumn, selectedColumnIndex, selected],
  );
  const maxBodyLines = Math.max(1, ...backlogBodyLines);

  const movePriority = (direction: -1 | 1, targetRow: 'same' | 'first' | 'last' = 'same') => {
    if (targetRow === 'same') {
      const nextColumn = selectedColumnIndex + direction;
      if (nextColumn < 0 || nextColumn >= priorityColumns.length) return;
      const targetColumn = priorityColumns[nextColumn] ?? [];
      setSelectedPriority(PRIORITIES[nextColumn]!);
      setSelected((row) => Math.min(row, Math.max(0, targetColumn.length - 1)));
      return;
    }

    let nextColumn = selectedColumnIndex + direction;
    while (nextColumn >= 0 && nextColumn < priorityColumns.length) {
      const targetColumn = priorityColumns[nextColumn] ?? [];
      if (targetColumn.length > 0) {
        setSelectedPriority(PRIORITIES[nextColumn]!);
        setSelected(targetRow === 'first' ? 0 : targetColumn.length - 1);
        return;
      }
      nextColumn += direction;
    }
  };

  const moveVertical = (direction: -1 | 1) => {
    if (direction === 1) {
      if (selected < selectedColumn.length - 1) setSelected((s) => s + 1);
      else movePriority(1, 'first');
      return;
    }

    if (selected > 0) setSelected((s) => s - 1);
    else movePriority(-1, 'last');
  };

  const moveSelectedPriority = (direction: -1 | 1) => {
    if (!selectedItem) return;
    const nextColumn = selectedColumnIndex + direction;
    if (nextColumn < 0 || nextColumn >= PRIORITIES.length) return;

    const nextPriority = PRIORITIES[nextColumn]!;
    const movedId = selectedItem.id;
    updateItem(movedId, { priority: nextPriority });
    const nextIndex = selectedIndexInColumn(listBacklog(), nextPriority, movedId);
    setSelectedPriority(nextPriority);
    setSelected(nextIndex);
    refresh();
    autoPush(movedId, onStatus);
    onStatus(`Moved to P${nextPriority}`);
  };

  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, selectedColumn.length - 1)));
  }, [selectedColumn.length]);

  // The help line sits on VIEW_ROW0; headers and items follow on subsequent rows.
  const regions = useMemo<ClickRegion[]>(() => {
    if (mode !== 'list') return [];
    return priorityColumns.flatMap((column, columnIndex) => {
      const colStart = columnStarts[columnIndex]!;
      const colEnd = colStart + columnWidth - 1;
      const visible = column.slice(0, maxItemsPerColumn);
      const header = {
        row: VIEW_ROW0 + 2,
        col: colStart,
        endCol: colEnd,
        onClick: () => {
          setSelectedPriority(PRIORITIES[columnIndex]!);
          setSelected(0);
        },
      };
      let row = VIEW_ROW0 + 3;
      if (visible.length === 0) {
        return [
          header,
          {
            row,
            col: colStart,
            endCol: colEnd,
            onClick: () => {
              setSelectedPriority(PRIORITIES[columnIndex]!);
              setSelected(0);
            },
          },
        ];
      }
      return [
        header,
        ...visible.map((item, rowIndex) => {
          const region = {
            row,
            col: colStart,
            endCol: colEnd,
            onClick: () => {
              setSelectedPriority(PRIORITIES[columnIndex]!);
              setSelected(rowIndex);
            },
          };
          row += 1;
          if (columnIndex === selectedColumnIndex && rowIndex === selected) {
            row += itemDetailLineCount(item);
          }
          return region;
        }),
      ];
    });
  }, [mode, priorityColumns, columnStarts, columnWidth, maxItemsPerColumn, selectedColumnIndex, selected]);
  useClickRegions('backlog', regions);

  useAppInput(
    (input, key) => {
      if (mode === 'quick') {
        if (key.escape) {
          setMode('list');
          setQuickInput('');
        }
        return;
      }
      if (mode !== 'list') return;

      if (input === 'H' || (key.shift && key.leftArrow)) {
        moveSelectedPriority(-1);
        return;
      }
      if (input === 'L' || (key.shift && key.rightArrow)) {
        moveSelectedPriority(1);
        return;
      }
      if (input === 'j' || key.downArrow) moveVertical(1);
      if (input === 'k' || key.upArrow) moveVertical(-1);
      if (input === 'h' || key.leftArrow) movePriority(-1);
      if (input === 'l' || key.rightArrow) movePriority(1);
      if (input === 'a') setMode('add');
      if (input === 'q') setMode('quick');
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
    { isActive: mode === 'list' || mode === 'quick' },
  );

  if (mode === 'quick') {
    return (
      <Box flexDirection="column">
        <Text color="cyan">Quick add (NLP):</Text>
        <Text dimColor>e.g. "review PR tomorrow 3pm @work p2 #swe"</Text>
        <Box marginTop={1}>
          <Text>&gt; </Text>
          <TextInput
            value={quickInput}
            onChange={setQuickInput}
            onSubmit={(val) => {
              const parsed = parseQuickAdd(val);
              const priority = /\bp[0-3]\b/i.test(val) ? parsed.priority : selectedPriority;
              const created = createItem({
                title: parsed.title,
                tags: parsed.tags,
                project: parsed.project,
                priority,
                start: parsed.start,
                end: parsed.end,
                allDay: parsed.allDay,
              });
              focusItem(created);
              refresh();
              if (created.start) autoPush(created.id, onStatus);
              onStatus(`Added: ${parsed.title}`);
              setQuickInput('');
              setMode('list');
            }}
          />
        </Box>
      </Box>
    );
  }

  if (mode === 'add') {
    return (
      <ItemEditor
        mode="add"
        defaultPriority={selectedPriority}
        onCancel={() => setMode('list')}
        onSubmit={(data) => {
          const created = createItem({
            title: data.title,
            notes: data.notes,
            project: data.project,
            tags: data.tags,
            priority: data.priority,
          });
          focusItem(created);
          refresh();
          onStatus('Task added');
          setMode('list');
        }}
      />
    );
  }

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
      <ShortcutBar shortcuts={BACKLOG_SHORTCUTS} context={{ scheduled: Boolean(selectedItem?.start) }} />
      <Box marginTop={1} flexDirection="column" width={viewWidth}>
        <Box flexDirection="row">
          {PRIORITIES.map((priority, columnIndex) => {
            const columnSelected = columnIndex === selectedColumnIndex;
            return (
              <React.Fragment key={`backlog-head-${priority}`}>
                {columnIndex > 0 ? (
                  <Box width={COLUMN_DIVIDER_WIDTH} height={1}>
                    <Text color="gray" wrap="truncate">
                      {padToWidth('│', COLUMN_DIVIDER_WIDTH)}
                    </Text>
                  </Box>
                ) : null}
                <Box width={columnWidth} height={1}>
                  <Text bold color={columnSelected ? 'cyan' : undefined} wrap="truncate">
                    {padToWidth(`P${priority}`, columnWidth)}
                  </Text>
                </Box>
              </React.Fragment>
            );
          })}
        </Box>
        <Box flexDirection="row" alignItems="flex-start">
          {priorityColumns.map((column, columnIndex) => {
            const visible = column.slice(0, maxItemsPerColumn);
            const columnSelected = columnIndex === selectedColumnIndex;
            return (
              <React.Fragment key={`backlog-col-${PRIORITIES[columnIndex]}`}>
                {columnIndex > 0 ? <ColumnDivider lines={maxBodyLines} /> : null}
                <Box flexDirection="column" width={columnWidth}>
                  {visible.length === 0 ? (
                    <Box height={1}>
                      <Text color={columnSelected ? 'cyan' : undefined} dimColor={!columnSelected} wrap="truncate">
                        {padToWidth(columnSelected ? '▸ —' : '—', columnWidth)}
                      </Text>
                    </Box>
                  ) : (
                    visible.map((item, rowIndex) => {
                      const selectedHere = columnSelected && rowIndex === selected;
                      return (
                        <Box key={item.id} flexDirection="column">
                          <Box height={1}>
                            <MarqueeText
                              text={itemLabel(item)}
                              maxWidth={columnWidth}
                              active={selectedHere}
                              color={selectedHere ? 'cyan' : undefined}
                              bold={selectedHere}
                              underline={selectedHere}
                            />
                          </Box>
                          {selectedHere ? <ItemDetailLines item={item} maxWidth={columnWidth} /> : null}
                        </Box>
                      );
                    })
                  )}
                </Box>
              </React.Fragment>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
