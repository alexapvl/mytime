import React from 'react';
import { Box, Text } from 'ink';
import { padToWidth } from '../lib/textWidth.js';

export const COLUMN_DIVIDER_WIDTH = 1;

export function ColumnDivider({ lines }: { lines: number }) {
  return (
    <Box flexDirection="column" width={COLUMN_DIVIDER_WIDTH}>
      {Array.from({ length: lines }, (_, i) => (
        <Box key={i} height={1}>
          <Text color="gray" wrap="truncate">
            {padToWidth('│', COLUMN_DIVIDER_WIDTH)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
