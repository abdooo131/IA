import type { LedgerAccountType, PayoutSchedule } from '@prisma/client';
import type { Db } from '../client';
import { accountKey, balancesByType } from './ledger';

/** How an account is shown: who it belongs to, in both languages where it has a name. */
async function owners(db: Db) {
  const [merchants, riders, stores] = await Promise.all([
    db.merchant.findMany({
      select: { id: true, name: true, payoutSchedule: true, isActive: true },
    }),
    db.rider.findMany({
      select: {
        id: true,
        badgeCode: true,
        darkStoreId: true,
        user: { select: { name: true, isActive: true } },
      },
    }),
    db.darkStore.findMany({ select: { id: true, code: true, nameEn: true, nameAr: true } }),
  ]);
  return { merchants, riders, stores };
}

/** Flips a sign without producing -0, which would show as "-0.00". */
const negate = (value: number) => 0 - value;

const sumOf = (rows: { balance: number }[]) => rows.reduce((s, r) => s + r.balance, 0);

/** Every wallet with its balance, from the point of view of its owner. */
export async function financeWallets(db: Db) {
  const [{ merchants, riders, stores }, balances, drafts, pending] = await Promise.all([
    owners(db),
    balancesByType(db, [
      'merchant',
      'rider_cash',
      'rider_bonus',
      'store_cash',
      'bank',
      'revenue',
      'vat_payable',
      'rider_bonus_expense',
      'cash_difference',
    ]),
    db.payout.findMany({
      where: { status: 'draft' },
      select: { id: true, merchantId: true, amountPiastres: true },
    }),
    db.cashHandover.groupBy({
      by: ['riderId'],
      where: { status: 'pending' },
      _count: { _all: true },
    }),
  ]);
  const of = (type: LedgerAccountType) => balances.filter((b) => b.type === type);
  const balance = (key: string) => balances.find((b) => b.key === key)?.balance ?? 0;

  return {
    merchants: merchants
      .map((m) => ({
        id: m.id,
        name: m.name,
        isActive: m.isActive,
        payoutSchedule: m.payoutSchedule as PayoutSchedule,
        owedPiastres: negate(balance(accountKey({ type: 'merchant', merchantId: m.id }))),
        draftPayout: drafts.find((d) => d.merchantId === m.id) ?? null,
      }))
      .sort((a, b) => b.owedPiastres - a.owedPiastres),
    riders: riders
      .map((r) => ({
        id: r.id,
        name: r.user.name,
        badgeCode: r.badgeCode,
        isActive: r.user.isActive,
        darkStore: stores.find((s) => s.id === r.darkStoreId)!,
        cashPiastres: balance(accountKey({ type: 'rider_cash', riderId: r.id })),
        bonusOwedPiastres: negate(balance(accountKey({ type: 'rider_bonus', riderId: r.id }))),
        pendingHandovers: pending.find((p) => p.riderId === r.id)?._count._all ?? 0,
      }))
      .sort((a, b) => b.cashPiastres - a.cashPiastres),
    stores: stores
      .map((s) => ({
        ...s,
        cashPiastres: balance(accountKey({ type: 'store_cash', darkStoreId: s.id })),
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    company: {
      bankPiastres: sumOf(of('bank')),
      /** Income is a credit, so it is shown with its sign flipped */
      revenuePiastres: negate(sumOf(of('revenue'))),
      vatPayablePiastres: negate(sumOf(of('vat_payable'))),
      riderBonusExpensePiastres: sumOf(of('rider_bonus_expense')),
      cashDifferencePiastres: sumOf(of('cash_difference')),
    },
    totals: {
      owedToMerchantsPiastres: negate(sumOf(of('merchant').filter((b) => b.balance < 0))),
      owedByMerchantsPiastres: sumOf(of('merchant').filter((b) => b.balance > 0)),
      cashWithRidersPiastres: sumOf(of('rider_cash')),
      cashInStoresPiastres: sumOf(of('store_cash')),
      riderBonusOwedPiastres: negate(sumOf(of('rider_bonus'))),
      pendingHandovers: pending.reduce((s, p) => s + p._count._all, 0),
      draftPayouts: drafts.length,
      draftPayoutsPiastres: drafts.reduce((s, d) => s + d.amountPiastres, 0),
    },
  };
}

export interface StatementLine {
  at: Date;
  kind: string;
  memo: string | null;
  orderId: string | null;
  orderNumber: string | null;
  /** From the merchant's side: positive adds to what we owe them */
  amountPiastres: number;
  balanceAfterPiastres: number;
}

/** What happened to a merchant's balance between two moments, line by line. */
export async function merchantStatement(db: Db, merchantId: string, from: Date, to: Date) {
  const key = accountKey({ type: 'merchant', merchantId });
  const [merchant, opening, lines] = await Promise.all([
    db.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      select: { id: true, name: true, payoutSchedule: true },
    }),
    db.ledgerLine.aggregate({
      where: { account: { key }, occurredAt: { lt: from } },
      _sum: { amountPiastres: true },
    }),
    db.ledgerLine.findMany({
      where: { account: { key }, occurredAt: { gte: from, lt: to } },
      include: { entry: { include: { order: { select: { number: true } } } } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const openingOwed = negate(opening._sum.amountPiastres ?? 0);
  let running = openingOwed;
  const rows: StatementLine[] = lines.map((l) => {
    running -= l.amountPiastres;
    return {
      at: l.occurredAt,
      kind: l.entry.kind,
      memo: l.entry.memo,
      orderId: l.entry.orderId,
      orderNumber: l.entry.order?.number ?? null,
      amountPiastres: negate(l.amountPiastres),
      balanceAfterPiastres: running,
    };
  });
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + r.amountPiastres;
  return {
    merchant,
    from,
    to,
    openingOwedPiastres: openingOwed,
    closingOwedPiastres: running,
    byKind,
    lines: rows,
  };
}

export interface EntryFilter {
  kind?: string;
  accountKey?: string;
  orderId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  take?: number;
}

/** The journal, newest first, with every line and the name of each account. */
export async function listLedgerEntries(db: Db, filter: EntryFilter) {
  const take = Math.min(filter.take ?? 50, 200);
  const entries = await db.ledgerEntry.findMany({
    where: {
      kind: filter.kind,
      orderId: filter.orderId,
      occurredAt: filter.from || filter.to ? { gte: filter.from, lt: filter.to } : undefined,
      lines: filter.accountKey ? { some: { account: { key: filter.accountKey } } } : undefined,
    },
    include: {
      lines: { include: { account: true } },
      createdBy: { select: { name: true } },
      order: { select: { number: true } },
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    cursor: filter.cursor ? { id: filter.cursor } : undefined,
    skip: filter.cursor ? 1 : 0,
  });
  const page = entries.slice(0, take);
  const { merchants, riders, stores } = await owners(db);
  const label = (a: {
    type: LedgerAccountType;
    merchantId: string | null;
    riderId: string | null;
    darkStoreId: string | null;
  }) => {
    if (a.merchantId) return merchants.find((m) => m.id === a.merchantId)?.name ?? a.merchantId;
    if (a.riderId) {
      const r = riders.find((x) => x.id === a.riderId);
      return r ? `${r.user.name} (${r.badgeCode})` : a.riderId;
    }
    if (a.darkStoreId) return stores.find((s) => s.id === a.darkStoreId)?.code ?? a.darkStoreId;
    return null;
  };
  return {
    rows: page.map((e) => ({
      id: e.id,
      at: e.occurredAt,
      kind: e.kind,
      memo: e.memo,
      orderId: e.orderId,
      orderNumber: e.order?.number ?? null,
      by: e.createdBy?.name ?? null,
      data: e.data as unknown,
      lines: e.lines.map((l) => ({
        accountKey: l.account.key,
        accountType: l.account.type,
        owner: label(l.account),
        amountPiastres: l.amountPiastres,
      })),
    })),
    nextCursor: entries.length > take ? page[page.length - 1]!.id : null,
  };
}

/** Debits and credits per account type in a period; the totals always match. */
export async function trialBalance(db: Db, from?: Date, to?: Date) {
  const lines = await db.ledgerLine.findMany({
    where: { occurredAt: from || to ? { gte: from, lt: to } : undefined },
    select: { amountPiastres: true, account: { select: { type: true } } },
  });
  const rows = new Map<LedgerAccountType, { debit: number; credit: number }>();
  for (const l of lines) {
    const row = rows.get(l.account.type) ?? { debit: 0, credit: 0 };
    if (l.amountPiastres > 0) row.debit += l.amountPiastres;
    else row.credit -= l.amountPiastres;
    rows.set(l.account.type, row);
  }
  const list = [...rows.entries()].map(([type, r]) => ({
    type,
    debitPiastres: r.debit,
    creditPiastres: r.credit,
    balancePiastres: r.debit - r.credit,
  }));
  return {
    rows: list.sort((a, b) => a.type.localeCompare(b.type)),
    totalDebitPiastres: list.reduce((s, r) => s + r.debitPiastres, 0),
    totalCreditPiastres: list.reduce((s, r) => s + r.creditPiastres, 0),
  };
}
