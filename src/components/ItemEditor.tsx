import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useAppInput } from '../hooks/useAppInput.js';
import type { Item } from '../db/types.js';

type Props = {
  item?: Item;
  mode: 'add' | 'edit';
  defaultPriority?: 0 | 1 | 2 | 3;
  onSubmit: (data: { title: string; notes?: string; project?: string; tags: string[]; priority: 0 | 1 | 2 | 3 }) => void;
  onCancel: () => void;
};

type Field = 'title' | 'notes' | 'project' | 'tags' | 'priority';

export function ItemEditor({ item, mode, defaultPriority = 0, onSubmit, onCancel }: Props) {
  const [field, setField] = useState<Field>('title');
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [project, setProject] = useState(item?.project ?? '');
  const [tags, setTags] = useState(item?.tags.join(' ') ?? '');
  const [priority, setPriority] = useState(String(item?.priority ?? defaultPriority));

  const fields: Field[] = ['title', 'notes', 'project', 'tags', 'priority'];
  const isLastField = field === fields[fields.length - 1];

  const submit = () => {
    if (!title.trim()) {
      setField('title');
      return;
    }

    const parsedTags = tags
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.startsWith('@') || t.startsWith('#'));

    onSubmit({
      title: title.trim(),
      notes: notes.trim() || undefined,
      project: project.trim() || undefined,
      tags: parsedTags.filter((t) => t.startsWith('@')),
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

  useAppInput((_input, key) => {
    if (key.escape) onCancel();
    if (key.tab && key.shift) prevField();
    else if (key.tab) nextField();
    if (key.return && (key.meta || key.ctrl)) submit();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        {mode === 'add' ? 'New task' : 'Edit task'}
      </Text>
      <Text dimColor>tab/enter next field · shift+tab prev · enter save (last) · cmd+enter save · esc cancel</Text>

      <Box>
        <Text color={field === 'title' ? 'cyan' : undefined}>Title*: </Text>
        {field === 'title' ? (
          <TextInput value={title} onChange={setTitle} onSubmit={isLastField ? submit : nextField} />
        ) : (
          <Text>{title || '—'}</Text>
        )}
      </Box>
      <Box>
        <Text color={field === 'notes' ? 'cyan' : undefined}>Notes: </Text>
        {field === 'notes' ? (
          <TextInput value={notes} onChange={setNotes} onSubmit={isLastField ? submit : nextField} />
        ) : (
          <Text dimColor>{notes || '—'}</Text>
        )}
      </Box>
      <Box>
        <Text color={field === 'project' ? 'cyan' : undefined}>Project: </Text>
        {field === 'project' ? (
          <TextInput value={project} onChange={setProject} onSubmit={isLastField ? submit : nextField} />
        ) : (
          <Text>{project ? `#${project}` : '—'}</Text>
        )}
      </Box>
      <Box>
        <Text color={field === 'tags' ? 'cyan' : undefined}>Tags: </Text>
        {field === 'tags' ? (
          <TextInput value={tags} onChange={setTags} onSubmit={isLastField ? submit : nextField} />
        ) : (
          <Text>{tags || '—'}</Text>
        )}
      </Box>
      <Box>
        <Text color={field === 'priority' ? 'cyan' : undefined}>Priority (0-3): </Text>
        {field === 'priority' ? (
          <TextInput value={priority} onChange={setPriority} onSubmit={submit} />
        ) : (
          <Text>P{priority}</Text>
        )}
      </Box>
    </Box>
  );
}
