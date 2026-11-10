import type { Prisma } from '@prisma/client';
import {
  addDays,
  bucketCash,
  cairoDay,
  cairoDayStart,
  type CashPiece,
  egpText,
  heldPieces,
  isMonth,
  MANUAL_MONTH_END_ITEMS,
  MONTH_END_ITEMS,
  type MonthEndItem,
  nextPayoutDay,
  pettyCashLabel,
  type PettyCashStatus,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { getSetting } from '../settings';
import { addMonths } from './assets';
import { chartOfAccounts } from './books';
import { attachReceipt, queueRequest, RECEIPT_KINDS } from './controls';
import { FEE_KINDS } from './invoices';
import { balanceOf, lockedBalance, post } from './ledger';

type Tx = Prisma.TransactionClient;

// Cash controls (CLAUDE.md, "Cash controls"): how much cash a rider may carry and for how long,
// petty cash paid from a store's box, the daily cash position, and the month end checklist.
//
//   rider collects COD ──▶ rider cash (1300) ──handover──▶ store box (1200) ──deposit──▶ bank
//        └ hand over refused past finance.rider_cash_limit_piastres unless a store manager
//          overrides with a reason; an alert once a day when cash is older than the max hours
//   store box ──petty cash (receipt photo)──▶ expense, at once or after finance approves

// ─── rider cash ─────────────────────────────────────────────────────────────────

/** The cash a rider holds now, split by when it was collected (oldest handed in first). */
export async function riderCashPieces(db: Db, riderId: string) {
  const balance = await balanceOf(db, { type: 'rider_cash', riderId });
  if (balance <= 0) return { balancePiastres: Math.max(0, balance), pieces: [] as CashPiece[] };
  const lines = await db.ledgerLine.findMany({
    where: { account: { key: `rider_cash:${riderId}` }, amountPiastres: { gt: 0 } },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    select: { amountPiastres: true, occurredAt: true },
    take: 1000,
  });
  return {
    balancePiastres: balance,
    pieces: heldPieces(
      balance,
      lines.map((l) => ({ amountPiastres: l.amountPiastres, at: l.occurredAt })),
    ),
  };
}

/** Riders holding cash (optionally of some stores), each with what they hold and since when. */
export async function ridersHoldingCash(db: Db, stores?: string[] | null) {
  const accounts = await db.ledgerAccount.findMany({
    where: { type: 'rider_cash', riderId: { not: null } },
    select: { id: true, riderId: true },
  });
  const sums = await db.ledgerLine.groupBy({
    by: ['accountId'],
    where: { accountId: { in: accounts.map((a) => a.id) } },
    _sum: { amountPiastres: true },
  });
  const holding = accounts.filter(
    (a) => (sums.find((s) => s.accountId === a.id)?._sum.amountPiastres ?? 0) > 0,
  );
  const riders = await db.rider.findMany({
    where: {
      id: { in: holding.map((a) => a.riderId!) },
      ...(stores ? { darkStoreId: { in: stores } } : {}),
    },
    include: {
      user: { select: { name: true } },
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
    },
    orderBy: { badgeCode: 'asc' },
  });
  const out = [];
  for (const r of riders) {
    const held = await riderCashPieces(db, r.id);
    if (held.balancePiastres <= 0) continue;
    out.push({
      riderId: r.id,
      name: r.user.name,
      badgeCode: r.badgeCode,
      store: r.darkStore,
      cashPiastres: held.balancePiastres,
      pieces: held.pieces,
      heldSince: new Date(Math.min(...held.pieces.map((p) => p.at.getTime()))),
    });
  }
  return out;
}

/**
 * Before a cash on delivery order goes to a rider: the cash they would then hold (their
 * rider cash balance plus the COD of every order they carry, this one included) must stay
 * within finance.rider_cash_limit_piastres for the store. Past it a store manager may still
 * hand it over with a reason, which is audited. Locks the rider so two hand overs at once
 * cannot both pass. Returns what was checked.
 */
export async function checkRiderCashLimit(
  tx: Tx,
  input: {
    riderId: string;
    darkStoreId: string;
    orderId: string;
    orderCodPiastres: number;
    overrideReason?: string | null;
    actorUserId: string | null;
  },
) {
  if (input.orderCodPiastres <= 0) return { checked: false as const };
  const limit = await getSetting(tx, 'finance.rider_cash_limit_piastres', input.darkStoreId);
  if (limit <= 0) return { checked: false as const };
  await tx.$queryRaw`SELECT id FROM riders WHERE id = ${input.riderId} FOR UPDATE`;
  const cash = Math.max(0, await balanceOf(tx, { type: 'rider_cash', riderId: input.riderId }));
  const carried = await tx.delivery.aggregate({
    where: { riderId: input.riderId, status: { in: ['assigned', 'picked_up'] } },
    _sum: { codExpectedPiastres: true },
  });
  const carrying = carried._sum.codExpectedPiastres ?? 0;
  const total = cash + carrying + input.orderCodPiastres;
  if (total <= limit) return { checked: true as const, overridden: false, totalPiastres: total };
  const reason = input.overrideReason?.trim() ?? '';
  if (reason.length < 5)
    throw new DomainError('rider_cash_limit', 409, {
      limitPiastres: limit,
      cashPiastres: cash,
      carryingPiastres: carrying,
      orderCodPiastres: input.orderCodPiastres,
      totalPiastres: total,
    });
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    action: 'order.rider_cash_override',
    entityType: 'order',
    entityId: input.orderId,
    before: { limitPiastres: limit, cashPiastres: cash, carryingPiastres: carrying },
    after: { riderId: input.riderId, totalPiastres: total, reason },
  });
  return { checked: true as const, overridden: true, totalPiastres: total, reason };
}

/**
 * One rider_cash_overdue alert per rider and Cairo day while cash older than
 * finance.rider_cash_max_hours (the rider's store) is not handed in. Safe to run any number
 * of times: the alert key holds the rider and the day.
 */
export async function checkRiderCashOverdue(db: Db, now: Date = new Date()) {
  const day = cairoDay(now);
  let raised = 0;
  for (const r of await ridersHoldingCash(db)) {
    const maxHours = await getSetting(db, 'finance.rider_cash_max_hours', r.store.id);
    const overdue = r.pieces
      .filter((p) => now.getTime() - p.at.getTime() > maxHours * 3_600_000)
      .reduce((s, p) => s + p.amountPiastres, 0);
    if (overdue <= 0) continue;
    const created = await db.alert.createMany({
      data: [
        {
          type: 'rider_cash_overdue',
          key: `rider_cash_overdue:${r.riderId}:${day}`,
          darkStoreId: r.store.id,
          data: {
            riderId: r.riderId,
            rider: r.name,
            badge: r.badgeCode,
            amountPiastres: r.cashPiastres,
            overduePiastres: overdue,
            amountEgp: egpText(r.cashPiastres),
            hours: maxHours,
            since: r.heldSince.toISOString(),
          },
        },
      ],
      skipDuplicates: true,
    });
    raised += created.count;
  }
  return { raised };
}

/** A store's riders holding cash: amount, since when, and whether it is overdue. */
export async function storeRiderCash(db: Db, darkStoreId: string, now: Date = new Date()) {
  const [maxHours, limit] = await Promise.all([
    getSetting(db, 'finance.rider_cash_max_hours', darkStoreId),
    getSetting(db, 'finance.rider_cash_limit_piastres', darkStoreId),
  ]);
  const riders = await ridersHoldingCash(db, [darkStoreId]);
  return {
    maxHours,
    limitPiastres: limit,
    riders: riders.map((r) => ({
      riderId: r.riderId,
      name: r.name,
      badgeCode: r.badgeCode,
      cashPiastres: r.cashPiastres,
      heldSince: r.heldSince,
      overdue: now.getTime() - r.heldSince.getTime() > maxHours * 3_600_000,
    })),
  };
}

// ─── the daily cash position ────────────────────────────────────────────────────

/**
 * Where the money is now: every bank and cash box (store boxes included), the cash each rider
 * holds by age, what we owe merchants with their next payout day, bills due within a week,
 * and the net of it all. A person limited to some stores sees only those stores' boxes and
 * riders; company wide parts (banks, merchants, bills, the net) are left out for them.
 */
export async function cashPosition(
  db: Db,
  input: { stores: string[] | null; now?: Date } = { stores: null },
) {
  const now = input.now ?? new Date();
  const today = cairoDay(now);
  const limited = input.stores !== null;
  const warnHours = await getSetting(db, 'finance.rider_cash_warn_hours');

  const chart = await chartOfAccounts(db, { includeInactive: true });
  const owners = await db.ledgerAccount.findMany({
    where: { groupCode: { in: [1100, 1200] } },
    select: { id: true, darkStoreId: true, type: true },
  });
  const money = chart
    .filter((a) => a.groupCode === 1100 || a.groupCode === 1200)
    .map((a) => {
      const o = owners.find((x) => x.id === a.id);
      return {
        id: a.id,
        code: a.code,
        nameEn: a.nameEn,
        nameAr: a.nameAr,
        kind:
          a.groupCode === 1100
            ? ('bank' as const)
            : o?.darkStoreId
              ? ('store_box' as const)
              : ('cash_box' as const),
        darkStoreId: o?.darkStoreId ?? null,
        isActive: a.isActive,
        balancePiastres: a.balancePiastres,
      };
    })
    .filter((a) => a.isActive || a.balancePiastres !== 0)
    .filter((a) => !limited || (a.darkStoreId !== null && input.stores!.includes(a.darkStoreId)));

  const riders = [];
  for (const r of await ridersHoldingCash(db, input.stores)) {
    const maxHours = await getSetting(db, 'finance.rider_cash_max_hours', r.store.id);
    const buckets = bucketCash(r.pieces, now, Math.min(warnHours, maxHours), maxHours);
    riders.push({
      riderId: r.riderId,
      name: r.name,
      badgeCode: r.badgeCode,
      store: r.store,
      cashPiastres: r.cashPiastres,
      freshPiastres: buckets.fresh,
      agingPiastres: buckets.aging,
      overduePiastres: buckets.overdue,
      heldSince: r.heldSince,
      maxHours,
    });
  }
  const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
  const moneyTotal = sum(money, (a) => a.balancePiastres);
  const riderTotal = sum(riders, (r) => r.cashPiastres);

  let merchants = null;
  let bills = null;
  if (!limited) {
    const wallets = await db.ledgerAccount.findMany({
      where: { type: 'merchant', merchantId: { not: null } },
      select: { id: true, merchantId: true },
    });
    const sums = await db.ledgerLine.groupBy({
      by: ['accountId'],
      where: { accountId: { in: wallets.map((w) => w.id) } },
      _sum: { amountPiastres: true },
    });
    const owed = new Map(
      wallets.map((w) => [
        w.merchantId!,
        0 - (sums.find((s) => s.accountId === w.id)?._sum.amountPiastres ?? 0),
      ]),
    );
    const list = await db.merchant.findMany({
      where: { id: { in: [...owed.keys()] } },
      select: {
        id: true,
        name: true,
        payoutSchedule: true,
        payouts: { where: { status: 'draft' }, select: { amountPiastres: true } },
      },
      orderBy: { name: 'asc' },
    });
    const rows = list
      .map((m) => ({
        id: m.id,
        name: m.name,
        owedPiastres: owed.get(m.id) ?? 0,
        schedule: m.payoutSchedule,
        nextPayoutDay: nextPayoutDay(m.payoutSchedule, today),
        draftPiastres: sum(m.payouts, (p) => p.amountPiastres),
      }))
      .filter((m) => m.owedPiastres > 0)
      .sort(
        (a, b) => a.nextPayoutDay.localeCompare(b.nextPayoutDay) || b.owedPiastres - a.owedPiastres,
      );
    merchants = {
      rows,
      totalPiastres: sum(rows, (m) => m.owedPiastres),
      owingUsPiastres: sum(
        [...owed.values()].filter((v) => v < 0),
        (v) => 0 - v,
      ),
    };

    const until = new Date(`${addDays(today, 7)}T00:00:00Z`);
    const open = await db.bill.findMany({
      where: { status: 'open', dueDate: { lte: until } },
      include: { supplier: { select: { name: true } } },
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
    });
    const billRows = open
      .map((b) => {
        const due = b.dueDate.toISOString().slice(0, 10);
        return {
          id: b.id,
          number: b.number,
          supplier: b.supplier.name,
          reference: b.reference,
          dueDate: due,
          overdue: due < today,
          leftPiastres: b.totalPiastres - b.paidPiastres,
        };
      })
      .filter((b) => b.leftPiastres > 0);
    bills = { rows: billRows, totalPiastres: sum(billRows, (b) => b.leftPiastres) };
  }

  return {
    asOf: now,
    today,
    scope: limited ? ('stores' as const) : ('all' as const),
    warnHours,
    money: {
      rows: money,
      bankPiastres: sum(
        money.filter((a) => a.kind === 'bank'),
        (a) => a.balancePiastres,
      ),
      boxPiastres: sum(
        money.filter((a) => a.kind !== 'bank'),
        (a) => a.balancePiastres,
      ),
      totalPiastres: moneyTotal,
    },
    riders: {
      rows: riders,
      totalPiastres: riderTotal,
      freshPiastres: sum(riders, (r) => r.freshPiastres),
      agingPiastres: sum(riders, (r) => r.agingPiastres),
      overduePiastres: sum(riders, (r) => r.overduePiastres),
    },
    merchants,
    bills,
    netPiastres:
      merchants && bills
        ? moneyTotal + riderTotal - merchants.totalPiastres - bills.totalPiastres
        : null,
  };
}

// ─── petty cash ─────────────────────────────────────────────────────────────────

const EXPENSE_GROUPS = [5400, 5500];

/** Expense categories, and which of them store staff may use for petty cash. */
export async function pettyCategories(db: Db, onlyPetty = false) {
  const rows = await db.ledgerAccount.findMany({
    where: {
      groupCode: { in: EXPENSE_GROUPS },
      isActive: true,
      ...(onlyPetty ? { petty: true } : {}),
    },
    select: { id: true, code: true, nameEn: true, nameAr: true, petty: true },
    orderBy: { code: 'asc' },
  });
  return rows.map((r) => ({
    ...r,
    nameEn: r.nameEn ?? r.code,
    nameAr: r.nameAr ?? r.nameEn ?? '',
  }));
}

/** Finance marks an expense category as one store staff may choose (audited). */
export function setPettyCategory(
  db: Db,
  input: { accountId: string; petty: boolean; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.ledgerAccount.findUnique({ where: { id: input.accountId } });
    if (!before || !EXPENSE_GROUPS.includes(before.groupCode))
      throw new DomainError('expense_account_not_found', 404);
    if (before.petty === input.petty) return { petty: before.petty };
    await tx.ledgerAccount.update({ where: { id: before.id }, data: { petty: input.petty } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.petty_category',
      entityType: 'ledger_account',
      entityId: before.id,
      before: { petty: before.petty },
      after: { petty: input.petty },
    });
    return { petty: input.petty };
  });
}

async function nextPettyNumber(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('number:petty_cash_expenses'))`;
  const last = await tx.pettyCashExpense.findFirst({
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  return (last?.number ?? 0) + 1;
}

/**
 * Locks the store's cash box (its ledger_accounts row, as every payment from a bank or box
 * does) and reads what it holds.
 */
async function lockedBox(tx: Tx, darkStoreId: string) {
  return (await lockedBalance(tx, { type: 'store_cash', darkStoreId })).balance;
}

type PettyRow = Prisma.PettyCashExpenseGetPayload<object>;

/** Posts a petty expense: the expense category against the store's cash box, tagged to the store. */
async function postPetty(tx: Tx, row: PettyRow, actorUserId: string) {
  const entry = await post(tx, {
    kind: 'petty_cash',
    idempotencyKey: `petty:${row.id}`,
    darkStoreId: row.darkStoreId,
    createdById: actorUserId,
    memo: `${pettyCashLabel(row.number)} ${row.note}`,
    data: { pettyCashId: row.id, number: row.number },
    lines: [
      { account: { id: row.expenseAccountId }, amount: row.amountPiastres },
      {
        account: { type: 'store_cash', darkStoreId: row.darkStoreId },
        amount: -row.amountPiastres,
      },
    ],
  });
  await tx.pettyCashExpense.update({ where: { id: row.id }, data: { entryId: entry!.id } });
  return entry!;
}

/**
 * Store staff pay a small expense from the store's cash box, with a receipt photo. Never more
 * than the box holds. Above finance.petty_cash_limit_piastres, or when the box would keep less
 * than finance.petty_cash_float_piastres, it waits for finance (a second person); otherwise it
 * is posted at once. The same idempotency key records it once.
 */
export async function submitPettyCash(
  db: Db,
  input: {
    darkStoreId: string;
    expenseAccountId: string;
    amountPiastres: number;
    note: string;
    photoId: string;
    actorUserId: string;
    idempotencyKey: string;
  },
) {
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  const note = input.note.trim();
  if (note.length < 3) throw new DomainError('note_required', 400);
  return inTransaction(db, async (tx) => {
    const seen = await tx.pettyCashExpense.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { request: { select: { status: true } } },
    });
    if (seen) return { id: seen.id, number: seen.number, status: pettyStatusOf(seen) };
    const store = await tx.darkStore.findUnique({ where: { id: input.darkStoreId } });
    if (!store) throw new DomainError('dark_store_not_found', 404);
    const account = await tx.ledgerAccount.findUnique({ where: { id: input.expenseAccountId } });
    if (
      !account ||
      !account.petty ||
      !account.isActive ||
      !EXPENSE_GROUPS.includes(account.groupCode)
    )
      throw new DomainError('petty_category_not_found', 404);
    const photo = await tx.photo.findUnique({
      where: { id: input.photoId },
      select: { kind: true },
    });
    if (!photo || photo.kind !== 'receipt') throw new DomainError('receipt_required', 400);
    const box = await lockedBox(tx, store.id);
    if (input.amountPiastres > box)
      throw new DomainError('not_enough_cash_in_box', 409, { boxPiastres: Math.max(0, box) });
    const limit = await getSetting(tx, 'finance.petty_cash_limit_piastres', store.id);
    const float = await getSetting(tx, 'finance.petty_cash_float_piastres', store.id);
    const overLimit = limit > 0 && input.amountPiastres > limit;
    const belowFloat = box - input.amountPiastres < float;
    const row = await tx.pettyCashExpense.create({
      data: {
        number: await nextPettyNumber(tx),
        darkStoreId: store.id,
        expenseAccountId: account.id,
        amountPiastres: input.amountPiastres,
        note,
        photoId: input.photoId,
        idempotencyKey: input.idempotencyKey,
        createdById: input.actorUserId,
      },
    });
    let status: PettyCashStatus;
    if (overLimit || belowFloat) {
      const request = await queueRequest(
        tx,
        {
          kind: 'petty_cash',
          input: {
            pettyCashId: row.id,
            amountPiastres: row.amountPiastres,
            reference: pettyCashLabel(row.number),
            memo: note,
            darkStoreId: store.id,
            idempotencyKey: `petty:${row.id}`,
          },
        },
        input.actorUserId,
        input.photoId,
      );
      await tx.pettyCashExpense.update({ where: { id: row.id }, data: { requestId: request.id } });
      status = 'pending';
    } else {
      const entry = await postPetty(tx, row, input.actorUserId);
      await attachReceipt(tx, {
        entryId: entry.id,
        photoId: input.photoId,
        actorUserId: input.actorUserId,
      });
      status = 'posted';
    }
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'store.petty_cash',
      entityType: 'petty_cash',
      entityId: row.id,
      after: {
        number: pettyCashLabel(row.number),
        darkStoreId: store.id,
        account: account.code,
        amount: row.amountPiastres,
        status,
        ...(status === 'pending' ? { overLimit, belowFloat } : {}),
      },
    });
    return { id: row.id, number: row.number, status };
  });
}

/** Finance approved a waiting petty expense: posted now, if the box still holds the money. */
export function postApprovedPettyCash(db: Db, input: { pettyCashId: string; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM petty_cash_expenses WHERE id = ${input.pettyCashId} FOR UPDATE`;
    const row = await tx.pettyCashExpense.findUnique({ where: { id: input.pettyCashId } });
    if (!row) throw new DomainError('petty_cash_not_found', 404);
    if (row.entryId) return (await tx.ledgerEntry.findUnique({ where: { id: row.entryId } }))!;
    const box = await lockedBox(tx, row.darkStoreId);
    if (row.amountPiastres > box)
      throw new DomainError('not_enough_cash_in_box', 409, { boxPiastres: Math.max(0, box) });
    return postPetty(tx, row, input.actorUserId);
  });
}

/** Finance takes back a posted petty expense with a reason: the money returns to the box. */
export async function reversePettyCash(
  db: Db,
  input: { pettyCashId: string; reason: string; actorUserId: string },
) {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError('reason_required', 400);
  return inTransaction(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM petty_cash_expenses WHERE id = ${input.pettyCashId} FOR UPDATE`;
    const row = await tx.pettyCashExpense.findUnique({ where: { id: input.pettyCashId } });
    if (!row) throw new DomainError('petty_cash_not_found', 404);
    if (!row.entryId) throw new DomainError('petty_cash_not_posted');
    if (row.reversalEntryId) throw new DomainError('petty_cash_reversed');
    const entry = await post(tx, {
      kind: 'petty_cash_reversal',
      idempotencyKey: `petty_reversal:${row.id}`,
      darkStoreId: row.darkStoreId,
      createdById: input.actorUserId,
      memo: `${pettyCashLabel(row.number)} ${reason}`,
      data: { pettyCashId: row.id, number: row.number, reason },
      lines: [
        {
          account: { type: 'store_cash', darkStoreId: row.darkStoreId },
          amount: row.amountPiastres,
        },
        { account: { id: row.expenseAccountId }, amount: -row.amountPiastres },
      ],
    });
    await tx.pettyCashExpense.update({
      where: { id: row.id },
      data: {
        reversalEntryId: entry!.id,
        reversedById: input.actorUserId,
        reversedAt: new Date(),
        reverseReason: reason,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.petty_cash_reverse',
      entityType: 'petty_cash',
      entityId: row.id,
      before: { status: 'posted' },
      after: { status: 'reversed', reason, entryId: entry!.id },
    });
    return { status: 'reversed' as const, entryId: entry!.id };
  });
}

export function pettyStatusOf(row: {
  entryId: string | null;
  reversalEntryId: string | null;
  request?: { status: string } | null;
}): PettyCashStatus {
  if (row.reversalEntryId) return 'reversed';
  if (row.entryId) return 'posted';
  const s = row.request?.status;
  if (s === 'rejected' || s === 'cancelled') return s;
  return 'pending';
}

/** Petty expenses, newest first, optionally of some stores and one status. */
export async function listPettyCash(
  db: Db,
  filter: {
    darkStoreId?: string | { in: string[] };
    status?: PettyCashStatus;
    from?: Date;
    to?: Date;
    take?: number;
  } = {},
) {
  const rows = await db.pettyCashExpense.findMany({
    where: {
      darkStoreId: filter.darkStoreId,
      createdAt: { gte: filter.from, lt: filter.to },
    },
    include: {
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      expenseAccount: { select: { code: true, nameEn: true, nameAr: true } },
      createdBy: { select: { name: true } },
      reversedBy: { select: { name: true } },
      request: { select: { id: true, status: true, decisionNote: true } },
      entry: { select: { number: true } },
      reversalEntry: { select: { number: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: filter.take ?? 300,
  });
  return rows
    .map((r) => ({
      id: r.id,
      number: r.number,
      label: pettyCashLabel(r.number),
      store: r.darkStore,
      category: r.expenseAccount,
      amountPiastres: r.amountPiastres,
      note: r.note,
      photoId: r.photoId,
      status: pettyStatusOf(r),
      createdAt: r.createdAt,
      by: r.createdBy.name,
      entryNumber: r.entry?.number ?? null,
      requestId: r.request?.id ?? null,
      decisionNote: r.request?.decisionNote ?? null,
      reversedAt: r.reversedAt,
      reversedBy: r.reversedBy?.name ?? null,
      reverseReason: r.reverseReason,
      reversalNumber: r.reversalEntry?.number ?? null,
    }))
    .filter((r) => !filter.status || r.status === filter.status);
}

/** What the store's petty cash form needs: categories, the box, the limits and recent ones. */
export async function storePettyCash(db: Db, darkStoreId: string) {
  const [categories, box, limit, float, recent] = await Promise.all([
    pettyCategories(db, true),
    balanceOf(db, { type: 'store_cash', darkStoreId }),
    getSetting(db, 'finance.petty_cash_limit_piastres', darkStoreId),
    getSetting(db, 'finance.petty_cash_float_piastres', darkStoreId),
    listPettyCash(db, { darkStoreId, take: 20 }),
  ]);
  return {
    categories: categories.map(({ petty: _petty, ...c }) => c),
    boxPiastres: box,
    limitPiastres: limit,
    floatPiastres: float,
    recent,
  };
}

// ─── month end ──────────────────────────────────────────────────────────────────

const monthStart = (month: string) => cairoDayStart(`${month}-01`);
const lastDayOf = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);
const dateOnly = (day: string) => new Date(`${day}T00:00:00Z`);

export interface MonthEndRow {
  id: MonthEndItem;
  /** Checked by the system (true) or ticked by hand only (false) */
  automatic: boolean;
  /** How many things are still open (0 when done by itself) */
  left: number;
  /** Cannot be finished before the month is over */
  notYet: boolean;
  done: boolean;
  mark: { note: string; by: string; at: Date } | null;
}

/**
 * The month end checklist, checked live: cash handovers counted and differences settled, bank
 * lines matched, receipts on money movements, petty cash decided, tax invoices issued, payroll
 * run, storage and depreciation charged, the VAT return (ticked by hand) and the books closed.
 * Any item but the last may be marked done by hand with a note.
 */
export async function monthEndChecklist(db: Db, month: string, now: Date = new Date()) {
  if (!isMonth(month)) throw new DomainError('invalid_month', 400);
  const today = cairoDay(now);
  const from = monthStart(month);
  const to = monthStart(addMonths(month, 1));
  const last = lastDayOf(month);
  const over = today > last;
  const marks = await db.monthEndMark.findMany({
    where: { month },
    include: { markedBy: { select: { name: true } } },
  });

  // Cash: handover differences still waiting, and riders still holding cash collected in the
  // month (or before it).
  const pendingHandovers = await db.cashHandover.count({
    where: { status: 'pending', createdAt: { lt: to } },
  });
  const holding = (await ridersHoldingCash(db)).filter((r) =>
    r.pieces.some((p) => p.at < to),
  ).length;

  const unmatched = await db.bankStatementLine.count({
    where: { status: 'unmatched', day: { gte: dateOnly(`${month}-01`), lte: dateOnly(last) } },
  });

  const [receipts] = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM ledger_entries e
     WHERE e.kind = ANY($1) AND e.occurred_at >= $2 AND e.occurred_at < $3
       AND NOT EXISTS (SELECT 1 FROM finance_receipts r WHERE r.entry_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM finance_receipts r JOIN finance_requests q ON q.id = r.request_id
                       WHERE q.entry_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM finance_receipts r WHERE r.payout_id = e.data->>'payoutId')`,
    RECEIPT_KINDS,
    from,
    to,
  );

  const pettyWaiting = await db.pettyCashExpense.count({
    where: { createdAt: { lt: to }, entryId: null, request: { status: 'pending' } },
  });

  let invoicesLeft = 0;
  if (over) {
    const [row] = await db.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT l.merchant_id) AS n
      FROM ledger_lines l
        JOIN ledger_accounts a ON a.id = l.account_id
        JOIN ledger_entries e ON e.id = l.entry_id
      WHERE a.key = 'revenue' AND e.kind = ANY(${Object.keys(FEE_KINDS)})
        AND l.merchant_id IS NOT NULL AND l.occurred_at >= ${from} AND l.occurred_at < ${to}
        AND NOT EXISTS (SELECT 1 FROM tax_invoices t
          WHERE t.type = 'invoice' AND t.merchant_id = l.merchant_id AND t.period_month = ${month})`;
    invoicesLeft = Number(row?.n ?? 0);
  }

  let payrollLeft = 0;
  if (
    over &&
    !(await db.ledgerEntry.findUnique({ where: { idempotencyKey: `payroll:${month}` } }))
  ) {
    const packages = await db.salaryPackage.count({
      where: { effectiveFrom: { lte: dateOnly(last) } },
    });
    payrollLeft = packages > 0 ? 1 : 0;
  }

  // Storage is charged for every day that ended with stock in a store; a day without any
  // charge counts as missing once the system has charged storage at least once.
  let storageLeft = 0;
  const firstCharge = await db.ledgerEntry.findFirst({
    where: { kind: 'storage_fee' },
    orderBy: { occurredAt: 'asc' },
    select: { occurredAt: true },
  });
  const anyStock = await db.binStock.count({ where: { quantity: { gt: 0 } } });
  if (firstCharge || anyStock > 0) {
    const charged = new Set(
      (
        await db.$queryRaw<{ day: string }[]>`
          SELECT DISTINCT e.data->>'day' AS day FROM ledger_entries e
          WHERE e.kind = 'storage_fee' AND e.occurred_at >= ${from} AND e.occurred_at < ${to}`
      ).map((r) => r.day),
    );
    const startDay = firstCharge ? cairoDay(firstCharge.occurredAt) : `${month}-01`;
    const yesterday = addDays(today, -1);
    for (let d = `${month}-01`; d <= last && d <= yesterday; d = addDays(d, 1))
      if (d >= startDay && !charged.has(d)) storageLeft++;
  }

  let deprLeft = 0;
  if (over) {
    const keys: string[] = [];
    for (const p of await db.prepayment.findMany())
      if (p.startMonth <= month && month < addMonths(p.startMonth, p.months))
        keys.push(`prepaid:${p.id}:${month}`);
    for (const a of await db.fixedAsset.findMany()) {
      const disposedMonth = a.disposedAt ? cairoDay(a.disposedAt).slice(0, 7) : null;
      if (
        a.startMonth <= month &&
        month < addMonths(a.startMonth, a.lifeMonths) &&
        (!disposedMonth || month < disposedMonth)
      )
        keys.push(`depr:${a.id}:${month}`);
    }
    const found = keys.length
      ? await db.ledgerEntry.count({ where: { idempotencyKey: { in: keys } } })
      : 0;
    deprLeft = keys.length - found;
  }

  const lock = await db.booksLock.findUnique({ where: { id: 'books' } });
  const closedThrough = lock ? lock.closedThrough.toISOString().slice(0, 10) : null;

  const left: Record<MonthEndItem, number> = {
    cash_handovers: pendingHandovers + holding,
    bank_lines: unmatched,
    receipts: Number(receipts?.n ?? 0),
    petty_cash: pettyWaiting,
    invoices: invoicesLeft,
    payroll: payrollLeft,
    storage: storageLeft,
    depreciation: deprLeft,
    vat_return: 1,
    books_closed: closedThrough && closedThrough >= last ? 0 : 1,
  };
  const waitsForMonthEnd = new Set<MonthEndItem>([
    'invoices',
    'payroll',
    'depreciation',
    'vat_return',
    'books_closed',
  ]);
  const items: MonthEndRow[] = MONTH_END_ITEMS.map((id) => {
    const automatic = !MANUAL_MONTH_END_ITEMS.includes(id);
    const m = marks.find((x) => x.item === id);
    const notYet = !over && waitsForMonthEnd.has(id);
    const auto = automatic && !notYet && left[id] === 0;
    return {
      id,
      automatic,
      left: automatic ? left[id] : 0,
      notYet,
      done: auto || (!!m && id !== 'books_closed'),
      mark: m ? { note: m.note, by: m.markedBy.name, at: m.markedAt } : null,
    };
  });
  return {
    month,
    lastDay: last,
    over,
    closedThrough,
    items,
    /** Every item before closing the books is done */
    readyToClose: over && items.every((i) => i.id === 'books_closed' || i.done),
    pending: { handovers: pendingHandovers, ridersHolding: holding },
  };
}

/** Finance ticks an item by hand with a note (the VAT return, or an exception explained). */
export async function markMonthEndItem(
  db: Db,
  input: { month: string; item: MonthEndItem; note: string; actorUserId: string },
) {
  if (!isMonth(input.month)) throw new DomainError('invalid_month', 400);
  if (input.item === 'books_closed') throw new DomainError('invalid_item', 400);
  const note = input.note.trim();
  if (note.length < 3) throw new DomainError('note_required', 400);
  return inTransaction(db, async (tx) => {
    const before = await tx.monthEndMark.findUnique({
      where: { month_item: { month: input.month, item: input.item } },
    });
    const mark = await tx.monthEndMark.upsert({
      where: { month_item: { month: input.month, item: input.item } },
      create: { month: input.month, item: input.item, note, markedById: input.actorUserId },
      update: { note, markedById: input.actorUserId, markedAt: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.month_end_mark',
      entityType: 'month_end',
      entityId: input.month,
      before: before ? { item: before.item, note: before.note } : null,
      after: { item: input.item, note },
    });
    return { id: mark.id };
  });
}

/** Takes a hand tick back (audited). */
export function unmarkMonthEndItem(
  db: Db,
  input: { month: string; item: MonthEndItem; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.monthEndMark.findUnique({
      where: { month_item: { month: input.month, item: input.item } },
    });
    if (!before) throw new DomainError('mark_not_found', 404);
    await tx.monthEndMark.delete({ where: { id: before.id } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.month_end_unmark',
      entityType: 'month_end',
      entityId: input.month,
      before: { item: before.item, note: before.note },
      after: null,
    });
    return { removed: true };
  });
}
