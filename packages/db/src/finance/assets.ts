import type { Prisma } from '@prisma/client';
import { cairoDay, cairoDayStart } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { eventTime } from './books';
import { balanceOf, post } from './ledger';

type Tx = Prisma.TransactionClient;

// Money paid once for something used over many months:
//
//   prepayment (a year's rent):  Dr prepaid expenses   Cr bank or box
//     each month:                Dr the expense        Cr prepaid expenses
//   fixed asset (a motorbike):   Dr equipment          Cr bank or box
//     each month:                Dr depreciation       Cr accumulated depreciation
//
// The monthly part is (amount ÷ months) in whole piastres, the last month takes what is
// left so the total is exact. A month is charged once it is over (key per item and month);
// a month inside closed books is charged on the first open day instead of being lost.

const MONEY_GROUPS = [1100, 1200];
const EXPENSE_GROUPS = [5400, 5500];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

async function lockedAccount(tx: Tx, id: string, groups: number[], notFound: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ledger_accounts WHERE id = ${id} FOR UPDATE`;
  const account = rows.length ? await tx.ledgerAccount.findUnique({ where: { id } }) : null;
  if (!account || !groups.includes(account.groupCode)) throw new DomainError(notFound, 404);
  if (!account.isActive) throw new DomainError('account_inactive');
  return account;
}

/** YYYY-MM plus n months. */
export function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** The moment a month's charge is dated: its last day at 23:00 Cairo time. */
export function monthEnd(month: string) {
  return new Date(cairoDayStart(`${addMonths(month, 1)}-01`).getTime() - 3600_000);
}

/** The part charged in month i (0 based) of n: equal parts, the last takes the rest. */
export function monthlyPart(amount: number, months: number, i: number) {
  const base = Math.floor(amount / months);
  return i === months - 1 ? amount - base * (months - 1) : base;
}

interface PaidOnce {
  name: string;
  moneyAccountId: string;
  reference: string;
  /** YYYY-MM of the first month charged */
  startMonth: string;
  darkStoreId?: string | null;
  day?: string;
  actorUserId: string;
  idempotencyKey: string;
}

async function checkStore(tx: Tx, id: string | null | undefined) {
  if (id && !(await tx.darkStore.findUnique({ where: { id } })))
    throw new DomainError('store_not_found', 404);
}

export interface PrepaymentInput extends PaidOnce {
  expenseAccountId: string;
  /** The whole amount paid now */
  amountPiastres: number;
  months: number;
}

/** Pays ahead for several months; the expense counts month by month. */
export function recordPrepayment(db: Db, input: PrepaymentInput) {
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 120)
    throw new DomainError('invalid_months', 400);
  if (!MONTH.test(input.startMonth)) throw new DomainError('invalid_month', 400);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const key = `prepayment:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    const expense = await lockedAccount(
      tx,
      input.expenseAccountId,
      EXPENSE_GROUPS,
      'expense_account_not_found',
    );
    const money = await lockedAccount(tx, input.moneyAccountId, MONEY_GROUPS, 'account_not_found');
    await checkStore(tx, input.darkStoreId);
    if (input.amountPiastres > (await balanceOf(tx, { id: money.id })))
      throw new DomainError('not_enough_money');
    const entry = await post(tx, {
      kind: 'prepayment',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.name,
      darkStoreId: input.darkStoreId ?? null,
      data: { reference: input.reference, months: input.months, startMonth: input.startMonth },
      lines: [
        { account: { type: 'prepaid' }, amount: input.amountPiastres },
        { account: { id: money.id }, amount: -input.amountPiastres },
      ],
    });
    const row = await tx.prepayment.create({
      data: {
        name: input.name,
        expenseAccountId: expense.id,
        darkStoreId: input.darkStoreId ?? null,
        totalPiastres: input.amountPiastres,
        months: input.months,
        startMonth: input.startMonth,
        entryId: entry!.id,
        createdById: input.actorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.prepayment',
      entityType: 'prepayment',
      entityId: row.id,
      after: {
        name: input.name,
        amount: input.amountPiastres,
        months: input.months,
        from: money.code,
      },
    });
    return entry!;
  });
}

export interface AssetInput extends PaidOnce {
  /** The price paid now */
  amountPiastres: number;
  /** What it is still worth at the end of its life */
  salvagePiastres?: number;
  lifeMonths: number;
}

/** Buys equipment; its cost becomes depreciation month by month over its life. */
export function recordAssetPurchase(db: Db, input: AssetInput) {
  const salvage = input.salvagePiastres ?? 0;
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  if (!Number.isSafeInteger(salvage) || salvage < 0 || salvage >= input.amountPiastres)
    throw new DomainError('invalid_salvage', 400);
  if (!Number.isInteger(input.lifeMonths) || input.lifeMonths < 1 || input.lifeMonths > 600)
    throw new DomainError('invalid_months', 400);
  if (!MONTH.test(input.startMonth)) throw new DomainError('invalid_month', 400);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const key = `asset:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    const money = await lockedAccount(tx, input.moneyAccountId, MONEY_GROUPS, 'account_not_found');
    await checkStore(tx, input.darkStoreId);
    if (input.amountPiastres > (await balanceOf(tx, { id: money.id })))
      throw new DomainError('not_enough_money');
    const entry = await post(tx, {
      kind: 'asset_purchase',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.name,
      darkStoreId: input.darkStoreId ?? null,
      data: { reference: input.reference, lifeMonths: input.lifeMonths, salvage },
      lines: [
        { account: { type: 'fixed_assets' }, amount: input.amountPiastres },
        { account: { id: money.id }, amount: -input.amountPiastres },
      ],
    });
    const row = await tx.fixedAsset.create({
      data: {
        name: input.name,
        costPiastres: input.amountPiastres,
        salvagePiastres: salvage,
        lifeMonths: input.lifeMonths,
        startMonth: input.startMonth,
        darkStoreId: input.darkStoreId ?? null,
        entryId: entry!.id,
        createdById: input.actorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.asset_purchase',
      entityType: 'fixed_asset',
      entityId: row.id,
      after: {
        name: input.name,
        cost: input.amountPiastres,
        life: input.lifeMonths,
        from: money.code,
      },
    });
    return entry!;
  });
}

/** When a monthly charge is dated: the month's end, or the first open moment after closing. */
async function chargeTime(db: Db, month: string) {
  const lock = await db.booksLock.findUnique({ where: { id: 'books' } });
  const end = monthEnd(month);
  return lock && end < lock.lockedBefore ? lock.lockedBefore : end;
}

/**
 * Charges every month that is over and not charged yet: prepayments to their expense,
 * fixed assets to depreciation. Safe to run any number of times (one key per item and month).
 */
export async function runMonthlyCharges(db: Db, now: Date = new Date()) {
  const lastDone = addMonths(cairoDay(now).slice(0, 7), -1);
  let charged = 0;
  const failed: { id: string; error: string }[] = [];
  const prepayments = await db.prepayment.findMany();
  for (const p of prepayments) {
    try {
      for (let i = 0; i < p.months; i++) {
        const month = addMonths(p.startMonth, i);
        if (month > lastDone) break;
        const key = `prepaid:${p.id}:${month}`;
        if (await db.ledgerEntry.findUnique({ where: { idempotencyKey: key } })) continue;
        const entry = await post(db, {
          kind: 'prepayment_release',
          idempotencyKey: key,
          occurredAt: await chargeTime(db, month),
          memo: `${p.name} ${month}`,
          darkStoreId: p.darkStoreId,
          data: { prepaymentId: p.id, month, part: i + 1, of: p.months },
          lines: [
            {
              account: { id: p.expenseAccountId },
              amount: monthlyPart(p.totalPiastres, p.months, i),
            },
            { account: { type: 'prepaid' }, amount: -monthlyPart(p.totalPiastres, p.months, i) },
          ],
        });
        if (entry) charged++;
      }
    } catch (error) {
      failed.push({ id: p.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const assets = await db.fixedAsset.findMany();
  for (const a of assets) {
    try {
      charged += await chargeDepreciation(db, a, lastDone);
    } catch (error) {
      failed.push({ id: a.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { charged, failed };
}

type DepreciableAsset = Pick<
  Prisma.FixedAssetGetPayload<object>,
  'id' | 'name' | 'costPiastres' | 'salvagePiastres' | 'lifeMonths' | 'startMonth' | 'darkStoreId'
> & { disposedAt: Date | null };

/**
 * Charges an asset's depreciation for every month up to `lastMonth` not charged yet (one
 * key per asset and month). A sold or scrapped asset is never charged for the month it left
 * or later. Returns how many months were charged.
 */
export async function chargeDepreciation(db: Db, a: DepreciableAsset, lastMonth: string) {
  const base = a.costPiastres - a.salvagePiastres;
  let charged = 0;
  for (let i = 0; i < a.lifeMonths; i++) {
    const month = addMonths(a.startMonth, i);
    if (month > lastMonth) break;
    // Sold or scrapped: nothing from the month it left.
    if (a.disposedAt && month >= cairoDay(a.disposedAt).slice(0, 7)) break;
    const key = `depr:${a.id}:${month}`;
    if (await db.ledgerEntry.findUnique({ where: { idempotencyKey: key } })) continue;
    const amount = monthlyPart(base, a.lifeMonths, i);
    const entry = await post(db, {
      kind: 'depreciation',
      idempotencyKey: key,
      occurredAt: await chargeTime(db, month),
      memo: `${a.name} ${month}`,
      darkStoreId: a.darkStoreId,
      data: { assetId: a.id, month, part: i + 1, of: a.lifeMonths },
      lines: [
        { account: { type: 'depreciation_expense' }, amount },
        { account: { type: 'accumulated_depreciation' }, amount: -amount },
      ],
    });
    if (entry) charged++;
  }
  return charged;
}

/** How much of each entry kind keyed by item has been charged so far. */
async function chargedSoFar(db: Db, kind: string, field: string) {
  const rows = await db.$queryRawUnsafe<{ id: string; total: bigint; months: bigint }[]>(
    `SELECT e.data->>'${field}' AS id, SUM(l.amount_piastres) AS total, COUNT(DISTINCT e.id) AS months
     FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.id AND l.amount_piastres > 0
     WHERE e.kind = $1 GROUP BY 1`,
    kind,
  );
  return new Map(rows.map((r) => [r.id, { total: Number(r.total), months: Number(r.months) }]));
}

export async function listPrepayments(db: Db) {
  const [rows, done] = await Promise.all([
    db.prepayment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        expenseAccount: { select: { code: true, nameEn: true, nameAr: true } },
        darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      },
    }),
    chargedSoFar(db, 'prepayment_release', 'prepaymentId'),
  ]);
  return rows.map((p) => {
    const d = done.get(p.id) ?? { total: 0, months: 0 };
    return {
      id: p.id,
      name: p.name,
      expenseAccount: p.expenseAccount,
      darkStore: p.darkStore,
      totalPiastres: p.totalPiastres,
      months: p.months,
      startMonth: p.startMonth,
      monthlyPiastres: monthlyPart(p.totalPiastres, p.months, 0),
      monthsCharged: d.months,
      chargedPiastres: d.total,
      leftPiastres: p.totalPiastres - d.total,
    };
  });
}

export async function listFixedAssets(db: Db) {
  const [rows, done] = await Promise.all([
    db.fixedAsset.findMany({
      orderBy: { createdAt: 'desc' },
      include: { darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
    }),
    chargedSoFar(db, 'depreciation', 'assetId'),
  ]);
  return rows.map((a) => {
    const d = done.get(a.id) ?? { total: 0, months: 0 };
    return {
      id: a.id,
      name: a.name,
      darkStore: a.darkStore,
      costPiastres: a.costPiastres,
      salvagePiastres: a.salvagePiastres,
      lifeMonths: a.lifeMonths,
      startMonth: a.startMonth,
      monthlyPiastres: monthlyPart(a.costPiastres - a.salvagePiastres, a.lifeMonths, 0),
      monthsCharged: d.months,
      depreciatedPiastres: d.total,
      bookValuePiastres: a.disposedAt ? 0 : a.costPiastres - d.total,
      disposedAt: a.disposedAt,
    };
  });
}
