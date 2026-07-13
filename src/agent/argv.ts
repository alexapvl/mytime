import { emitUsage } from './format.js';

export type ParsedArgs = {
  positional: string[];
  flags: Map<string, string | boolean>;
};

const BOOLEAN_FLAGS = new Set(['all-day', 'full', 'help', 'json']);

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      flags.set('help', true);
      continue;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags.set(arg.slice(2, eq), arg.slice(eq + 1));
        continue;
      }
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags.set(key, true);
        continue;
      }
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length === 2) {
      flags.set(arg.slice(1), true);
      continue;
    }
    positional.push(arg);
  }

  return { positional, flags };
}

export function flagString(flags: Map<string, string | boolean>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

export function flagBool(flags: Map<string, string | boolean>, name: string): boolean {
  return flags.get(name) === true;
}

export function flagInt(flags: Map<string, string | boolean>, name: string): number | undefined {
  const value = flagString(flags, name);
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function flagStringList(flags: Map<string, string | boolean>, name: string): string[] | undefined {
  const value = flagString(flags, name);
  if (value === undefined) return undefined;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function flagDone(flags: Map<string, string | boolean>): boolean | undefined {
  const value = flags.get('done');
  if (value === undefined) return undefined;
  if (value === true) return true;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function requirePos(positional: string[], index: number, label: string, help: string[] = []): string {
  const value = positional[index];
  if (!value) emitMissing(label, help);
  return value;
}

function emitMissing(label: string, help: string[]): never {
  emitUsage(`Missing ${label}`, help);
}
