import { existsSync, readFileSync } from 'node:fs';
import { printAgentNextStepsLine } from './agentSetup.js';
import { CREDENTIALS_PATH, MYTIME_DIR, TOKEN_PATH, ensureMytimeDir } from './config.js';

export const GOOGLE_CONSOLE_LINKS = {
  home: 'https://console.cloud.google.com/',
  calendarApi: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
  oauthConsent: 'https://console.cloud.google.com/apis/credentials/consent',
  credentials: 'https://console.cloud.google.com/apis/credentials',
} as const;

export const AGENT_SETUP_PROMPT = `Help me set up Google Calendar for mytime (https://github.com/alexapvl/mytime).

Goal: mytime needs a Google Cloud OAuth Desktop client saved at ~/.mytime/credentials.json, then I will run \`mytime auth\` and \`mytime sync\` locally.

Please do the following:

1. In Google Cloud Console (https://console.cloud.google.com/):
   - Create or select a project for personal mytime use.
   - Enable the Google Calendar API (APIs & Services → Library → "Google Calendar API").
   - Configure OAuth consent screen: External user type, app name "mytime", add my Google account as a Test user. Testing mode is fine.
   - Create Credentials → OAuth client ID → Application type "Desktop app".
   - Download the client JSON.

2. On my machine:
   - Create ~/.mytime if it does not exist.
   - Save the downloaded JSON as ~/.mytime/credentials.json (must have an "installed" key with client_id and client_secret).
   - Do NOT commit credentials.json to git.

3. Tell me when credentials.json is in place. I will run \`mytime auth\` myself in the terminal (browser OAuth — you cannot complete this step for me). After auth succeeds, I will run \`mytime sync\` to verify.

If you can control a browser (e.g. chrome-devtools-axi), navigate the Console for me step by step. Otherwise, give exact click-by-click instructions and pause after each step for confirmation.`;

export type CredentialsValidation =
  | { ok: true; clientId: string }
  | { ok: false; error: string; hint: string };

export type SetupCheck = {
  id: string;
  ok: boolean;
  label: string;
  detail?: string;
  fix?: string;
};

export type GoogleSetupStatus = {
  mytimeDir: boolean;
  credentials: boolean;
  token: boolean;
  credentialsValidation: CredentialsValidation | null;
  ready: boolean;
};

export function credentialsExist(): boolean {
  return existsSync(CREDENTIALS_PATH);
}

export function validateCredentialsFile(): CredentialsValidation {
  if (!existsSync(CREDENTIALS_PATH)) {
    return {
      ok: false,
      error: `Missing credentials at ${CREDENTIALS_PATH}`,
      hint: 'Run: mytime setup google or create a Desktop OAuth client in Google Cloud Console (see README).',
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
  } catch {
    return {
      ok: false,
      error: 'credentials.json is not valid JSON',
      hint: 'Re-download the OAuth client JSON from Google Cloud Console → Credentials → Desktop app.',
    };
  }

  const data = raw as {
    installed?: { client_id?: string; client_secret?: string };
    web?: { client_id?: string; client_secret?: string };
  };

  const installed = data.installed;
  if (installed?.client_id && installed.client_secret) {
    return { ok: true, clientId: installed.client_id };
  }

  if (data.web?.client_id) {
    return {
      ok: false,
      error: 'credentials.json is a Web OAuth client, not Desktop',
      hint: 'Create Credentials → OAuth client ID → Application type "Desktop app", then replace credentials.json.',
    };
  }

  return {
    ok: false,
    error: 'credentials.json missing installed.client_id and client_secret',
    hint: 'Download the Desktop app OAuth JSON from Google Cloud Console. See: mytime setup google --links',
  };
}

export function getGoogleSetupStatus(): GoogleSetupStatus {
  const mytimeDir = existsSync(MYTIME_DIR);
  const credentials = credentialsExist();
  const token = existsSync(TOKEN_PATH);
  const credentialsValidation = credentials ? validateCredentialsFile() : null;
  const credentialsOk = credentialsValidation?.ok === true;
  return {
    mytimeDir,
    credentials,
    token,
    credentialsValidation,
    ready: credentialsOk && token,
  };
}

export function runSetupChecks(): SetupCheck[] {
  const checks: SetupCheck[] = [];

  if (!existsSync(MYTIME_DIR)) {
    checks.push({
      id: 'dir',
      ok: false,
      label: '~/.mytime directory',
      detail: 'Not created yet',
      fix: 'Run: mkdir -p ~/.mytime (or mytime auth google / mytime setup google will create it)',
    });
  } else {
    checks.push({ id: 'dir', ok: true, label: '~/.mytime directory' });
  }

  if (!credentialsExist()) {
    checks.push({
      id: 'credentials',
      ok: false,
      label: 'credentials.json (Google OAuth Desktop client)',
      detail: `Expected at ${CREDENTIALS_PATH}`,
      fix: 'Run: mytime setup google --links, then save the downloaded JSON as credentials.json',
    });
  } else {
    const validation = validateCredentialsFile();
    if (validation.ok) {
      checks.push({
        id: 'credentials',
        ok: true,
        label: 'credentials.json (Google OAuth Desktop client)',
        detail: `client_id …${validation.clientId.slice(-12)}`,
      });
    } else {
      checks.push({
        id: 'credentials',
        ok: false,
        label: 'credentials.json (Google OAuth Desktop client)',
        detail: validation.error,
        fix: validation.hint,
      });
    }
  }

  if (!existsSync(TOKEN_PATH)) {
    checks.push({
      id: 'token',
      ok: false,
      label: 'token.json (signed-in Google account)',
      detail: 'Not authenticated yet',
      fix: 'Run: mytime auth',
    });
  } else {
    checks.push({ id: 'token', ok: true, label: 'token.json (signed-in Google account)' });
  }

  return checks;
}

export function printConsoleLinks(): void {
  console.log('Google Cloud Console links (in order):\n');
  console.log(`  1. Home          ${GOOGLE_CONSOLE_LINKS.home}`);
  console.log(`  2. Calendar API  ${GOOGLE_CONSOLE_LINKS.calendarApi}`);
  console.log(`  3. OAuth consent ${GOOGLE_CONSOLE_LINKS.oauthConsent}`);
  console.log(`  4. Credentials   ${GOOGLE_CONSOLE_LINKS.credentials}`);
  console.log('\nCreate a Desktop app OAuth client, download JSON, then:');
  console.log('  mkdir -p ~/.mytime');
  console.log('  mv ~/Downloads/client_secret_*.json ~/.mytime/credentials.json');
}

export function printNextSteps(status: GoogleSetupStatus): void {
  console.log('\nNext steps:\n');
  if (!status.mytimeDir) {
    console.log('  mkdir -p ~/.mytime');
  }
  if (!status.credentials || status.credentialsValidation?.ok === false) {
    console.log('  mytime setup google --links  # Google Cloud Console URLs');
    console.log('  mytime setup --agent-prompt  # paste into Cursor / Claude');
  }
  if (status.credentialsValidation?.ok && !status.token) {
    console.log('  mytime auth              # browser sign-in');
  }
  if (status.credentialsValidation?.ok && status.token) {
    console.log('  mytime sync              # create "mytime" calendar and sync');
    console.log('  mytime settings          # choose calendars to fetch');
    console.log('  mytime                   # launch TUI');
    printAgentNextStepsLine();
  }
}

export function formatAuthError(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes('access_denied') || lower.includes('access blocked')) {
    return [
      'Google sign-in blocked (access_denied).',
      'While the OAuth app is in Testing, add your Google account under',
      'Google Cloud Console → OAuth consent screen → Test users.',
      'Then run: mytime auth',
    ].join('\n');
  }
  if (lower.includes('invalid_client')) {
    return [
      'Invalid OAuth client (invalid_client).',
      'Check credentials.json is from a Desktop app client in your GCP project.',
      'Run: mytime setup google',
    ].join('\n');
  }
  if (lower.includes('timed out')) {
    return `${error}\nComplete sign-in in the browser within 2 minutes, then run: mytime auth`;
  }
  return error;
}

export function printPostAuthNextSteps(): void {
  console.log('\nNext steps:');
  console.log('  mytime sync      # create "mytime" calendar and run first sync');
  console.log('  mytime settings  # choose which Google calendars to fetch');
  console.log('  mytime           # launch TUI');
  printAgentNextStepsLine();
}

export function ensureMytimeDirExists(): void {
  ensureMytimeDir();
}
