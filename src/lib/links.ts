import { spawn } from 'node:child_process';
import type { Item } from '../db/types.js';

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, '');
}

export function firstUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  for (const match of value.match(URL_PATTERN) ?? []) {
    const url = trimUrl(match);
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url;
    } catch {
      // Ignore malformed URL-like text.
    }
  }
  return undefined;
}

export function extractFirstUrl(value: string): { text: string; url?: string } {
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(value))) {
    const url = firstUrl(match[0]);
    if (!url) continue;
    const text = `${value.slice(0, match.index)} ${value.slice(match.index + match[0].length)}`
      .replace(/\s+/g, ' ')
      .trim();
    return { text, url };
  }
  return { text: value };
}

export function openUrl(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? '/usr/bin/open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export function openItemUrl(item: Item): Promise<void> {
  if (!item.url) return Promise.reject(new Error('No attached link found'));
  return openUrl(item.url);
}
