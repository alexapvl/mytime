import { terminalScenes, type AgentStep, type SceneTurn } from "../data/terminal-scenes";

const CHAR_DELAY = 32;
const SEND_PAUSE = 220;
const TOOL_RUN_PAUSE = 780;
const TOOL_RESULT_PAUSE = 280;
const REPLY_PAUSE = 360;
const TURN_PAUSE = 900;

function scrollThreadToBottom(thread: HTMLElement) {
  thread.scrollTop = thread.scrollHeight;
}

function sleep(ms: number, signal: { aborted: boolean; paused: boolean }) {
  return new Promise<void>((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (signal.aborted) {
        resolve();
        return;
      }
      if (signal.paused) {
        requestAnimationFrame(tick);
        return;
      }
      if (performance.now() - start >= ms) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function createUserBubble(message: string) {
  const bubble = document.createElement("div");
  bubble.className = "tc-user-bubble";

  const text = document.createElement("p");
  text.className = "tc-user-text";
  text.textContent = message;

  bubble.append(text);
  return bubble;
}

const STATUS_WORDS = [
  "thinking…",
  "combobulating…",
  "scheduling…",
  "contemplating…",
  "scanning tasks…",
  "finding gaps…",
  "herding tasks…",
  "consulting the calendar…",
  "aligning chronons…",
  "poking the backlog…",
  "negotiating with the calendar…",
  "checking the matrix…",
  "booking…",
  "scouting free time…",
];

function pickStatus(words: string[]) {
  return words[Math.floor(Math.random() * words.length)];
}

function createToolBlock(step: AgentStep) {
  const block = document.createElement("div");
  block.className = "tc-tool";

  const cmd = document.createElement("div");
  cmd.className = "tc-tool-cmd";
  const prompt = document.createElement("span");
  prompt.className = "t-muted";
  prompt.textContent = "$ ";
  cmd.append(prompt, step.command);

  const status = document.createElement("div");
  status.className = "tc-tool-status t-muted";
  status.textContent = pickStatus(STATUS_WORDS);

  const result = document.createElement("div");
  result.className = "tc-tool-result";
  result.hidden = true;
  result.textContent = step.result;

  block.append(cmd, status, result);
  return block;
}

function createReplyEl() {
  const el = document.createElement("div");
  el.className = "tc-reply";

  const label = document.createElement("span");
  label.className = "tc-reply-label t-cyan";
  label.textContent = "agent";

  const text = document.createElement("p");
  text.className = "tc-reply-text";
  el.append(label, text);
  return el;
}

async function typeInComposer(
  field: HTMLElement,
  cursor: HTMLElement,
  message: string,
  signal: { aborted: boolean; paused: boolean },
  reducedMotion: boolean,
) {
  const textEl = field.querySelector<HTMLElement>("[data-tc-composer-text]");
  if (!textEl) return;

  textEl.textContent = "";
  cursor.hidden = false;

  if (reducedMotion) {
    textEl.textContent = message;
    return;
  }

  for (let i = 0; i < message.length; i += 1) {
    if (signal.aborted) return;
    textEl.textContent = message.slice(0, i + 1);
    await sleep(CHAR_DELAY, signal);
  }
}

async function sendUserMessage(
  thread: HTMLElement,
  turn: HTMLElement,
  composer: HTMLElement,
  field: HTMLElement,
  cursor: HTMLElement,
  message: string,
  signal: { aborted: boolean; paused: boolean },
  reducedMotion: boolean,
  clear: boolean,
) {
  if (clear) {
    turn.replaceChildren();
    turn.hidden = false;
  }

  const bubble = createUserBubble(message);
  bubble.classList.add(reducedMotion ? "tc-land-static" : "tc-land");
  turn.appendChild(bubble);

  composer.classList.add("is-sending");
  const textEl = field.querySelector<HTMLElement>("[data-tc-composer-text]");
  if (textEl) textEl.textContent = "";
  cursor.hidden = true;

  if (!reducedMotion) {
    await sleep(SEND_PAUSE, signal);
  }

  composer.classList.remove("is-sending");
  scrollThreadToBottom(thread);
}

async function runTurn(
  turnEl: HTMLElement,
  thread: HTMLElement,
  composer: HTMLElement,
  field: HTMLElement,
  cursor: HTMLElement,
  turn: SceneTurn,
  signal: { aborted: boolean; paused: boolean },
  reducedMotion: boolean,
  clear: boolean,
) {
  await typeInComposer(field, cursor, turn.userMessage, signal, reducedMotion);
  if (signal.aborted) return;

  await sendUserMessage(
    thread,
    turnEl,
    composer,
    field,
    cursor,
    turn.userMessage,
    signal,
    reducedMotion,
    clear,
  );
  if (signal.aborted) return;

  for (const step of turn.steps ?? []) {
    await runTool(turnEl, thread, step, signal, reducedMotion);
    if (signal.aborted) return;
  }

  await sleep(reducedMotion ? 60 : REPLY_PAUSE, signal);
  if (signal.aborted) return;

  const replyEl = createReplyEl();
  if (!reducedMotion) {
    replyEl.classList.add("tc-line-enter");
  }
  turnEl.appendChild(replyEl);
  scrollThreadToBottom(thread);

  const textEl = replyEl.querySelector<HTMLElement>(".tc-reply-text");
  if (!textEl) return;

  await typeReply(thread, textEl, turn.reply, signal, reducedMotion);
}

async function runTool(
  turn: HTMLElement,
  thread: HTMLElement,
  step: AgentStep,
  signal: { aborted: boolean; paused: boolean },
  reducedMotion: boolean,
) {
  if (step.pauseBefore) {
    await sleep(reducedMotion ? 60 : step.pauseBefore, signal);
    if (signal.aborted) return;
  }

  const block = createToolBlock(step);
  if (!reducedMotion) {
    block.classList.add("tc-line-enter");
  }
  turn.appendChild(block);

  const status = block.querySelector<HTMLElement>(".tc-tool-status");
  const result = block.querySelector<HTMLElement>(".tc-tool-result");
  if (!status || !result) return;

  scrollThreadToBottom(thread);

  await sleep(reducedMotion ? 120 : TOOL_RUN_PAUSE, signal);
  if (signal.aborted) return;

  status.hidden = true;
  result.hidden = false;
  if (!reducedMotion) {
    result.classList.add("tc-line-enter");
  }

  scrollThreadToBottom(thread);

  await sleep(reducedMotion ? 40 : TOOL_RESULT_PAUSE, signal);
}

async function typeReply(
  thread: HTMLElement,
  textEl: HTMLElement,
  reply: string,
  signal: { aborted: boolean; paused: boolean },
  reducedMotion: boolean,
) {
  if (reducedMotion) {
    textEl.textContent = reply;
    scrollThreadToBottom(thread);
    return;
  }

  for (let i = 0; i < reply.length; i += 1) {
    if (signal.aborted) return;
    textEl.textContent = reply.slice(0, i + 1);
    scrollThreadToBottom(thread);
    await sleep(CHAR_DELAY, signal);
  }
}

async function runScene(
  root: HTMLElement,
  sceneIndex: number,
  signal: { aborted: boolean; paused: boolean },
  reducedMotion: boolean,
) {
  const composer = root.querySelector<HTMLElement>("[data-tc-composer]");
  const field = root.querySelector<HTMLElement>("[data-tc-composer-field]");
  const cursor = root.querySelector<HTMLElement>("[data-tc-cursor]");
  const thread = root.querySelector<HTMLElement>("[data-tc-thread]");
  const turn = root.querySelector<HTMLElement>("[data-tc-turn]");
  if (!composer || !field || !cursor || !thread || !turn) return;

  const scene = terminalScenes[sceneIndex];
  turn.hidden = true;
  turn.replaceChildren();
  thread.scrollTop = 0;

  for (let i = 0; i < scene.turns.length; i += 1) {
    if (i > 0) {
      await sleep(reducedMotion ? 120 : TURN_PAUSE, signal);
      if (signal.aborted) return;
    }

    await runTurn(
      turn,
      thread,
      composer,
      field,
      cursor,
      scene.turns[i],
      signal,
      reducedMotion,
      i === 0,
    );
    if (signal.aborted) return;
  }
}

export function setupTerminalConversation() {
  document.querySelectorAll<HTMLElement>("[data-terminal-conversation]").forEach((root) => {
    if (root.dataset.tcReady === "true") return;
    root.dataset.tcReady = "true";

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const replayBtn = root.querySelector<HTMLButtonElement>("[data-tc-replay]");
    let sceneIndex = 0;
    let started = false;
    let currentSignal: { aborted: boolean; paused: boolean } | null = null;

    const setPlaying = (playing: boolean) => {
      root.dataset.tcPlaying = String(playing);
      if (replayBtn) replayBtn.disabled = playing;
    };

    const abortCurrent = () => {
      if (currentSignal) currentSignal.aborted = true;
    };

    const playScenario = async (index: number) => {
      abortCurrent();
      const signal = { aborted: false, paused: false };
      currentSignal = signal;
      setPlaying(true);

      await runScene(root, index, signal, reducedMotion);

      if (currentSignal === signal) {
        currentSignal = null;
        setPlaying(false);
      }
    };

    const playNext = () => {
      void playScenario(sceneIndex);
      sceneIndex = (sceneIndex + 1) % terminalScenes.length;
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        const paused = !entry?.isIntersecting;
        if (currentSignal) currentSignal.paused = paused;

        if (entry?.isIntersecting && !started) {
          started = true;
          playNext();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(root);

    replayBtn?.addEventListener("click", () => {
      playNext();
    });

    root.addEventListener(
      "astro:before-swap",
      () => {
        abortCurrent();
        observer.disconnect();
      },
      { once: true },
    );
  });
}

setupTerminalConversation();
