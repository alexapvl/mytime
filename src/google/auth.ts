import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { google } from 'googleapis';
import { CREDENTIALS_PATH, GOOGLE_SCOPES, TOKEN_PATH, ensureMytimeDir } from '../lib/config.js';

type Credentials = {
  installed?: { client_id: string; client_secret: string; redirect_uris?: string[] };
  web?: { client_id: string; client_secret: string; redirect_uris?: string[] };
};

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
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Missing credentials at ${CREDENTIALS_PATH}. See README for Google Cloud setup.`,
    );
  }
  const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')) as Credentials;
  const creds = raw.installed ?? raw.web;
  if (!creds?.client_id || !creds.client_secret) {
    throw new Error('Invalid credentials.json format.');
  }
  return { clientId: creds.client_id, clientSecret: creds.client_secret };
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
  return new google.auth.OAuth2(clientId, clientSecret, 'http://127.0.0.1:3847/oauth2callback');
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

  const code = await waitForAuthCode(state);
  const { tokens } = await oauth2.getToken(code);
  saveToken(normalizeToken(tokens));
  console.log('\nAuthenticated. Token saved to', TOKEN_PATH);
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
  return google.calendar({ version: 'v3', auth });
}
