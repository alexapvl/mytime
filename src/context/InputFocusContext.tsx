import React, { createContext, useContext, useMemo, useState } from 'react';

type InputFocusContextValue = {
  inputFocused: boolean;
  setInputFocused: (focused: boolean) => void;
  /** When true, app-level esc must not quit (e.g. backlog filter is active). */
  suppressAppEscape: boolean;
  setSuppressAppEscape: (suppress: boolean) => void;
};

const InputFocusContext = createContext<InputFocusContextValue | null>(null);

export function InputFocusProvider({ children }: { children: React.ReactNode }) {
  const [inputFocused, setInputFocused] = useState(false);
  const [suppressAppEscape, setSuppressAppEscape] = useState(false);
  const value = useMemo(
    () => ({ inputFocused, setInputFocused, suppressAppEscape, setSuppressAppEscape }),
    [inputFocused, suppressAppEscape],
  );
  return <InputFocusContext.Provider value={value}>{children}</InputFocusContext.Provider>;
}

export function useInputFocus() {
  const ctx = useContext(InputFocusContext);
  if (!ctx) {
    return {
      inputFocused: false,
      setInputFocused: () => {},
      suppressAppEscape: false,
      setSuppressAppEscape: () => {},
    };
  }
  return ctx;
}
