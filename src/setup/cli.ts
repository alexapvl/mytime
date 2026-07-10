import {
  AGENT_SETUP_PROMPT,
  getGoogleSetupStatus,
  printConsoleLinks,
  printNextSteps,
  runSetupChecks,
} from '../lib/googleSetup.js';

type SetupOptions = {
  doctor?: boolean;
};

export async function runSetup(args: string[], options: SetupOptions = {}): Promise<number> {
  if (args.includes('--agent-prompt')) {
    console.log(AGENT_SETUP_PROMPT);
    return 0;
  }

  if (args.includes('--links')) {
    printConsoleLinks();
    return 0;
  }

  const checks = runSetupChecks();
  const status = getGoogleSetupStatus();
  const allOk = checks.every((c) => c.ok);

  console.log(options.doctor ? 'mytime doctor\n' : 'mytime setup\n');

  for (const check of checks) {
    const mark = check.ok ? 'ok' : '!!';
    console.log(`  [${mark}] ${check.label}`);
    if (check.detail) console.log(`       ${check.detail}`);
    if (!check.ok && check.fix) console.log(`       → ${check.fix}`);
  }

  if (!options.doctor || !allOk) {
    if (!options.doctor) {
      console.log('');
      printConsoleLinks();
    }
    printNextSteps(status);
  } else {
    console.log('\nAll checks passed. Google Calendar is ready.');
    printNextSteps(status);
  }

  return allOk ? 0 : 1;
}
