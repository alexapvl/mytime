import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { DateTime } from 'luxon';
import type { Item } from '../db/types.js';
import { listScheduledInRange, scheduleAllDayItem, scheduleItem, toggleDone, unscheduleItem, updateItem } from '../db/items.js';
import { addMinutes, formatScheduleTime, formatTime, hourLabels, isSameDay } from '../lib/time.js';
import { autoPush, autoRemove } from '../google/autoSync.js';
import { useClickRegions } from '../components/Mouse.js';
import { ScheduleEditor } from '../components/ScheduleEditor.js';
import { useInputFocus } from '../context/InputFocusContext.js';
import { useAppInput } from '../hooks/useAppInput.js';
import type { ClickRegion } from '../lib/mouse.js';
import { VIEW_ROW0, weekColStart, WEEK_COL_WIDTH } from '../lib/layout.js';

type Props = {
  onRefresh: () => void;
  onStatus: (msg: string) => void;
};

/** Index of the next upcoming item (start >= now). Items are sorted ascending by start. */
function nearestIndexToNow(items: Item[]): number {
  if (items.length === 0) return 0;
  const now = DateTime.local().toMillis();
  const upcoming = items.findIndex((item) => item.start && DateTime.fromISO(item.start).toMillis() >= now);
  // All events are in the past — fall back to the most recent one.
  return upcoming === -1 ? items.length - 1 : upcoming;
}

// DayView: header(VIEW_ROW0) help(+1) [blank from marginTop] content(+3 onward)
const DAY_CONTENT_ROW = VIEW_ROW0 + 3;
// WeekView: header help [blank] day-names(+3) events(+4 onward)
const WEEK_EVENTS_ROW = VIEW_ROW0 + 4;

export function DayView({ onRefresh, onStatus }: Props) {
  const { setInputFocused } = useInputFocus();
  const [day, setDay] = useState(() => DateTime.local().startOf('day'));
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState<Item | null>(null);

  useEffect(() => {
    setInputFocused(editing !== null);
    return () => setInputFocused(false);
  }, [editing, setInputFocused]);

  useEffect(() => {
    const loaded = listScheduledInRange(day.startOf('day').toISO()!, day.endOf('day').toISO()!);
    setItems(loaded);
    setSelected(nearestIndexToNow(loaded));
    onRefresh();
  }, [day.toISODate()]);

  const refresh = () => {
    setItems(listScheduledInRange(day.startOf('day').toISO()!, day.endOf('day').toISO()!));
    onRefresh();
  };

  const scheduled = items.filter((i) => i.start);
  const hours = hourLabels();
  const isToday = day.hasSame(DateTime.local(), 'day');
  const sel = Math.min(selected, Math.max(0, scheduled.length - 1));

  // Build the rendered line list so click rows stay in sync with the layout.
  const lines = useMemo(() => {
    const out: { key: string; hour: string; item?: Item }[] = [];
    scheduled.filter((item) => item.allDay).forEach((item) => out.push({ key: item.id, hour: 'all day', item }));
    hours.forEach((hour, hi) => {
      const blocks = scheduled.filter((item) => !item.allDay && item.start && DateTime.fromISO(item.start).hour === hi);
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

      if (scheduled.length === 0) return;
      if (input === 'j' || key.downArrow) setSelected((s) => Math.min(s + 1, scheduled.length - 1));
      if (input === 'k' || key.upArrow) setSelected((s) => Math.max(s - 1, 0));

      const item = scheduled[sel];
      if (!item?.start || !item.end || item.source === 'external') return;

      if (input === 's') {
        setEditing(item);
        return;
      }
      if (input === 'x') {
        toggleDone(item.id);
        refresh();
        autoPush(item.id, onStatus);
        onStatus('Marked done');
        return;
      }
      if (item.allDay) {
        if (input === 'u') {
          unscheduleItem(item.id);
          refresh();
          autoRemove(item, onStatus);
          onStatus('Unscheduled');
        }
        return;
      }
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
      if (input === 'u') {
        unscheduleItem(item.id);
        refresh();
        autoRemove(item, onStatus);
        onStatus('Unscheduled');
      }
    },
    { isActive: editing === null },
  );

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
      <Text dimColor>click events · h/l prev/next day · t today · j/k select · s reschedule · +/- resize · x done · u unschedule</Text>
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
          return (
            <Text
              key={line.key}
              color={selectedHere ? 'cyan' : external ? 'magenta' : 'white'}
              bold={selectedHere}
              dimColor={external && !selectedHere}
              underline={selectedHere}
            >
              {line.hour} {selectedHere ? '▸ ' : '· '}
              {item.allDay ? item.title : `${formatTime(item.end!)} ${item.title}`}
              {external ? ' [gcal]' : ''}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}

export function WeekView({ onRefresh, onStatus }: Props) {
  const { setInputFocused } = useInputFocus();
  const [weekStart, setWeekStart] = useState(() => DateTime.local().startOf('week'));
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState<Item | null>(null);

  useEffect(() => {
    setInputFocused(editing !== null);
    return () => setInputFocused(false);
  }, [editing, setInputFocused]);

  useEffect(() => {
    const loaded = listScheduledInRange(weekStart.toISO()!, weekStart.endOf('week').toISO()!);
    setItems(loaded);
    setSelected(nearestIndexToNow(loaded));
    onRefresh();
  }, [weekStart.toISODate()]);

  const refresh = () => {
    setItems(listScheduledInRange(weekStart.toISO()!, weekStart.endOf('week').toISO()!));
    onRefresh();
  };

  const days = Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i }));
  const scheduled = items.filter((i) => i.start);
  const sel = Math.min(selected, Math.max(0, scheduled.length - 1));

  const regions = useMemo<ClickRegion[]>(() => {
    const out: ClickRegion[] = [];
    days.forEach((d, dayIndex) => {
      const colStart = weekColStart(dayIndex);
      const dayItems = scheduled.filter((i) => i.start && isSameDay(i.start, d.toISO()!));
      dayItems.forEach((item, ei) => {
        out.push({
          row: WEEK_EVENTS_ROW + ei,
          col: colStart,
          endCol: colStart + WEEK_COL_WIDTH - 3,
          onClick: () => setSelected(scheduled.indexOf(item)),
        });
      });
    });
    return out;
  }, [scheduled, weekStart.toISODate()]);
  useClickRegions('week', editing ? [] : regions);

  useAppInput(
    (input, key) => {
      if (input === 't') {
        setWeekStart(DateTime.local().startOf('week'));
        return;
      }
      if (input === 'h' || key.leftArrow) {
        setWeekStart((w) => w.minus({ weeks: 1 }));
        return;
      }
      if (input === 'l' || key.rightArrow) {
        setWeekStart((w) => w.plus({ weeks: 1 }));
        return;
      }

      if (scheduled.length === 0) return;

      // j/k stay within the selected event's day; don't jump to another day's event.
      const moveWithinDay = (dir: 1 | -1) => {
        const cur = scheduled[sel];
        if (!cur?.start) return;
        const dayItems = scheduled.filter((i) => i.start && isSameDay(i.start, cur.start!));
        const pos = dayItems.indexOf(cur);
        const next = dayItems[pos + dir];
        if (next) setSelected(scheduled.indexOf(next));
      };
      if (input === 'j' || key.downArrow) moveWithinDay(1);
      if (input === 'k' || key.upArrow) moveWithinDay(-1);

      const item = scheduled[sel];
      if (!item?.start || !item.end || item.source === 'external') return;

      if (input === 's') {
        setEditing(item);
        return;
      }
      if (input === 'x') {
        toggleDone(item.id);
        refresh();
        autoPush(item.id, onStatus);
        onStatus('Marked done');
        return;
      }
      if (input === 'u') {
        unscheduleItem(item.id);
        refresh();
        autoRemove(item, onStatus);
        onStatus('Unscheduled');
      }
    },
    { isActive: editing === null },
  );

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
      <Text dimColor>click events · h/l prev/next week · t this week · j/k select · s reschedule · x done · u unschedule</Text>
      <Box marginTop={1}>
        {days.map((d) => {
          const dayItems = scheduled.filter((i) => i.start && isSameDay(i.start, d.toISO()!));
          return (
            <Box key={d.toISODate()} flexDirection="column" marginRight={2} width={18}>
              <Text bold color={d.hasSame(DateTime.local(), 'day') ? 'cyan' : undefined}>
                {d.toFormat('EEE d')}
              </Text>
              {dayItems.length === 0 ? (
                <Text dimColor>—</Text>
              ) : (
                dayItems.map((item) => {
                  const idx = scheduled.indexOf(item);
                  const external = item.source === 'external';
                  return (
                    <Text
                      key={item.id}
                      color={idx === sel ? 'cyan' : external ? 'magenta' : undefined}
                      dimColor={external && idx !== sel}
                      underline={idx === sel}
                      wrap="truncate"
                    >
                      {formatScheduleTime(item.start!, item.end, item.allDay)} {item.title}
                    </Text>
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
