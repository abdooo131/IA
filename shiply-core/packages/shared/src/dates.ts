// Dates for the next day promise. Business days are counted in Cairo time.

export const BUSINESS_TZ = 'Africa/Cairo';

/** Calendar date (YYYY-MM-DD) and minutes since midnight in Cairo for an instant. */
export function cairoClock(at: Date): { date: string; minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return { date, minutes, weekday: weekdayOf(date) };
}

/** 0 = Sunday ... 6 = Saturday, for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addBusinessDays(date: string, days: number, weekendDays: readonly number[]): string {
  let current = date;
  let left = days;
  while (left > 0) {
    current = addDays(current, 1);
    if (!weekendDays.includes(weekdayOf(current))) left--;
  }
  return current;
}

/** "18:00" to 1080. */
export function parseTime(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`Bad time ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Promised delivery date for a parcel that enters our network at `at`.
 * Before the cutoff it counts from today; after it, from tomorrow.
 * transitDays is 1 for next day zones, 2 or more for far governorates.
 */
export function promisedDate(
  at: Date,
  transitDays: number,
  cutoff: string,
  weekendDays: readonly number[],
): string {
  const { date, minutes } = cairoClock(at);
  const extra = minutes >= parseTime(cutoff) ? 1 : 0;
  return addBusinessDays(date, transitDays + extra, weekendDays);
}

/** Minutes Cairo is ahead of UTC at a given instant (120 in winter, 180 in summer). */
export function cairoOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TZ, timeZoneName: 'longOffset' }).formatToParts(at);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+02:00';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 120;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -mins : mins;
}

/** The instant of a Cairo wall clock time ("09:00") on a Cairo date ("2026-11-08"). */
export function cairoTimeToUtc(date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const offset = cairoOffsetMinutes(new Date(guess.getTime() - 120 * 60000));
  return new Date(guess.getTime() - offset * 60000);
}
