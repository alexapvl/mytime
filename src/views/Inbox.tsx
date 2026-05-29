import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { ItemEditor } from '../components/ItemEditor.js';
import { ScheduleEditor } from '../components/ScheduleEditor.js';
import { useClickRegions } from '../components/Mouse.js';
import { useInputFocus } from '../context/InputFocusContext.js';
import { useAppInput } from '../hooks/useAppInput.js';
import type { ClickRegion } from '../lib/mouse.js';
import { VIEW_ROW0 } from '../lib/layout.js';
import type { Item } from '../db/types.js';
import { createItem, deleteItem, listInbox, scheduleItem, toggleDone, updateItem } from '../db/items.js';
import { autoPush, autoRemove } from '../google/autoSync.js';
import { formatDate, formatTime } from '../lib/time.js';
import { parseQuickAdd } from '../lib/nlp.js';

type Props = {
  onRefresh: () => void;
  onStatus: (msg: string) => void;
};

type Mode = 'list' | 'add' | 'edit' | 'schedule' | 'quick';

export function InboxView({ onRefresh, onStatus }: Props) {
  const { setInputFocused } = useInputFocus();
  const [items, setItems] = useState<Item[]>(() => listInbox());
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [quickInput, setQuickInput] = useState('');

  useEffect(() => {
    setInputFocused(mode !== 'list');
    return () => setInputFocused(false);
  }, [mode, setInputFocused]);

  const refresh = () => {
    setItems(listInbox());
    onRefresh();
  };

  // The help line sits on VIEW_ROW0; items follow on subsequent rows.
  const regions = useMemo<ClickRegion[]>(() => {
    if (mode !== 'list') return [];
    return items.map((_, i) => ({ row: VIEW_ROW0 + 1 + i, onClick: () => setSelected(i) }));
  }, [mode, items]);
  useClickRegions('inbox', regions);

  useAppInput(
    (input, key) => {
      if (mode === 'quick') {
        if (key.escape) {
          setMode('list');
          setQuickInput('');
        }
        return;
      }
      if (mode !== 'list') return;

      if (input === 'j' || key.downArrow) setSelected((s) => Math.min(s + 1, Math.max(0, items.length - 1)));
      if (input === 'k' || key.upArrow) setSelected((s) => Math.max(s - 1, 0));
      if (input === 'a') setMode('add');
      if (input === 'q') setMode('quick');
      if (input === 'e' && items[selected]) setMode('edit');
      if (input === 'x' && items[selected]) {
        const id = items[selected]!.id;
        toggleDone(id);
        refresh();
        autoPush(id, onStatus);
        onStatus('Toggled done');
      }
      if (input === 'd' && items[selected]) {
        const victim = items[selected]!;
        deleteItem(victim.id);
        setSelected((s) => Math.max(0, s - 1));
        refresh();
        autoRemove(victim, onStatus);
        onStatus('Deleted');
      }
      if (input === 's' && items[selected]) setMode('schedule');
    },
    { isActive: mode === 'list' || mode === 'quick' },
  );

  if (mode === 'quick') {
    return (
      <Box flexDirection="column">
        <Text color="cyan">Quick add (NLP):</Text>
        <Text dimColor>e.g. "review PR tomorrow 3pm @work p2 #swe"</Text>
        <Box marginTop={1}>
          <Text>&gt; </Text>
          <TextInput
            value={quickInput}
            onChange={setQuickInput}
            onSubmit={(val) => {
              const parsed = parseQuickAdd(val);
              const created = createItem({
                title: parsed.title,
                tags: parsed.tags,
                project: parsed.project,
                priority: parsed.priority,
                start: parsed.start,
                end: parsed.end,
              });
              refresh();
              if (created.start) autoPush(created.id, onStatus);
              onStatus(`Added: ${parsed.title}`);
              setQuickInput('');
              setMode('list');
            }}
          />
        </Box>
      </Box>
    );
  }

  if (mode === 'add') {
    return (
      <ItemEditor
        mode="add"
        onCancel={() => setMode('list')}
        onSubmit={(data) => {
          createItem({
            title: data.title,
            notes: data.notes,
            project: data.project,
            tags: data.tags,
            priority: data.priority,
          });
          refresh();
          onStatus('Task added');
          setMode('list');
        }}
      />
    );
  }

  if (mode === 'edit' && items[selected]) {
    const item = items[selected]!;
    return (
      <ItemEditor
        mode="edit"
        item={item}
        onCancel={() => setMode('list')}
        onSubmit={(data) => {
          updateItem(item.id, {
            title: data.title,
            notes: data.notes,
            project: data.project,
            tags: data.tags,
            priority: data.priority,
          });
          refresh();
          autoPush(item.id, onStatus);
          onStatus('Task updated');
          setMode('list');
        }}
      />
    );
  }

  if (mode === 'schedule' && items[selected]) {
    const item = items[selected]!;
    return (
      <ScheduleEditor
        item={item}
        onCancel={() => setMode('list')}
        onSubmit={(start, end) => {
          scheduleItem(item.id, start, end);
          refresh();
          autoPush(item.id, onStatus);
          onStatus(`Scheduled for ${formatDate(start)} ${formatTime(start)}`);
          setMode('list');
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>
        click to select · j/k navigate · a add · q quick-add · e edit · s schedule · x done · d delete
      </Text>
      {items.length === 0 ? (
        <Text dimColor>Backlog empty. Press a to add or q for quick-add.</Text>
      ) : (
        items.map((item, i) => (
          <Text
            key={item.id}
            color={i === selected ? 'cyan' : undefined}
            bold={i === selected}
            underline={i === selected}
          >
            {i === selected ? '▸ ' : '  '}
            {item.start ? `${formatDate(item.start)} ${formatTime(item.start)}  ` : ''}
            {item.priority > 0 ? `[P${item.priority}] ` : ''}
            {item.title}
            {item.project ? ` #${item.project}` : ''}
            {item.tags.length ? ` ${item.tags.join(' ')}` : ''}
          </Text>
        ))
      )}
    </Box>
  );
}
