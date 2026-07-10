import { realpathSync } from 'node:fs';
import { DateTime } from 'luxon';
import { getMeta, setMeta } from '../db/meta.js';
import { BUILD_SHA } from './version.js';

const GITHUB_REPO = 'alexapvl/mytime';
const META_UPDATE_CHECK_DATE = 'update_check_date';
const META_UPDATE_AVAILABLE_SHA = 'update_available_sha';

export type UpdateNotice = {
  message: string;
  command: string;
};

type InstallMethod = 'homebrew' | 'source';

function detectInstallMethod(): InstallMethod {
  try {
    const entry = realpathSync(process.argv[1] ?? '');
    if (entry.includes('/Cellar/mytime/')) return 'homebrew';
  } catch {
    // ignore
  }
  return 'source';
}

function upgradeCommand(method: InstallMethod): string {
  if (method === 'homebrew') return 'brew update && brew upgrade mytime --fetch-HEAD';
  return 'git pull && pnpm install && pnpm build';
}

function shaShort(sha: string): string {
  return sha.slice(0, 7);
}

function isSameCommit(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

async function fetchLatestMainSha(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/main?per_page=1`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mytime-cli',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { sha?: string };
    return data.sha ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function shouldCheckToday(): boolean {
  const today = DateTime.local().toISODate()!;
  return getMeta(META_UPDATE_CHECK_DATE) !== today;
}

function markCheckedToday(): void {
  setMeta(META_UPDATE_CHECK_DATE, DateTime.local().toISODate()!);
}

function cachedAvailableSha(): string | null {
  const raw = getMeta(META_UPDATE_AVAILABLE_SHA);
  return raw || null;
}

function setCachedAvailableSha(sha: string | null): void {
  setMeta(META_UPDATE_AVAILABLE_SHA, sha ?? '');
}

function noticeForSha(remoteSha: string): UpdateNotice {
  const method = detectInstallMethod();
  const remoteShort = shaShort(remoteSha);
  const localShort = BUILD_SHA === 'dev' ? 'dev' : shaShort(BUILD_SHA);
  return {
    message: `Update available (${localShort} → ${remoteShort})`,
    command: upgradeCommand(method),
  };
}

/** Return cached or freshly fetched update notice; network check at most once per local day. */
export async function checkForUpdatesOnceDaily(): Promise<UpdateNotice | null> {
  if (BUILD_SHA === 'dev') return null;

  const pending = cachedAvailableSha();
  if (pending && isSameCommit(BUILD_SHA, pending)) {
    setCachedAvailableSha(null);
  }

  if (!shouldCheckToday()) {
    const available = cachedAvailableSha();
    if (available && !isSameCommit(BUILD_SHA, available)) return noticeForSha(available);
    return null;
  }

  markCheckedToday();

  const remoteSha = await fetchLatestMainSha();
  if (!remoteSha || isSameCommit(BUILD_SHA, remoteSha)) {
    setCachedAvailableSha(null);
    return null;
  }

  setCachedAvailableSha(remoteSha);
  return noticeForSha(remoteSha);
}
