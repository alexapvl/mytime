import React from 'react';
import { Text } from 'ink';
import { formatShortcuts, type Shortcut } from '../lib/shortcuts.js';

type Props<C> = {
  shortcuts: Shortcut<C>[];
  context: C;
};

export function ShortcutBar<C>({ shortcuts, context }: Props<C>) {
  return <Text dimColor>{formatShortcuts(shortcuts, context)}</Text>;
}
