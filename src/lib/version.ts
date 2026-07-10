import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

export const VERSION = pkg.version;

function resolveBuildSha(): string {
  try {
    // Replaced with a string literal when bundled via tsup `define`.
    // @ts-expect-error build-time injection
    return __MYTIME_BUILD_SHA__ as string;
  } catch {
    try {
      return execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: root }).trim();
    } catch {
      return 'dev';
    }
  }
}

export const BUILD_SHA = resolveBuildSha();
