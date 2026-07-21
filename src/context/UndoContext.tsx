import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type UndoEntry = {
  label: string;
  run: () => void | Promise<void>;
};

type UndoContextValue = {
  pushUndo: (label: string, run: () => void | Promise<void>) => void;
  undoLast: () => Promise<string | null>;
  canUndo: boolean;
};

const UndoContext = createContext<UndoContextValue | null>(null);

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<UndoEntry[]>([]);

  const pushUndo = useCallback((label: string, run: () => void | Promise<void>) => {
    setStack((s) => [...s, { label, run }]);
  }, []);

  const undoLast = useCallback(async (): Promise<string | null> => {
    const entry = stack[stack.length - 1];
    if (!entry) return null;
    setStack((s) => s.slice(0, -1));
    try {
      await entry.run();
    } catch (error) {
      setStack((s) => [...s, entry]);
      throw error;
    }
    return entry.label;
  }, [stack]);

  const value = useMemo(
    () => ({ pushUndo, undoLast, canUndo: stack.length > 0 }),
    [pushUndo, undoLast, stack.length],
  );

  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>;
}

export function useUndo() {
  const ctx = useContext(UndoContext);
  if (!ctx) {
    return { pushUndo: () => {}, undoLast: async () => null, canUndo: false };
  }
  return ctx;
}
