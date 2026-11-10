import type { Prisma } from '@prisma/client';
import {
  type AccessProfile,
  cairoAt,
  cairoDay,
  canDo,
  correctionNumber,
  type CorrectionRequestBody,
  dayDeduction,
  employeeCode,
  leaveRequestNumber,
  parseMinute,
  violationNumber,
} from '@shiplynow/shared';
import { addManualPunch } from './attendance';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { inStoreScope, listLeaveRequests, type StoreScope, unpaidLeaveDaysFor } from './hr-leave';
import { managerLinks, managerOf, teamIds } from './hr-org';
import { finalDeductionsFor } from './hr-violations';
import { getSetting } from './settings';

// HR phase 3 (docs/HR.md "Phase 3 as built"): attendance correction requests (the person asks,
// the manager approves, HR applies them through the existing corrections), the inbox of what
// waits for a manager or HR, the menu counts, and what HR hands to the salary run (unpaid leave
// days and final violation deductions, each taken once).

const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);
const dayText = (d: Date) => d.toISOString().slice(0, 10);

// ─── attendance correction requests ────────────────────────────────────────────

const correctionInclude = {
  employee: {
    select: {
      id: true,
      number: true,
      nameEn: true,
      nameAr: true,
      userId: true,
      homeStoreId: true,
      homeStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
    },
  },
} as const;
type CorrectionRow = Prisma.AttendanceCorrectionGetPayload<{ include: typeof correctionInclude }>;

function correctionView(c: CorrectionRow) {
  return {
    id: c.id,
    number: correctionNumber(c.number),
    employee: {
      id: c.employee.id,
      code: employeeCode(c.employee.number),
      nameEn: c.employee.nameEn,
      nameAr: c.employee.nameAr,
      store: c.employee.homeStore,
    },
    day: dayText(c.day),
    problem: c.problem,
    proposedIn: c.proposedIn,
    proposedOut: c.proposedOut,
    status: c.status,
    managerDecidedAt: c.managerDecidedAt,
    hrDecidedAt: c.hrDecidedAt,
    rejectReason: c.rejectReason,
    createdAt: c.createdAt,
  };
}
export type CorrectionView = ReturnType<typeof correctionView>;

/** A time of the day as an instant; an out at or before the in runs past midnight. */
function times(day: string, inText?: string | null, outText?: string | null) {
  const inMin = inText ? parseMinute(inText) : null;
  const outMin = outText ? parseMinute(outText) : null;
  const proposedIn = inMin === null ? null : cairoAt(day, inMin);
  const proposedOut =
    outMin === null
      ? null
      : cairoAt(day, inMin !== null && outMin <= inMin ? outMin + 1440 : outMin);
  return { proposedIn, proposedOut };
}

/** A person asks to fix one of their days; it goes to their manager, or to HR without one. */
export function requestCorrection(
  db: Db,
  input: { userId: string; body: CorrectionRequestBody; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const seen = await tx.attendanceCorrection.findUnique({
      where: { idempotencyKey: input.body.idempotencyKey },
      include: correctionInclude,
    });
    if (seen) {
      if (seen.employee.userId !== input.userId) throw new DomainError('idempotency_key_reused');
      return correctionView(seen);
    }
    const e = await tx.employee.findUnique({ where: { userId: input.userId } });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (input.body.day > cairoDay(now)) throw new DomainError('day_in_future', 400);
    const { proposedIn, proposedOut } = times(
      input.body.day,
      input.body.proposedIn,
      input.body.proposedOut,
    );
    if ((proposedIn && proposedIn > now) || (proposedOut && proposedOut > now))
      throw new DomainError('punch_in_future', 400);
    const open = await tx.attendanceCorrection.findFirst({
      where: {
        employeeId: e.id,
        day: dayDate(input.body.day),
        status: { in: ['pending_manager', 'pending_hr'] },
      },
    });
    if (open)
      throw new DomainError('correction_open', 409, { number: correctionNumber(open.number) });
    const manager = await managerOf(tx, e.id);
    const c = await tx.attendanceCorrection.create({
      data: {
        employeeId: e.id,
        day: dayDate(input.body.day),
        problem: input.body.problem,
        proposedIn,
        proposedOut,
        status: manager.managerId ? 'pending_manager' : 'pending_hr',
        managerEmployeeId: manager.managerId,
        requestedById: input.userId,
        idempotencyKey: input.body.idempotencyKey,
      },
      include: correctionInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.userId,
      action: 'attendance.correction_request',
      entityType: 'attendance_correction',
      entityId: c.id,
      after: {
        employeeId: e.id,
        day: input.body.day,
        problem: c.problem,
        proposedIn: proposedIn?.toISOString() ?? null,
        proposedOut: proposedOut?.toISOString() ?? null,
        status: c.status,
      },
    });
    return correctionView(c);
  });
}

async function loadCorrection(tx: Db, id: string) {
  await tx.$queryRaw`SELECT id FROM attendance_corrections WHERE id = ${id} FOR UPDATE`;
  const c = await tx.attendanceCorrection.findUnique({ where: { id }, include: correctionInclude });
  if (!c) throw new DomainError('correction_not_found', 404);
  return c;
}

/** Step one: the person's manager in force approves or refuses (never their own). */
export function managerDecideCorrection(
  db: Db,
  input: {
    correctionId: string;
    actorUserId: string;
    approve: boolean;
    reason?: string;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const c = await loadCorrection(tx, input.correctionId);
    if (c.employee.userId === input.actorUserId) throw new DomainError('own_request', 403);
    const me = await tx.employee.findUnique({
      where: { userId: input.actorUserId },
      select: { id: true },
    });
    if (!me || (await managerOf(tx, c.employeeId)).managerId !== me.id)
      throw new DomainError('not_your_team', 403);
    if (c.status !== 'pending_manager') throw new DomainError('correction_not_waiting');
    if (!input.approve && !input.reason) throw new DomainError('reason_required', 400);
    const after = await tx.attendanceCorrection.update({
      where: { id: c.id },
      data: input.approve
        ? { status: 'pending_hr', managerDecidedById: input.actorUserId, managerDecidedAt: now }
        : {
            status: 'rejected',
            managerDecidedById: input.actorUserId,
            managerDecidedAt: now,
            rejectedById: input.actorUserId,
            rejectedAt: now,
            rejectReason: input.reason,
          },
      include: correctionInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: input.approve
        ? 'attendance.correction_manager_approve'
        : 'attendance.correction_reject',
      entityType: 'attendance_correction',
      entityId: c.id,
      before: { status: c.status },
      after: { status: after.status, reason: input.reason ?? null },
    });
    return correctionView(after);
  });
}

/**
 * Step two: HR (hr use) applies the correction through the attendance corrections (a manual
 * punch for each proposed time, with the person's words as the reason; the day is built again),
 * optionally with other times; or refuses it with a reason at either step.
 */
export function hrDecideCorrection(
  db: Db,
  input: {
    correctionId: string;
    actorUserId: string;
    approve: boolean;
    reason?: string;
    proposedIn?: string | null;
    proposedOut?: string | null;
    scope: StoreScope;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const c = await loadCorrection(tx, input.correctionId);
    if (!inStoreScope(input.scope, c.employee.homeStoreId))
      throw new DomainError('store_not_allowed', 403);
    if (c.employee.userId === input.actorUserId) throw new DomainError('own_request', 403);
    if (!input.approve) {
      if (c.status !== 'pending_manager' && c.status !== 'pending_hr')
        throw new DomainError('correction_not_waiting');
      if (!input.reason) throw new DomainError('reason_required', 400);
      const after = await tx.attendanceCorrection.update({
        where: { id: c.id },
        data: {
          status: 'rejected',
          hrDecidedById: input.actorUserId,
          hrDecidedAt: now,
          rejectedById: input.actorUserId,
          rejectedAt: now,
          rejectReason: input.reason,
        },
        include: correctionInclude,
      });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'attendance.correction_reject',
        entityType: 'attendance_correction',
        entityId: c.id,
        before: { status: c.status },
        after: { status: 'rejected', reason: input.reason },
      });
      return correctionView(after);
    }
    if (c.status !== 'pending_hr') throw new DomainError('correction_not_waiting');
    const day = dayText(c.day);
    const changed = input.proposedIn !== undefined || input.proposedOut !== undefined;
    const t = changed ? times(day, input.proposedIn, input.proposedOut) : c;
    if (!t.proposedIn && !t.proposedOut) throw new DomainError('times_required', 400);
    const punchIds: string[] = [];
    const reason = `${correctionNumber(c.number)}: ${c.problem}`.slice(0, 500);
    for (const [kind, at] of [
      ['in', t.proposedIn],
      ['out', t.proposedOut],
    ] as const) {
      if (!at) continue;
      const punch = await addManualPunch(tx, {
        body: { employeeId: c.employeeId, kind, at: at.toISOString(), reason },
        actorUserId: input.actorUserId,
        scope: input.scope,
        now,
      });
      punchIds.push(punch.id);
    }
    const after = await tx.attendanceCorrection.update({
      where: { id: c.id },
      data: {
        status: 'applied',
        hrDecidedById: input.actorUserId,
        hrDecidedAt: now,
        punchIds,
        proposedIn: t.proposedIn,
        proposedOut: t.proposedOut,
      },
      include: correctionInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'attendance.correction_apply',
      entityType: 'attendance_correction',
      entityId: c.id,
      before: { status: c.status },
      after: { status: 'applied', punchIds },
    });
    return correctionView(after);
  });
}

/** The person withdraws a correction that still waits. */
export function cancelCorrection(
  db: Db,
  input: { correctionId: string; actorUserId: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const c = await loadCorrection(tx, input.correctionId);
    if (c.employee.userId !== input.actorUserId) throw new DomainError('correction_not_found', 404);
    if (c.status !== 'pending_manager' && c.status !== 'pending_hr')
      throw new DomainError('correction_not_waiting');
    const after = await tx.attendanceCorrection.update({
      where: { id: c.id },
      data: { status: 'cancelled', cancelledAt: input.now ?? new Date() },
      include: correctionInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'attendance.correction_cancel',
      entityType: 'attendance_correction',
      entityId: c.id,
      before: { status: c.status },
      after: { status: 'cancelled' },
    });
    return correctionView(after);
  });
}

export async function listCorrections(
  db: Db,
  input: { scope: StoreScope; status?: string; employeeId?: string; employeeIds?: string[] },
) {
  const statuses = ['pending_manager', 'pending_hr', 'applied', 'rejected', 'cancelled'];
  const rows = await db.attendanceCorrection.findMany({
    where: {
      ...(input.status === 'pending'
        ? { status: { in: ['pending_manager', 'pending_hr'] } }
        : input.status && statuses.includes(input.status)
          ? { status: input.status as CorrectionRow['status'] }
          : {}),
      ...(input.employeeId && { employeeId: input.employeeId }),
      ...(input.employeeIds && { employeeId: { in: input.employeeIds } }),
      ...(input.scope && { employee: { homeStoreId: { in: input.scope } } }),
    },
    include: correctionInclude,
    orderBy: [{ day: 'desc' }, { number: 'desc' }],
    take: 300,
  });
  return rows.map(correctionView);
}

// ─── the inbox ─────────────────────────────────────────────────────────────────

/** The people whose manager in force is this person (only direct reports approve through them). */
export async function directReports(db: Db, managerEmployeeId: string) {
  const [people, departments] = await Promise.all([
    db.employee.findMany({
      where: { status: { not: 'left' } },
      select: { id: true, managerId: true, departmentId: true },
    }),
    db.department.findMany({ select: { id: true, parentId: true, headEmployeeId: true } }),
  ]);
  const links = managerLinks(people, departments);
  return [...links.entries()]
    .filter(([, l]) => l.managerId === managerEmployeeId)
    .map(([id]) => id);
}

const hrScope = (access: AccessProfile | null | undefined): StoreScope =>
  !access || access.allStores ? null : access.storeIds;

/**
 * What waits for a person: as a manager, the leave and correction requests of their direct
 * reports at the manager step; with hr use, requests at the HR step and the open suggestions;
 * with hr manage, appeals to decide (not those they recorded). Nobody sees their own requests.
 */
export async function hrInbox(
  db: Db,
  input: { userId: string; access: AccessProfile | null | undefined },
) {
  const me = await db.employee.findUnique({
    where: { userId: input.userId },
    select: { id: true },
  });
  const reports = me ? await directReports(db, me.id) : [];
  const notMine = (rows: { employee: { id: string } }[]) =>
    rows.filter((r) => r.employee.id !== me?.id);
  const managerLeave = reports.length
    ? notMine(
        await listLeaveRequests(db, {
          scope: null,
          status: 'pending_manager',
          employeeIds: reports,
        }),
      )
    : [];
  const managerCorrections = reports.length
    ? notMine(
        await listCorrections(db, { scope: null, status: 'pending_manager', employeeIds: reports }),
      )
    : [];
  const hrUse = canDo(input.access, 'hr', 'use');
  const hrManage = canDo(input.access, 'hr', 'manage');
  const scope = hrScope(input.access);
  const hrLeave = hrUse
    ? notMine(await listLeaveRequests(db, { scope, status: 'pending_hr' }))
    : [];
  const hrCorrections = hrUse
    ? notMine(await listCorrections(db, { scope, status: 'pending_hr' }))
    : [];
  const suggestions = hrUse
    ? await db.violationSuggestion.count({
        where: { status: 'open', ...(scope && { employee: { homeStoreId: { in: scope } } }) },
      })
    : 0;
  const appeals = hrManage
    ? await db.violation.findMany({
        where: {
          status: 'appealed',
          recordedById: { not: input.userId },
          employee: { userId: { not: input.userId }, ...(scope && { homeStoreId: { in: scope } }) },
        },
        select: {
          id: true,
          number: true,
          occurredOn: true,
          appealReason: true,
          appealedAt: true,
          penalty: true,
          days: true,
          amountPiastres: true,
          type: { select: { nameEn: true, nameAr: true } },
          employee: { select: { id: true, number: true, nameEn: true, nameAr: true } },
        },
        orderBy: { appealedAt: 'asc' },
      })
    : [];
  const total =
    managerLeave.length +
    managerCorrections.length +
    hrLeave.length +
    hrCorrections.length +
    appeals.length;
  return {
    isManager: reports.length > 0,
    hr: { use: hrUse, manage: hrManage },
    manager: { leave: managerLeave, corrections: managerCorrections },
    hrStep: { leave: hrLeave, corrections: hrCorrections },
    appeals: appeals.map((a) => ({
      id: a.id,
      number: violationNumber(a.number),
      occurredOn: dayText(a.occurredOn),
      appealReason: a.appealReason,
      appealedAt: a.appealedAt,
      penalty: a.penalty,
      days: a.days === null ? null : Number(a.days),
      amountPiastres: a.amountPiastres,
      type: a.type,
      employee: {
        id: a.employee.id,
        code: employeeCode(a.employee.number),
        nameEn: a.employee.nameEn,
        nameAr: a.employee.nameAr,
      },
    })),
    suggestions,
    total,
  };
}

/** The counts on the menus: the inbox and (hr use) the open suggestions. */
export async function hrBadges(
  db: Db,
  input: { userId: string; access: AccessProfile | null | undefined },
) {
  const inbox = await hrInbox(db, input);
  return { inbox: inbox.total, suggested: inbox.suggestions };
}

/** A manager's team (direct and indirect) as employee ids, for their read only views. */
export async function teamEmployeeIds(db: Db, userId: string) {
  const me = await db.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!me) return [];
  return [...(await teamIds(db, me.id)).keys()];
}

// ─── payroll ───────────────────────────────────────────────────────────────────

export interface HrPayItem {
  kind: 'unpaid_leave' | 'violation';
  id: string;
  label: string;
  days: number | null;
  amountPiastres: number;
}

/**
 * What HR hands to a month's salary run for an employee: unpaid leave days and final violation
 * deductions up to the month's last day that no run has taken yet. A day of pay is the basic
 * salary divided by hr.payroll_days_per_month. The deductions reduce the gross before tax.
 */
export async function hrPayrollItems(
  db: Db,
  input: { employeeId: string; monthEnd: string; basicPiastres: number },
) {
  const perMonth = await getSetting(db, 'hr.payroll_days_per_month');
  const items: HrPayItem[] = [];
  for (const d of await unpaidLeaveDaysFor(db, input.employeeId, input.monthEnd)) {
    const days = Number(d.fraction);
    items.push({
      kind: 'unpaid_leave',
      id: d.id,
      label: `${leaveRequestNumber(d.request.number)} ${d.request.type.nameEn} ${dayText(d.day)}`,
      days,
      amountPiastres: dayDeduction(input.basicPiastres, days, perMonth),
    });
  }
  for (const v of await finalDeductionsFor(db, input.employeeId, input.monthEnd)) {
    const days = v.days === null ? null : Number(v.days);
    items.push({
      kind: 'violation',
      id: v.id,
      label: `${violationNumber(v.number)} ${v.type.nameEn}`,
      days,
      amountPiastres:
        v.penalty === 'deduction_amount'
          ? (v.amountPiastres ?? 0)
          : dayDeduction(input.basicPiastres, days ?? 0, perMonth),
    });
  }
  return { items, totalPiastres: items.reduce((s, i) => s + i.amountPiastres, 0) };
}

/** Marks HR items as taken by a salary run (each once: rows already taken are left alone). */
export async function markHrPayrollItems(
  tx: Prisma.TransactionClient,
  items: HrPayItem[],
  entryId: string,
) {
  for (const i of items) {
    const done =
      i.kind === 'unpaid_leave'
        ? await tx.leaveRequestDay.updateMany({
            where: { id: i.id, payrollEntryId: null },
            data: { payrollEntryId: entryId, deductionPiastres: i.amountPiastres },
          })
        : await tx.violation.updateMany({
            where: { id: i.id, payrollEntryId: null },
            data: { payrollEntryId: entryId, deductionPiastres: i.amountPiastres },
          });
    if (done.count !== 1) throw new DomainError('hr_item_already_paid');
  }
}
