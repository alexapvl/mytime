import assert from 'node:assert/strict';
import { isoOffsetMismatch } from './isoOffset.js';

const zone = 'Europe/Bucharest';

// No offset: always accepted (parsed as local wall time).
assert.equal(isoOffsetMismatch('2026-11-10T11:00:00', zone), null);
assert.equal(isoOffsetMismatch('2026-11-10T11:00', zone), null);
assert.equal(isoOffsetMismatch('2026-11-10', zone), null);

// Matching offsets on both sides of DST.
assert.equal(isoOffsetMismatch('2026-11-10T11:00:00+02:00', zone), null);
assert.equal(isoOffsetMismatch('2026-07-10T11:00:00+03:00', zone), null);
assert.equal(isoOffsetMismatch('2026-07-10T11:00:00.000+0300', zone), null);

// The original bug: summer offset on a winter date, and the reverse.
const winter = isoOffsetMismatch('2026-11-10T11:00:00+03:00', zone);
assert.ok(winter?.includes('+03:00') && winter.includes('+02:00') && winter.includes('2026-11-10T11:00:00'));
assert.ok(isoOffsetMismatch('2026-07-10T11:00:00+02:00', zone));

// UTC "Z" and unrelated offsets are rejected too.
assert.ok(isoOffsetMismatch('2026-11-10T09:00:00Z', zone));
assert.ok(isoOffsetMismatch('2026-11-10T11:00:00-05:00', zone));
assert.equal(isoOffsetMismatch('2026-11-10T09:00:00Z', 'UTC'), null);

// Either side of the Oct 25 2026 clock change.
assert.equal(isoOffsetMismatch('2026-10-24T12:00:00+03:00', zone), null);
assert.equal(isoOffsetMismatch('2026-10-26T12:00:00+02:00', zone), null);
assert.ok(isoOffsetMismatch('2026-10-26T12:00:00+03:00', zone));

console.log('isoOffset selfcheck passed');
