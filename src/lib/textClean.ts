/** Remove emoji from text pulled from external calendars so local titles stay terminal-safe. */
export function stripEmojis(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\uFE0F/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
