export type MouseClick = {
  x: number;
  y: number;
};

let suppressUntil = 0;

export function suppressNextKeyboardInput(): void {
  suppressUntil = Date.now();
}

export function isKeyboardSuppressed(): boolean {
  return Date.now() - suppressUntil < 100;
}

/** Click only — no drag tracking (1002) to avoid click-and-hold floods. */
export function enableMouseTracking(): void {
  process.stdout.write('\x1b[?1000h\x1b[?1006h');
}

export function disableMouseTracking(): void {
  process.stdout.write('\x1b[?1000l\x1b[?1006l');
}

const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;

function isLeftClick(button: number, kind: 'm' | 'M'): boolean {
  if (button >= 32) return false;
  if (kind === 'M') return button === 0;
  return button === 0 || button === 3;
}

export function extractMouseClicks(chunk: string): MouseClick[] {
  const clicks: MouseClick[] = [];
  let match: RegExpExecArray | null;

  SGR_MOUSE_RE.lastIndex = 0;
  while ((match = SGR_MOUSE_RE.exec(chunk)) !== null) {
    const button = Number.parseInt(match[1]!, 10);
    const x = Number.parseInt(match[2]!, 10);
    const y = Number.parseInt(match[3]!, 10);
    const kind = match[4] as 'm' | 'M';
    if (isLeftClick(button, kind)) {
      clicks.push({ x, y });
    }
  }

  return clicks;
}

export function stripMouseSequences(chunk: string): string {
  return chunk.replace(SGR_MOUSE_RE, '');
}

export type ClickRegion = {
  row: number;
  col?: number;
  endCol?: number;
  onClick: () => void;
};

export function hitTestRegion(regions: ClickRegion[], click: MouseClick): ClickRegion | null {
  for (const region of regions) {
    if (region.row !== click.y) continue;

    if (region.col !== undefined) {
      const end = region.endCol ?? region.col + 999;
      if (click.x < region.col || click.x > end) continue;
    }

    return region;
  }

  return null;
}

export function dedupeClicks(clicks: MouseClick[]): MouseClick[] {
  const seen = new Set<string>();
  const out: MouseClick[] = [];
  for (const click of clicks) {
    const key = `${click.x}:${click.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(click);
  }
  return out;
}
