import React, { createContext, useContext, useMemo, useState } from 'react';

type InputFocusContextValue = {
  inputFocused: boolean;
  setInputFocused: (focused: boolean) => void;
};

const InputFocusContext = createContext<InputFocusContextValue | null>(null);

export function InputFocusProvider({ children }: { children: React.ReactNode }) {
  const [inputFocused, setInputFocused] = useState(false);
  const value = useMemo(() => ({ inputFocused, setInputFocused }), [inputFocused]);
  return <InputFocusContext.Provider value={value}>{children}</InputFocusContext.Provider>;
}

export function useInputFocus() {
  const ctx = useContext(InputFocusContext);
  if (!ctx) {
    return { inputFocused: false, setInputFocused: () => {} };
  }
  return ctx;
}
