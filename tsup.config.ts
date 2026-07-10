import { defineConfig } from 'tsup';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
  define: {
    __MYTIME_VERSION__: JSON.stringify(pkg.version),
    __MYTIME_BUILD_SHA__: JSON.stringify(buildSha),
  },
  banner: {
    // -S lets us pass node flags via the shebang. --no-deprecation silences the
    // harmless punycode (DEP0040) warning from a googleapis transitive dependency.
    js: '#!/usr/bin/env -S node --no-deprecation',
  },
});
