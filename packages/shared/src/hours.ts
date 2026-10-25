/** All store hours are Cairo local time. */
export const STORE_TIME_ZONE = 'Africa/Cairo';

export interface DayHours {
  /** 0 = Sunday */
  weekday: number;
  opensMinute: number;
  /** May exceed 1440 when the store closes after midnight */
  closesMinute: number;
  isClosed: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday and minute of day of `date` in Cairo. */
export function cairoClock(date: Date): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STORE_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: WEEKDAYS.indexOf(get('weekday')),
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function dayOf(hours: DayHours[], weekday: number) {
  return hours.find((h) => h.weekday === ((weekday % 7) + 7) % 7);
}

/** Whether the store is open at `now`, counting yesterday's hours that run past midnight. */
export function isOpenAt(hours: DayHours[], now: Date): boolean {
  const { weekday, minute } = cairoClock(now);
  const today = dayOf(hours, weekday);
  if (today && !today.isClosed && minute >= today.opensMinute && minute < today.closesMinute) {
    return true;
  }
  const yesterday = dayOf(hours, weekday - 1);
  return (
    !!yesterday &&
    !yesterday.isClosed &&
    yesterday.closesMinute > 1440 &&
    minute < yesterday.closesMinute - 1440
  );
}

/** The next time the store opens after `now`, or null if it has no open day at all. */
export function nextOpeningAt(hours: DayHours[], now: Date): Date | null {
  const { weekday, minute } = cairoClock(now);
  for (let offset = 0; offset <= 7; offset++) {
    const day = dayOf(hours, weekday + offset);
    if (!day || day.isClosed) continue;
    if (offset === 0 && day.opensMinute <= minute) continue;
    const minutesAhead = offset * 1440 + day.opensMinute - minute;
    const at = new Date(now.getTime() + minutesAhead * 60_000);
    at.setUTCSeconds(0, 0);
    return at;
  }
  return null;
}

/** "HH:MM" for a minute of day; minutes past 1440 wrap to the next day. */
export function formatMinute(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Parses "HH:MM" into minutes from midnight, or null. */
export function parseMinute(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
