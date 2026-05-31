import React, { useEffect, useState } from 'react';
import { Box, Text, type TextProps } from 'ink';

const SCROLL_MS = 50;
const PAUSE_MS = 900;

type Props = Omit<TextProps, 'children'> & {
  text: string;
  maxWidth: number;
  prefix?: string;
  /** When true and text overflows, scrolls the title with pauses at each end. */
  active?: boolean;
};

function fitWidth(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value.padEnd(width, ' ');
}

export function MarqueeText({ text, maxWidth, prefix = '', active = false, ...textProps }: Props) {
  const slot = Math.max(1, maxWidth - prefix.length);
  const overflows = text.length > slot;
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!active || !overflows) {
      setOffset(0);
      return;
    }

    const maxOffset = text.length - slot;
    let scrollOffset = 0;
    let pauseTicks = Math.ceil(PAUSE_MS / SCROLL_MS);

    const id = setInterval(() => {
      if (pauseTicks > 0) {
        pauseTicks--;
        return;
      }

      if (scrollOffset < maxOffset) {
        scrollOffset++;
        setOffset(scrollOffset);
        if (scrollOffset === maxOffset) pauseTicks = Math.ceil(PAUSE_MS / SCROLL_MS);
        return;
      }

      scrollOffset = 0;
      setOffset(0);
      pauseTicks = Math.ceil(PAUSE_MS / SCROLL_MS);
    }, SCROLL_MS);

    return () => clearInterval(id);
  }, [active, overflows, text, slot]);

  const start = overflows && active ? offset : 0;
  const body = overflows ? fitWidth(text.slice(start, start + slot), slot) : text;

  return (
    <Box width={maxWidth} overflow="hidden">
      <Text {...textProps} wrap="truncate">
        {prefix}
        {body}
      </Text>
    </Box>
  );
}
