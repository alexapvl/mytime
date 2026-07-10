import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function devRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

function resolveVersion(): string {
  try {
    // @ts-expect-error build-time injection
    return __MYTIME_VERSION__ as string;
  } catch {
    const pkg = JSON.parse(readFileSync(join(devRoot(), 'package.json'), 'utf8')) as { version: string };
    return pkg.version;
  }
}

function resolveBuildSha(): string {
  try {
    // @ts-expect-error build-time injection
    return __MYTIME_BUILD_SHA__ as string;
  } catch {
    try {
      return execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: devRoot() }).trim();
    } catch {
      return 'dev';
    }
  }
}

export const VERSION = resolveVersion();
export const BUILD_SHA = resolveBuildSha();
