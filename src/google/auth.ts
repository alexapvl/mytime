import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { OAuth2Client } from 'google-auth-library';
import { calendar } from '@googleapis/calendar';
import { CREDENTIALS_PATH, GOOGLE_SCOPES, TOKEN_PATH, ensureMytimeDir } from '../lib/config.js';
import {
  formatAuthError,
  printPostAuthNextSteps,
  validateCredentialsFile,
} from '../lib/googleSetup.js';

type Token = {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
  id_token?: string | null;
};

type StoredToken = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
  id_token?: string;
};

function normalizeToken(token: Token): StoredToken {
  return {
    access_token: token.access_token ?? undefined,
    refresh_token: token.refresh_token ?? undefined,
    scope: token.scope,
    token_type: token.token_type ?? undefined,
    expiry_date: token.expiry_date ?? undefined,
    id_token: token.id_token ?? undefined,
  };
}

function loadCredentials(): { clientId: string; clientSecret: string } {
  const validation = validateCredentialsFile();
  if (!validation.ok) {
    throw new Error(`${validation.error}\n${validation.hint}`);
  }
  const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')) as {
    installed: { client_id: string; client_secret: string };
  };
  return { clientId: raw.installed.client_id, clientSecret: raw.installed.client_secret };
}

function loadToken(): Token | null {
  if (!existsSync(TOKEN_PATH)) return null;
  return JSON.parse(readFileSync(TOKEN_PATH, 'utf8')) as Token;
}

function saveToken(token: StoredToken): void {
  ensureMytimeDir();
  writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

export function getOAuthClient() {
  const { clientId, clientSecret } = loadCredentials();
  return new OAuth2Client(clientId, clientSecret, 'http://127.0.0.1:3847/oauth2callback');
}

export function getAuthenticatedClient() {
  const oauth2 = getOAuthClient();
  const token = loadToken();
  if (!token) {
    throw new Error('Not authenticated. Run: mytime auth');
  }
  oauth2.setCredentials(normalizeToken(token));
  oauth2.on('tokens', (tokens) => {
    const existing = loadToken() ?? {};
    saveToken(normalizeToken({ ...existing, ...tokens }));
  });
  return oauth2;
}

export function isAuthenticated(): boolean {
  return existsSync(TOKEN_PATH);
}

/** Open the Google OAuth flow when no saved token exists. */
export async function ensureAuthenticated(): Promise<void> {
  if (isAuthenticated()) return;
  await authenticate();
}

function generateOAuthState(): string {
  return randomBytes(32).toString('hex');
}

function verifyOAuthState(expected: string, received: string | null): boolean {
  if (!received || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export async function authenticate(): Promise<void> {
  const oauth2 = getOAuthClient();
  const state = generateOAuthState();
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_SCOPES,
    prompt: 'consent',
    state,
  });

  console.log('\nOpening browser for Google sign-in...\n');
  console.log('If the browser does not open, visit:\n', authUrl, '\n');

  try {
    const { exec } = await import('node:child_process');
    exec(`open "${authUrl}"`);
  } catch {
    // ignore
  }

  try {
    const code = await waitForAuthCode(state);
    const { tokens } = await oauth2.getToken(code);
    saveToken(normalizeToken(tokens));
    console.log('\nAuthenticated. Token saved to', TOKEN_PATH);
    printPostAuthNextSteps();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(formatAuthError(message));
  }
}

function waitForAuthCode(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1:3847');
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const state = url.searchParams.get('state');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>mytime authenticated</h1><p>You can close this tab.</p></body></html>');

      server.close();
      if (error) reject(new Error(error));
      else if (!verifyOAuthState(expectedState, state)) {
        reject(new Error('Invalid OAuth state — possible CSRF attempt'));
      } else if (code) resolve(code);
      else reject(new Error('No authorization code received'));
    });

    server.listen(3847, '127.0.0.1', () => {
      // ready
    });

    server.on('error', reject);

    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out after 2 minutes'));
    }, 120_000);
  });
}

export function getCalendarClient() {
  const auth = getAuthenticatedClient();
  return calendar({ version: 'v3', auth });
}

export { validateCredentialsFile, getGoogleSetupStatus } from '../lib/googleSetup.js';
