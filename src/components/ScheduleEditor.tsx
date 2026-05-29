import React, { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { DateTime } from 'luxon';
import { useAppInput } from '../hooks/useAppInput.js';
import type { Item } from '../db/types.js';

type Props = {
  item: Item;
  onSubmit: (start: string, end: string) => void;
  onCancel: () => void;
};

const VISIBLE = 9;

/** Hourly slots for a day. Today starts at the next full hour; future days span all 24h. */
function buildSlots(date: DateTime): DateTime[] {
  const now = DateTime.local();
  const isToday = date.hasSame(now, 'day');
  const startHour = isToday ? now.hour + (now.minute > 0 || now.second > 0 ? 1 : 0) : 0;
  const slots: DateTime[] = [];
  for (let h = startHour; h <= 23; h++) {
    slots.push(date.set({ hour: h, minute: 0, second: 0, millisecond: 0 }));
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
  const [selected, setSelected] = useState(() => nearestIndexTo(buildSlots(initialDate), target.toMillis()));

  const filtered = useMemo(
    () => buildSlots(date).filter((slot) => slot.toFormat('HH:mm').includes(filter)),
    [date, filter],
  );

  const sel = Math.min(selected, Math.max(0, filtered.length - 1));
  const isToday = date.hasSame(DateTime.local(), 'day');

  const goToDate = (next: DateTime) => {
    const clamped = next < today ? today : next;
    setDate(clamped);
    setFilter('');
    setSelected(nearestIndexTo(buildSlots(clamped), DateTime.local().toMillis()));
  };

  useAppInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const slot = filtered[sel];
      if (slot) onSubmit(slot.toISO()!, slot.plus({ hours: 1 }).toISO()!);
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
        {isReschedule ? 're-schedule' : 'schedule'}: {item.title}
      </Text>
      <Text dimColor>h/l change day · j/k pick time · type digits to filter · enter confirm · esc cancel</Text>

      <Box marginTop={1}>
        <Text>date: </Text>
        <Text color="cyan">◂ {date.toFormat('EEE MMM d')} ▸</Text>
        {isToday ? <Text dimColor> (today)</Text> : null}
      </Box>
      <Box>
        <Text>filter: </Text>
        <Text color="yellow">{filter || '—'}</Text>
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
                {slot.toFormat('HH:mm')}–{slot.plus({ hours: 1 }).toFormat('HH:mm')}
              </Text>
            );
          })
        )}
      </Box>
    </Box>
  );
}
