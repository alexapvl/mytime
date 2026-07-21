import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useAppInput } from '../hooks/useAppInput.js';
import type { Item } from '../db/types.js';
import { deleteTextInput } from '../lib/textInput.js';

type Props = {
  item?: Item;
  mode: 'add' | 'edit';
  defaultPriority?: 0 | 1 | 2 | 3;
  onSubmit: (data: { title: string; notes?: string; url?: string; project?: string; tags: string[]; priority: 0 | 1 | 2 | 3 }) => void;
  onCancel: () => void;
};

type Field = 'title' | 'notes' | 'url' | 'project' | 'tags' | 'priority';

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

export function ItemEditor({ item, mode, defaultPriority = 0, onSubmit, onCancel }: Props) {
  const [field, setField] = useState<Field>('title');
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [project, setProject] = useState(item?.project?.replace(/^@/, '') ?? '');
  const [tags, setTags] = useState(item?.tags.join(' ') ?? '');
  const [priority, setPriority] = useState(String(item?.priority ?? defaultPriority));

  const fields: Field[] = ['title', 'notes', 'url', 'project', 'tags', 'priority'];
  const isLastField = field === fields[fields.length - 1];
  const values: Record<Field, string> = { title, notes, url, project, tags, priority };
  const setters: Record<Field, (value: string) => void> = {
    title: setTitle,
    notes: setNotes,
    url: setUrl,
    project: setProject,
    tags: setTags,
    priority: setPriority,
  };

  const submit = () => {
    if (!title.trim()) {
      setField('title');
      return;
    }

    const parsedTags = tags
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.startsWith('#'));

    onSubmit({
      title: title.trim(),
      notes: notes.trim() || undefined,
      url: url.trim() || undefined,
      project: project.trim().replace(/^@/, '') || undefined,
      tags: parsedTags,
      priority: Math.min(3, Math.max(0, parseInt(priority, 10) || 0)) as 0 | 1 | 2 | 3,
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

  useAppInput((input, key) => {
    if (key.escape) onCancel();
    if (input === '\n' || (key.return && (key.shift || key.ctrl || key.meta))) {
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
        {mode === 'add' ? 'New task' : 'Edit task'}
      </Text>
      <Text dimColor>type · ⌥⌫/ctrl+w word · ⌘⌫/ctrl+u clear · tab/enter/↓ next · shift+tab/↑ prev · enter save (last) · esc cancel</Text>

      <Box>
        <Text color={field === 'title' ? 'cyanBright' : undefined}>Title*: </Text>
        {field === 'title' ? editableText(title) : <Text>{title || '—'}</Text>}
      </Box>
      <NotesField value={notes} editing={field === 'notes'} />
      <Box>
        <Text color={field === 'url' ? 'cyanBright' : undefined}>Link: </Text>
        {field === 'url' ? editableText(url) : <Text>{url || '-'}</Text>}
      </Box>
      <Box>
        <Text color={field === 'project' ? 'cyanBright' : undefined}>Project: </Text>
        {field === 'project' ? editableText(project) : <Text>{project || '—'}</Text>}
      </Box>
      <Box>
        <Text color={field === 'tags' ? 'cyanBright' : undefined}>Tags: </Text>
        {field === 'tags' ? editableText(tags) : <Text>{tags || '—'}</Text>}
      </Box>
      <Box>
        <Text color={field === 'priority' ? 'cyanBright' : undefined}>Priority (0-3): </Text>
        {field === 'priority' ? editableText(priority) : <Text>{priority}</Text>}
      </Box>
    </Box>
  );
}
