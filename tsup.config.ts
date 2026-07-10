import { defineConfig } from 'tsup';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

let buildSha = 'dev';
try {
  buildSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  // not a git checkout (e.g. source tarball)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: true,
  // Keep in sync with bundled[] in scripts/build-macos-pack.sh
  noExternal: [
    '@toon-format/toon',
    'chrono-node',
    'luxon',
    'string-width',
    'uuid',
    'zod',
  ],
  define: {
    __MYTIME_VERSION__: JSON.stringify(pkg.version),
    __MYTIME_BUILD_SHA__: JSON.stringify(buildSha),
  },
  banner: {
    js: '#!/usr/bin/env -S node --no-deprecation',
  },
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      'react-devtools-core': join(rootDir, 'scripts/shims/empty-devtools.js'),
    };
  },
});
