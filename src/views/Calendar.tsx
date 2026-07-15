import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import type { Key } from 'ink';
import TextInput from 'ink-text-input';
import { DateTime } from 'luxon';
import type { EventAttendee, Item, MeetingProvider, Reminder } from '../db/types.js';
import { isLocalItem } from '../db/types.js';
import { createItem, createEvent, deleteItem, listScheduledInRange, rescheduleLocalItem, toggleDone, updateItem } from '../db/items.js';
import { padToWidth } from '../lib/textWidth.js';
import { addMinutes, allDayRange, hourLabels, itemSpansDay } from '../lib/time.js';
import { autoPush, autoRemove } from '../calendar/autoSync.js';
import { ItemEditor } from '../components/ItemEditor.js';
import { EventEditor } from '../components/EventEditor.js';
import { useClickRegions } from '../components/Mouse.js';
import { ScheduleEditor } from '../components/ScheduleEditor.js';
import { CalendarEventRow, CALENDAR_PREFIX_COL, hasWeekTime } from '../components/CalendarEventRow.js';
import { COLUMN_DIVIDER_WIDTH, ColumnDivider } from '../components/ColumnDivider.js';
import { ItemDetailLines, itemDetailLineCount } from '../components/ItemDetailLines.js';
import { ShortcutBar } from '../components/ShortcutBar.js';
import { useInputFocus } from '../context/InputFocusContext.js';
import { useUndo } from '../context/UndoContext.js';
import { useAppInput } from '../hooks/useAppInput.js';
import type { ClickRegion } from '../lib/mouse.js';
import { useViewport } from '../context/ViewportContext.js';
import { DAY_VIEW_HEADER_ROWS, VIEW_ROW0, WEEK_VIEW_HEADER_ROWS } from '../lib/layout.js';
import { QuickAddPreview } from '../components/QuickAddPreview.js';
import { buildQuickAddDraft, calendarQuickAddReference } from '../lib/quickAddPreview.js';
import { DAILY_SHORTCUTS, WEEK_SHORTCUTS } from '../lib/shortcuts.js';
import { cloneItem, makeUndoAdd, makeUndoDelete, makeUndoToggleDone } from '../lib/undoActions.js';
import { meetingUrlForItem, openMeeting } from '../lib/meetings.js';
import { canRespondToInvitation, needsInvitationResponse } from '../lib/invitations.js';
import { respondToInvitation } from '../calendar/invitations.js';
import { RsvpEditor } from '../components/RsvpEditor.js';
import { getDefaultMeetingProvider } from '../db/meta.js';
import { getActiveProvider } from '../calendar/provider.js';

type Props = {
  onRefresh: () => void;
  onStatus: (msg: string) => void;
  refreshToken?: number;
  focusedDateISO?: string;
  onFocusedDateChange?: (iso: string) => void;
};
type CalendarMode = 'list' | 'add' | 'quick' | 'addEvent' | 'quickEvent' | 'edit' | 'editEvent' | 'schedule' | 'scheduleNewEvent' | 'respond';

export type PendingEventDraft = {
  title: string;
  notes?: string;
  location?: string;
  reminders: Reminder[];
  attendees: EventAttendee[];
  meetingProvider?: MeetingProvider;
};

type CreatorKind = 'task' | 'event';

/** Items in the same order as the day view renders them (all-day, then timed by hour). */
function orderedDayItems(scheduled: Item[]): Item[] {
  const hours = hourLabels();
  const out: Item[] = [];
  const allDay = scheduled.filter((item) => !hasWeekTime(item));
  allDay.forEach((item) => out.push(item));
  hours.forEach((_, hi) => {
    const blocks = scheduled.filter(
      (item) => hasWeekTime(item) && item.start && DateTime.fromISO(item.start).hour === hi,
    );
    blocks.forEach((item) => out.push(item));
  });
  return out;
}

function defaultDaySelectionIndex(items: Item[]): number {
  const firstOpen = items.findIndex((item) => !isDoneTask(item));
  return firstOpen >= 0 ? firstOpen : 0;
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
const WEEK_FOCUS_WEIGHT = 2;
const WEEK_DETAIL_OPTS = { showSchedule: false, showMeta: true } as const;

function isDoneTask(item: Item): boolean {
  return item.status === 'done' && item.source === 'task';
}

export function allDayFields(day: DateTime): { start: string; end: string; allDay: true } {
  const range = allDayRange(day.toISO()!);
  return { ...range, allDay: true };
}

export function createCalendarItemFromQuickAdd(input: string, day: DateTime, kind: CreatorKind): Item {
  const ref = day.startOf('day');
  const draft = buildQuickAddDraft(input, {
    kind,
    referenceDate: ref.toJSDate(),
    fallbackDay: ref.toISO()!,
  });
  if (!draft) throw new Error('empty quick add');
  const fields = {
    title: draft.title,
    start: draft.start!,
    end: draft.end,
    allDay: draft.allDay,
  };
  return kind === 'event'
    ? createEvent({ ...fields, meetingProvider: getActiveProvider() === 'google' ? getDefaultMeetingProvider() : undefined })
    : createItem({ ...fields, tags: draft.tags, project: draft.project, priority: draft.priority });
}

export function draftScheduleItem(title: string): Item {
  return {
    id: 'draft',
    title,
    tags: [],
    priority: 0,
    status: 'open',
    source: 'event',
    reminders: [],
    attendees: [],
    allDay: false,
    updatedAt: '',
    createdAt: '',
  };
}

function calendarHelpContext(item: Item | undefined) {
  return {
    item,
    isLocal: !!item && isLocalItem(item),
    hasTime: item ? hasWeekTime(item) : false,
    hasMeeting: item ? Boolean(meetingUrlForItem(item)) : false,
    canRespond: item ? canRespondToInvitation(item) : false,
  };
}

/** +/- adjust end; shift+/- adjust start (_ is shift+- when the terminal omits key.shift). */
function timedResizeInput(item: Item, input: string, key: Key): { updates: Partial<Item>; message: string } | null {
  if (!item.start || !item.end || !hasWeekTime(item)) return null;

  const startLater = key.shift && (input === '+' || input === '=');
  const startEarlier = input === '_' || (key.shift && input === '-');
  if (startLater) {
    const newStart = addMinutes(item.start, 15);
    if (DateTime.fromISO(newStart) >= DateTime.fromISO(item.end)) return null;
    return { updates: { start: newStart }, message: 'Start 15m later' };
  }
  if (startEarlier) {
    const newStart = addMinutes(item.start, -15);
    if (DateTime.fromISO(newStart) >= DateTime.fromISO(item.end)) return null;
    return { updates: { start: newStart }, message: 'Start 15m earlier' };
  }
  if (input === '+' || input === '=') {
    return { updates: { end: addMinutes(item.end, 15) }, message: 'End 15m later' };
  }
  if (input === '-') {
    const newEnd = addMinutes(item.end, -15);
    if (DateTime.fromISO(newEnd) <= DateTime.fromISO(item.start)) return null;
    return { updates: { end: newEnd }, message: 'End 15m earlier' };
  }
  return null;
}

function applyTimedResize(
  item: Item,
  input: string,
  key: Key,
  onStatus: (msg: string) => void,
  refresh: () => void,
): boolean {
  const resize = timedResizeInput(item, input, key);
  if (!resize) return false;
  updateItem(item.id, resize.updates);
  refresh();
  autoPush(item.id, onStatus, refresh);
  onStatus(resize.message);
  return true;
}

export function CalendarItemCreator({
  mode,
  kind,
  day,
  onCancel,
  onCreated,
}: {
  mode: 'quick' | 'quickEvent';
  kind: CreatorKind;
  day: DateTime;
  onCancel: () => void;
  onCreated: (item: Item) => void;
}) {
  const [quickInput, setQuickInput] = useState('');
  const previewOpts = useMemo(
    () => ({ kind, ...calendarQuickAddReference(day) }),
    [kind, day],
  );
  useAppInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column">
      <Text color="cyanBright">Quick add {kind} for {day.toFormat('EEE d MMM')}:</Text>
      <Text dimColor>Time-only input uses this day. No time makes an all-day {kind}.</Text>
      <Box marginTop={1}>
        <Text>&gt; </Text>
        <TextInput
          value={quickInput}
          onChange={setQuickInput}
          onSubmit={(val) => {
            if (val.trim()) onCreated(createCalendarItemFromQuickAdd(val, day, kind));
          }}
        />
      </Box>
      <QuickAddPreview input={quickInput} {...previewOpts} />
    </Box>
  );
}


type DayLine = { key: string; hour: string; item?: Item; separator?: false } | { key: string; separator: true };

function rowDivider(width: number): string {
  return '─'.repeat(Math.max(1, width));
}

export function DayView({ onRefresh, onStatus, refreshToken, focusedDateISO, onFocusedDateChange }: Props) {
  const { setInputFocused } = useInputFocus();
  const { pushUndo } = useUndo();
  const { contentRows, columns } = useViewport();
  const viewWidth = Math.max(40, columns - 6);
  const [day, setDay] = useState(() =>
    focusedDateISO ? DateTime.fromISO(focusedDateISO).startOf('day') : DateTime.local().startOf('day'),
  );

  const changeDay = (next: DateTime | ((d: DateTime) => DateTime)) => {
    setDay((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      const normalized = resolved.startOf('day');
      onFocusedDateChange?.(normalized.toISODate()!);
      return normalized;
    });
  };

  useEffect(() => {
    if (!focusedDateISO) return;
    const external = DateTime.fromISO(focusedDateISO).startOf('day');
    setDay((current) => (current.hasSame(external, 'day') ? current : external));
  }, [focusedDateISO]);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<CalendarMode>('list');
  const [pendingEvent, setPendingEvent] = useState<PendingEventDraft | null>(null);
  const pendingSelectRef = useRef<'first' | 'last' | 'nearest'>('nearest');

  useEffect(() => {
    setInputFocused(mode !== 'list');
    return () => setInputFocused(false);
  }, [mode, setInputFocused]);

  useEffect(() => {
    const loaded = listScheduledInRange(day.startOf('day').toISO()!, day.endOf('day').toISO()!);
    setItems(loaded);
    const ordered = orderedDayItems(loaded.filter((i) => i.start));
    const anchor = pendingSelectRef.current;
    pendingSelectRef.current = 'nearest';
    if (anchor === 'first') setSelected(0);
    else if (anchor === 'last') setSelected(Math.max(0, ordered.length - 1));
    else setSelected(defaultDaySelectionIndex(ordered));
    onRefresh();
  }, [day.toISODate()]);

  useEffect(() => {
    if (refreshToken === undefined || refreshToken === 0) return;
    const loaded = listScheduledInRange(day.startOf('day').toISO()!, day.endOf('day').toISO()!);
    setItems(loaded);
    const ordered = orderedDayItems(loaded.filter((i) => i.start));
    setSelected((s) => Math.min(s, Math.max(0, ordered.length - 1)));
  }, [refreshToken]);

  const refresh = () => {
    setItems(listScheduledInRange(day.startOf('day').toISO()!, day.endOf('day').toISO()!));
    onRefresh();
  };

  const scheduled = items.filter((i) => i.start);
  const orderedItems = useMemo(() => orderedDayItems(scheduled), [scheduled]);
  const hours = useMemo(() => hourLabels(), []);
  const isToday = day.hasSame(DateTime.local(), 'day');
  const sel =
    orderedItems.length === 0 ? 0 : Math.max(0, Math.min(selected, orderedItems.length - 1));
  const selectedDayItem = orderedItems[sel];

  // Build the rendered line list so click rows stay in sync with the layout.
  const lines = useMemo(() => {
    const out: DayLine[] = [];
    const allDay = scheduled.filter((item) => !hasWeekTime(item));
    allDay.forEach((item) => out.push({ key: item.id, hour: 'all day', item }));
    if (allDay.length > 0) out.push({ key: 'all-day-separator', separator: true });
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

  const maxLines = Math.max(1, contentRows - DAY_VIEW_HEADER_ROWS);
  const visibleLines = lines.slice(0, maxLines);

  const regions = useMemo<ClickRegion[]>(
    () =>
      visibleLines
        .map((line, idx) =>
          'item' in line && line.item
            ? { row: DAY_CONTENT_ROW + idx, onClick: () => setSelected(orderedItems.indexOf(line.item!)) }
            : null,
        )
        .filter((r): r is ClickRegion => r !== null),
    [visibleLines, orderedItems],
  );
  useClickRegions('day', mode !== 'list' ? [] : regions);

  useAppInput(
    (input, key) => {
      if (input === 't') {
        changeDay(DateTime.local().startOf('day'));
        return;
      }
      if (input === 'h' || key.leftArrow) {
        changeDay((d) => d.minus({ days: 1 }));
        return;
      }
      if (input === 'l' || key.rightArrow) {
        changeDay((d) => d.plus({ days: 1 }));
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

      const moveVertical = (dir: 1 | -1) => {
        if (orderedItems.length > 0) {
          if (dir === 1 && sel < orderedItems.length - 1) {
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
          changeDay(adjacent.day.startOf('day'));
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

      if (orderedItems.length === 0) return;

      const item = orderedItems[sel];
      if (input === 'J' || (key.shift && key.downArrow)) {
        if (item?.start && item.end && isLocalItem(item) && hasWeekTime(item)) {
          updateItem(item.id, { start: addMinutes(item.start, 60), end: addMinutes(item.end, 60) });
          refresh();
          autoPush(item.id, onStatus, refresh);
          onStatus('Moved 1h later');
        }
        return;
      }
      if (input === 'K' || (key.shift && key.upArrow)) {
        if (item?.start && item.end && isLocalItem(item) && hasWeekTime(item)) {
          updateItem(item.id, { start: addMinutes(item.start, -60), end: addMinutes(item.end, -60) });
          refresh();
          autoPush(item.id, onStatus, refresh);
          onStatus('Moved 1h earlier');
        }
        return;
      }

      if (item && input === 'o' && meetingUrlForItem(item)) {
        void openMeeting(item)
          .then(() => onStatus('Opened meeting link'))
          .catch((error) => onStatus(`Could not open meeting: ${(error as Error).message}`));
        return;
      }
      if (item && input === 'v' && canRespondToInvitation(item)) {
        setMode('respond');
        return;
      }

      if (!item?.start || !item.end || !isLocalItem(item)) return;

      if (input === 'e') {
        setMode(item.source === 'event' ? 'editEvent' : 'edit');
        return;
      }
      if (input === 's') {
        setMode('schedule');
        return;
      }
      if (item.source === 'task' && input === 'x') {
        const before = cloneItem(item);
        toggleDone(item.id);
        pushUndo(
          before.status === 'open' ? `Marked done: ${before.title}` : `Marked open: ${before.title}`,
          makeUndoToggleDone(before, onStatus),
        );
        refresh();
        autoPush(item.id, onStatus, refresh);
        onStatus('Marked done');
        return;
      }
      if (input === 'd') {
        const victim = cloneItem(item);
        autoRemove(victim, onStatus);
        deleteItem(victim.id);
        pushUndo(`Deleted: ${victim.title}`, makeUndoDelete(victim, onStatus));
        setSelected((s) => Math.max(0, s - 1));
        refresh();
        onStatus('Deleted');
        return;
      }
      if (applyTimedResize(item, input, key, onStatus, refresh)) return;
    },
    { isActive: mode === 'list' },
  );

  if (mode === 'respond' && selectedDayItem) {
    return (
      <RsvpEditor
        item={selectedDayItem}
        onCancel={() => setMode('list')}
        onSubmit={(response) => {
          setMode('list');
          void respondToInvitation(selectedDayItem, response)
            .then(() => {
              refresh();
              onStatus(`Response sent: ${response}`);
            })
            .catch((error) => onStatus(`Response failed: ${(error as Error).message}`));
        }}
      />
    );
  }

  if (mode === 'add') {
    return (
      <ItemEditor
        mode="add"
        onCancel={() => setMode('list')}
        onSubmit={(data) => {
          const item = createItem({ ...data, ...allDayFields(day) });
          setMode('list');
          refresh();
          pushUndo(`Added: ${item.title}`, makeUndoAdd(cloneItem(item), onStatus));
          autoPush(item.id, onStatus, refresh);
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
        day={day}
        onCancel={() => setMode('list')}
        onCreated={(item) => {
          setMode('list');
          refresh();
          pushUndo(`Added: ${item.title}`, makeUndoAdd(cloneItem(item), onStatus));
          autoPush(item.id, onStatus, refresh);
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
            attendees: pendingEvent.attendees,
            meetingProvider: pendingEvent.meetingProvider,
            start,
            end,
            allDay,
          });
          setPendingEvent(null);
          setMode('list');
          refresh();
          pushUndo(`Added: ${item.title}`, makeUndoAdd(cloneItem(item), onStatus));
          autoPush(item.id, onStatus, refresh);
          onStatus(`Added event: ${item.title}`);
        }}
      />
    );
  }

  if (mode === 'edit' && selectedDayItem?.source === 'task') {
    const item = selectedDayItem;
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
          autoPush(item.id, onStatus, refresh);
          onStatus('Task updated');
          setMode('list');
        }}
      />
    );
  }

  if (mode === 'editEvent' && selectedDayItem?.source === 'event') {
    const item = selectedDayItem;
    return (
      <EventEditor
        mode="edit"
        item={item}
        onCancel={() => setMode('list')}
        onSubmit={(data) => {
          updateItem(item.id, {
            title: data.title,
            notes: data.notes,
            location: data.location,
            reminders: data.reminders,
            attendees: data.attendees,
            meetingProvider: data.meetingProvider,
          });
          refresh();
          autoPush(item.id, onStatus, refresh);
          onStatus('Event updated');
          setMode('list');
        }}
      />
    );
  }

  if (mode === 'schedule' && selectedDayItem && isLocalItem(selectedDayItem)) {
    const item = selectedDayItem;
    return (
      <ScheduleEditor
        item={item}
        onCancel={() => setMode('list')}
        onSubmit={(start, end, allDay) => {
          rescheduleLocalItem(item.id, start, end, allDay);
          refresh();
          autoPush(item.id, onStatus, refresh);
          onStatus('Rescheduled');
          setMode('list');
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        {day.toFormat('EEE MMM d, yyyy')} {isToday ? '(today)' : ''}
      </Text>
      <ShortcutBar shortcuts={DAILY_SHORTCUTS} context={calendarHelpContext(selectedDayItem)} />
      <Box flexDirection="column" marginTop={1} width={viewWidth}>
        {visibleLines.map((line) => {
          if ('separator' in line && line.separator) {
            return (
              <Box key={line.key} width={viewWidth} height={1} overflow="hidden">
                <Text dimColor wrap="truncate">
                  {padToWidth(rowDivider(viewWidth), viewWidth)}
                </Text>
              </Box>
            );
          }
          if (!line.item) {
            return (
              <Box key={line.key} width={viewWidth} height={1} overflow="hidden">
                <Text dimColor wrap="truncate">
                  {padToWidth(`${line.hour} ·`, viewWidth)}
                </Text>
              </Box>
            );
          }
          const item = line.item;
          const selectedHere = orderedItems[sel]?.id === item.id;
          return (
            <Box key={line.key} flexDirection="column">
              <CalendarEventRow
                item={item}
                rowWidth={viewWidth}
                selected={selectedHere}
                compactLabel={hasWeekTime(item) ? undefined : 'all day'}
                titleSuffix={needsInvitationResponse(item) ? '  ? RSVP' : ''}
              />
              {selectedHere ? (
                <ItemDetailLines item={item} maxWidth={viewWidth} showSchedule={false} />
              ) : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export function WeekView({ onRefresh, onStatus, refreshToken }: Props) {
  const { setInputFocused } = useInputFocus();
  const { pushUndo } = useUndo();
  const { contentRows, columns } = useViewport();
  const [weekStart, setWeekStart] = useState(() => DateTime.local().startOf('week'));
  const [focusedDayISO, setFocusedDayISO] = useState(() => DateTime.local().toISODate()!);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<CalendarMode>('list');
  const [pendingEvent, setPendingEvent] = useState<PendingEventDraft | null>(null);
  const pendingItemIdRef = useRef<string | null>(null);
  const weekSelectIntentRef = useRef<{ dayISO: string; select: 'first' | 'last' } | null>(null);
  useEffect(() => {
    setInputFocused(mode !== 'list');
    return () => setInputFocused(false);
  }, [mode, setInputFocused]);

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
      const dayItems = scheduledLoaded.filter((i) => i.start && itemSpansDay(i, dayISO));
      if (dayItems.length > 0) {
        const target = select === 'last' ? dayItems[dayItems.length - 1]! : dayItems[0]!;
        setSelected(scheduledLoaded.indexOf(target));
      }
    } else {
      const dayItems = scheduledLoaded.filter((i) => i.start && itemSpansDay(i, focusedDayISO));
      if (dayItems.length > 0) setSelected(scheduledLoaded.indexOf(dayItems[0]!));
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
  const selectedWeekItem =
    selectedCandidate?.start && itemSpansDay(selectedCandidate, focusedDay) ? selectedCandidate : undefined;
  const selectedDayIndex = Math.max(0, days.findIndex((d) => d.hasSame(focusedDay, 'day')));
  const viewWidth = Math.max(80, columns) - 4;
  const availableWidth = viewWidth - COLUMN_DIVIDER_WIDTH * (days.length - 1);
  const totalWeight = days.length + WEEK_FOCUS_WEIGHT - 1;
  const dayWidths = days.map((_, dayIndex) =>
    Math.max(CALENDAR_PREFIX_COL + 4, Math.floor((availableWidth * (dayIndex === selectedDayIndex ? WEEK_FOCUS_WEIGHT : 1)) / totalWeight)),
  );
  const usedWidth = dayWidths.reduce((sum, width) => sum + width, 0);
  if (usedWidth < availableWidth) {
    dayWidths[selectedDayIndex] += availableWidth - usedWidth;
  }
  const dayStarts = dayWidths.reduce<number[]>((starts, width, dayIndex) => {
    starts.push(dayIndex === 0 ? 2 : starts[dayIndex - 1]! + dayWidths[dayIndex - 1]! + COLUMN_DIVIDER_WIDTH);
    return starts;
  }, []);

  const itemsByDay = useMemo(
    () => days.map((d) => scheduled.filter((i) => i.start && itemSpansDay(i, d))),
    [days, scheduled],
  );
  const itemRows = useMemo(() => Math.max(1, ...itemsByDay.map((col) => col.length)), [itemsByDay]);
  const weekKey = weekStart.toISODate();
  const maxPaintRows = Math.max(1, contentRows - WEEK_VIEW_HEADER_ROWS);
  const paintRows = Math.min(maxPaintRows, itemRows);
  const weekBodyLines = useMemo(
    () =>
      days.map((_, dayIndex) => {
        const dayItems = itemsByDay[dayIndex]!;
        const visible = dayItems.slice(0, paintRows);
        if (visible.length === 0) return 1;
        let lines = 0;
        for (const item of visible) {
          lines += 1;
          if (dayIndex === selectedDayIndex && selectedWeekItem?.id === item.id) {
            lines += itemDetailLineCount(item, WEEK_DETAIL_OPTS);
          }
        }
        return lines;
      }),
    [days, itemsByDay, paintRows, selectedDayIndex, selectedWeekItem?.id],
  );
  const maxBodyLines = Math.max(1, ...weekBodyLines);

  const regions = useMemo<ClickRegion[]>(() => {
    const out: ClickRegion[] = [];
    days.forEach((d, dayIndex) => {
      const colStart = dayStarts[dayIndex]!;
      const dayWidth = dayWidths[dayIndex]!;
      const dayItems = itemsByDay[dayIndex]!;
      out.push({
        row: WEEK_EVENTS_ROW - 1,
        col: colStart,
        endCol: colStart + dayWidth - 1,
        onClick: () => {
          setFocusedDayISO(d.toISODate()!);
          if (dayItems.length > 0) setSelected(scheduled.indexOf(dayItems[0]!));
        },
      });
      let row = WEEK_EVENTS_ROW;
      const visible = dayItems.slice(0, paintRows);
      if (visible.length === 0) {
        out.push({
          row,
          col: colStart,
          endCol: colStart + dayWidth - 1,
          onClick: () => setFocusedDayISO(d.toISODate()!),
        });
        return;
      }
      for (const item of visible) {
        out.push({
          row,
          col: colStart,
          endCol: colStart + dayWidth - 1,
          onClick: () => {
            setFocusedDayISO(d.toISODate()!);
            setSelected(scheduled.indexOf(item));
          },
        });
        row += 1;
        if (dayIndex === selectedDayIndex && selectedWeekItem?.id === item.id) {
          row += itemDetailLineCount(item, WEEK_DETAIL_OPTS);
        }
      }
    });
    return out;
  }, [scheduled, weekStart.toISODate(), dayStarts, dayWidths, paintRows, itemsByDay, selectedDayIndex, selectedWeekItem?.id, focusedDayISO]);
  useClickRegions('week', mode !== 'list' ? [] : regions);

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
        const dayItems = scheduled.filter((i) => i.start && itemSpansDay(i, d));
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
      if (input === 'A') {
        setMode('addEvent');
        return;
      }
      if (input === 'Q') {
        setMode('quickEvent');
        return;
      }

      const moveVertical = (dir: 1 | -1) => {
        const dayItems = scheduled.filter((i) => i.start && itemSpansDay(i, focusedDay));
        const pos = selectedWeekItem ? dayItems.indexOf(selectedWeekItem) : dir === 1 ? -1 : dayItems.length;
        const next = dayItems[pos + dir];
        if (next) {
          setSelected(scheduled.indexOf(next));
          return;
        }

        for (let dayIndex = selectedDayIndex + dir; dayIndex >= 0 && dayIndex < days.length; dayIndex += dir) {
          const targetDayItems = scheduled.filter((i) => i.start && itemSpansDay(i, days[dayIndex]!));
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
      if (input === 'J' || (key.shift && key.downArrow)) {
        if (item?.start && item.end && isLocalItem(item) && hasWeekTime(item)) {
          updateItem(item.id, { start: addMinutes(item.start, 60), end: addMinutes(item.end, 60) });
          refresh();
          autoPush(item.id, onStatus, refresh);
          onStatus('Moved 1h later');
        }
        return;
      }
      if (input === 'K' || (key.shift && key.upArrow)) {
        if (item?.start && item.end && isLocalItem(item) && hasWeekTime(item)) {
          updateItem(item.id, { start: addMinutes(item.start, -60), end: addMinutes(item.end, -60) });
          refresh();
          autoPush(item.id, onStatus, refresh);
          onStatus('Moved 1h earlier');
        }
        return;
      }

      if (item && input === 'o' && meetingUrlForItem(item)) {
        void openMeeting(item)
          .then(() => onStatus('Opened meeting link'))
          .catch((error) => onStatus(`Could not open meeting: ${(error as Error).message}`));
        return;
      }
      if (item && input === 'v' && canRespondToInvitation(item)) {
        setMode('respond');
        return;
      }

      if (!item?.start || !item.end || !isLocalItem(item)) return;

      if (input === 'e') {
        setMode(item.source === 'event' ? 'editEvent' : 'edit');
        return;
      }
      if (input === 's') {
        setMode('schedule');
        return;
      }
      if (item.source === 'task' && input === 'x') {
        const before = cloneItem(item);
        toggleDone(item.id);
        pushUndo(
          before.status === 'open' ? `Marked done: ${before.title}` : `Marked open: ${before.title}`,
          makeUndoToggleDone(before, onStatus),
        );
        refresh();
        autoPush(item.id, onStatus, refresh);
        onStatus('Marked done');
        return;
      }
      if (input === 'd') {
        const victim = cloneItem(item);
        autoRemove(victim, onStatus);
        deleteItem(victim.id);
        pushUndo(`Deleted: ${victim.title}`, makeUndoDelete(victim, onStatus));
        setSelected((s) => Math.max(0, s - 1));
        refresh();
        onStatus('Deleted');
        return;
      }
      if (applyTimedResize(item, input, key, onStatus, refresh)) return;
    },
    { isActive: mode === 'list' },
  );

  if (mode === 'respond' && selectedWeekItem) {
    return (
      <RsvpEditor
        item={selectedWeekItem}
        onCancel={() => setMode('list')}
        onSubmit={(response) => {
          setMode('list');
          void respondToInvitation(selectedWeekItem, response)
            .then(() => {
              refresh();
              onStatus(`Response sent: ${response}`);
            })
            .catch((error) => onStatus(`Response failed: ${(error as Error).message}`));
        }}
      />
    );
  }

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
          autoPush(item.id, onStatus, refresh);
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
          autoPush(item.id, onStatus, refresh);
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
            attendees: pendingEvent.attendees,
            meetingProvider: pendingEvent.meetingProvider,
            start,
            end,
            allDay,
          });
          setPendingEvent(null);
          setMode('list');
          refresh();
          pushUndo(`Added: ${item.title}`, makeUndoAdd(cloneItem(item), onStatus));
          autoPush(item.id, onStatus, refresh);
          onStatus(`Added event: ${item.title}`);
        }}
      />
    );
  }

  if (mode === 'edit' && selectedWeekItem?.source === 'task') {
    const item = selectedWeekItem;
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
          autoPush(item.id, onStatus, refresh);
          onStatus('Task updated');
          setMode('list');
        }}
      />
    );
  }

  if (mode === 'editEvent' && selectedWeekItem?.source === 'event') {
    const item = selectedWeekItem;
    return (
      <EventEditor
        mode="edit"
        item={item}
        onCancel={() => setMode('list')}
        onSubmit={(data) => {
          updateItem(item.id, {
            title: data.title,
            notes: data.notes,
            location: data.location,
            reminders: data.reminders,
            attendees: data.attendees,
            meetingProvider: data.meetingProvider,
          });
          refresh();
          autoPush(item.id, onStatus, refresh);
          onStatus('Event updated');
          setMode('list');
        }}
      />
    );
  }

  if (mode === 'schedule' && selectedWeekItem && isLocalItem(selectedWeekItem)) {
    const item = selectedWeekItem;
    return (
      <ScheduleEditor
        item={item}
        onCancel={() => setMode('list')}
        onSubmit={(start, end, allDay) => {
          rescheduleLocalItem(item.id, start, end, allDay);
          refresh();
          autoPush(item.id, onStatus, refresh);
          onStatus('Rescheduled');
          setMode('list');
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        Week of {weekStart.toFormat('MMM d')} – {weekStart.endOf('week').toFormat('MMM d, yyyy')}
      </Text>
      <ShortcutBar shortcuts={WEEK_SHORTCUTS} context={calendarHelpContext(selectedWeekItem)} />
      <Box key={weekKey} marginTop={1} flexDirection="column" width={viewWidth}>
        <Box flexDirection="row">
          {days.map((d, dayIndex) => (
            <React.Fragment key={`week-head-${d.toISODate()}`}>
              {dayIndex > 0 ? (
                <Box width={COLUMN_DIVIDER_WIDTH} height={1}>
                  <Text color="gray" wrap="truncate">
                    {padToWidth('│', COLUMN_DIVIDER_WIDTH)}
                  </Text>
                </Box>
              ) : null}
              <Box width={dayWidths[dayIndex]!} height={1}>
                <Text bold color={dayIndex === selectedDayIndex ? 'cyanBright' : undefined} wrap="truncate">
                  {padToWidth(
                    `${d.toFormat('EEE d MMM')}${d.hasSame(DateTime.local(), 'day') ? ' (today)' : ''}`,
                    dayWidths[dayIndex]!,
                  )}
                </Text>
              </Box>
            </React.Fragment>
          ))}
        </Box>
        <Box flexDirection="row" alignItems="flex-start">
          {days.map((d, dayIndex) => {
            const dayItems = itemsByDay[dayIndex]!;
            const colWidth = dayWidths[dayIndex]!;
            const visible = dayItems.slice(0, paintRows);
            return (
              <React.Fragment key={`week-col-${d.toISODate()}`}>
                {dayIndex > 0 ? <ColumnDivider lines={maxBodyLines} /> : null}
                <Box flexDirection="column" width={colWidth}>
                  {visible.length === 0 ? (
                    <Box height={1}>
                      <Text
                        color={dayIndex === selectedDayIndex ? 'cyanBright' : undefined}
                        bold={dayIndex === selectedDayIndex}
                        dimColor={dayIndex !== selectedDayIndex}
                        wrap="truncate"
                      >
                        {padToWidth(dayIndex === selectedDayIndex ? '▸ —' : '—', colWidth)}
                      </Text>
                    </Box>
                  ) : (
                    visible.map((item) => (
                      <Box key={item.id} flexDirection="column">
                        <Box height={1}>
                          <CalendarEventRow
                            item={item}
                            rowWidth={colWidth}
                            selected={selectedWeekItem?.id === item.id}
                            titleSuffix={needsInvitationResponse(item) ? '  ? RSVP' : ''}
                          />
                        </Box>
                        {dayIndex === selectedDayIndex && selectedWeekItem?.id === item.id ? (
                          <ItemDetailLines item={item} maxWidth={colWidth} showSchedule={false} />
                        ) : null}
                      </Box>
                    ))
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
