import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { useStdin } from 'ink';
import {
  ClickRegion,
  dedupeClicks,
  enableMouseTracking,
  extractMouseClicks,
  hasFocusIn,
  hitTestRegion,
  stripInputSequences,
} from '../lib/mouse.js';

type MouseContextValue = {
  setRegions: (id: string, regions: ClickRegion[]) => void;
  clearRegions: (id: string) => void;
};

const MouseContext = createContext<MouseContextValue | null>(null);

export function MouseProvider({ children }: { children: React.ReactNode }) {
  const { internal_eventEmitter } = useStdin();
  const groupsRef = useRef<Map<string, ClickRegion[]>>(new Map());

  const setRegions = useCallback((id: string, regions: ClickRegion[]) => {
    groupsRef.current.set(id, regions);
  }, []);

  const clearRegions = useCallback((id: string) => {
    groupsRef.current.delete(id);
  }, []);

  // Patch the input emitter so mouse escape sequences are intercepted (and
  // dispatched as clicks) here, then stripped before any other listener —
  // including ink-text-input — ever sees them. Otherwise raw SGR sequences
  // like "\x1b[<0;24;13M" get typed into focused text inputs.
  useEffect(() => {
    if (!internal_eventEmitter) return;

    const emitter = internal_eventEmitter as { emit: (event: string, ...args: unknown[]) => boolean };
    const originalEmit = emitter.emit.bind(emitter);

    emitter.emit = (event: string, ...args: unknown[]): boolean => {
      if (event === 'input' && typeof args[0] === 'string') {
        const chunk = args[0];
        if (hasFocusIn(chunk)) enableMouseTracking();
        const clicks = dedupeClicks(extractMouseClicks(chunk));
        if (clicks.length > 0) {
          const all = [...groupsRef.current.values()].flat();
          for (const click of clicks) {
            hitTestRegion(all, click)?.onClick();
          }
        }
        return originalEmit(event, stripInputSequences(chunk), ...args.slice(1));
      }
      return originalEmit(event, ...args);
    };

    return () => {
      emitter.emit = originalEmit;
    };
  }, [internal_eventEmitter]);

  const value = useRef({ setRegions, clearRegions }).current;
  return <MouseContext.Provider value={value}>{children}</MouseContext.Provider>;
}

/** Register clickable regions for a component. Rows/cols are 1-indexed terminal cells. */
export function useClickRegions(id: string, regions: ClickRegion[]): void {
  const ctx = useContext(MouseContext);

  useLayoutEffect(() => {
    ctx?.setRegions(id, regions);
  });

  useLayoutEffect(() => () => ctx?.clearRegions(id), [ctx, id]);
}
