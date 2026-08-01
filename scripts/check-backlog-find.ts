/**
 * Mirrors Backlog find filtering/ranking against the live backlog DB.
 * Run: pnpm exec tsx scripts/check-backlog-find.ts
 */
import assert from 'node:assert/strict';
import { listBacklog } from '../src/db/items.js';
import { itemMatchesQuery, rankItems, scoreItem } from '../src/lib/itemSearch.js';

const items = listBacklog();
assert.ok(items.length > 0, 'expected a non-empty backlog for this check');

const sample = items.find((item) => item.title.trim().length >= 4);
assert.ok(sample, 'need a titled backlog item');
const token = sample.title.split(/\s+/).find((part) => part.length >= 3) ?? sample.title.slice(0, 4);

const filtered = items.filter((item) => itemMatchesQuery(item, token));
assert.ok(filtered.some((item) => item.id === sample.id), `token "${token}" should match sample`);

for (const item of filtered) {
  assert.ok(scoreItem(item, token) !== null);
}

const ranked = rankItems(items, token);
assert.deepEqual(
  ranked.map((item) => item.id).sort(),
  filtered.map((item) => item.id).sort(),
);

for (let i = 1; i < ranked.length; i++) {
  const prev = scoreItem(ranked[i - 1]!, token)!;
  const next = scoreItem(ranked[i]!, token)!;
  assert.ok(prev >= next, 'rankItems must be non-increasing by score');
}

const nonsense = `no-match-${Date.now()}-xyz`;
assert.equal(rankItems(items, nonsense).length, 0);
assert.equal(items.filter((item) => itemMatchesQuery(item, nonsense)).length, 0);

if (sample.project) {
  const byProject = rankItems(items, sample.project);
  assert.ok(byProject.some((item) => item.id === sample.id));
}

console.log(`check-backlog-find: ok (${items.length} items, token="${token}", matches=${filtered.length})`);
