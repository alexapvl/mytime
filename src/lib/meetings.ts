import { spawn } from 'node:child_process';
import type { Item, MeetingProvider } from '../db/types.js';

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, '');
}

export function meetingProviderForUrl(url: string): MeetingProvider {
  return /(^|\.)meet\.google\.com$/i.test(new URL(url).hostname) ? 'google_meet' : 'other';
}

export function findMeetingUrl(...values: Array<string | null | undefined>): string | undefined {
  const urls = values.flatMap((value) => value?.match(URL_PATTERN) ?? []).map(trimUrl);
  return urls.find((url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'meet.google.com' || host.endsWith('.zoom.us') || host === 'teams.microsoft.com' ||
        host === 'teams.live.com' || host === 'webex.com' || host.endsWith('.webex.com') ||
        host === 'meet.jit.si' || host === 'whereby.com' || host === 'around.co' ||
        host === 'facetime.apple.com';
    } catch {
      return false;
    }
  });
}

export function meetingUrlForItem(item: Item): string | undefined {
  return item.meetingUrl ?? findMeetingUrl(item.location, item.notes);
}

export function openMeeting(item: Item): Promise<void> {
  const url = meetingUrlForItem(item);
  if (!url) return Promise.reject(new Error('No meeting link found'));
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/open', [url], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
