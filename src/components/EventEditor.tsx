import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useAppInput } from '../hooks/useAppInput.js';
import type { Item, Reminder } from '../db/types.js';
import { listReminderPresets, defaultReminders, reminderLabel } from '../lib/reminders.js';

type Props = {
  item?: Item;
  mode: 'add' | 'edit';
  onSubmit: (data: { title: string; notes?: string; location?: string; reminders: Reminder[] }) => void;
  onCancel: () => void;
};

type Field = 'title' | 'notes' | 'location' | 'reminders';

const NOTES_LABEL = 'Notes: ';
const NOTES_INDENT = ' '.repeat(NOTES_LABEL.length);

function cleanTypedInput(value: string): string {
  return value.replace(/[\r\n]/g, '');
}

function editableText(value: string) {
  if (!value) return <Text inverse> </Text>;
  return (
    <Text>
      {value}
      <Text inverse> </Text>
    </Text>
  );
}

function NotesField({ value, editing }: { value: string; editing: boolean }) {
  if (!editing && !value) {
    return (
      <Box>
        <Text>{NOTES_LABEL}</Text>
        <Text>—</Text>
      </Box>
    );
  }

  const lines = editing && !value ? [''] : value.split('\n');

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Box key={i}>
          {i === 0 ? (
            <Text color={editing ? 'cyanBright' : undefined}>{NOTES_LABEL}</Text>
          ) : (
            <Text>{NOTES_INDENT}</Text>
          )}
          {editing ? (
            <>
              <Text>{line}</Text>
              {i === lines.length - 1 ? <Text inverse> </Text> : null}
            </>
          ) : (
            <Text>{line}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}

export function EventEditor({ item, mode, onSubmit, onCancel }: Props) {
  const [field, setField] = useState<Field>('title');
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [location, setLocation] = useState(item?.location ?? '');
  const [enabledReminders, setEnabledReminders] = useState<number[]>(
    () => item?.reminders.map((r) => r.minutes) ?? defaultReminders().map((r) => r.minutes),
  );
  const [reminderIndex, setReminderIndex] = useState(0);
  const reminderPresets = listReminderPresets();

  const fields: Field[] = ['title', 'notes', 'location', 'reminders'];
  const isLastField = field === fields[fields.length - 1];
  const values: Record<Exclude<Field, 'reminders'>, string> = { title, notes, location };
  const setters: Record<Exclude<Field, 'reminders'>, (value: string) => void> = {
    title: setTitle,
    notes: setNotes,
    location: setLocation,
  };

  const submit = () => {
    if (!title.trim()) {
      setField('title');
      return;
    }

    onSubmit({
      title: title.trim(),
      notes: notes.trim() || undefined,
      location: location.trim() || undefined,
      reminders: enabledReminders.map((minutes) => ({ method: 'popup', minutes })),
    });
  };

  const nextField = () => {
    const idx = fields.indexOf(field);
    if (idx < fields.length - 1) setField(fields[idx + 1]!);
  };

  const prevField = () => {
    const idx = fields.indexOf(field);
    if (idx > 0) setField(fields[idx - 1]!);
  };

  const toggleReminder = (minutes: number) => {
    setEnabledReminders((current) =>
      current.includes(minutes) ? current.filter((m) => m !== minutes) : [...current, minutes].sort((a, b) => b - a),
    );
  };

  useAppInput((input, key) => {
    if (key.escape) onCancel();
    if (input === '\n' || (key.return && (key.shift || key.ctrl || key.meta))) {
      return;
    }

    if (field === 'reminders') {
      if (key.upArrow || input === 'k') {
        setReminderIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setReminderIndex((i) => Math.min(reminderPresets.length - 1, i + 1));
        return;
      }
      if (input === ' ' || input === 'x') {
        const preset = reminderPresets[reminderIndex];
        if (preset) toggleReminder(preset.minutes);
        return;
      }
      if (key.tab && key.shift) {
        prevField();
        return;
      }
      if (key.tab || key.return) {
        if (key.return && isLastField) submit();
        else nextField();
        return;
      }
      return;
    }

    if (key.upArrow) {
      prevField();
      return;
    }
    if (key.downArrow) {
      nextField();
      return;
    }
    if (key.tab && key.shift) {
      prevField();
      return;
    }
    if (key.tab) {
      nextField();
      return;
    }
    if (key.return) {
      if (isLastField) submit();
      else nextField();
      return;
    }
    if (key.backspace || key.delete) {
      setters[field](values[field].slice(0, -1));
      return;
    }
    const typed = cleanTypedInput(input);
    if (typed && !key.ctrl && !key.meta) {
      setters[field](values[field] + typed);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyanBright" paddingX={1}>
      <Text bold color="cyanBright">
        {mode === 'add' ? 'New event' : 'Edit event'}
      </Text>
      <Text dimColor>type to edit · tab/enter/↓ next · shift+tab/↑ prev · enter save (last) · esc cancel</Text>

      <Box>
        <Text color={field === 'title' ? 'cyanBright' : undefined}>Title*: </Text>
        {field === 'title' ? editableText(title) : <Text>{title || '—'}</Text>}
      </Box>
      <NotesField value={notes} editing={field === 'notes'} />
      <Box>
        <Text color={field === 'location' ? 'cyanBright' : undefined}>Location: </Text>
        {field === 'location' ? editableText(location) : <Text>{location || '—'}</Text>}
      </Box>
      <Box flexDirection="column">
        <Text color={field === 'reminders' ? 'cyanBright' : undefined}>Reminders:</Text>
        {reminderPresets.map((preset, idx) => {
          const enabled = enabledReminders.includes(preset.minutes);
          const active = field === 'reminders' && idx === reminderIndex;
          return (
            <Text key={preset.minutes} color={active ? 'cyanBright' : undefined} bold={active}>
              {active ? '> ' : '  '}
              [{enabled ? 'x' : ' '}] {preset.label} before ({reminderLabel(preset.minutes)})
            </Text>
          );
        })}
        {field === 'reminders' ? <Text dimColor>  space/x toggle · ↑/↓ navigate</Text> : null}
      </Box>
    </Box>
  );
}
