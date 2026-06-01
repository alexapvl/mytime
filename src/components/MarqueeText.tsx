import React, { useEffect, useState } from 'react';
import { Box, Text, type TextProps } from 'ink';
import { padToWidth, sliceByWidth, textWidth, truncateToWidth } from '../lib/textWidth.js';

const SCROLL_MS = 50;
const PAUSE_MS = 900;

type Props = Omit<TextProps, 'children'> & {
  text: string;
  maxWidth: number;
  prefix?: string;
  /** When true and text overflows, scrolls the title with pauses at each end. */
  active?: boolean;
};

export function MarqueeText({ text, maxWidth, prefix = '', active = false, ...textProps }: Props) {
  const prefixWidth = textWidth(prefix);
  const slot = Math.max(1, maxWidth - prefixWidth);
  const overflows = textWidth(text) > slot;
  const [offset, setOffset] = useState(0);
  const contentKey = `${maxWidth}\0${prefix}\0${text}`;

  useEffect(() => {
    setOffset(0);
  }, [contentKey]);

  useEffect(() => {
    if (!active) {
      setOffset(0);
      return;
    }
    if (!overflows) return;

    const maxOffset = textWidth(text) - slot;
    if (maxOffset <= 0) return;

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
        if (scrollOffset >= maxOffset) pauseTicks = Math.ceil(PAUSE_MS / SCROLL_MS);
        return;
      }

      scrollOffset = 0;
      setOffset(0);
      pauseTicks = Math.ceil(PAUSE_MS / SCROLL_MS);
    }, SCROLL_MS);

    return () => clearInterval(id);
  }, [active, overflows, text, slot, contentKey]);

  const body =
    active && overflows ? sliceByWidth(text, offset, slot) : overflows ? truncateToWidth(text, slot) : text;

  const raw = `${prefix}${body}`;
  const line = active && overflows ? padToWidth(raw, maxWidth) : truncateToWidth(raw, maxWidth);

  return (
    <Box height={1} overflow="hidden">
      <Text {...textProps} wrap="truncate">
        {line}
      </Text>
    </Box>
  );
}
