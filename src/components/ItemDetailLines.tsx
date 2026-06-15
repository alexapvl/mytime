import React from 'react';
import type { Item } from '../db/types.js';
import { detailLines } from '../lib/itemLabels.js';
import { MarqueeText } from './MarqueeText.js';

export const ITEM_DETAIL_PREFIX = '  ↳ ';

type Props = {
  item: Item;
  maxWidth: number;
  showSchedule?: boolean;
  showMeta?: boolean;
};

export function itemDetailLineCount(
  item: Item,
  { showSchedule = true, showMeta = true }: { showSchedule?: boolean; showMeta?: boolean } = {},
): number {
  return detailLines(item, { showSchedule, showMeta }).length;
}

export function ItemDetailLines({
  item,
  maxWidth,
  showSchedule = true,
  showMeta = true,
}: Props) {
  const lines = detailLines(item, { showSchedule, showMeta });

  return (
    <>
      {lines.map((line, i) => (
        <MarqueeText key={`${i}-${line}`} text={line} maxWidth={maxWidth} prefix={ITEM_DETAIL_PREFIX} color="cyanBright" />
      ))}
    </>
  );
}
