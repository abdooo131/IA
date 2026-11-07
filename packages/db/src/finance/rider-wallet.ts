import type { Prisma, RiderWithdrawal } from '@prisma/client';
import {
  availableFrom,
  cairoDay,
  type HoldRules,
  OPEN_WITHDRAWAL_STATUSES,
  walletTotals,
  weekendDays,
  type WithdrawalDetails,
  withdrawalDeductions,
  withdrawalNumber,
  type WithdrawalRequestBody,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { getSetting } from '../settings';
import { payoutNeedsApproval } from './controls';
import { type AccountRef, accountKey, balanceOf, nextNumber, post } from './ledger';

type Tx = Prisma.TransactionClient;

// Rider pay (CLAUDE.md "Rider pay"). Riders earn only rider.bonus_per_delivery_piastres per
// delivered order (posted at delivery: rider pay expense 5101 against the rider's 2200 wallet).
// Earnings are held for rider.withdraw_hold_working_days working days, then the rider asks for
// a withdrawal. What the rider owes is taken first, in the same entry:
//
//   Dr 2200 rider wallet   amount + deductions
//   Cr 1350 rider dues     cash shortages kept on the rider, damage charges, penalties
//   Cr 1500 staff advance  an advance given to the rider
//   Cr bank or cash box    amount (what the rider receives)
//
// available = matured earnings − paid out − owed − open withdrawals (what they will receive).
// Nothing here is stored: every figure is summed from the ledger lines and open requests.

const negate = (value: number) => 0 - value;
const dayOf = (at: Date) => cairoDay(at);

/** The hold rules from the settings and HR's official holidays. */
export async function riderHoldRules(db: Db): Promise<HoldRules> {
  const [holdDays, weekend, holidays] = await Promise.all([
    getSetting(db, 'rider.withdraw_hold_working_days'),
    getSetting(db, 'rider.weekend_days'),
    db.holiday.findMany({ select: { day: true } }),
  ]);
  return {
    holdDays,
    weekend: weekendDays(weekend),
    holidays: new Set(holidays.map((h) => h.day.toISOString().slice(0, 10))),
  };
}

/** What a rider owes: dues (1350) and an advance on their staff advance wallet (1500). */
export async function riderOwed(db: Db, riderId: string) {
  const rider = await db.rider.findUnique({ where: { id: riderId }, select: { userId: true } });
  if (!rider) throw new DomainError('rider_not_found', 404);
  const [dues, advance] = await Promise.all([
    balanceOf(db, { type: 'rider_dues', riderId }),
    balanceOf(db, { type: 'staff_advance', userId: rider.userId }),
  ]);
  return withdrawalDeductions({ duesPiastres: dues, advancePiastres: advance });
}

/** Each earning (a rider_bonus credit) with its day and the day it becomes available. */
async function earningsOf(db: Db, riderId: string, rules: HoldRules) {
  const lines = await db.ledgerLine.findMany({
    where: { account: { key: accountKey({ type: 'rider_bonus', riderId }) } },
    select: {
      id: true,
      amountPiastres: true,
      occurredAt: true,
      darkStoreId: true,
      entry: {
        select: { id: true, kind: true, orderId: true, order: { select: { number: true } } },
      },
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
  });
  const earnings = [];
  let paid = 0;
  for (const l of lines) {
    if (l.amountPiastres > 0) {
      paid += l.amountPiastres;
      continue;
    }
    const day = dayOf(l.occurredAt);
    earnings.push({
      lineId: l.id,
      entryId: l.entry.id,
      kind: l.entry.kind,
      orderId: l.entry.orderId,
      orderNumber: l.entry.order?.number ?? null,
      darkStoreId: l.darkStoreId,
      at: l.occurredAt,
      day,
      amountPiastres: negate(l.amountPiastres),
      availableOn: availableFrom(day, rules),
    });
  }
  return { earnings, paid };
}

/** The wallet's figures for a rider on a moment (default now). */
export async function riderWalletTotals(db: Db, riderId: string, now: Date = new Date()) {
  const rules = await riderHoldRules(db);
  const [{ earnings, paid }, owed, open] = await Promise.all([
    earningsOf(db, riderId, rules),
    riderOwed(db, riderId),
    db.riderWithdrawal.findMany({
      where: { riderId, status: { in: OPEN_WITHDRAWAL_STATUSES } },
      select: { id: true, amountPiastres: true, deductionPiastres: true },
    }),
  ]);
  const totals = walletTotals({
    today: dayOf(now),
    earnings,
    paidPiastres: paid,
    owedPiastres: owed.totalPiastres,
    pendingPiastres: open.reduce((s, w) => s + w.amountPiastres, 0),
    pendingDeductionPiastres: open.reduce((s, w) => s + w.deductionPiastres, 0),
  });
  return { rules, earnings, owed, open, totals };
}

const withdrawalInclude = {
  rider: { select: { id: true, badgeCode: true, user: { select: { id: true, name: true } } } },
  darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  approvedBy: { select: { id: true, name: true } },
  paidBy: { select: { id: true, name: true } },
  rejectedBy: { select: { id: true, name: true } },
  entry: { select: { id: true, number: true } },
} as const;
type WithdrawalRow = Prisma.RiderWithdrawalGetPayload<{ include: typeof withdrawalInclude }>;

function withdrawalView(w: WithdrawalRow, paidFrom: { code: string; name: string } | null) {
  const d = (w.deductions ?? {}) as { duesPiastres?: number; advancePiastres?: number };
  return {
    id: w.id,
    number: withdrawalNumber(w.number),
    status: w.status,
    amountPiastres: w.amountPiastres,
    deductionPiastres: w.deductionPiastres,
    deductions: { duesPiastres: d.duesPiastres ?? 0, advancePiastres: d.advancePiastres ?? 0 },
    /** What leaves the wallet: what the rider receives plus the deductions */
    grossPiastres: w.amountPiastres + w.deductionPiastres,
    method: w.method,
    details: w.details as WithdrawalDetails,
    rider: { id: w.rider.id, badgeCode: w.rider.badgeCode, name: w.rider.user.name },
    riderUserId: w.rider.user.id,
    darkStore: w.darkStore,
    createdAt: w.createdAt,
    approvedAt: w.approvedAt,
    approvedBy: w.approvedBy,
    paidAt: w.paidAt,
    paidBy: w.paidBy,
    paidFrom,
    reference: w.reference,
    entryNumber: w.entry?.number ?? null,
    rejectedAt: w.rejectedAt,
    rejectedBy: w.rejectedBy,
    rejectReason: w.rejectReason,
    cancelledAt: w.cancelledAt,
  };
}
export type RiderWithdrawalView = ReturnType<typeof withdrawalView>;

async function views(db: Db, rows: WithdrawalRow[]) {
  const ids = [...new Set(rows.map((r) => r.paidFromAccountId).filter((x): x is string => !!x))];
  const accounts = ids.length
    ? await db.ledgerAccount.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          code: true,
          nameEn: true,
          darkStore: { select: { nameEn: true } },
        },
      })
    : [];
  return rows.map((r) => {
    const a = accounts.find((x) => x.id === r.paidFromAccountId);
    return withdrawalView(
      r,
      a ? { code: a.code, name: a.nameEn ?? a.darkStore?.nameEn ?? a.code } : null,
    );
  });
}

/**
 * The rider's wallet as the rider app shows it: the totals, what they owe (with the recent
 * charges behind it), each earning with the day it becomes available, the withdrawals, the
 * rules and the last method used.
 */
export async function riderWallet(db: Db, riderId: string, now: Date = new Date()) {
  const rider = await db.rider.findUnique({
    where: { id: riderId },
    include: {
      user: { select: { name: true } },
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
    },
  });
  if (!rider) throw new DomainError('rider_not_found', 404);
  const { rules, earnings, owed, open, totals } = await riderWalletTotals(db, riderId, now);
  const [rows, charges, stores, minPiastres, maxOpen, perDelivery] = await Promise.all([
    db.riderWithdrawal.findMany({
      where: { riderId },
      include: withdrawalInclude,
      orderBy: { number: 'desc' },
      take: 50,
    }),
    db.ledgerLine.findMany({
      where: {
        account: { key: accountKey({ type: 'rider_dues', riderId }) },
        amountPiastres: { gt: 0 },
      },
      select: {
        amountPiastres: true,
        occurredAt: true,
        entry: { select: { kind: true, memo: true, number: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    }),
    db.darkStore.findMany({ select: { id: true, code: true, nameEn: true, nameAr: true } }),
    getSetting(db, 'rider.min_withdrawal_piastres'),
    getSetting(db, 'rider.max_open_withdrawals'),
    getSetting(db, 'rider.bonus_per_delivery_piastres', rider.darkStoreId),
  ]);
  const list = await views(db, rows);
  const last = list.find((w) => w.status !== 'cancelled' && w.status !== 'rejected') ?? list[0];
  const today = dayOf(now);
  const canRequest =
    open.length >= maxOpen
      ? 'withdrawal_already_open'
      : totals.availablePiastres <= 0
        ? 'nothing_available'
        : null;
  return {
    rider: {
      id: rider.id,
      name: rider.user.name,
      badgeCode: rider.badgeCode,
      darkStore: rider.darkStore,
    },
    today,
    totals,
    owed: {
      ...owed,
      /** Owed and not yet set aside by an open withdrawal */
      outstandingPiastres: totals.owedPiastres,
      charges: charges.map((c) => ({
        kind: c.entry.kind,
        memo: c.entry.memo,
        at: c.occurredAt,
        amountPiastres: c.amountPiastres,
      })),
    },
    rules: {
      holdDays: rules.holdDays,
      weekend: rules.weekend,
      minPiastres: minPiastres,
      maxOpen,
      perDeliveryPiastres: perDelivery,
    },
    earnings: earnings.slice(0, 100).map((e) => ({
      ...e,
      available: e.availableOn <= today,
      darkStore: stores.find((s) => s.id === e.darkStoreId) ?? null,
    })),
    withdrawals: list,
    lastDetails: last ? last.details : null,
    canRequest,
  };
}

/** The rider row of a signed in rider. */
export async function riderOfUser(db: Db, userId: string) {
  const rider = await db.rider.findUnique({ where: { userId } });
  if (!rider) throw new DomainError('no_rider_profile', 403);
  return rider;
}

/**
 * A rider asks for money that finished its hold. The amount is what they receive; what they
 * owe (dues first, then an advance) is set aside to be taken from the wallet in the same
 * payment. At most rider.max_open_withdrawals open at once, at least
 * rider.min_withdrawal_piastres unless it is everything available. The same key answers the
 * same request.
 */
export function requestWithdrawal(
  db: Db,
  input: { riderUserId: string; body: WithdrawalRequestBody; now?: Date },
) {
  const now = input.now ?? new Date();
  return inTransaction(db, async (tx) => {
    const rider = await riderOfUser(tx, input.riderUserId);
    const seen = await tx.riderWithdrawal.findUnique({
      where: { idempotencyKey: input.body.idempotencyKey },
      include: withdrawalInclude,
    });
    if (seen) {
      if (seen.riderId !== rider.id) throw new DomainError('idempotency_key_reused');
      return (await views(tx, [seen]))[0]!;
    }
    // One rider at a time: two taps cannot both read the same available amount.
    await tx.$queryRaw`SELECT id FROM riders WHERE id = ${rider.id} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: input.riderUserId } });
    if (!user?.isActive) throw new DomainError('account_disabled', 403);
    const maxOpen = await getSetting(tx, 'rider.max_open_withdrawals');
    const { totals, owed, open } = await riderWalletTotals(tx, rider.id, now);
    if (open.length >= maxOpen) throw new DomainError('withdrawal_already_open', 409);
    const amount = input.body.amountPiastres;
    if (amount > totals.availablePiastres) throw new DomainError('more_than_available', 409);
    const min = await getSetting(tx, 'rider.min_withdrawal_piastres');
    if (amount < min && amount !== totals.availablePiastres)
      throw new DomainError('below_minimum', 400);
    // What the open requests already set aside is not taken twice.
    const setAside = open.reduce((s, w) => s + w.deductionPiastres, 0);
    const dues = Math.max(0, owed.duesPiastres - setAside);
    const advance = Math.max(0, owed.advancePiastres - Math.max(0, setAside - owed.duesPiastres));
    const deductions = withdrawalDeductions({ duesPiastres: dues, advancePiastres: advance });
    const created = await tx.riderWithdrawal.create({
      data: {
        number: await nextNumber(tx, 'rider_withdrawals'),
        riderId: rider.id,
        darkStoreId: rider.darkStoreId,
        amountPiastres: amount,
        deductionPiastres: deductions.totalPiastres,
        deductions: {
          duesPiastres: deductions.duesPiastres,
          advancePiastres: deductions.advancePiastres,
        },
        method: input.body.details.method,
        details: input.body.details as Prisma.InputJsonValue,
        idempotencyKey: input.body.idempotencyKey,
        createdAt: now,
      },
      include: withdrawalInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.riderUserId,
      action: 'rider_withdrawal.request',
      entityType: 'rider_withdrawal',
      entityId: created.id,
      after: {
        number: withdrawalNumber(created.number),
        amount,
        deductions: deductions.totalPiastres,
        method: created.method,
        availableBefore: totals.availablePiastres,
      },
    });
    return (await views(tx, [created]))[0]!;
  });
}

async function lockWithdrawal(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM rider_withdrawals WHERE id = ${id} FOR UPDATE`;
  const w = await tx.riderWithdrawal.findUnique({ where: { id }, include: withdrawalInclude });
  if (!w) throw new DomainError('withdrawal_not_found', 404);
  return w;
}

async function audit(
  tx: Tx,
  actorUserId: string,
  action: string,
  w: RiderWithdrawal,
  after: Record<string, unknown>,
) {
  await recordAudit(tx, {
    actorUserId,
    action: `rider_withdrawal.${action}`,
    entityType: 'rider_withdrawal',
    entityId: w.id,
    before: { status: w.status },
    after: after as Prisma.InputJsonValue,
  });
}

/** The rider takes back a request Accounting has not approved yet. */
export function cancelWithdrawal(db: Db, input: { withdrawalId: string; riderUserId: string }) {
  return inTransaction(db, async (tx) => {
    const w = await lockWithdrawal(tx, input.withdrawalId);
    if (w.rider.user.id !== input.riderUserId) throw new DomainError('withdrawal_not_found', 404);
    if (w.status !== 'requested') throw new DomainError('withdrawal_not_requested', 409);
    const after = await tx.riderWithdrawal.update({
      where: { id: w.id },
      data: { status: 'cancelled', cancelledAt: new Date() },
      include: withdrawalInclude,
    });
    await audit(tx, input.riderUserId, 'cancel', w, { status: 'cancelled' });
    return (await views(tx, [after]))[0]!;
  });
}

/** Accounting approves a request (never the rider's own account). */
export function approveWithdrawal(db: Db, input: { withdrawalId: string; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    const w = await lockWithdrawal(tx, input.withdrawalId);
    if (w.rider.user.id === input.actorUserId) throw new DomainError('own_withdrawal', 403);
    if (w.status !== 'requested') throw new DomainError('withdrawal_not_requested', 409);
    const after = await tx.riderWithdrawal.update({
      where: { id: w.id },
      data: { status: 'approved', approvedById: input.actorUserId, approvedAt: new Date() },
      include: withdrawalInclude,
    });
    await audit(tx, input.actorUserId, 'approve', w, {
      status: 'approved',
      amount: w.amountPiastres,
    });
    return (await views(tx, [after]))[0]!;
  });
}

/** Accounting refuses a request with a reason; the amount is available again at once. */
export function rejectWithdrawal(
  db: Db,
  input: { withdrawalId: string; reason: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const w = await lockWithdrawal(tx, input.withdrawalId);
    if (w.rider.user.id === input.actorUserId) throw new DomainError('own_withdrawal', 403);
    if (w.status !== 'requested' && w.status !== 'approved')
      throw new DomainError('withdrawal_not_open', 409);
    const after = await tx.riderWithdrawal.update({
      where: { id: w.id },
      data: {
        status: 'rejected',
        rejectedById: input.actorUserId,
        rejectedAt: new Date(),
        rejectReason: input.reason,
      },
      include: withdrawalInclude,
    });
    await audit(tx, input.actorUserId, 'reject', w, { status: 'rejected', reason: input.reason });
    return (await views(tx, [after]))[0]!;
  });
}

/** A bank (1100) or cash box (1200) that is open. */
async function moneyAccountFor(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id = ${id} FOR UPDATE`;
  const account = await tx.ledgerAccount.findUnique({ where: { id } });
  if (!account || ![1100, 1200].includes(account.groupCode))
    throw new DomainError('account_not_found', 404);
  if (!account.isActive) throw new DomainError('account_inactive');
  return account;
}

/**
 * Pays an approved withdrawal from a bank or cash box (cash at the store: the store's box by
 * default; otherwise the main bank). From finance.approval_threshold_piastres the person who
 * pays must not be the one who approved (second person rule). The deductions set aside at the
 * request are taken in the same entry (never more than is still owed), and the wallet must
 * still hold the money: a charge that came after the request is taken next time.
 */
export function payWithdrawal(
  db: Db,
  input: {
    withdrawalId: string;
    moneyAccountId?: string;
    reference: string;
    actorUserId: string;
    /** A store manager pays cash at their store: only from that store's box */
    storeId?: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return inTransaction(db, async (tx) => {
    const w = await lockWithdrawal(tx, input.withdrawalId);
    if (input.storeId && (w.darkStoreId !== input.storeId || w.method !== 'store_cash'))
      throw new DomainError('withdrawal_not_found', 404);
    if (w.rider.user.id === input.actorUserId) throw new DomainError('own_withdrawal', 403);
    if (w.status === 'paid') throw new DomainError('withdrawal_already_paid', 409);
    if (w.status !== 'approved') throw new DomainError('withdrawal_not_approved', 409);
    if ((await payoutNeedsApproval(tx, w.amountPiastres)) && w.approvedById === input.actorUserId)
      throw new DomainError('same_person', 403);
    await tx.$queryRaw`SELECT id FROM riders WHERE id = ${w.riderId} FOR UPDATE`;

    // Where the money comes from.
    let source: AccountRef;
    let sourceId: string;
    const storeBox = { type: 'store_cash', darkStoreId: w.darkStoreId } as const;
    if (input.storeId) {
      source = storeBox;
      sourceId = (await ensureAccountId(tx, storeBox))!;
    } else if (input.moneyAccountId) {
      const account = await moneyAccountFor(tx, input.moneyAccountId);
      source = { id: account.id };
      sourceId = account.id;
    } else {
      source = w.method === 'store_cash' ? storeBox : { type: 'bank' };
      sourceId = (await ensureAccountId(tx, source))!;
    }
    if (w.amountPiastres > (await balanceOf(tx, { id: sourceId })))
      throw new DomainError('not_enough_money', 409);

    // The wallet without this request must still cover what the rider receives.
    const { totals, owed, open } = await riderWalletTotals(tx, w.riderId, now);
    const stored = (w.deductions ?? {}) as { duesPiastres?: number; advancePiastres?: number };
    const dues = Math.min(stored.duesPiastres ?? 0, owed.duesPiastres);
    const advance = Math.min(stored.advancePiastres ?? 0, owed.advancePiastres);
    // What leaves the wallet is never more than has matured and is not paid or promised to
    // another open request.
    const others = open
      .filter((o) => o.id !== w.id)
      .reduce((s, o) => s + o.amountPiastres + o.deductionPiastres, 0);
    const free = totals.maturedPiastres - totals.paidPiastres - others;
    if (w.amountPiastres + dues + advance > free) throw new DomainError('more_than_available', 409);

    const tags = { riderId: w.riderId, darkStoreId: w.darkStoreId };
    const entry = await post(tx, {
      kind: 'rider_withdrawal',
      idempotencyKey: `rider_withdrawal:${w.id}`,
      occurredAt: now,
      createdById: input.actorUserId,
      memo: `${withdrawalNumber(w.number)} ${input.reference}`,
      ...tags,
      data: {
        withdrawalId: w.id,
        number: withdrawalNumber(w.number),
        method: w.method,
        reference: input.reference,
        duesPiastres: dues,
        advancePiastres: advance,
      },
      lines: [
        {
          account: { type: 'rider_bonus', riderId: w.riderId },
          amount: w.amountPiastres + dues + advance,
          tags,
        },
        { account: { type: 'rider_dues', riderId: w.riderId }, amount: -dues, tags },
        {
          account: { type: 'staff_advance', userId: w.rider.user.id },
          amount: -advance,
          tags: { ...tags, userId: w.rider.user.id },
        },
        { account: source, amount: -w.amountPiastres, tags },
      ],
    });
    const after = await tx.riderWithdrawal.update({
      where: { id: w.id },
      data: {
        status: 'paid',
        paidById: input.actorUserId,
        paidAt: now,
        paidFromAccountId: sourceId,
        reference: input.reference,
        entryId: entry!.id,
        deductionPiastres: dues + advance,
        deductions: { duesPiastres: dues, advancePiastres: advance },
      },
      include: withdrawalInclude,
    });
    await audit(tx, input.actorUserId, 'pay', w, {
      status: 'paid',
      amount: w.amountPiastres,
      deductions: dues + advance,
      from: sourceId,
      reference: input.reference,
      byStoreManager: Boolean(input.storeId),
    });
    return (await views(tx, [after]))[0]!;
  });
}

/** The id of an account by its reference, opened when first used (a store box, the bank). */
async function ensureAccountId(tx: Tx, ref: AccountRef) {
  if ('id' in ref) return ref.id;
  const found = await tx.ledgerAccount.findUnique({ where: { key: accountKey(ref) } });
  if (found) return found.id;
  // Opening it with a zero entry is not possible; an account nobody posted to holds nothing.
  throw new DomainError('not_enough_money', 409);
}

export interface WithdrawalFilter {
  status?: string;
  /** Limited people see only their stores (null: every store) */
  storeIds?: string[] | null;
  darkStoreId?: string;
  method?: string;
  riderId?: string;
}

/** Withdrawals for Accounting (or a store), newest first, with the rider's wallet now. */
export async function listRiderWithdrawals(db: Db, f: WithdrawalFilter = {}) {
  const rows = await db.riderWithdrawal.findMany({
    where: {
      ...(f.status && { status: f.status as RiderWithdrawal['status'] }),
      ...(f.darkStoreId
        ? { darkStoreId: f.darkStoreId }
        : f.storeIds
          ? { darkStoreId: { in: f.storeIds } }
          : {}),
      ...(f.method && { method: f.method as RiderWithdrawal['method'] }),
      ...(f.riderId && { riderId: f.riderId }),
    },
    include: withdrawalInclude,
    orderBy: { number: 'desc' },
    take: 200,
  });
  const list = await views(db, rows);
  const open = list.filter((w) => w.status === 'requested' || w.status === 'approved');
  return {
    withdrawals: list,
    counts: {
      requested: open.filter((w) => w.status === 'requested').length,
      approved: open.filter((w) => w.status === 'approved').length,
      openPiastres: open.reduce((s, w) => s + w.amountPiastres, 0),
    },
  };
}

/** Every rider's wallet in a few numbers, for Accounting's rider list. */
export async function riderWalletSummaries(db: Db, riderIds: string[], now: Date = new Date()) {
  const out = new Map<string, Awaited<ReturnType<typeof riderWalletTotals>>['totals']>();
  for (const id of riderIds) out.set(id, (await riderWalletTotals(db, id, now)).totals);
  return out;
}

// ─── what riders owe ───────────────────────────────────────────────────────────

/**
 * A cash shortage finance keeps on the rider moves from the cash they carry (1300) to what
 * they owe (1350), so it is taken from their next withdrawal (a surplus stays in rider cash).
 */
export async function chargeShortageToRider(
  tx: Tx,
  input: { handoverId: string; riderId: string; amountPiastres: number; actorUserId: string },
) {
  if (input.amountPiastres <= 0) return null;
  return post(tx, {
    kind: 'rider_shortage_charge',
    idempotencyKey: `handover:${input.handoverId}:charge_rider`,
    createdById: input.actorUserId,
    riderId: input.riderId,
    data: { handoverId: input.handoverId, riderId: input.riderId },
    lines: [
      { account: { type: 'rider_dues', riderId: input.riderId }, amount: input.amountPiastres },
      { account: { type: 'rider_cash', riderId: input.riderId }, amount: -input.amountPiastres },
    ],
  });
}

/**
 * A final violation deduction of a rider paid per delivery goes to their wallet, not the
 * salary run: what they owe grows by the amount (or days × rider.penalty_day_piastres of their
 * store), against rider pay (5101). Once per violation (it is then marked as taken).
 */
export async function chargeRiderPenalty(tx: Tx, violationId: string, now: Date = new Date()) {
  const v = await tx.violation.findUnique({
    where: { id: violationId },
    include: {
      employee: { select: { payBasis: true, userId: true } },
      type: { select: { nameEn: true } },
    },
  });
  if (
    !v ||
    v.status !== 'final' ||
    v.payrollEntryId ||
    v.employee.payBasis !== 'per_delivery' ||
    (v.penalty !== 'deduction_days' && v.penalty !== 'deduction_amount')
  )
    return null;
  const rider = await tx.rider.findUnique({ where: { userId: v.employee.userId } });
  if (!rider) return null;
  let amount = v.amountPiastres ?? 0;
  if (v.penalty === 'deduction_days') {
    const perDay = await getSetting(tx, 'rider.penalty_day_piastres', rider.darkStoreId);
    // Days come in quarters: work in hundredths so no float reaches the money.
    const hundredths = Math.round(Number(v.days ?? 0) * 100);
    amount = Math.floor((hundredths * perDay + 50) / 100);
  }
  const label = `VIO-${String(v.number).padStart(6, '0')} ${v.type.nameEn}`;
  const entry = await post(tx, {
    kind: 'rider_penalty',
    idempotencyKey: `violation:${v.id}:rider_penalty`,
    occurredAt: now,
    memo: label,
    riderId: rider.id,
    darkStoreId: rider.darkStoreId,
    data: { violationId: v.id, days: v.days === null ? null : Number(v.days) },
    lines: [
      { account: { type: 'rider_dues', riderId: rider.id }, amount },
      { account: { type: 'rider_bonus_expense' }, amount: -amount },
    ],
  });
  // Marked as taken even when the amount is zero, so it is never looked at again.
  const marked = await tx.violation.updateMany({
    where: { id: v.id, payrollEntryId: null },
    data: { payrollEntryId: entry?.id ?? null, deductionPiastres: amount },
  });
  if (entry && marked.count === 1)
    await recordAudit(tx, {
      actorUserId: null,
      action: 'violation.rider_wallet',
      entityType: 'violation',
      entityId: v.id,
      after: { riderId: rider.id, amount, entryId: entry.id },
    });
  return entry;
}

/** The job: final deductions of per delivery riders not charged yet (safe to run twice). */
export async function chargeRiderPenalties(db: Db, now: Date = new Date()) {
  const due = await db.violation.findMany({
    where: {
      status: 'final',
      payrollEntryId: null,
      deductionPiastres: null,
      penalty: { in: ['deduction_days', 'deduction_amount'] },
      employee: { payBasis: 'per_delivery' },
    },
    select: { id: true },
    take: 200,
  });
  let charged = 0;
  for (const v of due)
    await inTransaction(db, async (tx) => {
      if (await chargeRiderPenalty(tx, v.id, now)) charged++;
    });
  return { charged };
}
