import stringWidth from 'string-width';

export function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (stringWidth(text) <= maxWidth) return text;
  let width = 0;
  let out = '';
  for (const char of text) {
    const next = stringWidth(char);
    if (width + next > maxWidth) break;
    out += char;
    width += next;
  }
  return out;
}

export function sliceByWidth(text: string, startCols: number, maxCols: number): string {
  if (maxCols <= 0) return '';
  let col = 0;
  let out = '';
  for (const char of text) {
    const w = stringWidth(char);
    if (col >= startCols) {
      if (stringWidth(out) + w > maxCols) break;
      out += char;
    }
    col += w;
  }
  return out;
}

export function padToWidth(text: string, width: number): string {
  const pad = Math.max(0, width - stringWidth(text));
  return pad > 0 ? text + ' '.repeat(pad) : text;
}

export function textWidth(text: string): number {
  return stringWidth(text);
}
