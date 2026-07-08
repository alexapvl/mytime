import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { DateTime } from 'luxon';
import type { Item } from '../db/types.js';
import { createEvent, createItem, listScheduledInRange } from '../db/items.js';
import { padToWidth, truncateToWidth } from '../lib/textWidth.js';
import { formatTime, itemSpansDay } from '../lib/time.js';
import { autoPush } from '../google/autoSync.js';
import { ItemEditor } from '../components/ItemEditor.js';
import { EventEditor } from '../components/EventEditor.js';
import { useClickRegions } from '../components/Mouse.js';
import { ScheduleEditor } from '../components/ScheduleEditor.js';
import { hasWeekTime } from '../components/CalendarEventRow.js';
import { ShortcutBar } from '../components/ShortcutBar.js';
import { useInputFocus } from '../context/InputFocusContext.js';
import { useUndo } from '../context/UndoContext.js';
import { useAppInput } from '../hooks/useAppInput.js';
import type { ClickRegion } from '../lib/mouse.js';
import { useViewport } from '../context/ViewportContext.js';
import { MONTH_VIEW_HEADER_ROWS, VIEW_ROW0 } from '../lib/layout.js';
import { MONTH_SHORTCUTS } from '../lib/shortcuts.js';
import { cloneItem, makeUndoAdd } from '../lib/undoActions.js';
import {
  CalendarItemCreator,
  allDayFields,
  draftScheduleItem,
  type PendingEventDraft,
} from './Calendar.js';

type Props = {
  onRefresh: () => void;
  onStatus: (msg: string) => void;
  refreshToken?: number;
  focusedDateISO?: string;
  onFocusedDateChange?: (iso: string) => void;
  onDrillToDaily?: () => void;
};

type MonthMode = 'list' | 'add' | 'quick' | 'addEvent' | 'quickEvent' | 'scheduleNewEvent';

const GRID_COLS = 7;
const MONTH_GRID_ROW = VIEW_ROW0 + 4;

function monthGridDays(monthAnchor: DateTime): DateTime[] {
  const start = monthAnchor.startOf('month').startOf('week');
  const end = monthAnchor.endOf('month').endOf('week');
  const days: DateTime[] = [];
  let d = start;
  while (d <= end) {
    days.push(d);
    d = d.plus({ days: 1 });
  }
  return days;
}

/** Prev/current/next month grids — keeps adjacent months warm for navigation. */
function monthViewLoadRange(monthAnchor: DateTime): { start: string; end: string } {
  const prevGrid = monthGridDays(monthAnchor.minus({ months: 1 }));
  const nextGrid = monthGridDays(monthAnchor.plus({ months: 1 }));
  return {
    start: prevGrid[0]!.startOf('day').toISO()!,
    end: nextGrid[nextGrid.length - 1]!.endOf('day').toISO()!,
  };
}

function clampDayToMonth(day: DateTime, monthAnchor: DateTime): DateTime {
  const monthStart = monthAnchor.startOf('month');
  const monthEnd = monthAnchor.endOf('month');
  const dayNum = Math.min(day.day, monthEnd.day);
  return monthStart.set({ day: dayNum });
}

function cellEventLabel(item: Item, width: number): string {
  const done = item.status === 'done' && item.source === 'task';
  const title = done ? `✓ ${item.title}` : item.title;
  const prefix = hasWeekTime(item) ? `${formatTime(item.start!)} ` : '';
  return truncateToWidth(prefix + title, Math.max(1, width));
}

function cellDateLabel(day: DateTime, selected: boolean, showWeekday: boolean): string {
  const dateNum = String(day.day);
  const weekday = day.toFormat('EEE');
  if (selected) return `▸ ${weekday} ${dateNum}`;
  if (showWeekday) return `${weekday} ${dateNum}`;
  return dateNum;
}

function MonthCell({
  day,
  dayItems,
  cellWidth,
  cellHeight,
  selected,
  inMonth,
  isToday,
  showWeekday,
  borderTop,
  borderLeft,
  borderRight = true,
  borderBottom = true,
}: {
  day: DateTime;
  dayItems: Item[];
  cellWidth: number;
  cellHeight: number;
  selected: boolean;
  inMonth: boolean;
  isToday: boolean;
  showWeekday: boolean;
  borderTop: boolean;
  borderLeft: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
}) {
  const dateLabel = cellDateLabel(day, selected, showWeekday);
  const maxEvents = Math.max(0, cellHeight - 2);
  const visible = dayItems.slice(0, maxEvents);
  const overflow = dayItems.length - visible.length;
  const dateColor = selected ? 'cyanBright' : isToday ? 'cyanBright' : undefined;
  const dim = !inMonth && !selected;

  return (
    <Box
      flexDirection="column"
      width={cellWidth}
      height={cellHeight}
      overflow="hidden"
      borderStyle="single"
      borderColor={selected ? 'cyanBright' : 'gray'}
      borderTop={borderTop}
      borderLeft={borderLeft}
      borderRight={borderRight}
      borderBottom={borderBottom}
    >
      <Box height={1} overflow="hidden">
        <Text
          bold={selected || isToday}
          color={dateColor}
          dimColor={dim && !isToday}
          wrap="truncate"
        >
          {padToWidth(dateLabel, Math.max(1, cellWidth - 2))}
        </Text>
      </Box>
      {visible.map((item) => (
        <Box key={item.id} height={1} overflow="hidden">
          <Text
            dimColor={item.source === 'external' || (item.status === 'done' && item.source === 'task')}
            wrap="truncate"
          >
            {padToWidth(cellEventLabel(item, Math.max(1, cellWidth - 2)), Math.max(1, cellWidth - 2))}
          </Text>
        </Box>
      ))}
      {overflow > 0 ? (
        <Box height={1} overflow="hidden">
          <Text dimColor wrap="truncate">
            {padToWidth(`+${overflow} more`, Math.max(1, cellWidth - 2))}
          </Text>
        </Box>
      ) : null}
      {Array.from({ length: Math.max(0, cellHeight - 1 - visible.length - (overflow > 0 ? 1 : 0)) }, (_, i) => (
        <Box key={`pad-${i}`} height={1}>
          <Text> </Text>
        </Box>
      ))}
    </Box>
  );
}

export function MonthView({
  onRefresh,
  onStatus,
  refreshToken,
  focusedDateISO,
  onFocusedDateChange,
  onDrillToDaily,
}: Props) {
  const { setInputFocused } = useInputFocus();
  const { pushUndo } = useUndo();
  const { contentRows, columns } = useViewport();
  const viewWidth = Math.max(56, columns - 4);
  const cellWidth = Math.max(6, Math.floor(viewWidth / GRID_COLS));

  const [monthAnchor, setMonthAnchor] = useState(() =>
    focusedDateISO
      ? DateTime.fromISO(focusedDateISO).startOf('month')
      : DateTime.local().startOf('month'),
  );
  const [focusedDayISO, setFocusedDayISO] = useState(
    () => focusedDateISO ?? DateTime.local().toISODate()!,
  );
  const [mode, setMode] = useState<MonthMode>('list');
  const [pendingEvent, setPendingEvent] = useState<PendingEventDraft | null>(null);

  const focusedDay = DateTime.fromISO(focusedDayISO).startOf('day');

  const changeFocusedDay = (next: DateTime) => {
    const normalized = next.startOf('day');
    setFocusedDayISO(normalized.toISODate()!);
    onFocusedDateChange?.(normalized.toISODate()!);
    if (!normalized.hasSame(monthAnchor, 'month')) {
      setMonthAnchor(normalized.startOf('month'));
    }
  };

  useEffect(() => {
    if (!focusedDateISO) return;
    const external = DateTime.fromISO(focusedDateISO).startOf('day');
    setFocusedDayISO(external.toISODate()!);
    setMonthAnchor(external.startOf('month'));
  }, [focusedDateISO]);

  useEffect(() => {
    setInputFocused(mode !== 'list');
    return () => setInputFocused(false);
  }, [mode, setInputFocused]);

  const gridDays = useMemo(() => monthGridDays(monthAnchor), [monthAnchor.toISODate()]);
  const loadRange = useMemo(() => monthViewLoadRange(monthAnchor), [monthAnchor.toISODate()]);
  const items = useMemo(
    () => listScheduledInRange(loadRange.start, loadRange.end).filter((i) => i.start),
    [loadRange.start, loadRange.end, refreshToken],
  );
  const weekCount = Math.max(1, Math.ceil(gridDays.length / GRID_COLS));
  const gridBodyRows = Math.max(1, contentRows - MONTH_VIEW_HEADER_ROWS);
  const cellHeight = Math.max(3, Math.floor(gridBodyRows / weekCount));
  const weekdayLabels = useMemo(() => {
    const weekStart = monthAnchor.startOf('month').startOf('week');
    return Array.from({ length: GRID_COLS }, (_, i) => weekStart.plus({ days: i }).toFormat('EEE'));
  }, [monthAnchor.toISODate()]);

  useEffect(() => {
    onRefresh();
  }, [monthAnchor.toISODate()]);

  const refresh = () => onRefresh();

  const itemsByDay = useMemo(
    () =>
      gridDays.map((d) =>
        items.filter((i) => i.start && itemSpansDay(i, d)).sort((a, b) => {
          const aAll = !hasWeekTime(a);
          const bAll = !hasWeekTime(b);
          if (aAll !== bAll) return aAll ? -1 : 1;
          return (a.start ?? '').localeCompare(b.start ?? '');
        }),
      ),
    [gridDays, items],
  );

  const isCurrentMonth = monthAnchor.hasSame(DateTime.local(), 'month');

  const regions = useMemo<ClickRegion[]>(() => {
    const out: ClickRegion[] = [];
    for (let week = 0; week < weekCount; week++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const dayIndex = week * GRID_COLS + col;
        const day = gridDays[dayIndex];
        if (!day) continue;
        const colStart = 2 + col * cellWidth;
        const colEnd = colStart + cellWidth - 1;
        for (let line = 0; line < cellHeight; line++) {
          out.push({
            row: MONTH_GRID_ROW + week * cellHeight + line,
            col: colStart,
            endCol: colEnd,
            onClick: () => changeFocusedDay(day),
          });
        }
      }
    }
    return out;
  }, [weekCount, cellWidth, cellHeight, gridDays]);
  useClickRegions('month', mode !== 'list' ? [] : regions);

  useAppInput(
    (input, key) => {
      if (input === 't') {
        changeFocusedDay(DateTime.local().startOf('day'));
        return;
      }
      if (input === 'h' || key.leftArrow) {
        changeFocusedDay(focusedDay.minus({ days: 1 }));
        return;
      }
      if (input === 'l' || key.rightArrow) {
        changeFocusedDay(focusedDay.plus({ days: 1 }));
        return;
      }
      if (input === 'k' || key.upArrow) {
        changeFocusedDay(focusedDay.minus({ days: 7 }));
        return;
      }
      if (input === 'j' || key.downArrow) {
        changeFocusedDay(focusedDay.plus({ days: 7 }));
        return;
      }
      if (input === 'H' || (key.shift && key.leftArrow)) {
        changeFocusedDay(clampDayToMonth(focusedDay, monthAnchor.minus({ months: 1 })));
        return;
      }
      if (input === 'L' || (key.shift && key.rightArrow)) {
        changeFocusedDay(clampDayToMonth(focusedDay, monthAnchor.plus({ months: 1 })));
        return;
      }
      if (key.return) {
        onDrillToDaily?.();
        return;
      }
      if (input === 'a') {
        setMode('add');
        return;
      }
      if (input === 'q') {
        setMode('quick');
        return;
      }
      if (input === 'A') {
        setMode('addEvent');
        return;
      }
      if (input === 'Q') {
        setMode('quickEvent');
        return;
      }
    },
    { isActive: mode === 'list' },
  );

  if (mode === 'add') {
    return (
      <ItemEditor
        mode="add"
        onCancel={() => setMode('list')}
        onSubmit={(data) => {
          const item = createItem({ ...data, ...allDayFields(focusedDay) });
          setMode('list');
          refresh();
          pushUndo(`Added: ${item.title}`, makeUndoAdd(cloneItem(item), onStatus));
          autoPush(item.id, onStatus);
          onStatus(`Added: ${item.title}`);
        }}
      />
    );
  }

  if (mode === 'quick' || mode === 'quickEvent') {
    return (
      <CalendarItemCreator
        mode={mode}
        kind={mode === 'quickEvent' ? 'event' : 'task'}
        day={focusedDay}
        onCancel={() => setMode('list')}
        onCreated={(item) => {
          setMode('list');
          refresh();
          pushUndo(`Added: ${item.title}`, makeUndoAdd(cloneItem(item), onStatus));
          autoPush(item.id, onStatus);
          onStatus(`Added: ${item.title}`);
        }}
      />
    );
  }

  if (mode === 'addEvent') {
    return (
      <EventEditor
        mode="add"
        onCancel={() => setMode('list')}
        onSubmit={(data) => {
          setPendingEvent(data);
          setMode('scheduleNewEvent');
        }}
      />
    );
  }

  if (mode === 'scheduleNewEvent' && pendingEvent) {
    return (
      <ScheduleEditor
        item={draftScheduleItem(pendingEvent.title)}
        onCancel={() => {
          setPendingEvent(null);
          setMode('list');
        }}
        onSubmit={(start, end, allDay) => {
          const item = createEvent({
            title: pendingEvent.title,
            notes: pendingEvent.notes,
            location: pendingEvent.location,
            reminders: pendingEvent.reminders,
            start,
            end,
            allDay,
          });
          setPendingEvent(null);
          setMode('list');
          refresh();
          pushUndo(`Added: ${item.title}`, makeUndoAdd(cloneItem(item), onStatus));
          autoPush(item.id, onStatus);
          onStatus(`Added event: ${item.title}`);
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        {monthAnchor.toFormat('MMMM yyyy')}
        {isCurrentMonth ? ' (this month)' : ''}
      </Text>
      <ShortcutBar shortcuts={MONTH_SHORTCUTS} context={{ isLocal: false, hasTime: false }} />
      <Box marginTop={1} flexDirection="column" width={cellWidth * GRID_COLS}>
        <Box flexDirection="row" height={1}>
          {weekdayLabels.map((label, col) => (
            <Box
              key={label}
              width={cellWidth}
              height={1}
              borderStyle="single"
              borderColor="gray"
              borderTop
              borderLeft={col === 0}
              borderRight
              borderBottom
            >
              <Text bold dimColor wrap="truncate">
                {padToWidth(label, Math.max(1, cellWidth - 2))}
              </Text>
            </Box>
          ))}
        </Box>
        {Array.from({ length: weekCount }, (_, week) => (
          <Box key={`week-${week}`} flexDirection="row" height={cellHeight}>
            {Array.from({ length: GRID_COLS }, (_, col) => {
              const dayIndex = week * GRID_COLS + col;
              const day = gridDays[dayIndex];
              if (!day) {
                return (
                  <Box
                    key={`empty-${week}-${col}`}
                    width={cellWidth}
                    height={cellHeight}
                    borderStyle="single"
                    borderColor="gray"
                    borderTop={false}
                    borderLeft={col === 0}
                    borderRight
                    borderBottom
                  >
                    <Text> </Text>
                  </Box>
                );
              }
              const dayIndexInGrid = dayIndex;
              const selectedHere = day.hasSame(focusedDay, 'day');
              return (
                <MonthCell
                  key={day.toISODate()}
                  day={day}
                  dayItems={itemsByDay[dayIndexInGrid]!}
                  cellWidth={cellWidth}
                  cellHeight={cellHeight}
                  selected={selectedHere}
                  inMonth={day.hasSame(monthAnchor, 'month')}
                  isToday={day.hasSame(DateTime.local(), 'day')}
                  showWeekday={week === 0}
                  borderTop={selectedHere}
                  borderLeft={col === 0 || selectedHere}
                />
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
