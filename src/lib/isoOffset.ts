import { DateTime } from 'luxon';

const ISO_WITH_OFFSET = /^(\d{4}-\d{2}-\d{2}T\d{2}(?::\d{2}(?::\d{2}(?:\.\d+)?)?)?)(Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * Explicit UTC offsets in agent/MCP input are easy to get wrong across DST (e.g. +03:00 on a
 * November date in Europe/Bucharest). Returns an error message when the stated offset differs from
 * the local zone's real offset at that wall time; null when the value has no offset or it matches.
 */
export function isoOffsetMismatch(value: string, zone: string = DateTime.local().zoneName): string | null {
  const match = ISO_WITH_OFFSET.exec(value.trim());
  if (!match) return null;
  const wall = match[1];
  const local = DateTime.fromISO(wall, { zone });
  const stated = DateTime.fromISO(value.trim(), { setZone: true });
  if (!local.isValid || !stated.isValid || stated.offset === local.offset) return null;
  return (
    `Offset ${stated.toFormat('ZZ')} in "${value}" does not match ${zone} offset ${local.toFormat('ZZ')} at ${wall}. ` +
    `Pass local time without an offset ("${wall}") or use ${local.toFormat('ZZ')}.`
  );
}
