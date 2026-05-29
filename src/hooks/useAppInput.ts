import { useInput as inkUseInput } from 'ink';
import type { Key } from 'ink';
import { isKeyboardSuppressed, stripMouseSequences } from '../lib/mouse.js';

type InputHandler = (input: string, key: Key) => void;
type InputOptions = { isActive?: boolean };

export function useAppInput(inputHandler: InputHandler, options: InputOptions = {}): void {
  inkUseInput((input, key) => {
    if (isKeyboardSuppressed()) return;
    const cleaned = stripMouseSequences(input);
    if (!cleaned && !key.escape && !key.return && !key.tab && !key.backspace && !key.delete) return;
    inputHandler(cleaned, key);
  }, options);
}
