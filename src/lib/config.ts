import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const MYTIME_DIR = join(homedir(), '.mytime');
export const DB_PATH = join(MYTIME_DIR, 'db.sqlite');
export const TOKEN_PATH = join(MYTIME_DIR, 'token.json');
export const CREDENTIALS_PATH = join(MYTIME_DIR, 'credentials.json');

export function ensureMytimeDir(): void {
  mkdirSync(MYTIME_DIR, { recursive: true });
}

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar'];
