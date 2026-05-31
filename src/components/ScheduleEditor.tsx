import React, { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { DateTime } from 'luxon';
import { useAppInput } from '../hooks/useAppInput.js';
import type { Item } from '../db/types.js';
import { allDayRange } from '../lib/time.js';

type Props = {
  item: Item;
  onSubmit: (start: string, end: string, allDay: boolean) => void;
  onCancel: () => void;
};

const VISIBLE = 9;
const STEP_MINUTES = [15, 30, 60, 120, 240] as const;
const DEFAULT_STEP_INDEX = 2;

/** Step-aligned slots for a day. Today starts at the next slot boundary at or after now. */
function buildSlots(date: DateTime, stepMinutes: number): DateTime[] {
  const now = DateTime.local();
  const isToday = date.hasSame(now, 'day');
  const dayStart = date.startOf('day');
  const startMinute = isToday
    ? Math.ceil(now.diff(dayStart, 'minutes').minutes / stepMinutes) * stepMinutes
    : 0;
  const slots: DateTime[] = [];
  for (let minute = startMinute; minute < 24 * 60; minute += stepMinutes) {
    slots.push(dayStart.plus({ minutes: minute }));
  }
  return slots;
}

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

export function ScheduleEditor({ item, onSubmit, onCancel }: Props) {
  const today = DateTime.local().startOf('day');
  const isReschedule = Boolean(item.start);
  // For a reschedule, open on the item's current day/time; otherwise today/now.
  const target = item.start ? DateTime.fromISO(item.start) : DateTime.local();
  const initialDate = target.startOf('day') < today ? today : target.startOf('day');

  const [date, setDate] = useState(initialDate);
  const [filter, setFilter] = useState('');
  const [stepIndex, setStepIndex] = useState(DEFAULT_STEP_INDEX);
  const stepMinutes = STEP_MINUTES[stepIndex]!;
  const [selected, setSelected] = useState(() => nearestIndexTo(buildSlots(initialDate, STEP_MINUTES[DEFAULT_STEP_INDEX]!), target.toMillis()));

  const filtered = useMemo(
    () => buildSlots(date, stepMinutes).filter((slot) => slot.toFormat('HH:mm').includes(filter)),
    [date, filter, stepMinutes],
  );

  const sel = Math.min(selected, Math.max(0, filtered.length - 1));
  const isToday = date.hasSame(DateTime.local(), 'day');

  const goToDate = (next: DateTime) => {
    const clamped = next < today ? today : next;
    setDate(clamped);
    setFilter('');
    setSelected(nearestIndexTo(buildSlots(clamped, stepMinutes), DateTime.local().toMillis()));
  };

  const changeStep = (direction: -1 | 1) => {
    setStepIndex((i) => Math.max(0, Math.min(STEP_MINUTES.length - 1, i + direction)));
    setSelected(0);
  };

  useAppInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const slot = filtered[sel];
      if (slot) onSubmit(slot.toISO()!, slot.plus({ minutes: stepMinutes }).toISO()!, false);
      return;
    }
    if (input === 'a') {
      const range = allDayRange(date.toISO()!);
      onSubmit(range.start, range.end, true);
      return;
    }
    if (input === 'h' || key.leftArrow) {
      goToDate(date.minus({ days: 1 }));
      return;
    }
    if (input === 'l' || key.rightArrow) {
      goToDate(date.plus({ days: 1 }));
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
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        {isReschedule ? 'reschedule' : 'schedule'}: {item.title}
      </Text>
      <Text dimColor>←/→ day · ↑/↓ time · +/- step · a all day · digits filter · enter confirm · esc cancel</Text>

      <Box marginTop={1}>
        <Text>date: </Text>
        <Text color="cyan">◂ {date.toFormat('EEE MMM d')} ▸</Text>
        {isToday ? <Text dimColor> (today)</Text> : null}
      </Box>
      <Box>
        <Text>filter: </Text>
        <Text color="yellow">{filter || '—'}</Text>
      </Box>
      <Box>
        <Text>step: </Text>
        <Text color="yellow">{stepMinutes < 60 ? `${stepMinutes}m` : `${stepMinutes / 60}h`}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {windowSlots.length === 0 ? (
          <Text dimColor>no matching slots</Text>
        ) : (
          windowSlots.map((slot) => {
            const idx = filtered.indexOf(slot);
            const here = idx === sel;
            return (
              <Text key={slot.toISO()} color={here ? 'cyan' : undefined} bold={here} underline={here}>
                {here ? '▸ ' : '  '}
                {slot.toFormat('HH:mm')}–{slot.plus({ minutes: stepMinutes }).toFormat('HH:mm')}
              </Text>
            );
          })
        )}
      </Box>
    </Box>
  );
}
