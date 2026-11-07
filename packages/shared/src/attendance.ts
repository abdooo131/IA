import { z } from 'zod';
import { parseMinute } from './hours';
import { daySchema } from './hr';

/**
 * HR step 2 (docs/HR.md 2): shifts, a weekly roster, official holidays, Clock in and Clock out
 * with a location check, and one attendance day per person and Cairo day.
 */

export const ATTENDANCE_STATUSES = [
  'present',
  'late',
  'left_early',
  'absent',
  'on_leave',
  'day_off',
  'holiday',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const PUNCH_KINDS = ['in', 'out'] as const;
export type PunchKind = (typeof PUNCH_KINDS)[number];

/** app: the person's phone; manual: added by a manager with a reason; auto: the day close. */
export const PUNCH_SOURCES = ['app', 'manual', 'auto'] as const;
export type PunchSource = (typeof PUNCH_SOURCES)[number];

/** Problems found on a day, shown next to its status. */
export const ATTENDANCE_FLAGS = ['forgot_clock_out', 'manual_punch', 'corrected'] as const;
export type AttendanceFlag = (typeof ATTENDANCE_FLAGS)[number];

/** Where each person stands right now on the Today board. */
export const BOARD_STATES = [
  'in',
  'late_in',
  'left',
  'missing',
  'not_yet',
  'day_off',
  'holiday',
  'on_leave',
  'unplanned',
] as const;
export type BoardState = (typeof BOARD_STATES)[number];

/** Why a clock in or out was refused; each has its own message in the apps. */
export const CLOCK_ERRORS = [
  'no_position',
  'position_inaccurate',
  'too_far',
  'already_clocked_in',
  'not_clocked_in',
  'office_location_not_set',
  'employee_not_found',
  'employee_not_active',
] as const;

/** Distance in whole metres between two points (haversine on a 6,371 km sphere). */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** The phone's position as the browser gives it (accuracy in metres). */
export const clockSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000),
  device: z.string().trim().max(300).optional(),
});
export type ClockBody = z.infer<typeof clockSchema>;

const clock = z
  .string()
  .trim()
  .refine((v) => parseMinute(v) !== null, 'invalid_time');

/** A shift template. An end at or before the start runs past midnight (overnight). */
export const shiftSchema = z.object({
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z
    .string()
    .trim()
    .max(80)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  start: clock,
  end: clock,
  breakMinutes: z.number().int().min(0).max(240),
  /** 0 = Sunday */
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  overnight: z.boolean(),
  isActive: z.boolean().optional(),
});
export type ShiftBody = z.infer<typeof shiftSchema>;

export const holidaySchema = z.object({
  day: daySchema,
  nameEn: z.string().trim().min(2).max(120),
  nameAr: z.string().trim().min(2).max(120),
});
export type HolidayBody = z.infer<typeof holidaySchema>;

/** One roster cell: a shift, or null for a day off. */
export const rosterCellSchema = z.object({
  employeeId: z.string().min(1).max(64),
  day: daySchema,
  shiftId: z.string().min(1).max(64).nullable(),
});
export type RosterCellBody = z.infer<typeof rosterCellSchema>;

export const defaultShiftSchema = z.object({
  shiftId: z.string().min(1).max(64).nullable(),
});

const reason = z.string().trim().min(3).max(500);

/** A manager adds a punch the phone could not make (audited, with a reason). */
export const manualPunchSchema = z.object({
  employeeId: z.string().min(1).max(64),
  kind: z.enum(PUNCH_KINDS),
  at: z.string().datetime({ offset: true }),
  reason,
});
export type ManualPunchBody = z.infer<typeof manualPunchSchema>;

export const voidPunchSchema = z.object({ reason });

/** A manager sets a day's status (null goes back to the computed one). */
export const dayStatusSchema = z.object({
  employeeId: z.string().min(1).max(64),
  day: daySchema,
  status: z.enum(ATTENDANCE_STATUSES).nullable(),
  reason,
});
export type DayStatusBody = z.infer<typeof dayStatusSchema>;
