import React, { useMemo, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { DateTime } from 'luxon';
import { useAppInput } from '../hooks/useAppInput.js';
import { MarqueeText } from './MarqueeText.js';
import type { Item } from '../db/types.js';
import { isSlotFree, listDayEventsForSchedule, overlappingEvents, splitDayEvents, buildScheduleSlots } from '../lib/scheduleOverlap.js';
import { allDayRange } from '../lib/time.js';

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

  const [date, setDate] = useState(initialDate);
  const [filter, setFilter] = useState('');
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

  const goToDate = (next: DateTime) => {
    const clamped = next < today ? today : next;
    setDate(clamped);
    setFilter('');
    setSelected(nearestIndexTo(buildScheduleSlots(clamped, stepMinutes), DateTime.local().toMillis()));
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
    if (input === 'f') {
      setFreeOnly((on) => !on);
      setSelected(0);
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
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={viewWidth + 2}>
      <MarqueeText
        text={item.title}
        maxWidth={viewWidth}
        prefix={headerPrefix}
        active={false}
        bold
        color="cyan"
      />
      <MarqueeText
        text="←/→ day · ↑/↓ time · +/- step · f free slots · a all day · digits filter · enter confirm · esc cancel"
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
        <Text color="cyan">◂ {date.toFormat('EEE MMM d')} ▸</Text>
        {isToday ? <Text dimColor> (today)</Text> : null}
      </Box>
      <Box flexDirection="column" width={viewWidth}>
        <Text>filter:</Text>
        <Text>
          {'  '}digits: <Text color="yellow">{filter || '—'}</Text>
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
                <Text color={here ? 'cyan' : undefined} bold={here} dimColor={busy && !here}>
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
