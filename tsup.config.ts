import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  banner: {
    // -S lets us pass node flags via the shebang. --no-deprecation silences the
    // harmless punycode (DEP0040) warning from a googleapis transitive dependency.
    js: '#!/usr/bin/env -S node --no-deprecation',
  },
});
