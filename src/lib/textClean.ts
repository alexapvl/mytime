const EMOJI_RE =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u2600-\u27BF\u2300-\u23FF\uFE0E\uFE0F\u200D\u20E3\u{E0000}-\u{E007F}]/gu;

/** Remove emoji so titles stay terminal-safe. */
export function stripEmojis(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}

export function cleanTitle(text: string): string {
  const title = stripEmojis(text);
  return title || 'Untitled';
}
