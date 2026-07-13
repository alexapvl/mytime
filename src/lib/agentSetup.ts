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
2. If calendar provider is unknown, ask me whether I want Google or Apple Calendar. Infer project context from this conversation, but never infer calendar provider.
3. For Google, tell me to run \`mytime setup google\` then \`mytime auth google\`. For Apple, tell me to run \`mytime setup apple\` and approve the macOS Calendar permission prompt.
4. Install the mytime skill if missing:
   ${AGENT_SKILL_INSTALL}
5. Give every new task an \`@project\`. Infer the project from the conversation origin (current repository, workspace, issue, PR, or product), even if I do not repeat it. If no project can be inferred, ask me before adding the task.
6. Use \`mytime agent slots\` before scheduling timed work; \`mytime agent task quick "<text>"\` for NLP adds; \`mytime agent sync\` after writes if needed.

Only set up MCP (\`mytime setup --mcp-config\`) if this environment cannot run shell commands.

Show me the dashboard output and suggest one task I could add as a test.`;

export function printAgentIntegrationGuide(): void {
  console.log('AI agent integration\n');
  console.log('Always use `mytime agent` in Cursor, Claude Code, and other shell-capable agents.');
  console.log('Same SQLite DB and active-provider sync as the TUI - no extra credentials.\n');

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

  console.log('Calendar: choose `mytime setup google` or `mytime setup apple`.');
  console.log('Local backlog works without a provider; remote sync requires provider authorization.');
}

export function printAgentNextStepsLine(): void {
  console.log('  mytime setup --agents           # AI agent + MCP setup guide');
  console.log('  mytime setup --agent-onboarding-prompt  # paste into Cursor / Claude');
  console.log('  mytime setup --agent-skill      # install command for agent skill');
}
