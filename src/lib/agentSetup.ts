export const MYTIME_REPO = 'https://github.com/alexapvl/mytime';

export const MCP_CONFIG_JSON = `{
  "mcpServers": {
    "mytime": {
      "command": "mytime",
      "args": ["mcp"]
    }
  }
}`;

export const AGENT_SKILL_INSTALL = `npx skills add ${MYTIME_REPO} --skill mytime -g`;

export const AGENT_ONBOARDING_PROMPT = `Set up mytime for AI agent use (${MYTIME_REPO}).

I have mytime installed on PATH. When shell execution works, always use \`mytime agent\` for tasks and calendar. Do not use \`mytime mcp\` or configure mytime MCP in that environment.

Please do the following:

1. Run \`command -v mytime\`, then \`mytime agent\`, and confirm the dashboard works. Only use mytime MCP if shell execution or the binary is unavailable.
2. If Google shows disconnected, tell me to run \`mytime setup\` then \`mytime auth\` (browser OAuth — you cannot complete that step for me).
3. Install the mytime skill if missing:
   ${AGENT_SKILL_INSTALL}
4. Give every new task an \`@project\`. Infer the project from the conversation origin (current repository, workspace, issue, PR, or product), even if I do not repeat it. If no project can be inferred, ask me before adding the task.
5. Use \`mytime agent slots\` before scheduling timed work; \`mytime agent task quick "<text>"\` for NLP adds; \`mytime agent sync\` after writes if needed.

Only set up MCP (\`mytime setup --mcp-config\`) if this environment cannot run shell commands.

Show me the dashboard output and suggest one task I could add as a test.`;

export function printAgentIntegrationGuide(): void {
  console.log('AI agent integration\n');
  console.log('Always use `mytime agent` in Cursor, Claude Code, and other shell-capable agents.');
  console.log('Same SQLite DB and Google sync as the TUI — no extra OAuth or API keys.\n');

  console.log('Quick start:\n');
  console.log('  mytime agent                              # dashboard');
  console.log('  mytime agent task quick "buy milk tomorrow 5pm @personal"');
  console.log('  mytime agent slots --date tomorrow');
  console.log('  mytime agent sync\n');

  console.log('Give this prompt to your agent (after mytime is on PATH):\n');
  console.log('  mytime setup --agent-onboarding-prompt\n');

  console.log('Recommended - install the mytime skill for project-aware task handling and command hints:\n');
  console.log(`  ${AGENT_SKILL_INSTALL}\n`);

  console.log('Legacy MCP (only if the client cannot run shell; do not configure it otherwise):\n');
  console.log('  Add to Cursor MCP settings (~/.cursor/mcp.json or project .cursor/mcp.json):');
  console.log('  mytime setup --mcp-config\n');

  console.log('Google Calendar: same setup as the TUI (`mytime setup`, `mytime auth`).');
  console.log('Local backlog works without Google; sync and scheduled Google writes need auth.');
}

export function printAgentNextStepsLine(): void {
  console.log('  mytime setup --agents           # AI agent + MCP setup guide');
  console.log('  mytime setup --agent-onboarding-prompt  # paste into Cursor / Claude');
  console.log('  mytime setup --agent-skill      # install command for agent skill');
}
