import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import { useAppInput } from '../hooks/useAppInput.js';
import { deleteTextInput } from '../lib/textInput.js';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  focus?: boolean;
  placeholder?: string;
};

export function AppTextInput({
  value,
  onChange,
  onSubmit,
  focus = true,
  placeholder = '',
}: Props) {
  const [cursorOffset, setCursorOffset] = useState(value.length);

  useEffect(() => {
    setCursorOffset((offset) => Math.min(offset, value.length));
  }, [value]);

  useAppInput(
    (input, key) => {
      if (key.upArrow || key.downArrow || key.tab || (key.ctrl && input === 'c')) return;
      if (key.return) {
        onSubmit?.(value);
        return;
      }
      if (key.leftArrow) {
        setCursorOffset((offset) => Math.max(0, offset - 1));
        return;
      }
      if (key.rightArrow) {
        setCursorOffset((offset) => Math.min(value.length, offset + 1));
        return;
      }

      const deletion = deleteTextInput(value, cursorOffset, input, key);
      if (deletion) {
        setCursorOffset(deletion.cursorOffset);
        if (deletion.value !== value) onChange(deletion.value);
        return;
      }
      if (key.ctrl || key.meta || key.escape) return;

      const next = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
      setCursorOffset(cursorOffset + input.length);
      if (next !== value) onChange(next);
    },
    { isActive: focus },
  );

  if (!value) {
    return <Text inverse>{placeholder ? placeholder[0] : ' '}</Text>;
  }

  return (
    <Text>
      {value.slice(0, cursorOffset)}
      <Text inverse>{value[cursorOffset] ?? ' '}</Text>
      {value.slice(cursorOffset + (cursorOffset < value.length ? 1 : 0))}
    </Text>
  );
}
