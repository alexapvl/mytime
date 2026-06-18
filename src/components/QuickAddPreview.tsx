import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { quickAddPreviewLine, type QuickAddPreviewOptions } from '../lib/quickAddPreview.js';

type Props = QuickAddPreviewOptions & {
  input: string;
};

export function QuickAddPreview({
  input,
  referenceDate,
  defaultPriority,
  kind,
  fallbackDay,
  useDefaultPriority,
}: Props) {
  const preview = useMemo(
    () => quickAddPreviewLine(input, { referenceDate, defaultPriority, kind, fallbackDay, useDefaultPriority }),
    [input, referenceDate, defaultPriority, kind, fallbackDay, useDefaultPriority],
  );

  if (!preview) return null;

  return (
    <Box marginTop={1}>
      <Text dimColor>({preview})</Text>
    </Box>
  );
}
