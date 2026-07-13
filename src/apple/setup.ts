import { execFileSync } from 'node:child_process';
import {
  createAppleCalendar,
  getAppleAuthorizationStatus,
  listAppleCalendars,
  listAppleSources,
  requestAppleAuthorization,
} from './client.js';
import { getMeta, META_KEYS, setMeta } from '../db/meta.js';
import {
  getActiveProvider,
  setActiveProvider,
  switchCalendarProvider,
} from '../calendar/provider.js';

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

export async function runAppleSetup(args: string[], doctor = false): Promise<number> {
  console.log(doctor ? 'mytime doctor apple\n' : 'mytime setup apple\n');
  const major = macOSMajorVersion();
  if (major === null || major < 14) {
    console.log('  [!!] Apple Calendar requires macOS 14 or newer.');
    return 1;
  }
  console.log(`  [ok] macOS ${major}`);

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

  const calendars = await listAppleCalendars();
  const savedCalendarId = getMeta(META_KEYS.appleCalendarId);
  let mytimeCalendar = savedCalendarId
    ? calendars.find((calendar) => calendar.id === savedCalendarId && calendar.title === 'mytime')
    : undefined;

  if (!mytimeCalendar && !doctor) {
    const sources = (await listAppleSources()).filter((source) => source.canCreateCalendar);
    const requestedSource = optionValue(args, '--source');
    const savedSourceValue = getMeta(META_KEYS.appleSourceId) ?? undefined;
    const savedSource = sources.some((source) => source.id === savedSourceValue)
      ? savedSourceValue
      : undefined;
    const existing = calendars.filter((calendar) => calendar.title === 'mytime' && calendar.writable);
    const sourceId = requestedSource ?? savedSource ?? (existing.length === 1 ? existing[0]!.sourceId : undefined) ??
      (sources.length === 1 ? sources[0]!.id : undefined);

    if (!sourceId) {
      console.log('  [!!] Choose which Calendar account should contain the dedicated mytime calendar:\n');
      for (const source of sources) {
        console.log(`       ${source.title} (${source.type})  ${source.id}`);
      }
      console.log('\n       Re-run: mytime setup apple --source <source-id>');
      return 1;
    }
    if (!sources.some((source) => source.id === sourceId)) {
      console.log(`  [!!] Calendar source is unavailable or cannot create calendars: ${sourceId}`);
      return 1;
    }

    mytimeCalendar = existing.find((calendar) => calendar.sourceId === sourceId) ??
      await createAppleCalendar(sourceId);
    setMeta(META_KEYS.appleCalendarId, mytimeCalendar.id);
    setMeta(META_KEYS.appleSourceId, sourceId);
  }

  if (!mytimeCalendar) {
    console.log('  [!!] Dedicated mytime calendar is missing. Run: mytime setup apple');
    return 1;
  }
  console.log(`  [ok] mytime calendar in ${mytimeCalendar.sourceTitle}`);
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
