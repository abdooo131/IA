import type { Prisma } from '@prisma/client';
import { cairoDay } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { queueRequest, type RequestPayload } from './controls';

// Expenses that repeat every month (rent, internet, software). Each one is entered once; on
// its day of the month the job prepares that month's expense as a request, so a second
// person confirms the money really left before anything is posted. One request per month.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface RecurringExpense {
  expenseAccountId: string;
  paidFromAccountId: string;
  amountPiastres: number;
  vatPiastres?: number;
  darkStoreId?: string | null;
  memo: string;
  reference: string;
}

export function createRecurring(
  db: Db,
  input: {
    name: string;
    expense: RecurringExpense;
    dayOfMonth: number;
    startMonth: string;
    endMonth?: string | null;
    actorUserId: string;
  },
) {
  const e = input.expense;
  if (!Number.isSafeInteger(e.amountPiastres) || e.amountPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  const vat = e.vatPiastres ?? 0;
  if (!Number.isSafeInteger(vat) || vat < 0 || vat >= e.amountPiastres)
    throw new DomainError('invalid_vat', 400);
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 28)
    throw new DomainError('invalid_day_of_month', 400);
  if (!MONTH.test(input.startMonth) || (input.endMonth && !MONTH.test(input.endMonth)))
    throw new DomainError('invalid_month', 400);
  if (input.endMonth && input.endMonth < input.startMonth)
    throw new DomainError('end_before_start', 400);
  return inTransaction(db, async (tx) => {
    const expense = await tx.ledgerAccount.findUnique({ where: { id: e.expenseAccountId } });
    if (!expense || ![5400, 5500].includes(expense.groupCode) || !expense.isActive)
      throw new DomainError('expense_account_not_found', 404);
    const from = await tx.ledgerAccount.findUnique({ where: { id: e.paidFromAccountId } });
    if (!from || ![1100, 1200].includes(from.groupCode) || !from.isActive)
      throw new DomainError('account_not_found', 404);
    if (e.darkStoreId && !(await tx.darkStore.findUnique({ where: { id: e.darkStoreId } })))
      throw new DomainError('store_not_found', 404);
    const row = await tx.recurringEntry.create({
      data: {
        name: input.name.trim(),
        payload: { ...e, vatPiastres: vat } as unknown as Prisma.InputJsonValue,
        amountPiastres: e.amountPiastres,
        dayOfMonth: input.dayOfMonth,
        startMonth: input.startMonth,
        endMonth: input.endMonth || null,
        createdById: input.actorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.recurring_create',
      entityType: 'recurring_entry',
      entityId: row.id,
      after: { name: row.name, amount: e.amountPiastres, day: input.dayOfMonth },
    });
    return row;
  });
}

/** Stops (or starts again) a recurring expense. Requests already prepared stay. */
export function setRecurringActive(
  db: Db,
  input: { id: string; isActive: boolean; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.recurringEntry.findUnique({ where: { id: input.id } });
    if (!before) throw new DomainError('recurring_not_found', 404);
    const after = await tx.recurringEntry.update({
      where: { id: before.id },
      data: { isActive: input.isActive },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.recurring_update',
      entityType: 'recurring_entry',
      entityId: before.id,
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
    });
    return after;
  });
}

export async function listRecurring(db: Db) {
  const rows = await db.recurringEntry.findMany({
    orderBy: [{ isActive: 'desc' }, { dayOfMonth: 'asc' }],
    include: { createdBy: { select: { name: true } } },
  });
  const accounts = await db.ledgerAccount.findMany({
    where: {
      id: {
        in: rows.flatMap((r) => {
          const p = r.payload as unknown as RecurringExpense;
          return [p.expenseAccountId, p.paidFromAccountId];
        }),
      },
    },
    select: { id: true, code: true, nameEn: true, nameAr: true },
  });
  const month = cairoDay(new Date()).slice(0, 7);
  const requests = await db.financeRequest.findMany({
    where: { kind: 'expense', createdAt: { gte: new Date(Date.now() - 40 * 86_400_000) } },
    select: { payload: true },
  });
  const prepared = new Set(
    requests.map(
      (q) => (q.payload as { input?: { idempotencyKey?: string } }).input?.idempotencyKey,
    ),
  );
  return rows.map((r) => {
    const p = r.payload as unknown as RecurringExpense;
    return {
      id: r.id,
      name: r.name,
      amountPiastres: r.amountPiastres,
      vatPiastres: p.vatPiastres ?? 0,
      dayOfMonth: r.dayOfMonth,
      startMonth: r.startMonth,
      endMonth: r.endMonth,
      isActive: r.isActive,
      darkStoreId: p.darkStoreId ?? null,
      expenseAccount: accounts.find((a) => a.id === p.expenseAccountId) ?? null,
      paidFrom: accounts.find((a) => a.id === p.paidFromAccountId) ?? null,
      createdBy: r.createdBy.name,
      preparedThisMonth: prepared.has(`recurring:${r.id}:${month}`),
    };
  });
}

/**
 * Prepares this month's request of every active recurring expense whose day has come.
 * Safe to run any number of times: the request is keyed by the item and the month.
 */
export async function runRecurring(db: Db, now: Date = new Date()) {
  const today = cairoDay(now);
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const rows = await db.recurringEntry.findMany({
    where: { isActive: true, startMonth: { lte: month } },
  });
  let prepared = 0;
  const failed: { id: string; error: string }[] = [];
  for (const r of rows) {
    if (r.endMonth && r.endMonth < month) continue;
    if (day < r.dayOfMonth) continue;
    const p = r.payload as unknown as RecurringExpense;
    const payload: RequestPayload = {
      kind: 'expense',
      input: {
        ...p,
        memo: `${p.memo} ${month}`,
        reference: `${p.reference} ${month}`,
        day: `${month}-${String(r.dayOfMonth).padStart(2, '0')}`,
        idempotencyKey: `recurring:${r.id}:${month}`,
      },
    };
    const seen = await db.financeRequest.findFirst({
      where: {
        payload: { path: ['input', 'idempotencyKey'], equals: payload.input.idempotencyKey },
      },
    });
    if (seen) continue;
    try {
      await queueRequest(db, payload, r.createdById);
      prepared++;
    } catch (error) {
      failed.push({ id: r.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { prepared, failed };
}
