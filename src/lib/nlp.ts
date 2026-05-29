import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import { defaultEnd } from './time.js';

export type ParsedItem = {
  title: string;
  start?: string;
  end?: string;
  tags: string[];
  project?: string;
  priority: 0 | 1 | 2 | 3;
};

export function parseQuickAdd(input: string): ParsedItem {
  let text = input.trim();
  const tags: string[] = [];
  let project: string | undefined;
  let priority: 0 | 1 | 2 | 3 = 0;

  const tagMatches = text.match(/(?:^|\s)(@\w+|#\w+)/g);
  if (tagMatches) {
    for (const m of tagMatches) {
      const tag = m.trim();
      if (tag.startsWith('#')) {
        project = tag.slice(1);
      } else {
        tags.push(tag);
      }
    }
    text = text.replace(/(?:^|\s)(@\w+|#\w+)/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const prioMatch = text.match(/\bp([0-3])\b/i);
  if (prioMatch) {
    priority = parseInt(prioMatch[1]!, 10) as 0 | 1 | 2 | 3;
    text = text.replace(/\bp[0-3]\b/i, '').replace(/\s+/g, ' ').trim();
  }

  const results = chrono.parse(text, new Date(), { forwardDate: true });
  let start: string | undefined;
  let end: string | undefined;
  let title = text;

  if (results.length > 0) {
    const r = results[0]!;
    const startDate = r.start.date();
    start = DateTime.fromJSDate(startDate).toISO()!;

    if (r.end) {
      end = DateTime.fromJSDate(r.end.date()).toISO()!;
    } else {
      end = defaultEnd(start, 60);
    }

    title = text.slice(0, r.index).trim() + text.slice(r.index + r.text.length).trim();
    title = title.replace(/\s+/g, ' ').trim();
  }

  if (!title) {
    title = input.trim();
  }

  return { title, start, end, tags, project, priority };
}
