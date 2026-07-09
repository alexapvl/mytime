import os from 'node:os';
import { encode } from '@toon-format/toon';
import type { AgentResult } from './types.js';

export function binPath(): string {
  const raw = process.argv[1] ?? 'mytime';
  const home = os.homedir();
  return raw.startsWith(home) ? `~${raw.slice(home.length)}` : raw;
}

export function emitResult(result: AgentResult, opts: { json?: boolean; description?: string } = {}): number {
  if (result.kind === 'error') {
    const body: Record<string, unknown> = { error: result.message };
    if (result.help?.length) body.help = result.help;
    writeOut(body, opts.json);
    return result.exitCode ?? 1;
  }

  const body: Record<string, unknown> = {};
  if (opts.description) {
    body.bin = binPath();
    body.description = opts.description;
  }
  Object.assign(body, result.payload);
  if (result.help?.length) body.help = result.help;
  writeOut(body, opts.json);
  return 0;
}

function writeOut(body: Record<string, unknown>, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  console.log(encode(body));
}

export function emitUsage(message: string, help: string[]): never {
  const body: Record<string, unknown> = { error: message, help };
  console.log(encode(body));
  process.exit(2);
}

export const AGENT_DESCRIPTION =
  'Unified tasks and calendar for agents — backlog, schedule, free slots, Google Calendar sync';
