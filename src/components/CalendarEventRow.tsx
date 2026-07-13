import React from 'react';
import { Box, Text } from 'ink';
import { DateTime } from 'luxon';
import type { Item } from '../db/types.js';
import { formatScheduleTime } from '../lib/time.js';
import { padToWidth, textWidth } from '../lib/textWidth.js';
import { MarqueeText } from './MarqueeText.js';

export const CALENDAR_LABEL_COL = 11;
export const CALENDAR_MARKER_COL = 2;
export const CALENDAR_TITLE_GAP = 2;
export const CALENDAR_PREFIX_COL = CALENDAR_LABEL_COL + CALENDAR_MARKER_COL + CALENDAR_TITLE_GAP;

const DONE_PREFIX = '✓ ';

export function hasWeekTime(item: Item): boolean {
  if (item.allDay || !item.start || !item.end) return false;
  const start = DateTime.fromISO(item.start);
  const end = DateTime.fromISO(item.end);
  return !(start.hour === 0 && start.minute === 0 && end.hour === 0 && end.minute === 0);
}

export function calendarEventTimeLabel(item: Item): string {
  if (hasWeekTime(item)) {
    return formatScheduleTime(item.start!, item.end, item.allDay);
  }
  return '';
}

function displayTitle(item: Item): string {
  return item.status === 'done' && item.source === 'task' ? `${DONE_PREFIX}${item.title}` : item.title;
}

function isDoneTask(item: Item): boolean {
  return item.status === 'done' && item.source === 'task';
}

type Props = {
  item: Item;
  rowWidth: number;
  selected: boolean;
  color?: string;
  dimColor?: boolean;
  underline?: boolean;
  titleSuffix?: string;
  showTime?: boolean;
  compactLabel?: string;
};

export function CalendarEventRow({
  item,
  rowWidth,
  selected,
  color,
  dimColor,
  underline,
  titleSuffix = '',
  showTime = true,
  compactLabel,
}: Props) {
  const external = item.source === 'external';
  const done = isDoneTask(item);
  const title = displayTitle(item) + titleSuffix;
  const timed = showTime && hasWeekTime(item);
  const lineColor = color ?? (selected ? 'cyanBright' : undefined);
  const lineDim = selected ? false : (dimColor ?? (external || done));
  const lineUnderline = underline ?? false;

  if (compactLabel) {
    const marker = selected ? '▸' : '·';
    const prefix = `${compactLabel} ${marker}  `;
    return (
      <Box width={rowWidth} height={1} flexDirection="row" overflow="hidden">
        <Text color={lineColor} bold={selected} dimColor={lineDim} wrap="truncate">
          {prefix}
        </Text>
        <MarqueeText
          text={title}
          maxWidth={Math.max(1, rowWidth - textWidth(prefix))}
          active={selected}
          color={lineColor}
          bold={selected}
          dimColor={lineDim}
          underline={lineUnderline}
        />
      </Box>
    );
  }

  if (!timed) {
    return (
      <Box width={rowWidth} height={1} overflow="hidden">
        <MarqueeText
          text={title}
          maxWidth={rowWidth}
          active={selected}
          color={lineColor}
          bold={selected}
          dimColor={lineDim}
          underline={lineUnderline}
        />
      </Box>
    );
  }

  const marker = selected ? '▸' : '·';
  const titleWidth = Math.max(1, rowWidth - CALENDAR_PREFIX_COL);

  return (
    <Box width={rowWidth} height={1} flexDirection="row" overflow="hidden">
      <Box width={CALENDAR_LABEL_COL} height={1} overflow="hidden">
        <Text color={lineColor} bold={selected} dimColor={lineDim} wrap="truncate">
          {padToWidth(calendarEventTimeLabel(item), CALENDAR_LABEL_COL)}
        </Text>
      </Box>
      <Box width={CALENDAR_MARKER_COL} height={1} overflow="hidden">
        <Text color={lineColor} bold={selected} dimColor={lineDim} wrap="truncate">
          {padToWidth(` ${marker}`, CALENDAR_MARKER_COL)}
        </Text>
      </Box>
      <Box width={CALENDAR_TITLE_GAP} height={1} />
      <MarqueeText
        text={title}
        maxWidth={titleWidth}
        active={selected}
        color={lineColor}
        bold={selected}
        dimColor={lineDim}
        underline={lineUnderline}
      />
    </Box>
  );
}

export function calendarDetailPrefix(item: Item): string {
  if (!hasWeekTime(item)) return '';
  return padToWidth('', CALENDAR_PREFIX_COL);
}
