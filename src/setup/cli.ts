import {
  AGENT_ONBOARDING_PROMPT,
  AGENT_SKILL_INSTALL,
  MCP_CONFIG_JSON,
  printAgentIntegrationGuide,
  printAgentNextStepsLine,
} from '../lib/agentSetup.js';
import {
  AGENT_SETUP_PROMPT,
  getGoogleSetupStatus,
  printConsoleLinks,
  printNextSteps,
  runSetupChecks,
} from '../lib/googleSetup.js';
import { runAppleSetup } from '../apple/setup.js';
import {
  getActiveProvider,
  setActiveProvider,
  switchCalendarProvider,
} from '../calendar/provider.js';

type SetupOptions = {
  doctor?: boolean;
};

export async function runSetup(args: string[], options: SetupOptions = {}): Promise<number> {
  const requestedProvider = args.find((arg) => arg === 'google' || arg === 'apple');
  if (args.includes('--agent-prompt')) {
    console.log(AGENT_SETUP_PROMPT);
    return 0;
  }

  if (args.includes('--agent-onboarding-prompt')) {
    console.log(AGENT_ONBOARDING_PROMPT);
    return 0;
  }

  if (args.includes('--agents')) {
    printAgentIntegrationGuide();
    return 0;
  }

  if (args.includes('--mcp-config')) {
    console.log(MCP_CONFIG_JSON);
    return 0;
  }

  if (args.includes('--agent-skill')) {
    console.log(AGENT_SKILL_INSTALL);
    return 0;
  }

  if (args.includes('--links')) {
    if (requestedProvider === 'apple') {
      console.error('--links applies only to Google Calendar setup.');
      return 1;
    }
    printConsoleLinks();
    return 0;
  }

  if (requestedProvider === 'apple') {
    return runAppleSetup(args, options.doctor);
  }
  if (!requestedProvider) {
    const active = getActiveProvider();
    if (options.doctor && active === 'apple') return runAppleSetup(args, true);
    if (options.doctor && active === 'google') return runGoogleSetup(args, true);
    console.log(options.doctor ? 'mytime doctor\n' : 'mytime setup\n');
    console.log('Choose one active calendar provider:');
    console.log('  mytime setup google   # Google Calendar OAuth');
    console.log('  mytime setup apple    # Apple Calendar via macOS EventKit (macOS 14+)');
    console.log('\nAI agents: ask the user which provider they want. Never choose silently.');
    return 1;
  }

  return runGoogleSetup(args, options.doctor);
}

async function runGoogleSetup(args: string[], doctor = false): Promise<number> {
  const checks = runSetupChecks();
  const status = getGoogleSetupStatus();
  const allOk = checks.every((c) => c.ok);

  console.log(doctor ? 'mytime doctor google\n' : 'mytime setup google\n');

  for (const check of checks) {
    const mark = check.ok ? 'ok' : '!!';
    console.log(`  [${mark}] ${check.label}`);
    if (check.detail) console.log(`       ${check.detail}`);
    if (!check.ok && check.fix) console.log(`       → ${check.fix}`);
  }

  if (!doctor || !allOk) {
    if (!doctor) {
      console.log('');
      printConsoleLinks();
    }
    printNextSteps(status);
  } else {
    console.log('\nAll checks passed. Google Calendar is ready.');
    printNextSteps(status);
  }

  if (allOk || status.token) {
    console.log('\nAI agents (optional):');
    printAgentNextStepsLine();
  }

  if (status.ready && !doctor) {
    const active = getActiveProvider();
    if (!active || active === 'google') {
      setActiveProvider('google');
    } else {
      const deleteOld = args.includes('--delete-old-calendar');
      const keepOld = args.includes('--keep-old-calendar');
      if (!deleteOld && !keepOld) {
        console.log('\nGoogle Calendar is ready, but Apple Calendar is still active. Choose one:');
        console.log('  mytime setup google --keep-old-calendar');
        console.log('  mytime setup google --delete-old-calendar');
        return 1;
      }
      const result = await switchCalendarProvider('google', { deleteOldCalendar: deleteOld });
      console.log(
        `\nSwitched to Google Calendar: ${result.sync.pushed} pushed, ${result.sync.pulled} pulled, ` +
        `${result.localExternalDeleted} old local events removed.`,
      );
      for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    }
  }

  return allOk ? 0 : 1;
}
