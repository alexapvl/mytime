import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useAppInput } from '../hooks/useAppInput.js';
import type { EventAttendee, Item, MeetingProvider, Reminder } from '../db/types.js';
import { listReminderPresets, defaultReminders, reminderLabel } from '../lib/reminders.js';
import { getDefaultMeetingProvider } from '../db/meta.js';
import { getActiveProvider } from '../calendar/provider.js';
import { deleteTextInput } from '../lib/textInput.js';

type Props = {
  item?: Item;
  mode: 'add' | 'edit';
  onSubmit: (data: {
    title: string;
    notes?: string;
    location?: string;
    url?: string;
    reminders: Reminder[];
    attendees: EventAttendee[];
    meetingProvider?: MeetingProvider;
  }) => void;
  onCancel: () => void;
  enabledFields?: EventEditorField[];
};

export type EventEditorField = 'title' | 'notes' | 'location' | 'url' | 'guests' | 'meeting' | 'reminders';
type Field = EventEditorField;

const DEFAULT_FIELDS: Field[] = ['title', 'guests', 'meeting', 'notes', 'location', 'url', 'reminders'];

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

export function EventEditor({ item, mode, onSubmit, onCancel, enabledFields }: Props) {
  const fields = enabledFields?.length ? enabledFields : DEFAULT_FIELDS;
  const googleMeetAvailable = getActiveProvider() === 'google' && fields.includes('meeting');
  const [field, setField] = useState<Field>(fields[0]!);
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [location, setLocation] = useState(item?.location ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [guests, setGuests] = useState(() =>
    (item?.attendees ?? [])
      .filter((attendee) => !attendee.organizer || attendee.self)
      .map((attendee) => attendee.email)
      .join(', '),
  );
  const [googleMeet, setGoogleMeet] = useState(
    item ? item.meetingProvider === 'google_meet' : googleMeetAvailable && getDefaultMeetingProvider() === 'google_meet',
  );
  const [guestError, setGuestError] = useState('');
  const [enabledReminders, setEnabledReminders] = useState<number[]>(
    () => item?.reminders.map((r) => r.minutes) ?? defaultReminders().map((r) => r.minutes),
  );
  const [reminderIndex, setReminderIndex] = useState(0);
  const reminderPresets = listReminderPresets();

  const isLastField = field === fields[fields.length - 1];
  const values: Record<Exclude<Field, 'meeting' | 'reminders'>, string> = { title, notes, location, url, guests };
  const setters: Record<Exclude<Field, 'meeting' | 'reminders'>, (value: string) => void> = {
    title: setTitle,
    notes: setNotes,
    location: setLocation,
    url: setUrl,
    guests: setGuests,
  };

  const submit = () => {
    if (!title.trim()) {
      setField('title');
      return;
    }

    const guestEmails = [...new Set(guests.split(/[,\s]+/).map((email) => email.trim()).filter(Boolean))];
    const invalidGuest = guestEmails.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (invalidGuest) {
      setGuestError(`Invalid guest email: ${invalidGuest}`);
      setField('guests');
      return;
    }
    setGuestError('');
    const attendees = guestEmails.map((email) => {
      const existing = item?.attendees.find((attendee) => attendee.email.toLowerCase() === email.toLowerCase());
      return { email, responseStatus: existing?.responseStatus ?? 'needsAction' } satisfies EventAttendee;
    });

    onSubmit({
      title: title.trim(),
      notes: notes.trim() || undefined,
      location: location.trim() || undefined,
      url: url.trim() || undefined,
      reminders: enabledReminders.map((minutes) => ({ method: 'popup', minutes })),
      attendees,
      meetingProvider: googleMeet ? 'google_meet' : undefined,
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

    if (field === 'meeting') {
      if ((input === ' ' || input === 'x') && googleMeetAvailable && !(item?.meetingProvider === 'google_meet' && item.meetingUrl)) {
        setGoogleMeet((enabled) => !enabled);
        return;
      }
      if (key.tab && key.shift) prevField();
      else if (key.tab || key.return) nextField();
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
    const deletion = deleteTextInput(values[field], values[field].length, input, key);
    if (deletion) {
      setters[field](deletion.value);
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
      <Text dimColor>type · ⌥⌫/ctrl+w word · ⌘⌫/ctrl+u clear · tab/enter/↓ next · shift+tab/↑ prev · enter save (last) · esc cancel</Text>

      {fields.includes('title') ? <Box>
        <Text color={field === 'title' ? 'cyanBright' : undefined}>Title*: </Text>
        {field === 'title' ? editableText(title) : <Text>{title || '—'}</Text>}
      </Box> : null}
      {fields.includes('guests') ? <Box>
        <Text color={field === 'guests' ? 'cyanBright' : undefined}>Guests: </Text>
        {field === 'guests' ? editableText(guests) : <Text>{guests || '-'}</Text>}
      </Box> : null}
      {fields.includes('guests') ? <Text dimColor>Guest email addresses only, separated by commas or spaces.</Text> : null}
      {fields.includes('guests') && guestError ? <Text color="red">{guestError}</Text> : null}
      {fields.includes('meeting') ? <Box>
        <Text color={field === 'meeting' ? 'cyanBright' : undefined}>
          [{googleMeet ? 'x' : ' '}] Google Meet
        </Text>
        {item?.meetingProvider === 'google_meet' && item.meetingUrl ? <Text dimColor> (already created)</Text> : null}
        {!googleMeetAvailable ? <Text dimColor> (requires Google Calendar provider)</Text> : null}
      </Box> : null}
      {fields.includes('notes') ? <NotesField value={notes} editing={field === 'notes'} /> : null}
      {fields.includes('location') ? <Box>
        <Text color={field === 'location' ? 'cyanBright' : undefined}>Location: </Text>
        {field === 'location' ? editableText(location) : <Text>{location || '—'}</Text>}
      </Box> : null}
      {fields.includes('url') ? <Box>
        <Text color={field === 'url' ? 'cyanBright' : undefined}>Link: </Text>
        {field === 'url' ? editableText(url) : <Text>{url || '-'}</Text>}
      </Box> : null}
      {fields.includes('reminders') ? <Box flexDirection="column">
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
      </Box> : null}
    </Box>
  );
}
