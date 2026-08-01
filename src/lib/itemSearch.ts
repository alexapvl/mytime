import type { Item } from '../db/types.js';

// Field weights dominate quality bonuses so title always outranks project/tags/notes.
const TITLE_WEIGHT = 120;
const PROJECT_WEIGHT = 70;
const TAG_WEIGHT = 55;
const NOTES_WEIGHT = 20;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Field match quality on top of the field weight. */
function matchQuality(haystack: string, needle: string): number {
  if (haystack === needle) return 40;
  if (haystack.startsWith(needle)) return 20;
  const boundary = new RegExp(`(?:^|[\\s\\-_/#@.])${escapeRegExp(needle)}`);
  if (boundary.test(haystack)) return 10;
  return 0;
}

function fieldScore(haystack: string | undefined, needle: string, weight: number): number {
  if (!haystack) return -1;
  const h = haystack.toLowerCase();
  if (!h.includes(needle)) return -1;
  return weight + matchQuality(h, needle);
}

function bestTokenScore(item: Item, token: string): number {
  let best = fieldScore(item.title, token, TITLE_WEIGHT);
  best = Math.max(best, fieldScore(item.project, token, PROJECT_WEIGHT));
  for (const tag of item.tags) {
    best = Math.max(best, fieldScore(tag, token, TAG_WEIGHT));
    best = Math.max(best, fieldScore(`#${tag}`, token, TAG_WEIGHT));
  }
  best = Math.max(best, fieldScore(item.notes, token, NOTES_WEIGHT));
  return best;
}

/**
 * Score an item against a query. Returns null when any whitespace token fails to match
 * (AND). Empty / whitespace-only query scores 0 for every item.
 */
export function scoreItem(item: Item, query: string): number | null {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return 0;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let total = 0;
  for (const token of tokens) {
    const score = bestTokenScore(item, token);
    if (score < 0) return null;
    total += score;
  }
  return total;
}

export function itemMatchesQuery(item: Item, query: string): boolean {
  return scoreItem(item, query) !== null;
}

/** Rank matching items: higher score, then lower priority number, then older createdAt. */
export function rankItems(items: Item[], query: string): Item[] {
  const trimmed = query.trim();
  if (!trimmed) return [...items];

  const scored: { item: Item; score: number }[] = [];
  for (const item of items) {
    const score = scoreItem(item, query);
    if (score === null) continue;
    scored.push({ item, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.item.priority !== b.item.priority) return a.item.priority - b.item.priority;
    return a.item.createdAt.localeCompare(b.item.createdAt);
  });
  return scored.map((row) => row.item);
}
