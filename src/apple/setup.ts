import { execFileSync } from 'node:child_process';
import {
  createAppleCalendar,
  getAppleAuthorizationStatus,
  listAppleCalendars,
  listAppleSources,
  requestAppleAuthorization,
  renameAppleCalendar,
  queryAppleEvents,
  type AppleCalendar,
} from './client.js';
import { deleteMeta, getMeta, META_KEYS, setMeta } from '../db/meta.js';
import {
  getActiveProvider,
  setActiveProvider,
  switchCalendarProvider,
} from '../calendar/provider.js';
import { inferEventKitBackend, isMytimeCalendarName, mytimeCalendarName } from '../calendar/backend.js';
import { isAuthenticated as isGoogleAuthenticated } from '../google/auth.js';
import { listMytimeGoogleEventIdentities } from '../google/calendar.js';
import { DateTime } from 'luxon';
import { applyAppleDuplicateCleanup, previewAppleDuplicateCleanup } from './cleanup.js';
import { applyGoogleDuplicateCleanup, previewGoogleDuplicateCleanup } from '../google/cleanup.js';

function optionValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function macOSMajorVersion(): number | null {
  if (process.platform !== 'darwin') return null;
  try {
    return Number(execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim().split('.')[0]);
  } catch {
    return null;
  }
}

async function matchingGoogleCalendar(
  candidates: AppleCalendar[],
): Promise<AppleCalendar | undefined> {
  if (!isGoogleAuthenticated() || !getMeta(META_KEYS.googleCalendarId) || candidates.length === 0) {
    return undefined;
  }
  try {
    const googleUIDs = new Set(
      (await listMytimeGoogleEventIdentities()).map((event) => event.iCalUID.toLowerCase()),
    );
    if (googleUIDs.size === 0) return undefined;
    const start = DateTime.local().minus({ days: 30 }).startOf('day').toISO()!;
    const end = DateTime.local().plus({ days: 365 }).endOf('day').toISO()!;
    const scores = await Promise.all(candidates.map(async (calendar) => ({
      calendar,
      score: (await queryAppleEvents(calendar.id, start, end))
        .filter((event) => event.externalId && googleUIDs.has(event.externalId.toLowerCase())).length,
    })));
    scores.sort((a, b) => b.score - a.score);
    return scores[0]!.score > 0 && scores[0]!.score > (scores[1]?.score ?? 0)
      ? scores[0]!.calendar
      : undefined;
  } catch {
    return undefined;
  }
}

async function runAppleDuplicateCleanup(args: string[]): Promise<number> {
  if (getMeta(META_KEYS.appleBackend) === 'google') {
    const preview = await previewGoogleDuplicateCleanup();
    console.log(`\nDuplicate cleanup preview: ${preview.candidates.length} verified copied events in Google mytime calendar.`);
    for (const candidate of preview.candidates.slice(0, 20)) {
      console.log(`  ${candidate.start}  ${candidate.title}  (${candidate.type})`);
    }
    if (preview.candidates.length > 20) {
      console.log(`  ... ${preview.candidates.length - 20} more`);
    }
    if (!args.includes('--apply')) {
      console.log('\nNo events deleted. Review this preview, then run:');
      console.log('  mytime setup apple --cleanup-duplicates --apply');
      return 0;
    }
    const deleted = await applyGoogleDuplicateCleanup(preview);
    console.log(`\nDeleted ${deleted} verified duplicate events. Canonical mytime events were kept.`);
    return 0;
  }

  const authorization = await getAppleAuthorizationStatus();
  if (authorization !== 'full_access') {
    console.log(`  [!!] Calendar permission: ${authorization}`);
    console.log('       Cleanup preview never requests permission. Grant Full Access first, then retry.');
    return 1;
  }
  console.log('  [ok] Full Calendar access');

  const preview = await previewAppleDuplicateCleanup();
  console.log(`\nDuplicate cleanup preview: ${preview.candidates.length} events across ${preview.scannedCalendars} mytime calendars.`);
  for (const candidate of preview.candidates.slice(0, 20)) {
    console.log(`  ${candidate.start}  ${candidate.title}  (${candidate.sourceTitle})`);
  }
  if (preview.candidates.length > 20) {
    console.log(`  ... ${preview.candidates.length - 20} more`);
  }
  if (!args.includes('--apply')) {
    console.log('\nNo events deleted. Review this preview, then run:');
    console.log('  mytime setup apple --cleanup-duplicates --apply');
    return 0;
  }
  const deleted = await applyAppleDuplicateCleanup(preview);
  console.log(`\nDeleted ${deleted} verified duplicate events. Other events and calendars were kept.`);
  return 0;
}

export async function runAppleSetup(args: string[], doctor = false): Promise<number> {
  console.log(doctor ? 'mytime doctor apple\n' : 'mytime setup apple\n');
  const major = macOSMajorVersion();
  if (major === null || major < 14) {
    console.log('  [!!] Apple Calendar requires macOS 14 or newer.');
    return 1;
  }
  console.log(`  [ok] macOS ${major}`);

  if (args.includes('--cleanup-duplicates')) {
    return runAppleDuplicateCleanup(args);
  }

  let authorization = await getAppleAuthorizationStatus();
  if (authorization !== 'full_access' && !doctor) {
    console.log('  [..] Requesting Full Calendar access...');
    authorization = await requestAppleAuthorization();
  }
  if (authorization !== 'full_access') {
    console.log(`  [!!] Calendar permission: ${authorization}`);
    console.log('       Open System Settings > Privacy & Security > Calendars and allow Full Access for mytime.');
    return 1;
  }
  console.log('  [ok] Full Calendar access');

  if (args.includes('--list-sources')) {
    const sources = (await listAppleSources()).filter((source) => source.canCreateCalendar);
    console.log('\nWritable Calendar.app sources:\n');
    for (const source of sources) {
      console.log(`  ${source.title} (${source.type})${source.default ? ' [default]' : ''}  ${source.id}`);
    }
    return 0;
  }

  const calendars = await listAppleCalendars();
  const sources = (await listAppleSources()).filter((source) => source.canCreateCalendar);
  const savedCalendarId = getMeta(META_KEYS.appleCalendarId);
  const savedCalendar = savedCalendarId
    ? calendars.find((calendar) => calendar.id === savedCalendarId && isMytimeCalendarName(calendar.title))
    : undefined;
  let mytimeCalendar = doctor ? savedCalendar : undefined;

  if (!doctor) {
    const requestedSource = optionValue(args, '--source');
    const requestedCalendar = optionValue(args, '--calendar');
    const savedSourceValue = getMeta(META_KEYS.appleSourceId) ?? undefined;
    const savedSource = sources.some((source) => source.id === savedSourceValue)
      ? savedSourceValue
      : undefined;
    const allExisting = calendars.filter((calendar) => isMytimeCalendarName(calendar.title) && calendar.writable);
    const defaultSources = sources.filter((source) => source.default);
    const sourceId = requestedSource ?? savedCalendar?.sourceId ?? savedSource ??
      (defaultSources.length === 1 ? defaultSources[0]!.id : undefined) ??
      (sources.length === 1 ? sources[0]!.id : undefined);

    if (!sourceId) {
      console.log('  [!!] Choose which Calendar account should contain the dedicated mytime calendar:\n');
      for (const source of sources) {
        console.log(`       ${source.title} (${source.type})${source.default ? ' [default]' : ''}  ${source.id}`);
      }
      console.log('\n       Re-run: mytime setup apple --source <source-id>');
      return 1;
    }
    if (!sources.some((source) => source.id === sourceId)) {
      console.log(`  [!!] Calendar source is unavailable or cannot create calendars: ${sourceId}`);
      return 1;
    }

    const source = sources.find((candidate) => candidate.id === sourceId)!;
    const existing = allExisting.filter((calendar) => calendar.sourceId === sourceId);
    const googleMatch = await matchingGoogleCalendar(existing);
    const backend = googleMatch ? 'google' : inferEventKitBackend(source);
    const targetName = mytimeCalendarName(backend);
    const requestedMatch = requestedCalendar
      ? existing.find((calendar) => calendar.id === requestedCalendar)
      : undefined;
    if (requestedCalendar && !requestedMatch) {
      console.log(`  [!!] Calendar is not a writable mytime calendar in the selected source: ${requestedCalendar}`);
      return 1;
    }
    mytimeCalendar = requestedMatch ?? googleMatch ??
      (existing.length === 1 ? existing[0] : undefined) ??
      (existing.length === 0 ? await createAppleCalendar(sourceId, targetName) : undefined);
    if (!mytimeCalendar) {
      console.log('  [!!] Multiple mytime calendars found. Choose the existing calendar to adopt:\n');
      for (const calendar of existing) {
        console.log(`       ${calendar.sourceTitle}  ${calendar.id}`);
      }
      console.log('\n       Re-run: mytime setup apple --source <source-id> --calendar <calendar-id>');
      console.log('       Choosing the existing calendar prevents mytime from copying every event.');
      return 1;
    }
    const sharesGoogleCalendar = googleMatch?.id === mytimeCalendar.id;
    if (mytimeCalendar.title !== targetName) {
      mytimeCalendar = await renameAppleCalendar(mytimeCalendar.id, targetName);
    }
    if (savedCalendarId !== mytimeCalendar.id) deleteMeta(META_KEYS.appleAllDayBoundaryVersion);
    setMeta(META_KEYS.appleCalendarId, mytimeCalendar.id);
    setMeta(META_KEYS.appleSourceId, sourceId);
    setMeta(META_KEYS.appleBackend, backend);
    setMeta(META_KEYS.appleSharesGoogleCalendar, sharesGoogleCalendar ? 'true' : 'false');
  }

  if (!mytimeCalendar) {
    console.log('  [!!] Dedicated mytime calendar is missing. Run: mytime setup apple');
    return 1;
  }
  const backend = getMeta(META_KEYS.appleBackend) ?? mytimeCalendar.sourceType;
  console.log(`  [ok] mytime calendar in ${mytimeCalendar.sourceTitle} (${backend} backend)`);
  if (getMeta(META_KEYS.appleSharesGoogleCalendar) === 'true') {
    console.log('  [ok] Adopted existing Google mytime calendar - events will not be copied');
  }
  if (doctor) return 0;

  const active = getActiveProvider();
  if (!active || active === 'apple') {
    setActiveProvider('apple');
    console.log('\nApple Calendar is active. Run: mytime sync');
    return 0;
  }

  const deleteOld = args.includes('--delete-old-calendar');
  const keepOld = args.includes('--keep-old-calendar');
  if (!deleteOld && !keepOld) {
    console.log('\nApple Calendar is ready, but Google Calendar is still active. Choose one:');
    console.log('  mytime setup apple --keep-old-calendar');
    console.log('  mytime setup apple --delete-old-calendar');
    return 1;
  }

  const result = await switchCalendarProvider('apple', { deleteOldCalendar: deleteOld });
  console.log(
    `\nSwitched to Apple Calendar: ${result.sync.pushed} pushed, ${result.sync.pulled} pulled, ` +
    `${result.localExternalDeleted} old local events removed.`,
  );
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  return 0;
}
