export type AgentStep = {
  command: string;
  result: string;
  pauseBefore?: number;
};

export type SceneTurn = {
  userMessage: string;
  steps?: AgentStep[];
  reply: string;
};

export type TerminalScene = {
  turns: SceneTurn[];
};

export const terminalScenes: TerminalScene[] = [
  {
    turns: [
      {
        userMessage: "what tasks do i have for the mytime site?",
        steps: [
          {
            command: "mytime agent search mytime",
            result:
              "4 open · p0 ship site SEO, p0 terminal demo, p1 fix sync edge case, p2 release notes",
          },
        ],
        reply:
          "4 on mytime — ship site SEO and terminal demo are p0, fix sync edge case is p1, release notes is p2. none scheduled yet. want me to tackle one or find slots?",
      },
    ],
  },
  {
    turns: [
      {
        userMessage: "schedule a 30m sync with sam tomorrow afternoon",
        steps: [
          {
            command: "mytime agent slots --date tomorrow --time-filter 12",
            result: "afternoon free: 2pm, 2:30pm, 3:30pm, 4pm",
          },
          {
            command: 'mytime agent task quick "sync with sam tomorrow 3:30pm"',
            pauseBefore: 320,
            result: "added sync with sam · synced to active calendar",
          },
        ],
        reply: "Booked tomorrow 3:30pm — 30m sync with sam.",
      },
    ],
  },
  {
    turns: [
      {
        userMessage:
          "check what prs and issues i have open for mytime on github and prioritize them into mytime",
        steps: [
          {
            command:
              "gh-axi pr list -R alexapvl/mytime --state open && gh-axi issue list -R alexapvl/mytime --state open",
            result:
              "2 prs · #42 recurring tasks, #38 improve week view · 3 issues · timezone sync bug, quick-add aliases, onboarding docs",
          },
          {
            command: "mytime agent backlog list",
            pauseBefore: 320,
            result:
              "reprioritized · timezone sync bug p0, recurring tasks p1, improve week view p1, +2 p2",
          },
        ],
        reply:
          "pulled 5 items from GitHub into mytime — timezone sync bug is p0, recurring tasks and improve week view are p1. rest are p2.",
      },
      {
        userMessage:
          "spin up each item into a separate worktree and make a pr for it",
        steps: [
          {
            command:
              "git worktree add ../mytime-fix-timezone-sync -b fix-timezone-sync && git worktree add ../mytime-recurring-tasks -b recurring-tasks",
            result: "2 worktrees · fix-timezone-sync, recurring-tasks",
          },
          {
            command: 'gh-axi pr create -R alexapvl/mytime --draft --title "fix timezone sync"',
            pauseBefore: 340,
            result: "draft pr #43 opened · 4 more queued",
          },
        ],
        reply: "on it — worktrees are up, opening a pr per item.",
      },
    ],
  },
  {
    turns: [
      {
        userMessage:
          "check all tasks for the mytime project and implement the highest priority one",
        steps: [
          {
            command: "mytime agent search mytime",
            result: "4 open · p0 ship site SEO, p0 terminal demo, fix sync p1, +1 more",
          },
        ],
        reply:
          "top two are ship site SEO (p0) and terminal demo (p0). which one should i implement?",
      },
      {
        userMessage: "ship the terminal demo",
        reply: "on it.",
      },
    ],
  },
];
