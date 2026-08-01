import assert from 'node:assert/strict';
import { stripMytimeSyncEnvelope } from './syncNotes.js';
import { scoreItem } from './itemSearch.js';
import type { Item } from '../db/types.js';

assert.equal(
  stripMytimeSyncEnvelope(
    'real note\nProject: @meloDL\nPriority: P2\n - synced via mytime',
  ),
  'real note',
);

assert.equal(
  stripMytimeSyncEnvelope(
    'Priority: P3\n - synced via mytime\nProject: @meloDL\nPriority: P2\n - synced via mytime',
  ),
  undefined,
);

assert.equal(stripMytimeSyncEnvelope('keep this\n- mytime event'), 'keep this');

function stub(partial: Partial<Item> & Pick<Item, 'id' | 'title'>): Item {
  return {
    tags: [],
    priority: 2,
    status: 'open',
    source: 'task',
    reminders: [],
    attendees: [],
    allDay: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

const polluted = stub({
  id: '1',
  title: 'Ship release',
  project: 'other',
  notes: 'Priority: P0\n - synced via mytime\nProject: @other',
});
assert.equal(scoreItem(polluted, 'mytime'), null);

const realNotes = stub({
  id: '2',
  title: 'Ship release',
  notes: 'wire this into mytime agent search',
});
assert.ok((scoreItem(realNotes, 'mytime') ?? 0) > 0);

const titled = stub({ id: '3', title: 'mytime backlog find' });
assert.ok((scoreItem(titled, 'mytime') ?? 0) > 0);

console.log('syncNotes.selfcheck: ok');
