import React from 'react';
import { Box, Text } from 'ink';
import type { Item } from '../db/types.js';
import type { InvitationResponse } from '../lib/invitations.js';
import { useAppInput } from '../hooks/useAppInput.js';

type Props = {
  item: Item;
  onSubmit: (response: InvitationResponse) => void;
  onCancel: () => void;
};

export function RsvpEditor({ item, onSubmit, onCancel }: Props) {
  useAppInput((input, key) => {
    if (key.escape) onCancel();
    if (input === 'y') onSubmit('yes');
    if (input === 'm') onSubmit('maybe');
    if (input === 'n') onSubmit('no');
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyanBright" paddingX={1}>
      <Text bold color="cyanBright">Respond to invitation</Text>
      <Text>{item.title}</Text>
      {item.organizer?.displayName || item.organizer?.email ? (
        <Text dimColor>Organizer: {item.organizer.displayName ?? item.organizer.email}</Text>
      ) : null}
      <Text>[y] Yes   [m] Maybe   [n] No   [esc] Cancel</Text>
    </Box>
  );
}
