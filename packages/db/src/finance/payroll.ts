import type { Prisma } from '@prisma/client';
import { addDays, cairoDay, cairoDayStart, isCalendarDay } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { balanceOf, post } from './ledger';
import { eventTime } from './books';

type Tx = Prisma.TransactionClient;

// Salaries and staff advances. Each team member has a monthly salary (gross) set by admin.
// An advance is money given early, kept in the person's advance wallet (1500-xxxx) and
// recovered from a salary. The month's salary run pays everyone in one entry:
//
//   salaries expense (gross − deductions, tagged with the person and their store)
//     = staff advance recovered (back from their wallet) + net paid from a bank or box

const STAFF_ROLES = ['admin', 'finance', 'store_staff', 'rider'] as const;
const MONEY_GROUPS = [1100, 1200];

/** Sets a team member's monthly salary (gross, piastres). Admin only. */
export function setSalary(
  db: Db,
  input: { userId: string; monthlyPiastres: number; actorUserId: string },
) {
  if (!Number.isSafeInteger(input.monthlyPiastres) || input.monthlyPiastres < 0)
    throw new DomainError('invalid_amount', 400);
  return inTransaction(db, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.role === 'merchant') throw new DomainError('user_not_found', 404);
    const before = await tx.staffSalary.findUnique({ where: { userId: user.id } });
    await tx.staffSalary.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        monthlyPiastres: input.monthlyPiastres,
        updatedById: input.actorUserId,
      },
      update: { monthlyPiastres: input.monthlyPiastres, updatedById: input.actorUserId },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.salary_set',
      entityType: 'user',
      entityId: user.id,
      before: { monthlyPiastres: before?.monthlyPiastres ?? null },
      after: { monthlyPiastres: input.monthlyPiastres },
    });
    return { userId: user.id, monthlyPiastres: input.monthlyPiastres };
  });
}

/** Every active team member with their salary, store and the advance they still owe. */
export async function listStaffPay(db: Db) {
  const users = await db.user.findMany({
    where: { role: { in: [...STAFF_ROLES] }, isActive: true },
    include: {
      salary: true,
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      rider: { select: { id: true, darkStoreId: true } },
    },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
  const advances = await db.ledgerAccount.findMany({
    where: { type: 'staff_advance', userId: { in: users.map((u) => u.id) } },
    select: { id: true, userId: true },
  });
  const sums = await db.ledgerLine.groupBy({
    by: ['accountId'],
    where: { accountId: { in: advances.map((a) => a.id) } },
    _sum: { amountPiastres: true },
  });
  return users.map((u) => {
    const wallet = advances.find((a) => a.userId === u.id);
    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      darkStore: u.darkStore,
      monthlyPiastres: u.salary?.monthlyPiastres ?? null,
      advanceOwedPiastres: wallet
        ? (sums.find((s) => s.accountId === wallet.id)?._sum.amountPiastres ?? 0)
        : 0,
    };
  });
}

async function moneyAccount(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ledger_accounts WHERE id = ${id} FOR UPDATE`;
  const account = rows.length ? await tx.ledgerAccount.findUnique({ where: { id } }) : null;
  if (!account || !MONEY_GROUPS.includes(account.groupCode))
    throw new DomainError('account_not_found', 404);
  if (!account.isActive) throw new DomainError('account_inactive');
  return account;
}

/** Where a person's pay counts: their store, and the rider record for riders. */
async function personTags(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: { rider: { select: { id: true, darkStoreId: true } } },
  });
  if (!user || user.role === 'merchant') throw new DomainError('user_not_found', 404);
  return {
    user,
    tags: {
      userId: user.id,
      darkStoreId: user.darkStoreId ?? user.rider?.darkStoreId ?? null,
      riderId: user.rider?.id ?? null,
    },
  };
}

export interface AdvanceInput {
  userId: string;
  amountPiastres: number;
  moneyAccountId: string;
  reference: string;
  day?: string;
  actorUserId: string;
  idempotencyKey: string;
}

/** Money given to a team member early; they owe it until a salary recovers it. */
export function giveAdvance(db: Db, input: AdvanceInput) {
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const key = `advance:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    const money = await moneyAccount(tx, input.moneyAccountId);
    const { user, tags } = await personTags(tx, input.userId);
    if (input.amountPiastres > (await balanceOf(tx, { id: money.id })))
      throw new DomainError('not_enough_money');
    const entry = await post(tx, {
      kind: 'staff_advance',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.reference,
      darkStoreId: tags.darkStoreId,
      riderId: tags.riderId,
      data: { userId: user.id, reference: input.reference },
      lines: [
        {
          account: { type: 'staff_advance', userId: user.id },
          amount: input.amountPiastres,
          tags,
        },
        { account: { id: money.id }, amount: -input.amountPiastres },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.staff_advance',
      entityType: 'ledger_entry',
      entityId: entry!.id,
      after: { userId: user.id, amount: input.amountPiastres, from: money.code },
    });
    return entry!;
  });
}

export interface PayrollInput {
  /** YYYY-MM */
  month: string;
  moneyAccountId: string;
  /** Everyone paid this month; gross comes from their salary unless given */
  lines: {
    userId: string;
    grossPiastres?: number;
    deductionPiastres?: number;
    advanceRecoveryPiastres?: number;
    note?: string;
  }[];
  actorUserId: string;
  /** Kept for the approval flow; the run itself is once per month */
  idempotencyKey?: string;
}

/** What the month's run would pay each person, checked, before anything is posted. */
export async function previewPayroll(db: Db, input: Omit<PayrollInput, 'actorUserId'>) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new DomainError('invalid_month', 400);
  if (input.lines.length === 0) throw new DomainError('nothing_to_pay', 400);
  if (new Set(input.lines.map((l) => l.userId)).size !== input.lines.length)
    throw new DomainError('person_twice', 400);
  const rows = [];
  for (const l of input.lines) {
    const { user, tags } = await personTags(db as Tx, l.userId);
    const salary = await db.staffSalary.findUnique({ where: { userId: user.id } });
    const gross = l.grossPiastres ?? salary?.monthlyPiastres;
    if (gross === undefined) throw new DomainError('salary_not_set', 400);
    const deduction = l.deductionPiastres ?? 0;
    const recovery = l.advanceRecoveryPiastres ?? 0;
    for (const v of [gross, deduction, recovery])
      if (!Number.isSafeInteger(v) || v < 0) throw new DomainError('invalid_amount', 400);
    const owed = await balanceOf(db, { type: 'staff_advance', userId: user.id });
    if (recovery > owed) throw new DomainError('more_than_advance', 400);
    const cost = gross - deduction;
    const net = cost - recovery;
    if (cost < 0 || net < 0) throw new DomainError('net_below_zero', 400);
    rows.push({
      userId: user.id,
      name: user.name,
      tags,
      gross,
      deduction,
      recovery,
      net,
      note: l.note,
    });
  }
  return {
    month: input.month,
    rows,
    totalNetPiastres: rows.reduce((s, r) => s + r.net, 0),
    totalCostPiastres: rows.reduce((s, r) => s + r.gross - r.deduction, 0),
  };
}

/**
 * Pays the month's salaries from one bank or cash box, once per month: the salaries
 * expense per person (tagged with them and their store), advances recovered, net paid.
 */
export function runPayroll(db: Db, input: PayrollInput) {
  return inTransaction(db, async (tx) => {
    const key = `payroll:${input.month}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) throw new DomainError('payroll_already_run');
    const plan = await previewPayroll(tx, input);
    const money = await moneyAccount(tx, input.moneyAccountId);
    if (plan.totalNetPiastres > (await balanceOf(tx, { id: money.id })))
      throw new DomainError('not_enough_money');
    const salaries = await tx.ledgerAccount.findUnique({ where: { key: 'expense:salaries' } });
    if (!salaries) throw new DomainError('expense_account_not_found', 404);
    // The last day of the month, or now when the month is still running.
    const [y, m] = input.month.split('-').map(Number) as [number, number];
    const lastDay = `${input.month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const at =
      lastDay < cairoDay(new Date())
        ? new Date(cairoDayStart(addDays(lastDay, 1)).getTime() - 3600_000)
        : new Date();
    if (!isCalendarDay(lastDay)) throw new DomainError('invalid_month', 400);
    const lines: Parameters<typeof post>[1]['lines'] = [];
    for (const r of plan.rows) {
      lines.push({ account: { id: salaries.id }, amount: r.gross - r.deduction, tags: r.tags });
      lines.push({
        account: { type: 'staff_advance', userId: r.userId },
        amount: -r.recovery,
        tags: r.tags,
      });
    }
    lines.push({ account: { id: money.id }, amount: -plan.totalNetPiastres });
    const entry = await post(tx, {
      kind: 'payroll',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: `Salaries ${input.month}`,
      data: {
        month: input.month,
        people: plan.rows.map((r) => ({
          userId: r.userId,
          gross: r.gross,
          deduction: r.deduction,
          recovery: r.recovery,
          net: r.net,
          note: r.note ?? null,
        })),
      },
      lines,
    });
    if (!entry) throw new DomainError('nothing_to_pay', 400);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.payroll',
      entityType: 'ledger_entry',
      entityId: entry.id,
      after: { month: input.month, people: plan.rows.length, net: plan.totalNetPiastres },
    });
    return entry;
  });
}
