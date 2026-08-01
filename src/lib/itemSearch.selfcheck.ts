import assert from 'node:assert/strict';
import type { Item } from '../db/types.js';
import { rankItems, scoreItem } from './itemSearch.js';

function stub(partial: Partial<Item> & Pick<Item, 'id' | 'title'>): Item {
  return {
    notes: undefined,
    project: undefined,
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

const titleHit = stub({ id: '1', title: 'Ship meloDL release' });
const projectHit = stub({ id: '2', title: 'Write docs', project: 'meloDL' });
const tagHit = stub({ id: '3', title: 'Cleanup', tags: ['#meloDL'] });
const notesHit = stub({ id: '4', title: 'Follow up', notes: 'ask about meloDL builds' });
const exactTitle = stub({ id: '5', title: 'meloDL' });
const unrelated = stub({ id: '6', title: 'Buy milk', project: 'home', tags: ['#errands'] });

assert.equal(scoreItem(unrelated, 'meloDL'), null);
assert.ok((scoreItem(exactTitle, 'meloDL') ?? 0) > (scoreItem(titleHit, 'meloDL') ?? 0));
assert.ok((scoreItem(titleHit, 'meloDL') ?? 0) > (scoreItem(projectHit, 'meloDL') ?? 0));
assert.ok((scoreItem(projectHit, 'meloDL') ?? 0) > (scoreItem(tagHit, 'meloDL') ?? 0));
assert.ok((scoreItem(tagHit, 'meloDL') ?? 0) > (scoreItem(notesHit, 'meloDL') ?? 0));

const ranked = rankItems([notesHit, tagHit, projectHit, titleHit, exactTitle, unrelated], 'meloDL');
assert.deepEqual(
  ranked.map((item) => item.id),
  ['5', '1', '2', '3', '4'],
);

assert.equal(scoreItem(titleHit, 'melo missing'), null);
assert.ok(scoreItem(stub({ id: '7', title: 'Ship meloDL', project: 'release' }), 'meloDL release') !== null);

assert.deepEqual(
  rankItems([titleHit, unrelated], '   ').map((item) => item.id),
  ['1', '6'],
);

console.log('itemSearch.selfcheck: ok');
