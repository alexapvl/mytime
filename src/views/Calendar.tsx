import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { DateTime } from 'luxon';
import type { Item } from '../db/types.js';
import { createItem, deleteItem, listScheduledInRange, scheduleAllDayItem, scheduleItem, toggleDone, updateItem } from '../db/items.js';
import { addMinutes, allDayRange, formatScheduleTime, formatTime, hourLabels, isSameDay } from '../lib/time.js';
import { autoPush, autoRemove } from '../google/autoSync.js';
import { ItemEditor } from '../components/ItemEditor.js';
import { useClickRegions } from '../components/Mouse.js';
import { ScheduleEditor } from '../components/ScheduleEditor.js';
import { MarqueeText } from '../components/MarqueeText.js';
import { ShortcutBar } from '../components/ShortcutBar.js';
import { useInputFocus } from '../context/InputFocusContext.js';
import { useUndo } from '../context/UndoContext.js';
import { useAppInput } from '../hooks/useAppInput.js';
import type { ClickRegion } from '../lib/mouse.js';
import { VIEW_ROW0 } from '../lib/layout.js';
import { parseQuickAdd } from '../lib/nlp.js';
import { DAILY_SHORTCUTS, WEEK_SHORTCUTS } from '../lib/shortcuts.js';
import { cloneItem, makeUndoDelete, makeUndoToggleDone } from '../lib/undoActions.js';

type Props = {
  onRefresh: () => void;
  onStatus: (msg: string) => void;
  refreshToken?: number;
};
type CalendarMode = 'list' | 'add' | 'quick';

/** Index of the next upcoming item (start >= now). Items are sorted ascending by start. */
function nearestIndexToNow(items: Item[]): number {
  if (items.length === 0) return 0;
  const now = DateTime.local().toMillis();
  const upcoming = items.findIndex((item) => item.start && DateTime.fromISO(item.start).toMillis() >= now);
  // All events are in the past — fall back to the most recent one.
  return upcoming === -1 ? items.length - 1 : upcoming;
}

function scheduledForDay(day: DateTime): Item[] {
  return listScheduledInRange(day.startOf('day').toISO()!, day.endOf('day').toISO()!).filter((i) => i.start);
}

function findAdjacentDayItem(anchorDay: DateTime, dir: 1 | -1): { day: DateTime; item: Item } | null {
  for (let step = 1; step <= 366; step++) {
    const nextDay = anchorDay.plus({ days: dir * step });
    const dayItems = scheduledForDay(nextDay);
    if (dayItems.length > 0) {
      return { day: nextDay, item: dir === 1 ? dayItems[0]! : dayItems[dayItems.length - 1]! };
    }
  }
  return null;
}

// DayView: header(VIEW_ROW0) help(+1) [blank from marginTop] content(+3 onward)
const DAY_CONTENT_ROW = VIEW_ROW0 + 3;
// WeekView: header help [blank] day-names(+3) events(+4 onward)
const WEEK_EVENTS_ROW = VIEW_ROW0 + 4;
const WEEK_COLUMN_GAP = 1;
const WEEK_FOCUS_WEIGHT = 2;

const DONE_PREFIX = '✓ ';

function displayTitle(item: Item): string {
  return item.status === 'done' && item.source === 'task' ? `${DONE_PREFIX}${item.title}` : item.title;
}

function isDoneTask(item: Item): boolean {
  return item.status === 'done' && item.source === 'task';
}

function hasWeekTime(item: Item): boolean {
  if (item.allDay || !item.start || !item.end) return false;
  const start = DateTime.fromISO(item.start);
  const end = DateTime.fromISO(item.end);
  return !(start.hour === 0 && start.minute === 0 && end.hour === 0 && end.minute === 0);
}

function allDayFields(day: DateTime): { start: string; end: string; allDay: true } {
  const range = allDayRange(day.toISO()!);
  return { ...range, allDay: true };
}

function createCalendarItemFromQuickAdd(input: string, day: DateTime): Item {
  const parsed = parseQuickAdd(input, day.startOf('day').toJSDate());
  const fallback = allDayFields(day);
  return createItem({
    title: parsed.title,
    tags: parsed.tags,
    project: parsed.project,
    priority: parsed.priority,
    start: parsed.start ?? fallback.start,
    end: parsed.end ?? fallback.end,
    allDay: parsed.start ? parsed.allDay : true,
  });
}

function CalendarTaskCreator({
  mode,
  day,
  onCancel,
  onCreated,
}: {
  mode: Exclude<CalendarMode, 'list'>;
  day: DateTime;
  onCancel: () => void;
  onCreated: (item: Item) => void;
}) {
  const [quickInput, setQuickInput] = useState('');
  useAppInput((_input, key) => {
    if (key.escape) onCancel();
  });

  if (mode === 'quick') {
    return (
      <Box flexDirection="column">
        <Text color="cyan">Quick add for {day.toFormat('EEE d MMM')}:</Text>
        <Text dimColor>Time-only input uses this day. No time makes an all-day task.</Text>
        <Box marginTop={1}>
          <Text>&gt; </Text>
          <TextInput
            value={quickInput}
            onChange={setQuickInput}
            onSubmit={(val) => {
              if (val.trim()) onCreated(createCalendarItemFromQuickAdd(val, day));
            }}
          />
        </Box>
      </Box>
    );
  }

  return (
    <ItemEditor
      mode="add"
      onCancel={onCancel}
      onSubmit={(data) => {
        const fields = allDayFields(day);
        onCreated(createItem({ ...data, ...fields }));
      }}
    />
  );
}


export function DayView({ onRefresh, onStatus, refreshToken }: Props) {
  const { setInputFocused } = useInputFocus();
  const { pushUndo } = useUndo();
  const [day, setDay] = useState(() => DateTime.local().startOf('day'));
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<CalendarMode>('list');
  const [editing, setEditing] = useState<Item | null>(null);
  const pendingSelectRef = useRef<'first' | 'last' | 'nearest'>('nearest');

  useEffect(() => {
    setInputFocused(editing !== null || mode !== 'list');
    return () => setInputFocused(false);
  }, [editing, mode, setInputFocused]);

  useEffect(() => {
    const loaded = listScheduledInRange(day.startOf('day').toISO()!, day.endOf('day').toISO()!);
    setItems(loaded);
    const dayItems = loaded.filter((i) => i.start);
    const anchor = pendingSelectRef.current;
    pendingSelectRef.current = 'nearest';
    if (anchor === 'first') setSelected(0);
    else if (anchor === 'last') setSelected(Math.max(0, dayItems.length - 1));
    else setSelected(nearestIndexToNow(loaded));
    onRefresh();
  }, [day.toISODate()]);

  useEffect(() => {
    if (refreshToken === undefined || refreshToken === 0) return;
    setItems(listScheduledInRange(day.startOf('day').toISO()!, day.endOf('day').toISO()!));
  }, [refreshToken]);

  const refresh = () => {
    setItems(listScheduledInRange(day.startOf('day').toISO()!, day.endOf('day').toISO()!));
    onRefresh();
  };

  const scheduled = items.filter((i) => i.start);
  const hours = hourLabels();
  const isToday = day.hasSame(DateTime.local(), 'day');
  const sel = Math.min(selected, Math.max(0, scheduled.length - 1));
  const selectedDayItem = scheduled[sel];

  // Build the rendered line list so click rows stay in sync with the layout.
  const lines = useMemo(() => {
    const out: { key: string; hour: string; item?: Item }[] = [];
    scheduled.filter((item) => !hasWeekTime(item)).forEach((item) => out.push({ key: item.id, hour: 'all day', item }));
    hours.forEach((hour, hi) => {
      const blocks = scheduled.filter((item) => hasWeekTime(item) && item.start && DateTime.fromISO(item.start).hour === hi);
      if (blocks.length === 0) {
        out.push({ key: `empty-${hour}`, hour });
      } else {
        blocks.forEach((item) => out.push({ key: item.id, hour, item }));
      }
    });
    return out;
  }, [scheduled, hours]);

  const regions = useMemo<ClickRegion[]>(
    () =>
      lines
        .map((line, idx) =>
          line.item
            ? { row: DAY_CONTENT_ROW + idx, onClick: () => setSelected(scheduled.indexOf(line.item!)) }
            : null,
        )
        .filter((r): r is ClickRegion => r !== null),
    [lines, scheduled],
  );
  useClickRegions('day', editing ? [] : regions);

  useAppInput(
    (input, key) => {
      if (input === 't') {
        setDay(DateTime.local().startOf('day'));
        return;
      }
      if (input === 'h' || key.leftArrow) {
        setDay((d) => d.minus({ days: 1 }));
        return;
      }
      if (input === 'l' || key.rightArrow) {
        setDay((d) => d.plus({ days: 1 }));
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

      const moveVertical = (dir: 1 | -1) => {
        if (scheduled.length > 0) {
          if (dir === 1 && sel < scheduled.length - 1) {
            setSelected((s) => s + 1);
            return;
          }
          if (dir === -1 && sel > 0) {
            setSelected((s) => s - 1);
            return;
          }
        }

        const anchor = dir === 1 ? 'first' : 'last';
        const adjacent = findAdjacentDayItem(day, dir);
        if (adjacent) {
          pendingSelectRef.current = anchor;
          setDay(adjacent.day.startOf('day'));
        }
      };

      if (input === 'j' || key.downArrow) {
        moveVertical(1);
        return;
      }
      if (input === 'k' || key.upArrow) {
        moveVertical(-1);
        return;
      }

      if (scheduled.length === 0) return;

      const item = scheduled[sel];
      if (input === 'J' || (key.shift && key.downArrow)) {
        if (item?.start && item.end && item.source === 'task' && hasWeekTime(item)) {
          updateItem(item.id, { start: addMinutes(item.start, 60), end: addMinutes(item.end, 60) });
          refresh();
          autoPush(item.id, onStatus);
          onStatus('Moved 1h later');
        }
        return;
      }
      if (input === 'K' || (key.shift && key.upArrow)) {
        if (item?.start && item.end && item.source === 'task' && hasWeekTime(item)) {
          updateItem(item.id, { start: addMinutes(item.start, -60), end: addMinutes(item.end, -60) });
          refresh();
          autoPush(item.id, onStatus);
          onStatus('Moved 1h earlier');
        }
        return;
      }

      if (!item?.start || !item.end || item.source === 'external') return;

      if (input === 's') {
        setEditing(item);
        return;
      }
      if (input === 'x') {
        const before = cloneItem(item);
        toggleDone(item.id);
        pushUndo(
          before.status === 'open' ? `Marked done: ${before.title}` : `Marked open: ${before.title}`,
          makeUndoToggleDone(before, onStatus),
        );
        refresh();
        autoPush(item.id, onStatus);
        onStatus('Marked done');
        return;
      }
      if (input === 'd') {
        const victim = cloneItem(item);
        deleteItem(victim.id);
        pushUndo(`Deleted: ${victim.title}`, makeUndoDelete(victim, onStatus));
        setSelected((s) => Math.max(0, s - 1));
        refresh();
        autoRemove(victim, onStatus);
        onStatus('Deleted');
        return;
      }
      if (!hasWeekTime(item)) return;
      if (input === '+' || input === '=') {
        updateItem(item.id, { end: addMinutes(item.end, 15) });
        refresh();
        autoPush(item.id, onStatus);
      }
      if (input === '-') {
        const newEnd = addMinutes(item.end, -15);
        if (DateTime.fromISO(newEnd) > DateTime.fromISO(item.start)) {
          updateItem(item.id, { end: newEnd });
          refresh();
          autoPush(item.id, onStatus);
        }
      }
    },
    { isActive: editing === null && mode === 'list' },
  );

  if (mode !== 'list') {
    return (
      <CalendarTaskCreator
        mode={mode}
        day={day}
        onCancel={() => setMode('list')}
        onCreated={(item) => {
          setMode('list');
          refresh();
          autoPush(item.id, onStatus);
          onStatus(`Added: ${item.title}`);
        }}
      />
    );
  }

  if (editing) {
    const target = editing;
    return (
      <ScheduleEditor
        item={target}
        onCancel={() => setEditing(null)}
        onSubmit={(start, end, allDay) => {
          if (allDay) scheduleAllDayItem(target.id, start, end);
          else scheduleItem(target.id, start, end);
          setEditing(null);
          refresh();
          autoPush(target.id, onStatus);
          onStatus('Rescheduled');
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        {day.toFormat('EEE MMM d, yyyy')} {isToday ? '(today)' : ''}
      </Text>
      <ShortcutBar
        shortcuts={DAILY_SHORTCUTS}
        context={{
          isTask: selectedDayItem?.source === 'task',
          hasTime: selectedDayItem ? hasWeekTime(selectedDayItem) : false,
        }}
      />
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line) => {
          if (!line.item) {
            return (
              <Text key={line.key} dimColor>
                {line.hour} ·
              </Text>
            );
          }
          const item = line.item;
          const idx = scheduled.indexOf(item);
          const selectedHere = idx === sel;
          const external = item.source === 'external';
          const done = isDoneTask(item);
          const title = displayTitle(item);
          return (
            <Text
              key={line.key}
              color={selectedHere ? 'cyan' : external ? 'magenta' : 'white'}
              bold={selectedHere}
              dimColor={(external && !selectedHere) || (done && !selectedHere)}
              underline={selectedHere}
            >
              {line.hour} {selectedHere ? '▸ ' : '· '}
              {!hasWeekTime(item) ? title : `${formatTime(item.end!)} ${title}`}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}

export function WeekView({ onRefresh, onStatus, refreshToken }: Props) {
  const { setInputFocused } = useInputFocus();
  const { pushUndo } = useUndo();
  const { stdout } = useStdout();
  const [weekStart, setWeekStart] = useState(() => DateTime.local().startOf('week'));
  const [focusedDayISO, setFocusedDayISO] = useState(() => DateTime.local().toISODate()!);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<CalendarMode>('list');
  const [editing, setEditing] = useState<Item | null>(null);
  const pendingItemIdRef = useRef<string | null>(null);
  const weekSelectIntentRef = useRef<{ dayISO: string; select: 'first' | 'last' } | null>(null);

  useEffect(() => {
    setInputFocused(editing !== null || mode !== 'list');
    return () => setInputFocused(false);
  }, [editing, mode, setInputFocused]);

  useEffect(() => {
    const loaded = listScheduledInRange(weekStart.toISO()!, weekStart.endOf('week').toISO()!);
    setItems(loaded);
    const scheduledLoaded = loaded.filter((i) => i.start);
    const pendingId = pendingItemIdRef.current;
    if (pendingId) {
      pendingItemIdRef.current = null;
      const idx = scheduledLoaded.findIndex((i) => i.id === pendingId);
      if (idx >= 0) setSelected(idx);
    } else if (weekSelectIntentRef.current) {
      const { dayISO, select } = weekSelectIntentRef.current;
      weekSelectIntentRef.current = null;
      const dayItems = scheduledLoaded.filter((i) => i.start && isSameDay(i.start, dayISO));
      if (dayItems.length > 0) {
        const target = select === 'last' ? dayItems[dayItems.length - 1]! : dayItems[0]!;
        setSelected(scheduledLoaded.indexOf(target));
      }
    }
    onRefresh();
  }, [weekStart.toISODate()]);

  useEffect(() => {
    if (refreshToken === undefined || refreshToken === 0) return;
    setItems(listScheduledInRange(weekStart.toISO()!, weekStart.endOf('week').toISO()!));
  }, [refreshToken]);

  const refresh = () => {
    setItems(listScheduledInRange(weekStart.toISO()!, weekStart.endOf('week').toISO()!));
    onRefresh();
  };

  const days = Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i }));
  const focusedDay = DateTime.fromISO(focusedDayISO).startOf('day');
  const scheduled = useMemo(() => items.filter((i) => i.start), [items]);
  const sel = Math.min(selected, Math.max(0, scheduled.length - 1));
  const selectedCandidate = scheduled[sel];
  const selectedWeekItem = selectedCandidate?.start && isSameDay(selectedCandidate.start, focusedDay.toISO()!) ? selectedCandidate : undefined;
  const selectedDayIndex = Math.max(0, days.findIndex((d) => d.hasSame(focusedDay, 'day')));
  const viewWidth = Math.max(80, stdout.columns ?? 80) - 4;
  const availableWidth = viewWidth - WEEK_COLUMN_GAP * (days.length - 1);
  const totalWeight = days.length + WEEK_FOCUS_WEIGHT - 1;
  const dayWidths = days.map((_, dayIndex) =>
    Math.max(8, Math.floor((availableWidth * (dayIndex === selectedDayIndex ? WEEK_FOCUS_WEIGHT : 1)) / totalWeight)),
  );
  const usedWidth = dayWidths.reduce((sum, width) => sum + width, 0);
  if (usedWidth < availableWidth) {
    dayWidths[selectedDayIndex] += availableWidth - usedWidth;
  }
  const dayStarts = dayWidths.reduce<number[]>((starts, width, dayIndex) => {
    starts.push(dayIndex === 0 ? 2 : starts[dayIndex - 1]! + dayWidths[dayIndex - 1]! + WEEK_COLUMN_GAP);
    return starts;
  }, []);

  const regions = useMemo<ClickRegion[]>(() => {
    const out: ClickRegion[] = [];
    days.forEach((d, dayIndex) => {
      const colStart = dayStarts[dayIndex]!;
      const dayWidth = dayWidths[dayIndex]!;
      const dayItems = scheduled.filter((i) => i.start && isSameDay(i.start, d.toISO()!));
      out.push({
        row: WEEK_EVENTS_ROW - 1,
        col: colStart,
        endCol: colStart + dayWidth - 1,
        onClick: () => {
          setFocusedDayISO(d.toISODate()!);
          if (dayItems.length > 0) setSelected(scheduled.indexOf(dayItems[0]!));
        },
      });
      dayItems.forEach((item, ei) => {
        out.push({
          row: WEEK_EVENTS_ROW + ei,
          col: colStart,
          endCol: colStart + dayWidth - 1,
          onClick: () => {
            setFocusedDayISO(d.toISODate()!);
            setSelected(scheduled.indexOf(item));
          },
        });
      });
    });
    return out;
  }, [scheduled, weekStart.toISODate(), dayStarts, dayWidths]);
  useClickRegions('week', editing ? [] : regions);

  useAppInput(
    (input, key) => {
      const focusDay = (next: DateTime, select: 'first' | 'last' | 'keep' = 'first') => {
        const d = next.startOf('day');
        const newWeekStart = d.startOf('week');
        setFocusedDayISO(d.toISODate()!);

        if (!newWeekStart.hasSame(weekStart, 'day')) {
          if (select !== 'keep') weekSelectIntentRef.current = { dayISO: d.toISODate()!, select };
          setWeekStart(newWeekStart);
          return;
        }

        if (select === 'keep') return;
        const dayItems = scheduled.filter((i) => i.start && isSameDay(i.start, d.toISO()!));
        if (dayItems.length > 0) {
          const target = select === 'last' ? dayItems[dayItems.length - 1]! : dayItems[0]!;
          setSelected(scheduled.indexOf(target));
        }
      };

      if (input === 't') {
        focusDay(DateTime.local(), 'first');
        return;
      }
      if (input === 'h' || input === 'H' || key.leftArrow) {
        focusDay(focusedDay.minus({ days: key.shift || input === 'H' ? 7 : 1 }), 'first');
        return;
      }
      if (input === 'l' || input === 'L' || key.rightArrow) {
        focusDay(focusedDay.plus({ days: key.shift || input === 'L' ? 7 : 1 }), 'first');
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

      const moveVertical = (dir: 1 | -1) => {
        const dayItems = scheduled.filter((i) => i.start && isSameDay(i.start, focusedDay.toISO()!));
        const pos = selectedWeekItem ? dayItems.indexOf(selectedWeekItem) : dir === 1 ? -1 : dayItems.length;
        const next = dayItems[pos + dir];
        if (next) {
          setSelected(scheduled.indexOf(next));
          return;
        }

        for (let dayIndex = selectedDayIndex + dir; dayIndex >= 0 && dayIndex < days.length; dayIndex += dir) {
          const targetDayItems = scheduled.filter((i) => i.start && isSameDay(i.start, days[dayIndex]!.toISO()!));
          const target = dir === 1 ? targetDayItems[0] : targetDayItems[targetDayItems.length - 1];
          if (target) {
            setFocusedDayISO(days[dayIndex]!.toISODate()!);
            setSelected(scheduled.indexOf(target));
            return;
          }
        }

        const adjacent = findAdjacentDayItem(focusedDay, dir);
        if (!adjacent) return;
        pendingItemIdRef.current = adjacent.item.id;
        setFocusedDayISO(adjacent.day.toISODate()!);
        setWeekStart(adjacent.day.startOf('week'));
      };
      if (input === 'j' || key.downArrow) moveVertical(1);
      if (input === 'k' || key.upArrow) moveVertical(-1);

      const item = selectedWeekItem;
      if (!item?.start || !item.end || item.source === 'external') return;

      if (input === 's') {
        setEditing(item);
        return;
      }
      if (input === 'x') {
        const before = cloneItem(item);
        toggleDone(item.id);
        pushUndo(
          before.status === 'open' ? `Marked done: ${before.title}` : `Marked open: ${before.title}`,
          makeUndoToggleDone(before, onStatus),
        );
        refresh();
        autoPush(item.id, onStatus);
        onStatus('Marked done');
        return;
      }
      if (input === 'd') {
        const victim = cloneItem(item);
        deleteItem(victim.id);
        pushUndo(`Deleted: ${victim.title}`, makeUndoDelete(victim, onStatus));
        setSelected((s) => Math.max(0, s - 1));
        refresh();
        autoRemove(victim, onStatus);
        onStatus('Deleted');
        return;
      }
    },
    { isActive: editing === null && mode === 'list' },
  );

  if (mode !== 'list') {
    return (
      <CalendarTaskCreator
        mode={mode}
        day={focusedDay}
        onCancel={() => setMode('list')}
        onCreated={(item) => {
          setMode('list');
          refresh();
          autoPush(item.id, onStatus);
          onStatus(`Added: ${item.title}`);
        }}
      />
    );
  }

  if (editing) {
    const target = editing;
    return (
      <ScheduleEditor
        item={target}
        onCancel={() => setEditing(null)}
        onSubmit={(start, end, allDay) => {
          if (allDay) scheduleAllDayItem(target.id, start, end);
          else scheduleItem(target.id, start, end);
          setEditing(null);
          refresh();
          autoPush(target.id, onStatus);
          onStatus('Rescheduled');
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        Week of {weekStart.toFormat('MMM d')} – {weekStart.endOf('week').toFormat('MMM d, yyyy')}
      </Text>
      <ShortcutBar shortcuts={WEEK_SHORTCUTS} context={{ isTask: selectedWeekItem?.source === 'task' }} />
      <Box marginTop={1}>
        {days.map((d) => {
          const dayItems = scheduled.filter((i) => i.start && isSameDay(i.start, d.toISO()!));
          const dayIndex = days.indexOf(d);
          return (
            <Box key={d.toISODate()} flexDirection="column" marginRight={WEEK_COLUMN_GAP} width={dayWidths[dayIndex]!}>
              <Text
                bold
                color={dayIndex === selectedDayIndex || d.hasSame(DateTime.local(), 'day') ? 'cyan' : undefined}
                underline={dayIndex === selectedDayIndex && dayItems.length === 0}
              >
                {d.toFormat('EEE d MMM')}
                {d.hasSame(DateTime.local(), 'day') ? ' (today)' : ''}
              </Text>
              {dayItems.length === 0 ? (
                <Text color={dayIndex === selectedDayIndex ? 'cyan' : undefined} dimColor={dayIndex !== selectedDayIndex}>
                  {dayIndex === selectedDayIndex ? '▸ —' : '—'}
                </Text>
              ) : (
                dayItems.map((item) => {
                  const idx = scheduled.indexOf(item);
                  const external = item.source === 'external';
                  const done = isDoneTask(item);
                  const selectedHere = selectedWeekItem?.id === item.id;
                  const showTime = dayIndex === selectedDayIndex;
                  const prefix = showTime && hasWeekTime(item) ? `${formatScheduleTime(item.start!, item.end, item.allDay)} ` : '';
                  return (
                    <Box key={item.id} flexDirection="column">
                      <MarqueeText
                        text={displayTitle(item)}
                        maxWidth={dayWidths[dayIndex]!}
                        prefix={prefix}
                        active={selectedHere}
                        color={selectedHere ? 'cyan' : external ? 'magenta' : undefined}
                        dimColor={(external && !selectedHere) || (done && !selectedHere)}
                        underline={selectedHere}
                      />
                    </Box>
                  );
                })
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
