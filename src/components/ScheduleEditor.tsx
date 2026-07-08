import React, { useMemo, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { DateTime } from 'luxon';
import { useAppInput } from '../hooks/useAppInput.js';
import { MarqueeText } from './MarqueeText.js';
import type { Item } from '../db/types.js';
import { isSlotFree, listDayEventsForSchedule, overlappingEvents, splitDayEvents, buildScheduleSlots } from '../lib/scheduleOverlap.js';
import {
  allDayRange,
  formatTime,
  isMultiDayAllDay,
  multiDayAllDayRange,
  parseAllDayDateRangeInput,
  parseScheduleRangeInput,
} from '../lib/time.js';

type Props = {
  item: Item;
  onSubmit: (start: string, end: string, allDay: boolean) => void;
  onCancel: () => void;
};

const VISIBLE = 9;
const STEP_MINUTES = [15, 30, 60, 120, 240] as const;
const DEFAULT_STEP_INDEX = 2;

function nearestIndexTo(slots: DateTime[], targetMillis: number): number {
  if (slots.length === 0) return 0;
  let best = 0;
  let bestDiff = Infinity;
  slots.forEach((slot, i) => {
    const diff = Math.abs(slot.toMillis() - targetMillis);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

const RANGE_TYPING = /^[0-9:a-zA-Z.\-–— ]$/;

function isRangeTyping(input: string): boolean {
  return input.length === 1 && RANGE_TYPING.test(input);
}

function divider(width: number): string {
  return '─'.repeat(Math.max(1, width));
}

export function ScheduleEditor({ item, onSubmit, onCancel }: Props) {
  const { stdout } = useStdout();
  const viewWidth = Math.max(80, stdout.columns ?? 80) - 4;
  const today = DateTime.local().startOf('day');
  const isReschedule = Boolean(item.start);
  const target = item.start ? DateTime.fromISO(item.start) : DateTime.local();
  const initialDate = target.startOf('day') < today ? today : target.startOf('day');
  const initialMultiDay =
    Boolean(item.start && item.end && isMultiDayAllDay(item.start, item.end, item.allDay));
  const initialEndDate = initialMultiDay
    ? DateTime.fromISO(item.end!).minus({ days: 1 }).startOf('day')
    : initialDate;

  const [date, setDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [multiDay, setMultiDay] = useState(initialMultiDay);
  const [filter, setFilter] = useState('');
  const [rangeInput, setRangeInput] = useState('');
  const [rangeMode, setRangeMode] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [stepIndex, setStepIndex] = useState(DEFAULT_STEP_INDEX);
  const stepMinutes = STEP_MINUTES[stepIndex]!;
  const [selected, setSelected] = useState(() =>
    nearestIndexTo(buildScheduleSlots(initialDate, STEP_MINUTES[DEFAULT_STEP_INDEX]!), target.toMillis()),
  );

  const { allDayEvents, timedEvents } = useMemo(() => {
    const dayEvents = listDayEventsForSchedule(date, item.id);
    return splitDayEvents(dayEvents);
  }, [date, item.id]);

  const filtered = useMemo(() => {
    let slots = buildScheduleSlots(date, stepMinutes);
    if (filter) slots = slots.filter((slot) => slot.toFormat('HH:mm').includes(filter));
    if (freeOnly) slots = slots.filter((slot) => isSlotFree(slot, stepMinutes, timedEvents));
    return slots;
  }, [date, filter, freeOnly, stepMinutes, timedEvents]);

  const sel = Math.min(selected, Math.max(0, filtered.length - 1));
  const isToday = date.hasSame(DateTime.local(), 'day');
  const headerPrefix = `${isReschedule ? 'reschedule' : 'schedule'}: `;

  const parsedRange = useMemo(() => {
    if (!rangeInput.trim()) return null;
    return parseScheduleRangeInput(rangeInput, date.toISO()!) ?? parseAllDayDateRangeInput(rangeInput, date.toISO()!);
  }, [rangeInput, date]);

  const goToDate = (next: DateTime) => {
    const clamped = next < today ? today : next;
    setDate(clamped);
    if (!multiDay || clamped > endDate) setEndDate(clamped);
    setFilter('');
    setSelected(nearestIndexTo(buildScheduleSlots(clamped, stepMinutes), DateTime.local().toMillis()));
  };

  const goToEndDate = (next: DateTime) => {
    const clamped = next < date ? date : next;
    setEndDate(clamped);
  };

  const changeStep = (direction: -1 | 1) => {
    setStepIndex((i) => Math.max(0, Math.min(STEP_MINUTES.length - 1, i + direction)));
    setSelected(0);
  };

  useAppInput((input, key) => {
    if (key.escape) {
      if (rangeMode) {
        setRangeMode(false);
        setRangeInput('');
        return;
      }
      onCancel();
      return;
    }
    if (input === 'c') {
      setRangeMode(true);
      return;
    }
    if (key.return) {
      if (rangeInput.trim()) {
        if (parsedRange) {
          const allDayRangePick = !parsedRange.start.includes('T') && !parsedRange.end.includes('T');
          onSubmit(parsedRange.start, parsedRange.end, allDayRangePick);
        }
        return;
      }
      if (multiDay) {
        const range = multiDayAllDayRange(date.toISODate()!, endDate.toISODate()!);
        onSubmit(range.start, range.end, true);
        return;
      }
      const slot = filtered[sel];
      if (slot) onSubmit(slot.toISO()!, slot.plus({ minutes: stepMinutes }).toISO()!, false);
      return;
    }
    if (input === 'a') {
      const range = allDayRange(date.toISO()!);
      onSubmit(range.start, range.end, true);
      return;
    }
    if (input === 'm') {
      setMultiDay((on) => {
        const next = !on;
        if (next && endDate < date) setEndDate(date);
        return next;
      });
      return;
    }
    if (input === 'f') {
      setFreeOnly((on) => !on);
      setSelected(0);
      return;
    }
    if (input === 'h' || key.leftArrow) {
      if (multiDay && (key.shift || input === 'H')) goToEndDate(endDate.minus({ days: 1 }));
      else goToDate(date.minus({ days: 1 }));
      return;
    }
    if (input === 'l' || key.rightArrow) {
      if (multiDay && (key.shift || input === 'L')) goToEndDate(endDate.plus({ days: 1 }));
      else goToDate(date.plus({ days: 1 }));
      return;
    }
    if (rangeMode) {
      if (key.backspace || key.delete) {
        setRangeInput((r) => {
          const next = r.slice(0, -1);
          if (!next) setRangeMode(false);
          return next;
        });
        return;
      }
      if (input && !key.ctrl && !key.meta && isRangeTyping(input)) {
        setRangeInput((r) => r + input);
      }
      return;
    }
    if (input && !key.ctrl && !key.meta && isRangeTyping(input) && !/^[0-9]$/.test(input)) {
      setRangeMode(true);
      setRangeInput(input);
      return;
    }
    if (input === '-' || input === '_') {
      changeStep(-1);
      return;
    }
    if (input === '+' || input === '=') {
      changeStep(1);
      return;
    }
    if (input === 'j' || key.downArrow) {
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
      return;
    }
    if (input === 'k' || key.upArrow) {
      setSelected((s) => Math.max(s - 1, 0));
      return;
    }
    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setSelected(0);
      return;
    }
    if (/^[0-9]$/.test(input)) {
      setFilter((f) => (f + input).slice(0, 4));
      setSelected(0);
    }
  });

  const windowStart = Math.max(0, Math.min(sel - Math.floor(VISIBLE / 2), Math.max(0, filtered.length - VISIBLE)));
  const windowSlots = filtered.slice(windowStart, windowStart + VISIBLE);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyanBright" paddingX={1} width={viewWidth + 2}>
      <MarqueeText
        text={item.title}
        maxWidth={viewWidth}
        prefix={headerPrefix}
        active={false}
        bold
        color="cyanBright"
      />
      <MarqueeText
        text="←/→ day · ⇧←/→ end day · ↑/↓ time · +/- step · c custom range · m multi-day · f free slots · a all day · digits filter · enter confirm · esc cancel"
        maxWidth={viewWidth}
        active={false}
        dimColor
      />

      <Box flexDirection="column" marginTop={1} width={viewWidth}>
        <Text bold dimColor>
          all day
        </Text>
        {allDayEvents.length === 0 ? (
          <Text dimColor>—</Text>
        ) : (
          allDayEvents.map((event) => (
            <MarqueeText key={event.id} text={event.title} maxWidth={viewWidth} prefix="· " active={false} />
          ))
        )}
      </Box>

      <Box marginY={1} width={viewWidth}>
        <Text dimColor>{divider(viewWidth)}</Text>
      </Box>

      <Box width={viewWidth}>
        <Text>date: </Text>
        <Text color="cyanBright">◂ {date.toFormat('EEE MMM d')} ▸</Text>
        {isToday ? <Text dimColor> (today)</Text> : null}
      </Box>
      {multiDay ? (
        <Box width={viewWidth}>
          <Text>end: </Text>
          <Text color="cyanBright">◂ {endDate.toFormat('EEE MMM d')} ▸</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" width={viewWidth}>
        <Text>filter:</Text>
        <Text>
          {'  '}digits: <Text color={!rangeMode ? 'yellow' : undefined}>{filter || '—'}</Text>
        </Text>
        <Text>
          {'  '}range:{' '}
          <Text color={rangeMode ? 'yellow' : undefined}>{rangeInput || '—'}</Text>
          {parsedRange ? (
            <Text dimColor>
              {' '}
              ({parsedRange.start.includes('T')
                ? `${formatTime(parsedRange.start)}–${formatTime(parsedRange.end)}`
                : `${DateTime.fromISO(parsedRange.start).toFormat('MMM d')}–${DateTime.fromISO(parsedRange.end).minus({ days: 1 }).toFormat('MMM d')}`}
              )
            </Text>
          ) : rangeInput.trim() && rangeMode ? (
            <Text dimColor> (unrecognized)</Text>
          ) : null}
        </Text>
        <Text>
          {'  '}multi-day: <Text color={multiDay ? 'yellow' : undefined}>{multiDay ? 'on' : 'off'}</Text>
        </Text>
        <Text>
          {'  '}free slots: <Text color={freeOnly ? 'yellow' : undefined}>{freeOnly ? 'on' : 'off'}</Text>
        </Text>
      </Box>
      <Box width={viewWidth}>
        <Text>step: </Text>
        <Text color="yellow">{stepMinutes < 60 ? `${stepMinutes}m` : `${stepMinutes / 60}h`}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} width={viewWidth}>
        {windowSlots.length === 0 ? (
          <Text dimColor>{freeOnly ? 'no free slots' : 'no matching slots'}</Text>
        ) : (
          windowSlots.map((slot) => {
            const idx = filtered.indexOf(slot);
            const here = idx === sel;
            const overlaps = overlappingEvents(slot, stepMinutes, timedEvents);
            const busy = overlaps.length > 0;
            return (
              <Box key={slot.toISO()} flexDirection="column">
                <Text color={here ? 'cyanBright' : undefined} bold={here} dimColor={busy && !here}>
                  {here ? '▸ ' : '  '}
                  {slot.toFormat('HH:mm')}–{slot.plus({ minutes: stepMinutes }).toFormat('HH:mm')}
                </Text>
                {here
                  ? overlaps.map((event) => (
                      <MarqueeText
                        key={event.id}
                        text={event.title}
                        maxWidth={viewWidth}
                        prefix="    ↳ "
                        active
                        dimColor
                      />
                    ))
                  : null}
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
