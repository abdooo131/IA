import { addDays, cairoAt, cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clockPunch,
  closeAttendanceDays,
  createHoliday,
  createShift,
  setDefaultShift,
} from '../src/attendance';
import { DomainError } from '../src/domain-error';
import {
  createSupplier,
  ensureDefaultAccounts,
  previewPayroll,
  recordCapital,
  runPayroll,
} from '../src/finance';
import { ensureHrDefaults } from '../src/hr-defaults';
import {
  hrBadges,
  hrDecideCorrection,
  hrInbox,
  hrPayrollItems,
  managerDecideCorrection,
  requestCorrection,
} from '../src/hr-inbox';
import {
  adjustLeaveBalance,
  annualEntitlement,
  cancelLeave,
  hrDecideLeave,
  leaveBalances,
  leaveCalendar,
  managerDecideLeave,
  requestLeave,
} from '../src/hr-leave';
import { setEmployment, setSalary } from '../src/hr-pay';
import {
  appealViolation,
  confirmSuggestion,
  decideViolation,
  dismissSuggestion,
  finalizeViolations,
  listSuggestions,
  listViolations,
  recordViolation,
  suggestViolations,
} from '../src/hr-violations';
import { setSetting } from '../src/settings';
import { createFixture, prisma, resetDatabase } from './helpers';

// HR phase 3 (docs/HR.md "Phase 3 as built"). Wednesday 4 November 2026, 10:00 in Cairo.
const D = '2026-11-04';
const at = (day: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return cairoAt(day, h * 60 + m);
};
const NOW = at(D, '10:00');
const SUN_TO_THU = [0, 1, 2, 3, 4];
const AT_STORE = { lat: 30.0005, lng: 31.0005, accuracy: 20 };

let f: Awaited<ReturnType<typeof createFixture>>;
let hr1: string;
let hr2: string;
let shiftId: string;
let n = 0;
const key = () => `hr3-${++n}-${Math.random().toString(36).slice(2)}`;
const types = async () => {
  const rows = await prisma.leaveType.findMany();
  const by = (code: string) => rows.find((t) => t.code === code)!.id;
  return {
    annual: by('annual'),
    casual: by('casual'),
    sick: by('sick'),
    unpaid: by('unpaid'),
  };
};
const vtype = async (code: string) =>
  (await prisma.violationType.findUniqueOrThrow({ where: { code } })).id;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  await ensureHrDefaults(prisma);
  const admin = (name: string) =>
    prisma.user.create({
      data: { email: `${name}@t.eg`, name, role: 'admin', passwordHash: 'x' },
    });
  hr1 = (await admin('hr1')).id;
  hr2 = (await admin('hr2')).id;
  shiftId = (
    await createShift(prisma, {
      body: {
        nameEn: 'Office',
        start: '09:00',
        end: '17:00',
        breakMinutes: 30,
        weekdays: SUN_TO_THU,
        overnight: false,
      },
      actorUserId: hr1,
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A store staff member with a file, the Sunday to Thursday shift planned from `planFrom`. */
async function person(
  name: string,
  options: {
    hire?: string;
    managerId?: string;
    shift?: boolean;
    planFrom?: Date;
  } = {},
) {
  const user = await prisma.user.create({
    data: {
      email: `${name}@t.eg`,
      name,
      role: 'store_staff',
      darkStoreId: f.store.id,
      passwordHash: 'x',
    },
  });
  const employee = await prisma.employee.create({
    data: {
      userId: user.id,
      nameEn: name,
      homeStoreId: f.store.id,
      hireDate: options.hire ? new Date(`${options.hire}T00:00:00Z`) : null,
      managerId: options.managerId ?? null,
    },
  });
  if (options.shift !== false)
    await setDefaultShift(prisma, {
      employeeId: employee.id,
      shiftId,
      actorUserId: hr1,
      scope: null,
      now: options.planFrom ?? NOW,
    });
  return { userId: user.id, employeeId: employee.id };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code, ...error.details };
    throw error;
  }
  throw new Error('expected a refusal');
}

const ask = (
  p: { userId: string; employeeId: string },
  body: { typeId: string; from: string; to: string; halfDay?: boolean },
  now = NOW,
) =>
  requestLeave(prisma, {
    employeeId: p.employeeId,
    body: { halfDay: false, ...body, idempotencyKey: key() },
    actorUserId: p.userId,
    onBehalf: false,
    now,
  });

const hrAsk = (
  employeeId: string,
  body: {
    typeId: string;
    from: string;
    to: string;
    overrideBalance?: boolean;
    overrideBackdate?: boolean;
  },
  now = NOW,
) =>
  requestLeave(prisma, {
    employeeId,
    body: {
      halfDay: false,
      overrideBalance: false,
      overrideBackdate: false,
      ...body,
      employeeId,
      idempotencyKey: key(),
    },
    actorUserId: hr1,
    onBehalf: true,
    scope: null,
    now,
  });

const hrApprove = (requestId: string, actor = hr2, now = NOW) =>
  hrDecideLeave(prisma, { requestId, actorUserId: actor, approve: true, scope: null, now });

describe('entitlement and balances', () => {
  it('takes the position over the grade over the default', async () => {
    const p = await person('ali', { shift: false });
    expect(await annualEntitlement(prisma, p.employeeId)).toEqual({ days: 21, source: 'default' });
    const grade = await prisma.grade.create({
      data: { code: 'G-T', nameEn: 'T', nameAr: 'ت', rank: 50, annualLeaveDays: 25 },
    });
    await prisma.employee.update({ where: { id: p.employeeId }, data: { gradeId: grade.id } });
    expect(await annualEntitlement(prisma, p.employeeId)).toEqual({ days: 25, source: 'grade' });
    const dept = await prisma.department.findFirstOrThrow();
    const position = await prisma.jobPosition.create({
      data: { code: 'P-T', titleEn: 'T', titleAr: 'ت', departmentId: dept.id, annualLeaveDays: 30 },
    });
    await prisma.employee.update({
      where: { id: p.employeeId },
      data: { positionId: position.id },
    });
    expect(await annualEntitlement(prisma, p.employeeId)).toEqual({
      days: 30,
      source: 'position',
    });
    await setSetting(prisma, { key: 'hr.default_annual_leave_days', value: 15, actorUserId: hr1 });
    expect((await annualEntitlement(prisma, p.employeeId)).days).toBe(30);
  });

  it('prorates joiners, accrues monthly when set and carries over up to the limit', async () => {
    const joiner = await person('joiner', { hire: '2026-04-20', shift: false });
    const b = await leaveBalances(prisma, { employeeId: joiner.employeeId, asOf: D });
    expect(b.annual).toMatchObject({ entitlement: 15.5, remaining: 15.5 }); // 21 × 9 / 12 = 15.75

    const old = await person('old', { hire: '2024-01-01', shift: false });
    expect(
      (await leaveBalances(prisma, { employeeId: old.employeeId, asOf: D })).annual,
    ).toMatchObject({ entitlement: 21, carriedIn: 0 });
    await setSetting(prisma, { key: 'hr.leave_accrual_monthly', value: 1, actorUserId: hr1 });
    // January to November have started: 21 × 11 / 12 = 19.25, a half day down.
    expect(
      (await leaveBalances(prisma, { employeeId: old.employeeId, asOf: D })).annual.entitlement,
    ).toBe(19);
    await setSetting(prisma, { key: 'hr.leave_accrual_monthly', value: 0, actorUserId: hr1 });

    // 2025 ends with 8 days left after an adjustment of −16; at most 3 come into 2026.
    await setSetting(prisma, { key: 'hr.leave_carry_over_days', value: 3, actorUserId: hr1 });
    await adjustLeaveBalance(prisma, {
      body: {
        employeeId: old.employeeId,
        typeId: null,
        year: 2025,
        days: -16,
        reason: 'Leave taken before the system',
      },
      actorUserId: hr1,
      scope: null,
    });
    const now = await leaveBalances(prisma, { employeeId: old.employeeId, asOf: D });
    expect(now.annual).toMatchObject({ entitlement: 21, carriedIn: 3, remaining: 24 });
    const last = await leaveBalances(prisma, { employeeId: old.employeeId, year: 2025 });
    // 2025 itself got 3 carried from 2024: 21 + 3 − 16 = 8.
    expect(last.annual).toMatchObject({ carriedIn: 3, adjustments: -16, remaining: 8 });
    // Adjustments are rows with a reason, audited on the person.
    expect(
      await prisma.auditLog.count({
        where: { action: 'leave.balance_adjust', entityId: old.employeeId },
      }),
    ).toBe(1);
  });
});

describe('requests', () => {
  it('counts working days against the roster and holidays, and refuses overlaps', async () => {
    const t = await types();
    const p = await person('sara');
    await createHoliday(prisma, {
      body: { day: '2026-11-10', nameEn: 'Holiday', nameAr: 'عطلة' },
      actorUserId: hr1,
      now: NOW,
    });
    // Sunday 8 to Saturday 14 November: Friday and Saturday are off, Tuesday 10 a holiday.
    const r = await ask(p, { typeId: t.annual, from: '2026-11-08', to: '2026-11-14' });
    expect(r).toMatchObject({ days: 4, status: 'pending_hr' }); // no manager: straight to HR
    // Beyond the planned two weeks the shift's weekdays decide.
    const later = await ask(p, { typeId: t.casual, from: '2026-12-06', to: '2026-12-07' });
    expect(later.days).toBe(2);
    expect(
      await refusal(ask(p, { typeId: t.annual, from: '2026-11-12', to: '2026-11-12' })),
    ).toEqual({
      code: 'leave_overlap',
      number: r.number,
    });
    expect(
      await refusal(ask(p, { typeId: t.annual, from: '2026-11-11', to: '2026-11-13' })),
    ).toMatchObject({ code: 'leave_overlap' });
    expect(
      await refusal(ask(p, { typeId: t.annual, from: '2026-11-20', to: '2026-11-21' })),
    ).toEqual({ code: 'no_working_days' }); // Friday and Saturday
    // Half a day, one day only.
    const half = await ask(p, {
      typeId: t.annual,
      from: '2026-11-17',
      to: '2026-11-17',
      halfDay: true,
    });
    expect(half.days).toBe(0.5);
    expect(
      await refusal(
        ask(p, { typeId: t.annual, from: '2026-11-18', to: '2026-11-19', halfDay: true }),
      ),
    ).toEqual({ code: 'half_day_one_day' });
  });

  it('refuses more than the balance, short notice and too far back, except unpaid and HR overrides', async () => {
    const t = await types();
    const p = await person('omar');
    expect(
      await refusal(ask(p, { typeId: t.annual, from: '2026-11-08', to: '2026-12-31' })),
    ).toMatchObject({ code: 'leave_above_balance', available: 21 });
    expect(await refusal(ask(p, { typeId: t.annual, from: D, to: D }))).toEqual({
      code: 'leave_notice',
      days: 2,
    });
    expect(
      await refusal(ask(p, { typeId: t.casual, from: '2026-11-08', to: '2026-11-10' })),
    ).toEqual({ code: 'leave_too_long', days: 2 });
    expect(
      await refusal(
        hrAsk(p.employeeId, { typeId: t.annual, from: '2026-10-20', to: '2026-10-20' }),
      ),
    ).toEqual({ code: 'leave_too_far_back', days: 7 });
    const back = await hrAsk(p.employeeId, {
      typeId: t.annual,
      from: '2026-10-20',
      to: '2026-10-20',
      overrideBackdate: true,
    });
    expect(back.status).toBe('pending_hr');
    // Unpaid leave has no balance: any length (with its notice).
    const unpaid = await ask(p, { typeId: t.unpaid, from: '2026-11-15', to: '2026-12-31' });
    expect(unpaid.days).toBeGreaterThan(21);
    // HR may go past the balance: the days beyond it are unpaid.
    const over = await hrAsk(p.employeeId, {
      typeId: t.annual,
      from: '2027-01-03',
      to: '2027-02-04',
      overrideBalance: true,
    });
    const done = await hrApprove(over.id);
    expect(done.status).toBe('approved');
    const rows = await prisma.leaveRequestDay.findMany({ where: { requestId: over.id } });
    expect(rows.filter((r) => r.paid).length).toBe(21);
    expect(rows.filter((r) => !r.paid).length).toBe(rows.length - 21);
    expect(
      (await leaveBalances(prisma, { employeeId: p.employeeId, year: 2027 })).annual.remaining,
    ).toBe(0);
  });

  it('casual leave counts against annual and its own yearly cap', async () => {
    const t = await types();
    const p = await person('nour');
    await setSetting(prisma, { key: 'hr.casual_leave_days', value: 2, actorUserId: hr1 });
    const a = await ask(p, { typeId: t.casual, from: '2026-11-08', to: '2026-11-09' });
    await hrApprove(a.id);
    const b = await leaveBalances(prisma, { employeeId: p.employeeId, asOf: D });
    expect(b.annual.taken).toBe(2);
    expect(b.annual.remaining).toBe(19);
    expect(b.types.find((x) => x.type.code === 'casual')).toMatchObject({
      entitlement: 2,
      taken: 2,
      available: 0,
    });
    expect(
      await refusal(ask(p, { typeId: t.casual, from: '2026-11-11', to: '2026-11-11' })),
    ).toMatchObject({ code: 'leave_above_balance', available: 0 });
  });
});

describe('two step approval', () => {
  it('goes to the manager in force first, then HR, never to oneself', async () => {
    const t = await types();
    const boss = await person('boss');
    const other = await person('other');
    const p = await person('worker', { managerId: boss.employeeId });
    const r = await ask(p, { typeId: t.annual, from: '2026-11-08', to: '2026-11-09' });
    expect(r.status).toBe('pending_manager');
    expect(
      await refusal(
        managerDecideLeave(prisma, { requestId: r.id, actorUserId: p.userId, approve: true }),
      ),
    ).toEqual({ code: 'own_request' });
    expect(
      await refusal(
        managerDecideLeave(prisma, { requestId: r.id, actorUserId: other.userId, approve: true }),
      ),
    ).toEqual({ code: 'not_your_team' });
    // HR cannot approve before the manager (it may refuse at either step).
    expect(await refusal(hrApprove(r.id))).toEqual({ code: 'leave_not_waiting' });
    // The manager's inbox holds it; the person's own does not.
    expect(
      (await hrInbox(prisma, { userId: boss.userId, access: null })).manager.leave,
    ).toHaveLength(1);
    expect((await hrBadges(prisma, { userId: p.userId, access: null })).inbox).toBe(0);
    const step = await managerDecideLeave(prisma, {
      requestId: r.id,
      actorUserId: boss.userId,
      approve: true,
      now: NOW,
    });
    expect(step.status).toBe('pending_hr');
    const final = await hrApprove(r.id);
    expect(final.status).toBe('approved');
    expect(
      await prisma.auditLog.count({ where: { entityType: 'leave_request', entityId: r.id } }),
    ).toBe(3);

    // A manager refuses with a reason; HR asks for themselves and cannot approve it.
    const r2 = await ask(p, { typeId: t.annual, from: '2026-11-16', to: '2026-11-16' });
    expect(
      await refusal(
        managerDecideLeave(prisma, { requestId: r2.id, actorUserId: boss.userId, approve: false }),
      ),
    ).toEqual({ code: 'reason_required' });
    const no = await managerDecideLeave(prisma, {
      requestId: r2.id,
      actorUserId: boss.userId,
      approve: false,
      reason: 'Stock count that day',
    });
    expect(no).toMatchObject({ status: 'rejected', rejectReason: 'Stock count that day' });

    const mine = await ask(boss, { typeId: t.annual, from: '2026-11-08', to: '2026-11-08' });
    expect(mine.status).toBe('pending_hr');
    expect(
      await refusal(
        hrDecideLeave(prisma, {
          requestId: mine.id,
          actorUserId: boss.userId,
          approve: true,
          scope: null,
        }),
      ),
    ).toEqual({ code: 'own_request' });
  });

  it('needs the document above the type limit before HR approves', async () => {
    const t = await types();
    const p = await person('ill');
    const r = await ask(p, { typeId: t.sick, from: '2026-11-04', to: '2026-11-05' });
    expect(await refusal(hrApprove(r.id))).toEqual({ code: 'document_required' });
    const { attachLeaveDocument } = await import('../src/hr-leave');
    await attachLeaveDocument(prisma, {
      requestId: r.id,
      actorUserId: p.userId,
      asHr: false,
      contentType: 'application/pdf',
      data: Buffer.from('%PDF-1.4 note'),
      name: 'note.pdf',
    });
    expect((await hrApprove(r.id)).status).toBe('approved');
  });

  it('gives the days back when HR cancels an approved request; the person cannot', async () => {
    const t = await types();
    const p = await person('karim');
    const r = await ask(p, { typeId: t.annual, from: '2026-11-08', to: '2026-11-11' });
    await hrApprove(r.id);
    expect((await leaveBalances(prisma, { employeeId: p.employeeId, asOf: D })).annual.taken).toBe(
      4,
    );
    expect(
      await refusal(cancelLeave(prisma, { requestId: r.id, actorUserId: p.userId, asHr: false })),
    ).toEqual({ code: 'approved_leave_hr_only' });
    const c = await cancelLeave(prisma, {
      requestId: r.id,
      actorUserId: hr1,
      asHr: true,
      reason: 'Called back for the opening',
      scope: null,
      now: NOW,
    });
    expect(c.status).toBe('cancelled');
    const b = await leaveBalances(prisma, { employeeId: p.employeeId, asOf: D });
    expect(b.annual).toMatchObject({ taken: 0, remaining: 21 });
    // A waiting request the person withdraws themself.
    const w = await ask(p, { typeId: t.annual, from: '2026-11-15', to: '2026-11-15' });
    expect(
      (await cancelLeave(prisma, { requestId: w.id, actorUserId: p.userId, asHr: false })).status,
    ).toBe('cancelled');
  });
});

describe('effects', () => {
  it('marks closed attendance days on leave and shows the leave on the calendar', async () => {
    const t = await types();
    const p = await person('maha', { planFrom: at('2026-10-25', '08:00') });
    await closeAttendanceDays(prisma, NOW);
    const day = (d: string) =>
      prisma.attendanceDay.findUniqueOrThrow({
        where: { employeeId_day: { employeeId: p.employeeId, day: new Date(`${d}T00:00:00Z`) } },
      });
    expect((await day('2026-11-02')).status).toBe('absent');
    expect((await suggestViolations(prisma, NOW)).suggested).toBeGreaterThan(0);
    const r = await hrAsk(p.employeeId, { typeId: t.annual, from: '2026-11-01', to: '2026-11-02' });
    await hrApprove(r.id);
    expect((await day('2026-11-01')).status).toBe('on_leave');
    expect((await day('2026-11-02')).status).toBe('on_leave');
    // The absence suggestions of those days fall away.
    await suggestViolations(prisma, NOW);
    const open = await listSuggestions(prisma, { scope: null });
    expect(open.some((s) => s.day === '2026-11-01' || s.day === '2026-11-02')).toBe(false);
    const cal = await leaveCalendar(prisma, { month: '2026-11', scope: null });
    expect(cal.people[0]!.days['2026-11-01']).toMatchObject({ status: 'approved', fraction: 1 });
    expect(cal.people[0]!.total).toBe(2);
  });
});

describe('violations', () => {
  it('climbs the ladder inside the period and a changed step keeps its reason', async () => {
    const p = await person('late');
    const late = await vtype('late_arrival');
    const rec = (day: string, extra: Record<string, unknown> = {}) =>
      recordViolation(prisma, {
        body: {
          employeeId: p.employeeId,
          typeId: late,
          occurredOn: day,
          description: 'Came late',
          idempotencyKey: key(),
          ...extra,
        },
        actorUserId: hr1,
        scope: null,
        now: NOW,
      });
    // One older than 180 days does not count.
    expect((await rec('2026-03-01')).step).toBe(1);
    const a = await rec('2026-10-01');
    expect(a).toMatchObject({ step: 1, penalty: 'written_warning' });
    const b = await rec('2026-10-10');
    expect(b).toMatchObject({ step: 2, penalty: 'deduction_days', days: 0.25 });
    // Cancelled violations do not count.
    await decideViolation(prisma, {
      violationId: b.id,
      actorUserId: hr2,
      decision: 'cancelled',
      note: 'Traffic accident on the ring road',
      scope: null,
      now: NOW,
    });
    expect((await rec('2026-10-20')).step).toBe(2);
    const c = await rec('2026-11-01', { step: 4, stepReason: 'Agreed with the store manager' });
    expect(c).toMatchObject({
      step: 4,
      suggestedStep: 3,
      stepReason: 'Agreed with the store manager',
      days: 1,
    });
    // Cash shortages take the amount entered.
    const cash = await vtype('cash_shortage');
    expect(
      await refusal(
        recordViolation(prisma, {
          body: {
            employeeId: p.employeeId,
            typeId: cash,
            occurredOn: D,
            description: 'Box short',
            idempotencyKey: key(),
          },
          actorUserId: hr1,
          scope: null,
          now: NOW,
        }),
      ),
    ).toEqual({ code: 'amount_required' });
  });

  it('allows one appeal inside the window, decided by someone else, and finals the rest', async () => {
    const p = await person('appeal');
    const misconduct = await vtype('misconduct');
    const rec = (now: Date) =>
      recordViolation(prisma, {
        body: {
          employeeId: p.employeeId,
          typeId: misconduct,
          occurredOn: cairoDay(now),
          description: 'Shouted at a rider',
          idempotencyKey: key(),
        },
        actorUserId: hr1,
        scope: null,
        now,
      });
    const v = await rec(NOW);
    const appealed = await appealViolation(prisma, {
      violationId: v.id,
      actorUserId: p.userId,
      reason: 'The rider insulted me first',
      now: at('2026-11-05', '10:00'),
    });
    expect(appealed.status).toBe('appealed');
    expect(
      await refusal(
        appealViolation(prisma, {
          violationId: v.id,
          actorUserId: p.userId,
          reason: 'Again',
          now: at('2026-11-05', '11:00'),
        }),
      ),
    ).toEqual({ code: 'already_appealed' });
    expect(
      await refusal(
        decideViolation(prisma, {
          violationId: v.id,
          actorUserId: hr1,
          decision: 'upheld',
          note: 'I saw it',
          scope: null,
        }),
      ),
    ).toEqual({ code: 'same_person' });
    const upheld = await decideViolation(prisma, {
      violationId: v.id,
      actorUserId: hr2,
      decision: 'upheld',
      note: 'Witnesses agree',
      scope: null,
      now: at('2026-11-06', '10:00'),
    });
    expect(upheld).toMatchObject({ status: 'final', decision: 'upheld' });

    // Without an appeal: closed after hr.appeal_days (3), then final by the job.
    const w = await rec(at('2026-10-20', '10:00'));
    expect(
      await refusal(
        appealViolation(prisma, {
          violationId: w.id,
          actorUserId: p.userId,
          reason: 'Too late now',
          now: NOW,
        }),
      ),
    ).toEqual({ code: 'appeal_closed' });
    expect((await finalizeViolations(prisma, NOW)).finalized).toBe(1);
    expect((await finalizeViolations(prisma, NOW)).finalized).toBe(0);
    expect((await prisma.violation.findUniqueOrThrow({ where: { id: w.id } })).status).toBe(
      'final',
    );
  });

  it('suggests one violation per person and day from attendance, confirmed or dismissed', async () => {
    const p = await person('day', { planFrom: at('2026-10-25', '08:00') });
    // Monday 2 November: in at 09:40, 40 minutes late (grace 10).
    await clockPunch(prisma, {
      userId: p.userId,
      kind: 'in',
      position: AT_STORE,
      now: at('2026-11-02', '09:40'),
    });
    await clockPunch(prisma, {
      userId: p.userId,
      kind: 'out',
      position: AT_STORE,
      now: at('2026-11-02', '17:00'),
    });
    await closeAttendanceDays(prisma, NOW);
    const first = await suggestViolations(prisma, NOW);
    const again = await suggestViolations(prisma, NOW);
    expect(first.suggested).toBeGreaterThan(0);
    expect(again.suggested).toBe(0);
    const open = await listSuggestions(prisma, { scope: null });
    const lateOne = open.find((s) => s.day === '2026-11-02')!;
    expect(lateOne).toMatchObject({ kind: 'late', lateMinutes: 40 });
    expect(lateOne.type?.code).toBe('late_arrival');
    const absent = open.find((s) => s.kind === 'absent')!;
    const v = await confirmSuggestion(prisma, {
      suggestionId: lateOne.id,
      actorUserId: hr1,
      scope: null,
      idempotencyKey: key(),
      now: NOW,
    });
    expect(v).toMatchObject({ step: 1, occurredOn: '2026-11-02', penalty: 'written_warning' });
    await dismissSuggestion(prisma, { suggestionId: absent.id, actorUserId: hr1, scope: null });
    expect(
      await refusal(
        dismissSuggestion(prisma, { suggestionId: absent.id, actorUserId: hr1, scope: null }),
      ),
    ).toEqual({ code: 'suggestion_closed' });
    expect((await hrBadges(prisma, { userId: hr1, access: null })).suggested).toBe(0);
  });

  it('lists outsourced deductions for their company and keeps them out of payroll', async () => {
    const p = await person('temp');
    const agency = await createSupplier(prisma, { name: 'Agency', actorUserId: hr1 });
    await setEmployment(prisma, {
      userId: p.userId,
      employment: 'outsourced',
      staffingSupplierId: agency.id,
      actorUserId: hr1,
    });
    const v = await recordViolation(prisma, {
      body: {
        employeeId: p.employeeId,
        typeId: await vtype('absence_without_leave'),
        occurredOn: D,
        description: 'Did not come',
        idempotencyKey: key(),
      },
      actorUserId: hr1,
      scope: null,
      now: NOW,
    });
    await decideViolation(prisma, {
      violationId: v.id,
      actorUserId: hr2,
      decision: 'upheld',
      note: 'Confirmed by the store',
      scope: null,
      now: NOW,
    });
    const list = await listViolations(prisma, { scope: null, forSupplier: true });
    expect(list.map((x) => x.id)).toEqual([v.id]);
    expect(list[0]).toMatchObject({ forSupplier: true, employee: { employment: 'outsourced' } });
    expect(
      (
        await hrPayrollItems(prisma, {
          employeeId: p.employeeId,
          monthEnd: '2026-11-30',
          basicPiastres: 900_000,
        })
      ).items,
    ).toEqual([]);
  });
});

describe('payroll', () => {
  it('takes unpaid leave and final deductions once, a day being basic over 30', async () => {
    await ensureDefaultAccounts(prisma);
    const bank = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: bank.id,
      amountPiastres: 50_000_000,
      reference: 'Owner',
      actorUserId: hr1,
      idempotencyKey: key(),
    });
    const p = await person('paid', { shift: false });
    await setSalary(prisma, { userId: p.userId, monthlyPiastres: 900_000, actorUserId: hr1 });
    const t = await types();
    // Last month (relative to today, as the salary run needs), on a working day of the office week.
    const month = addDays(cairoDay(new Date()), -40).slice(0, 7);
    let d = `${month}-10`;
    while (![0, 1, 2, 3, 4].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1);
    const inMonth = cairoAt(d, 12 * 60);
    const r = await hrAsk(p.employeeId, {
      typeId: t.unpaid,
      from: d,
      to: d,
      overrideBackdate: true,
    });
    await hrApprove(r.id, hr2, inMonth);
    const v = await recordViolation(prisma, {
      body: {
        employeeId: p.employeeId,
        typeId: await vtype('absence_without_leave'),
        occurredOn: d,
        description: 'Absent',
        idempotencyKey: key(),
      },
      actorUserId: hr1,
      scope: null,
      now: inMonth,
    });
    await decideViolation(prisma, {
      violationId: v.id,
      actorUserId: hr2,
      decision: 'upheld',
      note: 'Confirmed',
      scope: null,
      now: inMonth,
    });
    const plan = await previewPayroll(prisma, { month, lines: [{ userId: p.userId }] });
    expect(plan.rows[0]).toMatchObject({ base: 900_000, hrDeduction: 60_000, gross: 840_000 });
    expect(plan.rows[0]!.hrItems.map((i) => i.kind).sort()).toEqual(['unpaid_leave', 'violation']);
    const entry = await runPayroll(prisma, {
      month,
      moneyAccountId: bank.id,
      lines: [{ userId: p.userId }],
      actorUserId: hr1,
    });
    const taken = await prisma.violation.findUniqueOrThrow({ where: { id: v.id } });
    expect(taken).toMatchObject({ payrollEntryId: entry.id, deductionPiastres: 30_000 });
    // The next month takes nothing again.
    const next = addDays(`${month}-28`, 5).slice(0, 7);
    const later = await previewPayroll(prisma, { month: next, lines: [{ userId: p.userId }] });
    expect(later.rows[0]!.hrDeduction).toBe(0);
    // A request whose days reached payroll can no longer be cancelled.
    expect(
      await refusal(
        cancelLeave(prisma, {
          requestId: r.id,
          actorUserId: hr1,
          asHr: true,
          reason: 'Mistake',
          scope: null,
        }),
      ),
    ).toEqual({ code: 'leave_in_payroll' });
  });
});

describe('attendance corrections', () => {
  it('goes from the person to their manager to HR, who applies it as manual punches', async () => {
    const boss = await person('lead', { planFrom: at('2026-10-25', '08:00') });
    const p = await person('fix', {
      managerId: boss.employeeId,
      planFrom: at('2026-10-25', '08:00'),
    });
    await closeAttendanceDays(prisma, NOW);
    const c = await requestCorrection(prisma, {
      userId: p.userId,
      body: {
        day: '2026-11-02',
        problem: 'My phone had no battery',
        proposedIn: '09:00',
        proposedOut: '17:00',
        idempotencyKey: key(),
      },
      now: NOW,
    });
    expect(c.status).toBe('pending_manager');
    expect(
      await refusal(
        requestCorrection(prisma, {
          userId: p.userId,
          body: { day: '2026-11-02', problem: 'Again', proposedIn: '09:00', idempotencyKey: key() },
          now: NOW,
        }),
      ),
    ).toMatchObject({ code: 'correction_open' });
    await managerDecideCorrection(prisma, {
      correctionId: c.id,
      actorUserId: boss.userId,
      approve: true,
      now: NOW,
    });
    const done = await hrDecideCorrection(prisma, {
      correctionId: c.id,
      actorUserId: hr1,
      approve: true,
      scope: null,
      now: NOW,
    });
    expect(done.status).toBe('applied');
    const row = await prisma.attendanceDay.findUniqueOrThrow({
      where: {
        employeeId_day: { employeeId: p.employeeId, day: new Date('2026-11-02T00:00:00Z') },
      },
    });
    expect(row.status).toBe('present');
    expect(row.flags).toContain('manual_punch');
  });
});
