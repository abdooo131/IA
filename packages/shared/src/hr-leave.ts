import { z } from 'zod';
import { addDays, parseMinute } from './hours';
import { daySchema } from './hr';

/**
 * HR phase 3 (docs/HR.md "Phase 3 as built"): leave types and requests with balances, violations
 * with an escalation ladder, suggested violations from attendance, attendance correction
 * requests and the manager inbox. The rules that need no database live here so the API, the
 * web app and the tests share them.
 */

export const LEAVE_BALANCE_KINDS = ['annual', 'own', 'none'] as const;
export type LeaveBalanceKind = (typeof LEAVE_BALANCE_KINDS)[number];

export const LEAVE_REQUEST_STATUSES = [
  'pending_manager',
  'pending_hr',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

export const VIOLATION_CATEGORIES = ['attendance', 'conduct', 'cash', 'damage', 'safety'] as const;
export type ViolationCategory = (typeof VIOLATION_CATEGORIES)[number];

export const PENALTY_KINDS = [
  'verbal_warning',
  'written_warning',
  'deduction_days',
  'deduction_amount',
  'suspension_days',
  'termination_review',
] as const;
export type PenaltyKind = (typeof PENALTY_KINDS)[number];

export const VIOLATION_STATUSES = ['recorded', 'appealed', 'final', 'cancelled'] as const;
export type ViolationStatus = (typeof VIOLATION_STATUSES)[number];

export const SUGGESTION_KINDS = ['late', 'absent'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export const CORRECTION_STATUSES = [
  'pending_manager',
  'pending_hr',
  'applied',
  'rejected',
  'cancelled',
] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

/** The violation types the attendance close suggests for (seeded; HR may edit their ladders). */
export const SUGGESTION_TYPE_CODES: Record<SuggestionKind, string> = {
  late: 'late_arrival',
  absent: 'absence_without_leave',
};

export const leaveRequestNumber = (n: number) => `LV-${String(n).padStart(6, '0')}`;
export const violationNumber = (n: number) => `VIO-${String(n).padStart(6, '0')}`;
export const correctionNumber = (n: number) => `COR-${String(n).padStart(6, '0')}`;

const id = z.string().min(1).max(64);
const idempotencyKey = z.string().min(8).max(100);
const reason = z.string().trim().min(3).max(500);
const note = z
  .string()
  .trim()
  .max(1000)
  .transform((v) => v || null)
  .nullable()
  .optional();
/** Days in quarters (0.25, 0.5...), as violation steps allow. */
const quarterDays = z
  .number()
  .min(0.25)
  .max(365)
  .refine((v) => Number.isInteger(v * 4), 'quarter_days');
const halfDays = z
  .number()
  .min(0)
  .max(366)
  .refine((v) => Number.isInteger(v * 2), 'half_days');

export const leaveTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/),
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  paid: z.boolean(),
  balance: z.enum(LEAVE_BALANCE_KINDS),
  yearlyDays: halfDays.nullable(),
  casualAllowance: z.boolean(),
  documentAboveDays: z.number().int().min(0).max(365).nullable(),
  maxDaysPerRequest: z.number().int().min(1).max(366).nullable(),
  noticeDays: z.number().int().min(0).max(90),
  selfRequest: z.boolean(),
  isActive: z.boolean(),
  sort: z.number().int().min(0).max(1000).optional(),
});
export type LeaveTypeBody = z.infer<typeof leaveTypeSchema>;

/** A person asks for leave (from My HR), or HR for them (employeeId and the overrides). */
export const leaveRequestSchema = z.object({
  typeId: id,
  from: daySchema,
  to: daySchema,
  halfDay: z.boolean().default(false),
  note,
  idempotencyKey,
});
export type LeaveRequestBody = z.infer<typeof leaveRequestSchema>;

export const hrLeaveRequestSchema = leaveRequestSchema.extend({
  employeeId: id,
  /** Above the balance: the days beyond it become unpaid */
  overrideBalance: z.boolean().default(false),
  /** Further back than hr.leave_backdate_days */
  overrideBackdate: z.boolean().default(false),
});
export type HrLeaveRequestBody = z.infer<typeof hrLeaveRequestSchema>;

export const rejectSchema = z.object({ reason });
export const cancelSchema = z.object({ reason: reason.optional() });

/** HR changes a balance with a reason (no type: the annual balance). */
export const leaveAdjustmentSchema = z.object({
  employeeId: id,
  typeId: id.nullable(),
  year: z.number().int().min(2000).max(2100),
  days: z
    .number()
    .min(-366)
    .max(366)
    .refine((v) => v !== 0 && Number.isInteger(v * 2), 'half_days'),
  reason,
});
export type LeaveAdjustmentBody = z.infer<typeof leaveAdjustmentSchema>;

export const violationStepSchema = z
  .object({
    penalty: z.enum(PENALTY_KINDS),
    days: quarterDays.nullable().optional(),
    /** deduction_amount: null means the amount is entered when recording */
    amountPiastres: z.number().int().min(1).max(100_000_000).nullable().optional(),
  })
  .refine(
    (s) => (['deduction_days', 'suspension_days'].includes(s.penalty) ? !!s.days : s.days == null),
    'step_days',
  )
  .refine((s) => s.penalty === 'deduction_amount' || s.amountPiastres == null, 'step_amount');
export type ViolationStepBody = z.infer<typeof violationStepSchema>;

export const violationTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/),
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  category: z.enum(VIOLATION_CATEGORIES),
  isActive: z.boolean(),
  sort: z.number().int().min(0).max(1000).optional(),
  steps: z.array(violationStepSchema).min(1).max(10),
});
export type ViolationTypeBody = z.infer<typeof violationTypeSchema>;

/** HR records a violation; the ladder picks the step unless HR changes it with a reason. */
export const recordViolationSchema = z
  .object({
    employeeId: id,
    typeId: id,
    occurredOn: daySchema,
    description: z.string().trim().min(3).max(2000),
    step: z.number().int().min(1).max(10).optional(),
    stepReason: reason.optional(),
    /** The amount of a deduction entered when recording (a cash shortage, damage) */
    amountPiastres: z.number().int().min(1).max(100_000_000).optional(),
    idempotencyKey,
  })
  .refine((b) => b.step === undefined || !!b.stepReason, 'step_reason_required');
export type RecordViolationBody = z.infer<typeof recordViolationSchema>;

export const appealSchema = z.object({ reason });
export const violationDecisionSchema = z.object({
  decision: z.enum(['upheld', 'cancelled']),
  note: reason,
});
export type ViolationDecisionBody = z.infer<typeof violationDecisionSchema>;

/** HR confirms a suggested violation onto the ladder (optionally another type). */
export const confirmSuggestionSchema = z.object({
  typeId: id.optional(),
  description: z.string().trim().min(3).max(2000).optional(),
  idempotencyKey,
});

const clock = z
  .string()
  .trim()
  .refine((v) => parseMinute(v) !== null, 'invalid_time')
  .nullable()
  .optional();

/** A person asks to fix one of their days: what is wrong and the times it should show. */
export const correctionRequestSchema = z
  .object({
    day: daySchema,
    problem: z.string().trim().min(3).max(1000),
    proposedIn: clock,
    proposedOut: clock,
    idempotencyKey,
  })
  .refine((b) => !!b.proposedIn || !!b.proposedOut, 'times_required');
export type CorrectionRequestBody = z.infer<typeof correctionRequestSchema>;

/** HR applies a correction, optionally with other times than the person proposed. */
export const applyCorrectionSchema = z.object({
  proposedIn: clock,
  proposedOut: clock,
});

// ─── pure rules ────────────────────────────────────────────────────────────────

/** The leave year a day falls in, named by the calendar year it starts in. */
export function leaveYearOf(day: string, startMonth: number): number {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return month >= startMonth ? year : year - 1;
}

/** First and last day of a leave year. */
export function leaveYearRange(year: number, startMonth: number) {
  const mm = String(startMonth).padStart(2, '0');
  const from = `${year}-${mm}-01`;
  const next = `${year + 1}-${mm}-01`;
  return { from, to: addDays(next, -1) };
}

/** Rounds days down to a half day (balances never give more than earned). */
export function floorHalf(days: number) {
  return Math.floor(days * 2 + 1e-9) / 2;
}

/** Keeps two decimals (the database keeps days as numeric(6,2)). */
export const days2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The months of a leave year that count for a person: from their hire month on (a joiner's
 * first year is prorated by whole months, the hire month counted), and with monthly accrual
 * only the months that have started by `asOf`.
 */
export function countedMonths(input: {
  year: number;
  startMonth: number;
  hireDate: string | null;
  asOf: string;
  monthly: boolean;
}) {
  let count = 0;
  for (let i = 0; i < 12; i++) {
    const m = ((input.startMonth - 1 + i) % 12) + 1;
    const y = input.year + Math.floor((input.startMonth - 1 + i) / 12);
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = addDays(
      `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`,
      -1,
    );
    if (input.hireDate && input.hireDate > last) continue;
    if (input.monthly && first > input.asOf) continue;
    count++;
  }
  return count;
}

/** A yearly allowance prorated by counted months, rounded down to a half day. */
export function prorate(yearlyDays: number, months: number) {
  if (months >= 12) return yearlyDays;
  return floorHalf((yearlyDays * months) / 12);
}

/** What the carry over into the next year comes to: what is left, at most the limit. */
export function carryOver(remaining: number, limit: number) {
  return Math.max(0, Math.min(remaining, limit));
}

/**
 * The working days of a period for a person: a day planned with a shift counts, a planned day
 * off does not; without a roster row the default weekdays decide. Holidays never count.
 */
export function workingDays(input: {
  from: string;
  to: string;
  holidays: Set<string>;
  /** Roster rows: true for a shift, false for a day off */
  roster: Map<string, boolean>;
  /** Weekdays (0 = Sunday) worked when the day is not on the roster */
  defaultWeekdays: number[];
}) {
  const out: string[] = [];
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) {
    if (input.holidays.has(d)) continue;
    const planned = input.roster.get(d);
    if (planned === false) continue;
    if (planned === undefined) {
      const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (!input.defaultWeekdays.includes(weekday)) continue;
    }
    out.push(d);
  }
  return out;
}

/** Office weeks when a person has neither a roster nor a default shift: Sunday to Thursday. */
export const OFFICE_WEEKDAYS = [0, 1, 2, 3, 4];

/** The ladder step of a new violation: one past the prior ones in the period, capped at the last. */
export function ladderStep(priorCount: number, stepCount: number) {
  return Math.max(1, Math.min(priorCount + 1, stepCount));
}

/** Pay taken for days: basic ÷ hr.payroll_days_per_month × days, rounded to the piastre. */
export function dayDeduction(basicPiastres: number, days: number, daysPerMonth: number) {
  if (daysPerMonth <= 0) return 0;
  return Math.round((basicPiastres * days) / daysPerMonth);
}

/** Whether an appeal is still possible: within hr.appeal_days of the recording. */
export function appealOpen(recordedAt: Date, now: Date, appealDays: number) {
  return now.getTime() < recordedAt.getTime() + appealDays * 86_400_000;
}
