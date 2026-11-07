import { z } from 'zod';
import {
  type AccessTemplate,
  JOB_ROLE_TEMPLATES,
  JOB_ROLES,
  type JobRole,
  type JobRoleLabel,
  matchJobRole,
} from './access';
import { badgeCodeSchema } from './admin';
import { ALLOWANCE_KINDS } from './hr';
import { addDays, isCalendarDay } from './hours';
import { dayDeduction } from './hr-leave';
import { normalizeEgyptianPhone } from './phone';

/**
 * HR phase 2 (docs/HR.md "Phase 2 as built"): guided flows. The new hire wizard keeps what is
 * typed in a draft between steps; the leaving wizard computes the final settlement figures
 * handed to payroll. Everything here is pure, so the web steps and the server check the same.
 */

// ─── new hire wizard ───────────────────────────────────────────────────────────

export const HIRE_STEPS = ['person', 'job', 'pay', 'documents', 'access', 'review'] as const;
export type HireStep = (typeof HIRE_STEPS)[number];

export const HIRE_KINDS = ['team', 'rider'] as const;
export type HireKind = (typeof HIRE_KINDS)[number];

const text = (max: number) => z.string().max(max).optional();
const idText = z.string().max(64).optional();
const piastres = z.number().int().min(0).max(1_000_000_000);

/** What a draft holds: lenient (half typed forms are saved), checked step by step. */
export const hireDraftDataSchema = z.object({
  person: z
    .object({
      nameEn: text(120),
      nameAr: text(120),
      mobile: text(30),
      email: text(200),
      nationalId: text(20),
      birthDate: text(10),
      address: text(300),
      emergencyName: text(120),
      emergencyPhone: text(30),
    })
    .partial()
    .default({}),
  job: z
    .object({
      kind: z.enum(HIRE_KINDS),
      departmentId: idText,
      positionId: idText,
      gradeId: idText,
      managerId: idText,
      storeIds: z.array(z.string().max(64)).max(50),
      hireDate: text(10),
      employment: z.enum(['employee', 'outsourced']),
      staffingSupplierId: idText,
      contractType: z.enum(['permanent', 'fixed_term', 'part_time']),
      contractEndsOn: text(10),
      probationEndsOn: text(10),
      defaultShiftId: idText,
      badgeCode: text(20),
      jobTitle: text(120),
    })
    .partial()
    .default({}),
  pay: z
    .object({
      basicPiastres: piastres.nullable(),
      insuredWagePiastres: piastres.nullable(),
      allowances: z
        .array(
          z.object({
            kind: z.enum(ALLOWANCE_KINDS),
            label: z.string().max(60).optional(),
            amountPiastres: piastres,
          }),
        )
        .max(12),
      bankName: text(80),
      bankAccountNumber: text(40),
      iban: text(40),
      bankAccountHolder: text(120),
    })
    .partial()
    .default({}),
  access: z
    .object({
      login: z.boolean(),
      jobRole: z.union([z.enum(JOB_ROLES), z.literal('')]),
      allStores: z.boolean(),
      storeIds: z.array(z.string().max(64)).max(200),
      customerData: z.boolean(),
      salaries: z.boolean(),
    })
    .partial()
    .default({}),
});
export type HireDraftData = z.infer<typeof hireDraftDataSchema>;

/** PUT /hr/hire-drafts/:id (and POST to start one): the step reached and what it holds. */
export const hireDraftSaveSchema = z.object({
  step: z.enum(HIRE_STEPS),
  data: hireDraftDataSchema,
});
export type HireDraftSaveBody = z.infer<typeof hireDraftSaveSchema>;

/** POST /hr/hire-drafts/:id/create: one key per click, so a retry answers the same file. */
export const hireCreateSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
});

/**
 * The steps a person goes through: pay only with the salaries switch and for people on our
 * payroll (outsourced people are paid by their company).
 */
export function hireSteps(input: { canPay: boolean; employment?: string }): HireStep[] {
  return HIRE_STEPS.filter(
    (s) => s !== 'pay' || (input.canPay && input.employment !== 'outsourced'),
  );
}

/** The step after or before `step` among `steps` (staying put at either end). */
export function nextHireStep(steps: readonly HireStep[], step: HireStep, by: 1 | -1): HireStep {
  const i = Math.max(0, steps.indexOf(step));
  return steps[Math.min(steps.length - 1, Math.max(0, i + by))]!;
}

/** Share of the way through, 0 to 100 (the review step is 100). */
export function hireProgress(steps: readonly HireStep[], step: HireStep) {
  const i = Math.max(0, steps.indexOf(step));
  return steps.length <= 1 ? 100 : Math.round((i / (steps.length - 1)) * 100);
}

/** Account kinds a job role signs in as: the store screens, the books, or the office apps. */
const STORE_ROLES: JobRole[] = ['store_staff', 'hub_staff', 'qc_agent', 'store_manager'];
const FINANCE_ROLES: JobRole[] = ['accountant', 'finance_officer', 'finance_manager'];

/** The account role a new login gets: riders the rider app, store people their store. */
export function accountRoleFor(kind: HireKind, jobRole: JobRole | '' | undefined) {
  if (kind === 'rider') return 'rider' as const;
  if (jobRole && STORE_ROLES.includes(jobRole)) return 'store_staff' as const;
  if (jobRole && FINANCE_ROLES.includes(jobRole)) return 'finance' as const;
  return 'admin' as const;
}

/**
 * The job role a default position starts the access step from (positions HR adds later have
 * none; HR picks one). Riders sign in to the rider app and have no job role.
 */
export const POSITION_JOB_ROLES: Record<string, JobRole | 'rider'> = {
  CEO: 'owner',
  COO: 'operations_manager',
  'STORE-MGR': 'store_manager',
  PICKER: 'store_staff',
  'HUB-LEAD': 'store_manager',
  'HUB-STAFF': 'hub_staff',
  'RIDER-LEAD': 'dispatcher',
  RIDER: 'rider',
  'QC-AGENT': 'qc_agent',
  'COM-HEAD': 'sales_manager',
  AM: 'account_manager',
  SALES: 'sales_rep',
  'FIN-MGR': 'finance_manager',
  ACCOUNTANT: 'accountant',
  'HR-MGR': 'hr_manager',
  'HR-OFFICER': 'hr_officer',
  'CS-AGENT': 'customer_service',
};

/** The access values a new login gets: the job role, with the store scope and switches. */
export function hireAccessValues(access: HireDraftData['access']): AccessTemplate & {
  jobRole: JobRoleLabel;
} {
  const role = (access.jobRole || 'store_staff') as JobRole;
  const values: AccessTemplate = {
    ...JOB_ROLE_TEMPLATES[role],
    allStores: access.allStores ?? JOB_ROLE_TEMPLATES[role].allStores,
    customerData: access.customerData ?? JOB_ROLE_TEMPLATES[role].customerData,
    salaries: access.salaries ?? JOB_ROLE_TEMPLATES[role].salaries,
  };
  return { ...values, jobRole: matchJobRole(values, role) };
}

/** Field → reason a step cannot go on yet. Empty: the step is complete. */
export type StepIssues = Record<string, string>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DIGITS14 = /^\d{14}$/;

function dayIssue(value: string | undefined, required: boolean): string | null {
  if (!value) return required ? 'required' : null;
  return isCalendarDay(value) ? null : 'invalid_date';
}

/**
 * What stops a step from being complete. `today` keeps a birth date in the past; the review
 * step is every step together (with the pay step only when it is one of the steps).
 */
export function hireStepIssues(
  data: HireDraftData,
  step: HireStep,
  options: { today: string; steps?: readonly HireStep[] },
): StepIssues {
  const out: StepIssues = {};
  const p = data.person ?? {};
  const j = data.job ?? {};
  const pay = data.pay ?? {};
  const a = data.access ?? {};
  if (step === 'review') {
    for (const s of options.steps ?? HIRE_STEPS)
      if (s !== 'review') Object.assign(out, hireStepIssues(data, s, options));
    return out;
  }
  if (step === 'person') {
    if (!p.nameEn || p.nameEn.trim().length < 2) out['person.nameEn'] = 'required';
    if (p.nameAr && p.nameAr.trim().length < 2) out['person.nameAr'] = 'too_short';
    if (!p.mobile) out['person.mobile'] = 'required';
    else if (!normalizeEgyptianPhone(p.mobile)) out['person.mobile'] = 'invalid_egyptian_phone';
    if (p.email && !EMAIL.test(p.email.trim())) out['person.email'] = 'invalid_email';
    if (p.nationalId && !DIGITS14.test(p.nationalId.trim()))
      out['person.nationalId'] = 'invalid_national_id';
    const birth = dayIssue(p.birthDate, false);
    if (birth) out['person.birthDate'] = birth;
    else if (p.birthDate && p.birthDate >= options.today) out['person.birthDate'] = 'in_future';
    if (p.emergencyPhone && !normalizeEgyptianPhone(p.emergencyPhone))
      out['person.emergencyPhone'] = 'invalid_egyptian_phone';
  }
  if (step === 'job') {
    if (!j.kind) out['job.kind'] = 'required';
    if (!j.departmentId && !j.positionId) out['job.departmentId'] = 'required';
    const hire = dayIssue(j.hireDate, true);
    if (hire) out['job.hireDate'] = hire;
    if (j.kind === 'rider') {
      if ((j.storeIds ?? []).length !== 1) out['job.storeIds'] = 'one_store';
      if (!j.badgeCode) out['job.badgeCode'] = 'required';
      else if (!badgeCodeSchema.safeParse(j.badgeCode).success)
        out['job.badgeCode'] = 'invalid_badge_code';
    }
    if (!j.employment) out['job.employment'] = 'required';
    if (j.employment === 'outsourced' && !j.staffingSupplierId)
      out['job.staffingSupplierId'] = 'required';
    if (j.contractType === 'fixed_term' && !j.contractEndsOn)
      out['job.contractEndsOn'] = 'required';
    const end = dayIssue(j.contractEndsOn, false);
    if (end) out['job.contractEndsOn'] = end;
    else if (j.contractEndsOn && j.hireDate && j.contractEndsOn < j.hireDate)
      out['job.contractEndsOn'] = 'before_hire';
    const probation = dayIssue(j.probationEndsOn, false);
    if (probation) out['job.probationEndsOn'] = probation;
    else if (j.probationEndsOn && j.hireDate && j.probationEndsOn < j.hireDate)
      out['job.probationEndsOn'] = 'before_hire';
  }
  if (step === 'pay' && j.employment !== 'outsourced') {
    if (pay.basicPiastres == null || pay.basicPiastres <= 0) out['pay.basicPiastres'] = 'required';
    if (pay.iban && !/^EG\d{27}$/.test(pay.iban.replace(/\s+/g, '').toUpperCase()))
      out['pay.iban'] = 'invalid_iban';
  }
  if (step === 'access') {
    const login = j.kind === 'rider' || Boolean(a.login);
    if (login) {
      if (!p.email) out['person.email'] = 'required_for_login';
      else if (!EMAIL.test(p.email.trim())) out['person.email'] = 'invalid_email';
      if (j.kind !== 'rider') {
        if (!a.jobRole) out['access.jobRole'] = 'required';
        if (!a.allStores && (a.storeIds ?? []).length === 0) out['access.storeIds'] = 'required';
      }
    }
  }
  return out;
}

/** The access step's starting values from the job step: the position's job role and stores. */
export function defaultHireAccess(input: {
  kind?: HireKind;
  positionCode?: string | null;
  storeIds?: string[];
}): HireDraftData['access'] {
  const mapped = input.positionCode ? POSITION_JOB_ROLES[input.positionCode] : undefined;
  const jobRole = mapped && mapped !== 'rider' ? mapped : '';
  const template = jobRole ? JOB_ROLE_TEMPLATES[jobRole] : null;
  return {
    login: true,
    jobRole,
    allStores: template ? template.allStores : false,
    storeIds: input.storeIds ?? [],
    customerData: template?.customerData ?? false,
    salaries: template?.salaries ?? false,
  };
}

// ─── leaving wizard ────────────────────────────────────────────────────────────

export const EXIT_REASONS = ['resignation', 'termination', 'end_of_contract', 'other'] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

/** What a leaver looked after and may need a new owner. */
export const REASSIGN_KINDS = [
  'manager_of',
  'department_head',
  'account_manager',
  'deal_owner',
  'company_owner',
] as const;
export type ReassignKind = (typeof REASSIGN_KINDS)[number];

const day = z
  .string()
  .trim()
  .refine((v) => isCalendarDay(v), 'invalid_date');

/** POST /hr/employees/:id/leaving: confirms the leaving wizard. */
export const leavingSchema = z
  .object({
    lastDay: day,
    reason: z.enum(EXIT_REASONS),
    note: z.string().trim().max(300).optional(),
    noticeGivenOn: day.optional(),
    /** Titles of the offboarding tasks for company items already returned */
    itemsReturned: z.array(z.string().max(200)).max(60).default([]),
    /** New owners chosen in the wizard (null: nobody yet, listed under Needs a new owner) */
    replacements: z
      .array(
        z.object({
          kind: z.enum(REASSIGN_KINDS),
          entityId: z.string().min(1).max(64),
          newOwnerId: z.string().min(1).max(64).nullable(),
        }),
      )
      .max(500)
      .default([]),
    idempotencyKey: z.string().min(8).max(100),
  })
  .superRefine((v, ctx) => {
    if (v.reason === 'other' && (v.note ?? '').length < 2)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'note_required' });
    if (v.noticeGivenOn && v.noticeGivenOn > v.lastDay)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['noticeGivenOn'],
        message: 'notice_after_last_day',
      });
  });
export type LeavingBody = z.infer<typeof leavingSchema>;

/** PUT /hr/reassignments/:id: the new owner of one thing a leaver looked after. */
export const reassignSchema = z.object({ newOwnerId: z.string().min(1).max(64) });

/** Whole days from one calendar day to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string) {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/** The notice check: days between the notice and the last day against the notice period. */
export function noticeCheck(input: {
  noticeGivenOn: string | null | undefined;
  lastDay: string;
  noticeDays: number;
}) {
  if (!input.noticeGivenOn) return { givenDays: null, shortBy: input.noticeDays };
  const givenDays = Math.max(0, daysBetween(input.noticeGivenOn, input.lastDay));
  return { givenDays, shortBy: Math.max(0, input.noticeDays - givenDays) };
}

export interface SettlementInput {
  lastDay: string;
  hireDate: string | null;
  /** The basic salary in force on the last day; null: unknown (outsourced, none, no switch) */
  basicPiastres: number | null;
  daysPerMonth: number;
  /** Annual leave remaining on the last day (may be negative: taken ahead) */
  annualRemaining: number;
  payUnusedLeave: boolean;
  /** Unpaid leave days no salary run has taken yet */
  unpaidLeaveDays: number;
  /** Final violation deductions no salary run has taken yet */
  deductions: { days: number | null; amountPiastres: number | null }[];
  /** What the person still owes on staff advances (1500 wallet) */
  advancePiastres: number;
  /** Sales commission worked out and not paid yet */
  commissionPiastres: number;
}

/**
 * The final settlement figures handed to payroll (read only; the salary run pays them): days
 * worked in the last month and their pay, unused annual leave to pay (or taken ahead), unpaid
 * days and deductions not yet taken, advances to take back and commission still owed. Money
 * figures are null when the basic salary is unknown; the net is an estimate before tax and
 * insurance.
 */
export function exitSettlement(i: SettlementInput) {
  const monthStart = `${i.lastDay.slice(0, 8)}01`;
  const from = i.hireDate && i.hireDate > monthStart ? i.hireDate : monthStart;
  const daysInMonth = new Date(
    Date.UTC(Number(i.lastDay.slice(0, 4)), Number(i.lastDay.slice(5, 7)), 0),
  ).getUTCDate();
  const daysWorked = Math.max(0, daysBetween(from, i.lastDay) + 1);
  const wholeMonth = from === monthStart && daysWorked === daysInMonth;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const leaveDaysToPay = i.payUnusedLeave ? round2(Math.max(0, i.annualRemaining)) : 0;
  const leaveDaysAhead = round2(Math.max(0, -i.annualRemaining));
  const basic = i.basicPiastres;
  const pay = (days: number) => (basic === null ? null : dayDeduction(basic, days, i.daysPerMonth));
  const lastMonthPay = basic === null ? null : wholeMonth ? basic : pay(daysWorked);
  const deductionDays = i.deductions.reduce((s, d) => s + (d.days ?? 0), 0);
  const deductionsPiastres =
    basic === null && i.deductions.some((d) => d.amountPiastres === null)
      ? null
      : i.deductions.reduce(
          (s, d) => s + (d.amountPiastres ?? dayDeduction(basic ?? 0, d.days ?? 0, i.daysPerMonth)),
          0,
        );
  const leavePay = pay(leaveDaysToPay);
  const leaveAheadPay = pay(leaveDaysAhead);
  const unpaidPay = pay(i.unpaidLeaveDays);
  const net =
    lastMonthPay === null ||
    leavePay === null ||
    leaveAheadPay === null ||
    unpaidPay === null ||
    deductionsPiastres === null
      ? null
      : lastMonthPay +
        leavePay +
        i.commissionPiastres -
        leaveAheadPay -
        unpaidPay -
        deductionsPiastres -
        i.advancePiastres;
  return {
    from,
    daysWorked,
    lastMonthPayPiastres: lastMonthPay,
    leaveDaysToPay,
    leavePayPiastres: leavePay,
    leaveDaysAhead,
    leaveAheadPiastres: leaveAheadPay,
    unpaidLeaveDays: i.unpaidLeaveDays,
    unpaidLeavePiastres: unpaidPay,
    deductionCount: i.deductions.length,
    deductionDays,
    deductionsPiastres,
    advancePiastres: i.advancePiastres,
    commissionPiastres: i.commissionPiastres,
    netPiastres: net,
  };
}
export type ExitSettlement = ReturnType<typeof exitSettlement>;

/** The settlement's money fields, left out for people without the salaries switch. */
export const SETTLEMENT_MONEY = [
  'lastMonthPayPiastres',
  'leavePayPiastres',
  'leaveAheadPiastres',
  'unpaidLeavePiastres',
  'deductionsPiastres',
  'advancePiastres',
  'commissionPiastres',
  'netPiastres',
] as const;

/** The end of a Cairo day as the next day's start (the account is disabled then). */
export function dayAfter(lastDay: string) {
  return addDays(lastDay, 1);
}

// ─── documents ─────────────────────────────────────────────────────────────────

/** POST /hr/employees/:id/documents/remind: ask the person for one document type. */
export const documentRemindSchema = z.object({ typeId: z.string().min(1).max(64) });

/** Document states HR may remind about: nothing valid is on the file, or it runs out soon. */
export const REMINDABLE_STATES = ['missing', 'rejected', 'expired', 'expiring'] as const;
