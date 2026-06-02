export type AppScreen = 'main' | 'settings';

/**
 * Fixed terminal rows (1-indexed) for the app chrome, assuming the root Box
 * uses padding={1}, height={stdout.rows}, and the alternate screen buffer.
 *
 * row 1: top padding
 * row 2: title          (marginBottom -> row 3 blank)
 * row 4: tab bar        (marginBottom -> row 5 blank)  [main only]
 * row 6: first view row
 */
export const TAB_ROW = 4;
export const VIEW_ROW0 = 6;

/** Rows outside the flex content area (padding, title, tabs, status). Keep in sync with app.tsx. */
export const MAIN_CONTENT_CHROME_ROWS = 9;
export const SETTINGS_CONTENT_CHROME_ROWS = 7;

export function contentAreaRows(terminalRows: number, screen: AppScreen): number {
  const chrome = screen === 'main' ? MAIN_CONTENT_CHROME_ROWS : SETTINGS_CONTENT_CHROME_ROWS;
  return Math.max(1, terminalRows - chrome);
}

/** Rows each view uses before its scrollable body (inside the content area). */
export const DAY_VIEW_HEADER_ROWS = 3;
export const WEEK_VIEW_HEADER_ROWS = 4;
export const BACKLOG_VIEW_HEADER_ROWS = 2;
export const PAST_DUE_VIEW_HEADER_ROWS = 2;
export const SETTINGS_VIEW_HEADER_ROWS = 6;

/** Per-day column geometry in the week grid (Box width 18 + marginRight 2, left padding 1). */
export const WEEK_COL_WIDTH = 20;
export const WEEK_COL_START = 2;

export function weekColStart(dayIndex: number): number {
  return WEEK_COL_START + dayIndex * WEEK_COL_WIDTH;
}
