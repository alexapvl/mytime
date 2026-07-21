import type { Key } from 'ink';

export type TextEdit = {
  value: string;
  cursorOffset: number;
};

function wordStart(value: string, cursorOffset: number): number {
  let start = cursorOffset;
  while (start > 0 && /\s/.test(value[start - 1]!)) start--;
  while (start > 0 && !/\s/.test(value[start - 1]!)) start--;
  return start;
}

export function deleteTextInput(
  value: string,
  cursorOffset: number,
  input: string,
  key: Key,
): TextEdit | null {
  const clearInput = key.ctrl && input === 'u';
  if (clearInput) return { value: '', cursorOffset: 0 };

  const deleteWord =
    (key.meta && (key.backspace || key.delete)) ||
    (key.ctrl && (input === 'w' || key.backspace || key.delete));
  if (deleteWord) {
    const start = wordStart(value, cursorOffset);
    return {
      value: value.slice(0, start) + value.slice(cursorOffset),
      cursorOffset: start,
    };
  }

  if (!(key.backspace || key.delete)) return null;
  if (cursorOffset <= 0) return { value, cursorOffset };
  return {
    value: value.slice(0, cursorOffset - 1) + value.slice(cursorOffset),
    cursorOffset: cursorOffset - 1,
  };
}
