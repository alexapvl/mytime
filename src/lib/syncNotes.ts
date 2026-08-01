/**
 * mytime appends a sync envelope to remote calendar descriptions:
 *   Project: @foo
 *   Tags: #a #b
 *   Priority: P2
 *   - synced via mytime   (tasks)
 *   - mytime event        (events)
 *
 * Those lines must not live in local item.notes (or find/"mytime" matches everything).
 */

const SYNC_MARKER =
  /^\s*[\u2014-]\s*(?:synced via mytime|mytime event)\s*$/i;
const SYNC_META =
  /^\s*(?:Project:\s*@?\S+|Tags:\s*.+|Priority:\s*P[0-3])\s*$/i;

export function stripMytimeSyncEnvelope(notes: string | null | undefined): string | undefined {
  if (!notes) return undefined;
  const cleaned = notes
    .split('\n')
    .filter((line) => !SYNC_MARKER.test(line) && !SYNC_META.test(line))
    .join('\n')
    .trim();
  return cleaned || undefined;
}
