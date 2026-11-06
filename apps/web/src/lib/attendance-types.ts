import type { AttendanceStatus, BoardState } from '@shiplynow/shared';

/** What the API answers for attendance (docs/HR.md 2). Instants are ISO strings. */

export interface Named {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
}

export interface StoreRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface AttendanceDayRow {
  day: string;
  status: AttendanceStatus;
  computedStatus: AttendanceStatus;
  overrideStatus: AttendanceStatus | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  firstIn: string | null;
  lastOut: string | null;
  lateMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
  flags: string[];
  correctionReason: string | null;
}

export interface MyToday {
  day: string;
  shift: { start: string; end: string } | null;
  dayOff: boolean;
  holiday: boolean;
  clockedIn: boolean;
  since: string | null;
  firstIn: string | null;
  lastOut: string | null;
  lateMinutes: number | null;
  late: boolean;
  workedMinutes: number;
}

export interface MyAttendance {
  employeeId: string;
  today: MyToday;
  place: {
    kind: 'store' | 'office';
    nameEn: string | null;
    nameAr: string | null;
    radiusM: number;
    maxAccuracyM: number;
    ready: boolean;
  };
  month: string;
  days: AttendanceDayRow[];
}

export interface BoardRow {
  employee: Named & { role: string; status: string };
  store: StoreRef | null;
  shift: { start: string; end: string } | null;
  state: BoardState;
  firstIn: string | null;
  lastOut: string | null;
  lateMinutes: number;
  missingMinutes: number;
}

export interface Board {
  day: string;
  holiday: { nameEn: string; nameAr: string } | null;
  counts: Partial<Record<BoardState, number>>;
  people: BoardRow[];
}

export interface DayListRow extends AttendanceDayRow {
  id: string;
  employee: Named;
  store: StoreRef | null;
}

export interface ShiftRow {
  id: string;
  nameEn: string;
  nameAr: string | null;
  start: string;
  end: string;
  breakMinutes: number;
  weekdays: number[];
  overnight: boolean;
  isActive: boolean;
  employees: number;
}

export interface HolidayRow {
  id: string;
  day: string;
  nameEn: string;
  nameAr: string;
}

export interface RosterCell {
  day: string;
  shiftId: string | null;
  start: string | null;
  end: string | null;
  edited: boolean;
}

export interface Roster {
  from: string;
  days: string[];
  holidays: HolidayRow[];
  shifts: ShiftRow[];
  people: (Named & {
    role: string;
    status: string;
    defaultShiftId: string | null;
    cells: (RosterCell | null)[];
  })[];
}

export interface DayDetail {
  employee: Named;
  day: string;
  closed: boolean;
  canCorrect: boolean;
  plan: { start: string; end: string } | null;
  dayOff: boolean;
  holiday: boolean;
  row: AttendanceDayRow | null;
  preview: { status: AttendanceStatus; workedMinutes: number };
  punches: {
    id: string;
    kind: 'in' | 'out';
    at: string;
    source: 'app' | 'manual' | 'auto';
    distanceM: number | null;
    accuracyM: number | null;
    reason: string | null;
    voided: boolean;
    voidReason: string | null;
  }[];
}

const hm = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Cairo wall clock time HH:MM (Latin digits, kept LTR in Arabic). */
export function cairoHm(iso: string | null | undefined): string {
  return iso ? hm.format(new Date(iso)) : '–';
}

/** 485 minutes as 8:05. */
export function hours(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The person's name in the page's language. */
export function personName(p: { nameEn: string; nameAr: string | null }, locale: string) {
  return locale === 'ar' && p.nameAr ? p.nameAr : p.nameEn;
}

/** Tone of a status or board state: good, warn or bad, for the chip's border. */
export function tone(state: string): 'good' | 'warn' | 'bad' | 'plain' {
  if (state === 'present' || state === 'in') return 'good';
  if (state === 'late' || state === 'late_in' || state === 'left_early') return 'warn';
  if (state === 'absent' || state === 'missing') return 'bad';
  return 'plain';
}

export const TONE_CLASS = {
  good: 'border-status-delivered text-status-delivered',
  warn: 'border-status-needs-action text-status-needs-action',
  bad: 'border-danger text-danger',
  plain: 'border-line text-text-muted',
} as const;
