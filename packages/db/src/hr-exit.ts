import type { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDayStart,
  dealNumber,
  employeeCode,
  type ExitReason,
  exitSettlement,
  type ExitSettlement,
  isTeamRole,
  type LeavingBody,
  noticeCheck,
  type ReassignKind,
  SETTLEMENT_MONEY,
} from '@shiplynow/shared';
import { assertCanDisable } from './access';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { balanceOf } from './finance/ledger';
import { startChecklist, templateFor } from './hr-checklists';
import { leaveBalances, unpaidLeaveDaysFor } from './hr-leave';
import { assertNoManagerLoop } from './hr-org';
import { packageInForce } from './hr-pay';
import { finalDeductionsFor } from './hr-violations';
import { getSetting } from './settings';
import { riderWalletTotals } from './finance/rider-wallet';

// HR phase 2 (docs/HR.md "Phase 2 as built"): the leaving wizard. HR picks the last working
// day and the reason, checks the notice, ticks company items returned, reads the final
// settlement figures for payroll and gives what the person looked after to someone else (or
// lists it under "Needs a new owner"). Confirming sets the file to left, starts offboarding and
// schedules the account to be disabled at the end of the last day, in one transaction.

type Tx = Prisma.TransactionClient;
type StoreScope = string[] | null;

const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
const dayText = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

async function loadPerson(db: Db, employeeId: string, scope: StoreScope) {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    include: { user: { select: { id: true, role: true, isActive: true, name: true } } },
  });
  if (!e) throw new DomainError('employee_not_found', 404);
  if (scope !== null && !(e.homeStoreId && scope.includes(e.homeStoreId)))
    throw new DomainError('store_not_allowed', 403);
  return e;
}

/** Everything a person looks after that needs a new owner when they leave. */
export async function ownedBy(db: Db, e: { id: string; userId: string }) {
  const [reports, heads, merchants, deals, companies] = await Promise.all([
    db.employee.findMany({
      where: { managerId: e.id, status: { not: 'left' } },
      select: { id: true, number: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: 'asc' },
    }),
    db.department.findMany({
      where: { headEmployeeId: e.id },
      select: { id: true, nameEn: true, nameAr: true },
    }),
    db.merchant.findMany({
      where: { accountManagerId: e.userId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.crmDeal.findMany({
      where: { ownerId: e.userId, stage: { notIn: ['won', 'lost'] } },
      select: { id: true, number: true, title: true, company: { select: { brandName: true } } },
      orderBy: { number: 'asc' },
    }),
    db.crmCompany.findMany({
      where: { ownerId: e.userId },
      select: { id: true, brandName: true },
      orderBy: { brandName: 'asc' },
    }),
  ]);
  const items: { kind: ReassignKind; entityId: string; label: string; labelAr: string }[] = [
    ...reports.map((r) => ({
      kind: 'manager_of' as const,
      entityId: r.id,
      label: `${r.nameEn} (${employeeCode(r.number)})`,
      labelAr: `${r.nameAr ?? r.nameEn} (${employeeCode(r.number)})`,
    })),
    ...heads.map((d) => ({
      kind: 'department_head' as const,
      entityId: d.id,
      label: d.nameEn,
      labelAr: d.nameAr,
    })),
    ...merchants.map((m) => ({
      kind: 'account_manager' as const,
      entityId: m.id,
      label: m.name,
      labelAr: m.name,
    })),
    ...deals.map((d) => {
      const label = `${dealNumber(d.number)} ${d.title ?? d.company.brandName}`;
      return { kind: 'deal_owner' as const, entityId: d.id, label, labelAr: label };
    }),
    ...companies.map((c) => ({
      kind: 'company_owner' as const,
      entityId: c.id,
      label: c.brandName,
      labelAr: c.brandName,
    })),
  ];
  return items;
}

/** Who may take over each kind: people for managers and heads, team members for the rest. */
export async function ownerCandidates(db: Db, leaverEmployeeId: string) {
  const [people, team] = await Promise.all([
    db.employee.findMany({
      where: { status: { not: 'left' }, id: { not: leaverEmployeeId } },
      select: { id: true, number: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: 'asc' },
      take: 1000,
    }),
    db.user.findMany({
      where: {
        isActive: true,
        role: { in: ['admin', 'finance', 'store_staff'] },
        employee: { id: { not: leaverEmployeeId } },
      },
      select: {
        id: true,
        name: true,
        access: { select: { merchants: true, sales: true } },
      },
      orderBy: { name: 'asc' },
    }),
  ]);
  return {
    people: people.map((p) => ({ ...p, code: employeeCode(p.number) })),
    accountManagers: team
      .filter((u) => u.access && u.access.merchants !== 'none')
      .map((u) => ({ id: u.id, name: u.name })),
    salesPeople: team
      .filter((u) => u.access && ['use', 'manage'].includes(u.access.sales))
      .map((u) => ({ id: u.id, name: u.name })),
  };
}

/** The settlement figures on a last day (money included; callers strip it without salaries). */
async function settlementFor(
  db: Db,
  e: { id: string; userId: string; hireDate: Date | null; employment: string; payBasis: string },
  lastDay: string,
): Promise<ExitSettlement> {
  // Riders paid per delivery are settled through their wallet, never the salary run.
  const perDelivery = e.payBasis === 'per_delivery';
  const onPayroll = e.employment === 'employee' && !perDelivery;
  const rider = perDelivery
    ? await db.rider.findUnique({ where: { userId: e.userId }, select: { id: true } })
    : null;
  const wallet = rider ? (await riderWalletTotals(db, rider.id)).totals : null;
  const [pkg, perMonth, payUnused, balances, unpaid, deductions, advance, commission] =
    await Promise.all([
      onPayroll ? packageInForce(db, e.id, lastDay) : null,
      getSetting(db, 'hr.payroll_days_per_month'),
      getSetting(db, 'hr.pay_unused_leave_on_exit'),
      leaveBalances(db, { employeeId: e.id, asOf: lastDay }),
      unpaidLeaveDaysFor(db, e.id, lastDay),
      onPayroll ? finalDeductionsFor(db, e.id, lastDay) : [],
      balanceOf(db, { type: 'staff_advance', userId: e.userId }),
      db.crmCommission.aggregate({
        where: { userId: e.userId, status: { in: ['draft', 'approved'] }, outcome: 'hit' },
        _sum: { amountPiastres: true },
      }),
    ]);
  return exitSettlement({
    lastDay,
    hireDate: dayText(e.hireDate),
    basicPiastres: pkg?.basicPiastres ?? null,
    daysPerMonth: perMonth,
    annualRemaining: balances.annual.remaining,
    payUnusedLeave: payUnused === 1,
    unpaidLeaveDays: onPayroll ? unpaid.reduce((s, d) => s + Number(d.fraction), 0) : 0,
    deductions: deductions.map((d) => ({
      days: d.days === null ? null : Number(d.days),
      amountPiastres: d.penalty === 'deduction_amount' ? (d.amountPiastres ?? 0) : null,
    })),
    advancePiastres: Math.max(0, advance),
    commissionPiastres: commission._sum.amountPiastres ?? 0,
    riderWallet: wallet && {
      availablePiastres: wallet.availablePiastres,
      onHoldPiastres: wallet.onHoldPiastres,
      owedPiastres: wallet.owedPiastres,
      pendingPiastres: wallet.pendingPiastres,
      balancePiastres: wallet.balancePiastres,
    },
  });
}

/** The settlement without its money for people without the salaries switch. */
export function settlementView(s: ExitSettlement | Record<string, unknown>, pay: boolean) {
  if (pay) return { ...s, money: true };
  const copy: Record<string, unknown> = { ...s };
  for (const k of SETTLEMENT_MONEY) copy[k] = null;
  return { ...copy, money: false };
}

/**
 * What the leaving wizard shows for a last day: the notice period, the company items of the
 * offboarding template, the settlement figures, what the person looks after with the people
 * who could take it over, and what would stop the confirmation.
 */
export async function leavingPreview(
  db: Db,
  input: {
    employeeId: string;
    lastDay: string;
    noticeGivenOn?: string;
    scope: StoreScope;
    pay: boolean;
    actorUserId: string;
  },
) {
  const e = await loadPerson(db, input.employeeId, input.scope);
  const [noticeDays, template, owned, candidates, settlement] = await Promise.all([
    getSetting(db, 'hr.notice_days'),
    templateFor(db as Tx, 'offboarding', e.positionId),
    ownedBy(db, e),
    ownerCandidates(db, e.id),
    settlementFor(db, e, input.lastDay),
  ]);
  let lastOwner = false;
  if (isTeamRole(e.user.role) && e.user.isActive) {
    const row = await db.userAccess.findUnique({ where: { userId: e.userId } });
    if (row?.settings === 'manage') {
      const others = await db.userAccess.count({
        where: {
          settings: 'manage',
          userId: { not: e.userId },
          user: { isActive: true, role: { in: ['admin', 'finance', 'store_staff'] } },
        },
      });
      lastOwner = others === 0;
    }
  }
  const hire = dayText(e.hireDate);
  return {
    employee: {
      id: e.id,
      code: employeeCode(e.number),
      nameEn: e.nameEn,
      nameAr: e.nameAr,
      status: e.status,
      hireDate: hire,
      employment: e.employment,
      contractEndsOn: dayText(e.contractEndsOn),
    },
    lastDay: input.lastDay,
    notice: {
      days: noticeDays,
      ...noticeCheck({
        noticeGivenOn: input.noticeGivenOn,
        lastDay: input.lastDay,
        noticeDays,
      }),
    },
    items: (template?.tasks ?? []).map((t) => ({
      titleEn: t.titleEn,
      titleAr: t.titleAr,
      ownerRole: t.ownerRole,
    })),
    settlement: settlementView(settlement, input.pay),
    owned,
    candidates,
    blockers: {
      alreadyLeft: e.status === 'left',
      self: e.userId === input.actorUserId,
      beforeHire: Boolean(hire && input.lastDay < hire),
      lastOwner,
    },
  };
}

/** Puts a new owner (or none) on one thing a leaver looked after. Audited. */
async function applyOwner(
  tx: Tx,
  input: {
    kind: ReassignKind;
    entityId: string;
    newOwnerId: string | null;
    leaverEmployeeId: string;
    leaverUserId: string;
    actorUserId: string;
    now: Date;
  },
) {
  const { kind, entityId, newOwnerId } = input;
  if (kind === 'manager_of' || kind === 'department_head') {
    if (newOwnerId) {
      const p = await tx.employee.findUnique({ where: { id: newOwnerId } });
      if (!p || p.status === 'left' || p.id === input.leaverEmployeeId)
        throw new DomainError('owner_not_allowed', 400);
      if (kind === 'manager_of' && p.id === entityId) throw new DomainError('manager_is_self', 400);
    }
    if (kind === 'manager_of') {
      const before = await tx.employee.findUnique({ where: { id: entityId } });
      if (!before) throw new DomainError('employee_not_found', 404);
      await tx.employee.update({ where: { id: entityId }, data: { managerId: newOwnerId } });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'employee.update',
        entityType: 'employee',
        entityId,
        before: { managerId: before.managerId },
        after: { managerId: newOwnerId, reason: 'manager_left' },
      });
    } else {
      const before = await tx.department.findUnique({ where: { id: entityId } });
      if (!before) throw new DomainError('department_not_found', 404);
      await tx.department.update({ where: { id: entityId }, data: { headEmployeeId: newOwnerId } });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'department.update',
        entityType: 'department',
        entityId,
        before: { headEmployeeId: before.headEmployeeId },
        after: { headEmployeeId: newOwnerId, reason: 'head_left' },
      });
    }
    return;
  }
  if (newOwnerId) {
    const u = await tx.user.findUnique({
      where: { id: newOwnerId },
      include: { access: true },
    });
    if (!u || !u.isActive || !isTeamRole(u.role) || u.id === input.leaverUserId)
      throw new DomainError('owner_not_allowed', 400);
    if (kind === 'account_manager' && (!u.access || u.access.merchants === 'none'))
      throw new DomainError('owner_not_allowed', 400);
    if (kind !== 'account_manager' && (!u.access || !['use', 'manage'].includes(u.access.sales)))
      throw new DomainError('owner_not_allowed', 400);
  }
  if (kind === 'account_manager') {
    const m = await tx.merchant.findUnique({ where: { id: entityId } });
    if (!m) throw new DomainError('merchant_not_found', 404);
    await tx.merchant.update({ where: { id: entityId }, data: { accountManagerId: newOwnerId } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant.account_manager',
      entityType: 'merchant',
      entityId,
      before: { accountManagerId: m.accountManagerId },
      after: { accountManagerId: newOwnerId, reason: 'owner_left' },
    });
  } else if (kind === 'deal_owner') {
    const d = await tx.crmDeal.findUnique({ where: { id: entityId } });
    if (!d) throw new DomainError('deal_not_found', 404);
    await tx.crmDeal.update({
      where: { id: entityId },
      data: {
        ownerId: newOwnerId,
        ownerAssignedAt: newOwnerId ? input.now : null,
        ownerAssignedById: newOwnerId ? input.actorUserId : null,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'crm_deal.assign',
      entityType: 'crm_deal',
      entityId,
      before: { ownerId: d.ownerId },
      after: { ownerId: newOwnerId, reason: 'owner_left' },
    });
  } else {
    const c = await tx.crmCompany.findUnique({ where: { id: entityId } });
    if (!c) throw new DomainError('company_not_found', 404);
    await tx.crmCompany.update({ where: { id: entityId }, data: { ownerId: newOwnerId } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'crm_company.assign',
      entityType: 'crm_company',
      entityId,
      before: { ownerId: c.ownerId },
      after: { ownerId: newOwnerId, reason: 'owner_left' },
    });
  }
}

/** Disables a leaver's account and signs them out everywhere (inside the caller's transaction). */
async function disableAccount(tx: Tx, userId: string, actorUserId: string | null, exitId: string) {
  const u = await tx.user.findUnique({ where: { id: userId } });
  if (!u || !u.isActive) return false;
  if (isTeamRole(u.role)) await assertCanDisable(tx, u.id);
  await tx.user.update({ where: { id: u.id }, data: { isActive: false } });
  await tx.refreshToken.updateMany({
    where: { userId: u.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordAudit(tx, {
    actorUserId,
    action: 'user.disable_on_exit',
    entityType: 'user',
    entityId: u.id,
    before: { isActive: true },
    after: { isActive: false, exitId },
  });
  return true;
}

const exitSelect = {
  id: true,
  employeeId: true,
  lastDay: true,
  reason: true,
  note: true,
  noticeGivenOn: true,
  noticeDays: true,
  noticeShortBy: true,
  itemsReturned: true,
  settlement: true,
  disableAt: true,
  disabledAt: true,
  cancelledAt: true,
  createdAt: true,
  reassignments: {
    select: {
      id: true,
      kind: true,
      entityId: true,
      label: true,
      newOwnerId: true,
      resolvedAt: true,
    },
  },
} as const;

function exitView(x: Prisma.EmployeeExitGetPayload<{ select: typeof exitSelect }>, pay: boolean) {
  return {
    ...x,
    lastDay: dayText(x.lastDay)!,
    noticeGivenOn: dayText(x.noticeGivenOn),
    settlement: settlementView(x.settlement as Record<string, unknown>, pay),
  };
}

/**
 * Confirms the leaving wizard in one transaction: the file is left with its last day and
 * reason, everything the person looked after gets the chosen owner or none (listed under
 * "Needs a new owner"), offboarding starts from the last day with returned items ticked, the
 * settlement figures are kept for payroll, and the account is disabled at the end of the last
 * day (at once when that is already past). Idempotent with the key; audited.
 */
export function confirmLeaving(
  db: Db,
  input: {
    employeeId: string;
    body: LeavingBody;
    actorUserId: string;
    scope: StoreScope;
    pay: boolean;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const b = input.body;
  return inTransaction(db, async (tx) => {
    const seen = await tx.employeeExit.findUnique({
      where: { idempotencyKey: b.idempotencyKey },
      select: exitSelect,
    });
    if (seen) {
      if (seen.employeeId !== input.employeeId)
        throw new DomainError('idempotency_key_reused', 409);
      return exitView(seen, input.pay);
    }
    await tx.$queryRaw`SELECT id FROM employees WHERE id = ${input.employeeId} FOR UPDATE`;
    const e = await loadPerson(tx, input.employeeId, input.scope);
    if (e.status === 'left') throw new DomainError('employee_left', 409);
    if (e.userId === input.actorUserId) throw new DomainError('cannot_leave_self', 400);
    const hire = dayText(e.hireDate);
    if (hire && b.lastDay < hire) throw new DomainError('left_before_hire', 400);
    // The last person who keeps settings manage cannot leave (their account must stay).
    if (isTeamRole(e.user.role) && e.user.isActive) await assertCanDisable(tx, e.userId);

    const noticeDays = await getSetting(tx, 'hr.notice_days');
    const notice = noticeCheck({ noticeGivenOn: b.noticeGivenOn, lastDay: b.lastDay, noticeDays });
    const settlement = await settlementFor(tx, e, b.lastDay);
    const reasonText = `${b.reason}${b.note ? `: ${b.note}` : ''}`;
    await tx.employee.update({
      where: { id: e.id },
      data: { status: 'left', leftOn: toDate(b.lastDay), leftReason: reasonText.slice(0, 300) },
    });

    const disableAt = cairoDayStart(addDays(b.lastDay, 1));
    const exit = await tx.employeeExit.create({
      data: {
        employeeId: e.id,
        lastDay: toDate(b.lastDay),
        reason: b.reason,
        note: b.note || null,
        noticeGivenOn: b.noticeGivenOn ? toDate(b.noticeGivenOn) : null,
        noticeDays,
        noticeShortBy: notice.shortBy,
        itemsReturned: b.itemsReturned,
        settlement: settlement as unknown as Prisma.InputJsonValue,
        disableAt,
        createdById: input.actorUserId,
        idempotencyKey: b.idempotencyKey,
      },
    });

    // What they looked after: the chosen owner, or none and a row under Needs a new owner.
    const owned = await ownedBy(tx, e);
    const chosen = new Map(b.replacements.map((r) => [`${r.kind}:${r.entityId}`, r.newOwnerId]));
    for (const item of owned) {
      const newOwnerId = chosen.get(`${item.kind}:${item.entityId}`) ?? null;
      await applyOwner(tx, {
        kind: item.kind,
        entityId: item.entityId,
        newOwnerId,
        leaverEmployeeId: e.id,
        leaverUserId: e.userId,
        actorUserId: input.actorUserId,
        now,
      });
      await tx.reassignment.create({
        data: {
          exitId: exit.id,
          kind: item.kind,
          entityId: item.entityId,
          label: item.label,
          newOwnerId,
          resolvedAt: newOwnerId ? now : null,
          resolvedById: newOwnerId ? input.actorUserId : null,
        },
      });
    }
    await assertNoManagerLoop(tx);

    // Offboarding from the last day, with the items already returned ticked.
    const open = await tx.employeeChecklist.findFirst({
      where: { employeeId: e.id, kind: 'offboarding', status: 'open' },
    });
    const checklist =
      open ??
      (await startChecklist(tx, {
        employeeId: e.id,
        body: { kind: 'offboarding', startsOn: b.lastDay },
        actorUserId: input.actorUserId,
      }));
    if (checklist && b.itemsReturned.length > 0) {
      await tx.employeeChecklistTask.updateMany({
        where: { checklistId: checklist.id, doneAt: null, titleEn: { in: b.itemsReturned } },
        data: { doneAt: now, doneById: input.actorUserId, note: 'Returned (leaving wizard)' },
      });
      const left = await tx.employeeChecklistTask.count({
        where: { checklistId: checklist.id, doneAt: null },
      });
      if (left === 0)
        await tx.employeeChecklist.update({
          where: { id: checklist.id },
          data: { status: 'done' },
        });
    }

    // The account closes at the end of the last day; already past: now.
    let disabledNow = false;
    if (disableAt <= now) {
      await disableAccount(tx, e.userId, input.actorUserId, exit.id);
      await tx.employeeExit.update({ where: { id: exit.id }, data: { disabledAt: now } });
      disabledNow = true;
    }
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'employee.exit',
      entityType: 'employee',
      entityId: e.id,
      before: { status: e.status, leftOn: dayText(e.leftOn), leftReason: e.leftReason },
      after: {
        status: 'left',
        leftOn: b.lastDay,
        leftReason: reasonText,
        exitId: exit.id,
        reason: b.reason as ExitReason,
        noticeGivenOn: b.noticeGivenOn ?? null,
        noticeShortBy: notice.shortBy,
        itemsReturned: b.itemsReturned,
        reassigned: owned.length,
        unassigned: owned.filter((o) => !chosen.get(`${o.kind}:${o.entityId}`)).length,
        disableAt: disableAt.toISOString(),
        accountDisabled: disabledNow,
      },
    });
    const saved = await tx.employeeExit.findUniqueOrThrow({
      where: { id: exit.id },
      select: exitSelect,
    });
    return exitView(saved, input.pay);
  });
}

/** The latest exit of a person (the file shows when the account closes). */
export async function latestExit(db: Db, employeeId: string, pay: boolean) {
  const x = await db.employeeExit.findFirst({
    where: { employeeId },
    select: exitSelect,
    orderBy: { createdAt: 'desc' },
  });
  return x ? exitView(x, pay) : null;
}

/**
 * The API job: disables the account of every leaver whose last day is over. Each exit is
 * claimed once, so running twice (or on two instances) disables nothing twice. A person set
 * back to active before then keeps their account (the exit is marked cancelled).
 */
export async function runExitDisables(db: Db, now: Date = new Date()) {
  const due = await db.employeeExit.findMany({
    where: { disabledAt: null, cancelledAt: null, disableAt: { lte: now } },
    select: { id: true },
    take: 200,
  });
  let disabled = 0;
  let cancelled = 0;
  for (const { id } of due) {
    await inTransaction(db, async (tx) => {
      const x = await tx.employeeExit.findUnique({
        where: { id },
        include: { employee: { select: { status: true, userId: true } } },
      });
      if (!x || x.disabledAt || x.cancelledAt) return;
      if (x.employee.status !== 'left') {
        const claimed = await tx.employeeExit.updateMany({
          where: { id, disabledAt: null, cancelledAt: null },
          data: { cancelledAt: now },
        });
        cancelled += claimed.count;
        return;
      }
      const claimed = await tx.employeeExit.updateMany({
        where: { id, disabledAt: null, cancelledAt: null },
        data: { disabledAt: now },
      });
      if (claimed.count === 0) return;
      if (await disableAccount(tx, x.employee.userId, null, id)) disabled++;
    });
  }
  return { disabled, cancelled };
}

/** What leavers looked after that still needs a new owner, in the person's stores. */
export async function needsNewOwner(db: Db, scope: StoreScope) {
  const rows = await db.reassignment.findMany({
    where: {
      resolvedAt: null,
      exit: scope ? { employee: { homeStoreId: { in: scope } } } : undefined,
    },
    include: {
      exit: {
        select: {
          id: true,
          lastDay: true,
          employee: { select: { id: true, number: true, nameEn: true, nameAr: true } },
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { kind: 'asc' }],
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as ReassignKind,
    entityId: r.entityId,
    label: r.label,
    createdAt: r.createdAt,
    leaver: {
      ...r.exit.employee,
      code: employeeCode(r.exit.employee.number),
      lastDay: dayText(r.exit.lastDay),
    },
  }));
}

/** HR gives one thing a leaver looked after its new owner (later, from the list). Audited. */
export function assignNewOwner(
  db: Db,
  input: {
    reassignmentId: string;
    newOwnerId: string;
    actorUserId: string;
    scope: StoreScope;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return inTransaction(db, async (tx) => {
    const r = await tx.reassignment.findUnique({
      where: { id: input.reassignmentId },
      include: {
        exit: { select: { employee: { select: { id: true, userId: true, homeStoreId: true } } } },
      },
    });
    if (!r) throw new DomainError('reassignment_not_found', 404);
    const leaver = r.exit.employee;
    if (input.scope !== null && !(leaver.homeStoreId && input.scope.includes(leaver.homeStoreId)))
      throw new DomainError('store_not_allowed', 403);
    if (r.resolvedAt) throw new DomainError('already_reassigned', 409);
    await applyOwner(tx, {
      kind: r.kind as ReassignKind,
      entityId: r.entityId,
      newOwnerId: input.newOwnerId,
      leaverEmployeeId: leaver.id,
      leaverUserId: leaver.userId,
      actorUserId: input.actorUserId,
      now,
    });
    await assertNoManagerLoop(tx);
    const claimed = await tx.reassignment.updateMany({
      where: { id: r.id, resolvedAt: null },
      data: { newOwnerId: input.newOwnerId, resolvedAt: now, resolvedById: input.actorUserId },
    });
    if (claimed.count === 0) throw new DomainError('already_reassigned', 409);
    return { id: r.id, newOwnerId: input.newOwnerId };
  });
}
