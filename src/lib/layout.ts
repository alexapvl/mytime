/**
 * Fixed terminal rows (1-indexed) for the app chrome, assuming the root Box
 * uses padding={1} and the app runs in the alternate screen buffer so output
 * starts at the top-left of the viewport.
 *
 * row 1: top padding
 * row 2: title          (marginBottom -> row 3 blank)
 * row 4: tab bar        (marginBottom -> row 5 blank)
 * row 6: first view row
 */
export const TAB_ROW = 4;
export const VIEW_ROW0 = 6;

/** Per-day column geometry in the week grid (Box width 18 + marginRight 2, left padding 1). */
export const WEEK_COL_WIDTH = 20;
export const WEEK_COL_START = 2;

export function weekColStart(dayIndex: number): number {
  return WEEK_COL_START + dayIndex * WEEK_COL_WIDTH;
}
