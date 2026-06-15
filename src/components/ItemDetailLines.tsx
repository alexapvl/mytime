import React from 'react';
import type { Item } from '../db/types.js';
import { metaLabel, scheduleLabel } from '../lib/itemLabels.js';
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
  let n = 0;
  if (showSchedule && scheduleLabel(item)) n++;
  if (showMeta && metaLabel(item)) n++;
  return n;
}

export function ItemDetailLines({
  item,
  maxWidth,
  showSchedule = true,
  showMeta = true,
}: Props) {
  const schedule = showSchedule ? scheduleLabel(item) : '';
  const meta = showMeta ? metaLabel(item) : '';

  return (
    <>
      {schedule ? (
        <MarqueeText text={schedule} maxWidth={maxWidth} prefix={ITEM_DETAIL_PREFIX} color="cyanBright" />
      ) : null}
      {meta ? (
        <MarqueeText text={meta} maxWidth={maxWidth} prefix={ITEM_DETAIL_PREFIX} color="cyanBright" />
      ) : null}
    </>
  );
}
