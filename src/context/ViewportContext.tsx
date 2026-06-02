import React, { createContext, useContext, useMemo } from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { contentAreaRows, type AppScreen } from '../lib/layout.js';

export type Viewport = {
  rows: number;
  columns: number;
  contentRows: number;
};

const ViewportContext = createContext<Viewport>({ rows: 24, columns: 80, contentRows: 15 });

export function ViewportProvider({ screen, children }: { screen: AppScreen; children: React.ReactNode }) {
  const { rows, columns } = useTerminalSize();
  const value = useMemo(
    () => ({
      rows,
      columns,
      contentRows: contentAreaRows(rows, screen),
    }),
    [rows, columns, screen],
  );

  return <ViewportContext.Provider value={value}>{children}</ViewportContext.Provider>;
}

export function useViewport(): Viewport {
  return useContext(ViewportContext);
}
