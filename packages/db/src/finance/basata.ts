import { Prisma } from '@prisma/client';
import {
  addDays,
  basataDepositNumber,
  type BasataDepositBody,
  type BasataDepositStatus,
  basataSettlementNumber,
  type BasataSettlementBody,
  cairoAt,
  cairoDay,
  deadlineDayOf,
  depositDeadline,
  egpText,
  type FreezeReason,
  isCalendarDay,
  lastDeadlineDay,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { getSetting } from '../settings';
import { type AccountRef, balanceOf, lockedBalance, nextNumber, post } from './ledger';
import { bankAccount, cashToHandIn } from './operations';
import { riderOfficeOf } from './rider-offices';

type Tx = Prisma.TransactionClient;

// Basata cash deposits (owner, 2026-11-11). The company goes cashless: riders deposit the cash
// they collected at a Basata branch; Basata sends one transfer a day to our bank less its fee,
// which the company pays. No Basata API yet: Accounting reviews each receipt photo.
//
//   rider deposits at Basata ──BD-000001 (photo, reference)──▶ pending
//        approve: Dr Money at Basata (1200)        amount
//                 Cr 1300 rider cash               the part the rider still holds
//                 Cr office wallet 2500 / 1350     what an earlier deadline took, given back
//        reject:  no money; past its deadline the deadline rule applies at once
//   Basata transfer ──BT-000001──▶ Dr bank (received), Dr Basata fees, Cr Money at Basata
//
// The deadline (cash.deposit_deadline_hour, Cairo): cash a rider still holds then (rider cash
// at that instant less deposits sent before it and not refused by then, less handover
// differences still waiting for finance) is taken from them, to their rider office's wallet
// (Dr 2500, Cr 1300: the office now owes it) or their own dues (Dr 1350, Cr 1300: taken from
// their next withdrawal), and the rider is frozen: no orders, no withdrawals, until Accounting
// unfreezes them with a reason.

const DEPOSIT_KIND = 'basata_deposit';
const DEADLINE_KIND = 'basata_deadline_charge';
const SETTLEMENT_KIND = 'basata_settlement';

const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);
const dayText = (d: Date) => d.toISOString().slice(0, 10);

/** Basata references are compared without spaces and case ("ab 12" is "AB12"). */
export const normalizeReference = (text: string) => text.replace(/\s+/g, '').toUpperCase();

// ─── what a rider holds ──────────────────────────────────────────────────────────

/** Deposits a rider sent that Accounting has not decided yet. */
export async function pendingBasataPiastres(db: Db, riderId: string) {
  const sum = await db.basataDeposit.aggregate({
    where: { riderId, status: 'pending' },
    _sum: { amountPiastres: true },
  });
  return sum._sum.amountPiastres ?? 0;
}

/** Cash the rider holds now: rider cash less handover differences still waiting for finance. */
async function cashHeldNow(db: Db, riderId: string) {
  const pending = await db.cashHandover.aggregate({
    where: { riderId, status: 'pending' },
    _sum: { differencePiastres: true },
  });
  const cash = await balanceOf(db, { type: 'rider_cash', riderId });
  return Math.max(0, cash - (pending._sum.differencePiastres ?? 0));
}

/** Deadline deductions not given back yet, oldest first. */
async function openDeductions(db: Db, riderId: string) {
  const rows = await db.riderCashDeduction.findMany({
    where: { riderId, amountPiastres: { gt: 0 } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.filter((d) => d.amountPiastres > d.givenBackPiastres);
}

/** What the deadline took from a rider and was not given back by a later deposit yet. */
export async function deductedNotGivenBack(db: Db, riderId: string) {
  const rows = await openDeductions(db, riderId);
  return rows.reduce((s, d) => s + d.amountPiastres - d.givenBackPiastres, 0);
}

/**
 * The most a rider may deposit now: the cash they must hand in (cashToHandIn: rider cash less
 * waiting handover differences and their deposits still waiting) plus what a deadline took
 * from them and no deposit gave back yet (a late deposit gives it back).
 */
export async function maxBasataDeposit(db: Db, riderId: string) {
  const [toHandIn, deducted] = await Promise.all([
    cashToHandIn(db, riderId),
    deductedNotGivenBack(db, riderId),
  ]);
  return {
    toHandInPiastres: toHandIn,
    deductedPiastres: deducted,
    maxPiastres: toHandIn + deducted,
  };
}

// ─── the deposit ─────────────────────────────────────────────────────────────────

const depositInclude = {
  rider: {
    select: {
      id: true,
      badgeCode: true,
      userId: true,
      frozenAt: true,
      user: { select: { name: true } },
    },
  },
  darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  decidedBy: { select: { id: true, name: true } },
  entry: { select: { id: true, number: true } },
  settlement: { select: { id: true, number: true, receivedOn: true } },
} as const;
type DepositRow = Prisma.BasataDepositGetPayload<{ include: typeof depositInclude }>;

export function basataDepositView(d: DepositRow) {
  return {
    id: d.id,
    number: basataDepositNumber(d.number),
    status: d.status as BasataDepositStatus,
    rider: {
      id: d.rider.id,
      name: d.rider.user.name,
      badgeCode: d.rider.badgeCode,
      userId: d.rider.userId,
    },
    store: d.darkStore,
    darkStoreId: d.darkStoreId,
    amountPiastres: d.amountPiastres,
    reference: d.reference,
    depositedAt: d.depositedAt,
    photoId: d.photoId,
    deadlineDay: dayText(d.deadlineDay),
    decidedBy: d.decidedBy?.name ?? null,
    decidedById: d.decidedById,
    decidedAt: d.decidedAt,
    rejectReason: d.rejectReason,
    heldPiastres: d.heldPiastres,
    givenBackPiastres: d.givenBackPiastres,
    entry: d.entry,
    settlement: d.settlement
      ? {
          id: d.settlement.id,
          number: basataSettlementNumber(d.settlement.number),
          receivedOn: dayText(d.settlement.receivedOn),
        }
      : null,
    createdAt: d.createdAt,
  };
}
export type BasataDepositView = ReturnType<typeof basataDepositView>;

async function riderOfUserId(db: Db, userId: string) {
  const rider = await db.rider.findUnique({
    where: { userId },
    include: { user: { select: { isActive: true, name: true } } },
  });
  if (!rider) throw new DomainError('no_rider_profile', 403);
  return rider;
}

/**
 * A rider sends a deposit made at a Basata branch: the receipt photo (their own upload, kind
 * basata_receipt), the amount (never more than they must hand in plus what a deadline took and
 * was not given back), Basata's reference (never used twice) and when they deposited (default
 * now, never in the future). Refused while Basata is closed for the rider's store. The same
 * idempotency key records it once.
 */
export function submitBasataDeposit(
  db: Db,
  input: { riderUserId: string; body: BasataDepositBody; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const body = input.body;
    const rider = await riderOfUserId(tx, input.riderUserId);
    const seen = await tx.basataDeposit.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
      include: depositInclude,
    });
    if (seen) {
      if (seen.riderId !== rider.id) throw new DomainError('idempotency_key_reused');
      return basataDepositView(seen);
    }
    if (!rider.user.isActive) throw new DomainError('account_disabled', 403);
    if ((await getSetting(tx, 'cash.basata_enabled', rider.darkStoreId)) !== 1)
      throw new DomainError('basata_closed', 409);
    if (!Number.isSafeInteger(body.amountPiastres) || body.amountPiastres <= 0)
      throw new DomainError('invalid_amount', 400);
    const reference = normalizeReference(body.reference);
    if (reference.length < 3) throw new DomainError('reference_required', 400);
    const depositedAt = body.depositedAt ? new Date(body.depositedAt) : now;
    if (Number.isNaN(depositedAt.getTime())) throw new DomainError('invalid_time', 400);
    // A minute of slack for a phone clock a little ahead.
    if (depositedAt.getTime() > now.getTime() + 60_000)
      throw new DomainError('deposit_in_future', 400);
    const photo = await tx.photo.findUnique({
      where: { id: body.photoId },
      select: { kind: true, createdById: true },
    });
    // The receipt is the rider's own photo of a Basata receipt.
    if (!photo || photo.kind !== 'basata_receipt' || photo.createdById !== input.riderUserId)
      throw new DomainError('receipt_required', 400);
    // One rider at a time: two taps cannot both use the same cash.
    await tx.$queryRaw`SELECT id FROM riders WHERE id = ${rider.id} FOR UPDATE`;
    if (await tx.basataDeposit.findUnique({ where: { reference } }))
      throw new DomainError('reference_used', 409);
    const max = await maxBasataDeposit(tx, rider.id);
    if (body.amountPiastres > max.maxPiastres)
      throw new DomainError('more_than_cash', 409, { maxPiastres: max.maxPiastres });
    const hour = await getSetting(tx, 'cash.deposit_deadline_hour');
    let created: DepositRow;
    try {
      created = await tx.basataDeposit.create({
        data: {
          number: await nextNumber(tx, 'basata_deposits'),
          riderId: rider.id,
          darkStoreId: rider.darkStoreId,
          amountPiastres: body.amountPiastres,
          reference,
          depositedAt,
          photoId: body.photoId,
          deadlineDay: dayDate(deadlineDayOf(now, hour)),
          idempotencyKey: body.idempotencyKey,
          createdAt: now,
        },
        include: depositInclude,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new DomainError('reference_used', 409);
      throw error;
    }
    await recordAudit(tx, {
      actorUserId: input.riderUserId,
      action: 'basata_deposit.submit',
      entityType: 'basata_deposit',
      entityId: created.id,
      after: {
        number: basataDepositNumber(created.number),
        riderId: rider.id,
        amount: created.amountPiastres,
        reference,
        depositedAt: depositedAt.toISOString(),
        deadlineDay: dayText(created.deadlineDay),
      },
    });
    return basataDepositView(created);
  });
}

async function lockDeposit(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM basata_deposits WHERE id = ${id} FOR UPDATE`;
  const d = await tx.basataDeposit.findUnique({ where: { id }, include: depositInclude });
  if (!d) throw new DomainError('basata_deposit_not_found', 404);
  return d;
}

/**
 * Accounting approves a deposit after checking its receipt: one entry (key
 * basata_deposit:<id>) moves the money to Money at Basata, from the rider's cash for the part
 * they still hold; what is left gives back what a deadline took from them (oldest first: to
 * the office's wallet it was taken from, or to their dues; what their dues no longer hold,
 * because a withdrawal already took it, goes to their wallet). Never more than the cash held
 * plus what was taken (more_than_cash). Nobody approves their own deposit. Approving again
 * answers the same deposit. The rider stays frozen if a deadline froze them.
 */
export function approveBasataDeposit(
  db: Db,
  input: { depositId: string; actorUserId: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const d = await lockDeposit(tx, input.depositId);
    if (d.rider.userId === input.actorUserId) throw new DomainError('own_deposit', 403);
    if (d.status === 'approved') return basataDepositView(d);
    if (d.status !== 'pending') throw new DomainError('deposit_not_pending', 409);
    await tx.$queryRaw`SELECT id FROM riders WHERE id = ${d.riderId} FOR UPDATE`;
    const held = await cashHeldNow(tx, d.riderId);
    const open = await openDeductions(tx, d.riderId);
    const deducted = open.reduce((s, x) => s + x.amountPiastres - x.givenBackPiastres, 0);
    if (d.amountPiastres > held + deducted)
      throw new DomainError('more_than_cash', 409, { maxPiastres: held + deducted });
    const heldPart = Math.min(d.amountPiastres, held);
    let rest = d.amountPiastres - heldPart;
    const tags = { riderId: d.riderId, darkStoreId: d.darkStoreId };
    const lines: { account: AccountRef; amount: number; tags: typeof tags }[] = [
      { account: { type: 'basata_transit' }, amount: d.amountPiastres, tags },
      { account: { type: 'rider_cash', riderId: d.riderId }, amount: -heldPart, tags },
    ];
    // Dues the rider still owes can take back what was charged to them; the rest was already
    // taken from a withdrawal, so it goes back to their wallet.
    let duesLeft = Math.max(0, await balanceOf(tx, { type: 'rider_dues', riderId: d.riderId }));
    const given: { id: string; amount: number }[] = [];
    for (const x of open) {
      if (rest <= 0) break;
      const give = Math.min(rest, x.amountPiastres - x.givenBackPiastres);
      rest -= give;
      given.push({ id: x.id, amount: give });
      if (x.supplierId) {
        lines.push({
          account: { type: 'supplier', supplierId: x.supplierId },
          amount: -give,
          tags,
        });
      } else {
        const toDues = Math.min(give, duesLeft);
        duesLeft -= toDues;
        lines.push({ account: { type: 'rider_dues', riderId: d.riderId }, amount: -toDues, tags });
        lines.push({
          account: { type: 'rider_bonus', riderId: d.riderId },
          amount: -(give - toDues),
          tags,
        });
      }
    }
    const label = basataDepositNumber(d.number);
    const entry = await post(tx, {
      kind: DEPOSIT_KIND,
      idempotencyKey: `basata_deposit:${d.id}`,
      occurredAt: now,
      createdById: input.actorUserId,
      memo: `${label} ${d.rider.user.name} (${d.rider.badgeCode}) ${d.reference}`.slice(0, 500),
      riderId: d.riderId,
      darkStoreId: d.darkStoreId,
      data: {
        basataDepositId: d.id,
        number: label,
        reference: d.reference,
        heldPiastres: heldPart,
        givenBackPiastres: d.amountPiastres - heldPart,
      },
      lines,
    });
    for (const g of given)
      await tx.riderCashDeduction.update({
        where: { id: g.id },
        data: { givenBackPiastres: { increment: g.amount } },
      });
    // The receipt photo stays with the entry.
    await tx.financeReceipt.create({
      data: { photoId: d.photoId, entryId: entry!.id, createdById: input.actorUserId },
    });
    const after = await tx.basataDeposit.update({
      where: { id: d.id },
      data: {
        status: 'approved',
        decidedById: input.actorUserId,
        decidedAt: now,
        entryId: entry!.id,
        heldPiastres: heldPart,
        givenBackPiastres: d.amountPiastres - heldPart,
      },
      include: depositInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'basata_deposit.approve',
      entityType: 'basata_deposit',
      entityId: d.id,
      before: { status: d.status },
      after: {
        status: 'approved',
        amount: d.amountPiastres,
        held: heldPart,
        givenBack: d.amountPiastres - heldPart,
        entryId: entry!.id,
      },
    });
    return basataDepositView(after);
  });
}

/**
 * Accounting refuses a deposit with a reason (at least 5 characters). No money moves; when
 * the deadline the deposit counted for has passed (and the deadline rule is on), the cash is
 * taken from the rider at once and they are frozen, as at the deadline (key
 * basata_rejected:<id>). Nobody refuses their own deposit.
 */
export function rejectBasataDeposit(
  db: Db,
  input: { depositId: string; actorUserId: string; reason: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const d = await lockDeposit(tx, input.depositId);
    if (d.rider.userId === input.actorUserId) throw new DomainError('own_deposit', 403);
    if (d.status !== 'pending') throw new DomainError('deposit_not_pending', 409);
    const reason = input.reason.trim();
    if (reason.length < 5) throw new DomainError('reason_required', 400);
    const after = await tx.basataDeposit.update({
      where: { id: d.id },
      data: {
        status: 'rejected',
        decidedById: input.actorUserId,
        decidedAt: now,
        rejectReason: reason,
      },
      include: depositInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'basata_deposit.reject',
      entityType: 'basata_deposit',
      entityId: d.id,
      before: { status: d.status },
      after: { status: 'rejected', reason },
    });
    if ((await getSetting(tx, 'cash.deposit_deadline_enabled')) === 1) {
      const hour = await getSetting(tx, 'cash.deposit_deadline_hour');
      const deadline = depositDeadline(dayText(d.deadlineDay), hour);
      if (now >= deadline) {
        await tx.$queryRaw`SELECT id FROM riders WHERE id = ${d.riderId} FOR UPDATE`;
        await chargeRiderCash(tx, {
          riderId: d.riderId,
          kind: 'rejected',
          day: dayText(d.deadlineDay),
          depositId: d.id,
          heldPiastres: d.amountPiastres,
          key: `basata_rejected:${d.id}`,
          occurredAt: now,
          actorUserId: input.actorUserId,
        });
      }
    }
    return basataDepositView(after);
  });
}

// ─── the deadline ────────────────────────────────────────────────────────────────

/**
 * Takes cash a rider held at a deadline (or a refused deposit) from them, at most what they
 * still hold now (cashToHandIn, so nothing they handed in or deposited since is taken twice):
 * to their rider office's wallet when they are linked to one, else their own dues. Freezes
 * the rider (when not frozen yet) and raises one rider_frozen alert. Once per key.
 */
async function chargeRiderCash(
  tx: Tx,
  input: {
    riderId: string;
    kind: 'deadline' | 'rejected';
    day: string;
    depositId?: string;
    heldPiastres: number;
    key: string;
    occurredAt: Date;
    actorUserId: string | null;
  },
) {
  const seen = await tx.riderCashDeduction.findUnique({ where: { key: input.key } });
  if (seen) return { deduction: seen, frozen: false };
  const rider = await tx.rider.findUniqueOrThrow({
    where: { id: input.riderId },
    include: { user: { select: { name: true } } },
  });
  const amount = Math.max(0, Math.min(input.heldPiastres, await cashToHandIn(tx, rider.id)));
  const office = await riderOfficeOf(tx, rider.id);
  // A moment inside closed books is booked on the first open moment instead.
  const lock = await tx.booksLock.findUnique({ where: { id: 'books' } });
  const at = lock && input.occurredAt < lock.lockedBefore ? lock.lockedBefore : input.occurredAt;
  const entry =
    amount > 0
      ? await post(tx, {
          kind: DEADLINE_KIND,
          idempotencyKey: input.key,
          occurredAt: at,
          createdById: input.actorUserId,
          memo: `${rider.user.name} (${rider.badgeCode}) ${input.day}`,
          riderId: rider.id,
          darkStoreId: rider.darkStoreId,
          data: {
            riderId: rider.id,
            day: input.day,
            reason: input.kind,
            heldPiastres: input.heldPiastres,
            ...(input.depositId ? { basataDepositId: input.depositId } : {}),
            ...(office ? { supplierId: office.id } : {}),
          },
          lines: [
            {
              account: office
                ? { type: 'supplier', supplierId: office.id }
                : { type: 'rider_dues', riderId: rider.id },
              amount,
            },
            { account: { type: 'rider_cash', riderId: rider.id }, amount: -amount },
          ],
        })
      : null;
  const deduction = await tx.riderCashDeduction.create({
    data: {
      riderId: rider.id,
      kind: input.kind,
      day: dayDate(input.day),
      depositId: input.depositId ?? null,
      heldPiastres: input.heldPiastres,
      amountPiastres: amount,
      supplierId: office?.id ?? null,
      entryId: entry?.id ?? null,
      key: input.key,
    },
  });
  const reason: FreezeReason = input.kind === 'deadline' ? 'deposit_deadline' : 'deposit_rejected';
  let frozen = false;
  if (!rider.frozenAt) {
    frozen = true;
    await tx.rider.update({
      where: { id: rider.id },
      data: { frozenAt: input.occurredAt, frozenReason: reason, frozenById: input.actorUserId },
    });
    await tx.riderFreeze.create({
      data: {
        riderId: rider.id,
        reason,
        day: dayDate(input.day),
        amountPiastres: input.heldPiastres,
        frozenAt: input.occurredAt,
        frozenById: input.actorUserId,
      },
    });
  }
  await tx.alert.createMany({
    data: [
      {
        type: 'rider_frozen',
        key: `rider_frozen:${input.key}`,
        darkStoreId: rider.darkStoreId,
        data: {
          riderId: rider.id,
          rider: rider.user.name,
          badge: rider.badgeCode,
          reason,
          day: input.day,
          amountPiastres: input.heldPiastres,
          chargedPiastres: amount,
          amountEgp: egpText(input.heldPiastres),
          office: office?.name ?? null,
        },
      },
    ],
    skipDuplicates: true,
  });
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    action: frozen ? 'rider.freeze' : 'rider.cash_deadline_charge',
    entityType: 'rider',
    entityId: rider.id,
    before: { frozenAt: rider.frozenAt?.toISOString() ?? null },
    after: {
      reason,
      day: input.day,
      heldPiastres: input.heldPiastres,
      chargedPiastres: amount,
      chargedTo: office ? `office:${office.id}` : 'rider_dues',
      entryId: entry?.id ?? null,
      key: input.key,
    },
  });
  return { deduction, frozen };
}

/**
 * What a rider held at a deadline instant, worked out from the books as of that instant (so
 * a job that runs late, after the server slept, sees what was true then): rider cash before
 * the deadline, less handover differences that were still waiting for finance then, less
 * deposits sent before the deadline and not refused before it (pending, or approved after it:
 * one approved before it already lowered rider cash).
 */
export async function riderCashAtDeadline(db: Db, riderId: string, deadline: Date) {
  const cash = await balanceOf(db, { type: 'rider_cash', riderId }, deadline);
  const waiting = await db.cashHandover.aggregate({
    where: {
      riderId,
      createdAt: { lt: deadline },
      OR: [{ status: 'pending' }, { reviewedAt: { gte: deadline } }],
    },
    _sum: { differencePiastres: true },
  });
  const deposits = await db.basataDeposit.aggregate({
    where: {
      riderId,
      createdAt: { lt: deadline },
      OR: [{ status: 'pending' }, { decidedAt: { gte: deadline } }],
    },
    _sum: { amountPiastres: true },
  });
  return Math.max(
    0,
    cash - (waiting._sum.differencePiastres ?? 0) - (deposits._sum.amountPiastres ?? 0),
  );
}

/**
 * The deposit deadline job (an API job under an advisory lock): for every Cairo day whose
 * deadline has passed and was not run yet (the very first run only marks the last deadline as
 * the start, taking nothing), each
 * rider's cash at that deadline is taken from them and they are frozen (key
 * basata_deadline:<rider>:<day>). The day is then marked done (cash_deadline_runs), so a run
 * twice changes nothing. While cash.deposit_deadline_enabled is 0 the days are marked skipped.
 */
export async function runDepositDeadline(db: Db, now: Date = new Date()) {
  const [enabled, hour] = await Promise.all([
    getSetting(db, 'cash.deposit_deadline_enabled'),
    getSetting(db, 'cash.deposit_deadline_hour'),
  ]);
  const last = lastDeadlineDay(now, hour);
  const done = await db.cashDeadlineRun.findFirst({ orderBy: { day: 'desc' } });
  const out = { days: [] as string[], frozen: 0, chargedPiastres: 0 };
  if (!done) {
    // The very first run only marks where the rule starts: cash held at a deadline that passed
    // before the feature existed is never taken (riders could not know the rule then).
    await db.cashDeadlineRun.createMany({
      data: [{ day: dayDate(last), deadlineAt: depositDeadline(last, hour), skipped: true }],
      skipDuplicates: true,
    });
    return out;
  }
  const days: string[] = [];
  for (let d = addDays(dayText(done.day), 1); d <= last; d = addDays(d, 1)) days.push(d);
  for (const day of days) {
    const deadline = depositDeadline(day, hour);
    if (deadline > now) break;
    const result = await inTransaction(db, async (tx) => {
      if (await tx.cashDeadlineRun.findUnique({ where: { day: dayDate(day) } })) return null;
      let frozen = 0;
      let charged = 0;
      if (enabled === 1) {
        const accounts = await tx.ledgerAccount.findMany({
          where: { type: 'rider_cash', riderId: { not: null } },
          select: { riderId: true },
        });
        for (const a of accounts) {
          const riderId = a.riderId!;
          await tx.$queryRaw`SELECT id FROM riders WHERE id = ${riderId} FOR UPDATE`;
          const held = await riderCashAtDeadline(tx, riderId, deadline);
          if (held <= 0) continue;
          const r = await chargeRiderCash(tx, {
            riderId,
            kind: 'deadline',
            day,
            heldPiastres: held,
            key: `basata_deadline:${riderId}:${day}`,
            occurredAt: deadline,
            actorUserId: null,
          });
          if (r.frozen) frozen++;
          charged += r.deduction.amountPiastres;
        }
      }
      await tx.cashDeadlineRun.create({
        data: {
          day: dayDate(day),
          deadlineAt: deadline,
          skipped: enabled !== 1,
          frozen,
          chargedPiastres: charged,
        },
      });
      return { frozen, charged };
    });
    if (!result) continue;
    out.days.push(day);
    out.frozen += result.frozen;
    out.chargedPiastres += result.charged;
  }
  return out;
}

// ─── freezing ────────────────────────────────────────────────────────────────────

/** Refuses an action a frozen rider may not take (orders, withdrawals). */
export function assertNotFrozen(rider: { frozenAt: Date | null }) {
  if (rider.frozenAt) throw new DomainError('rider_frozen', 409);
}

/**
 * Only Accounting unfreezes a rider, with a written reason (at least 5 characters); audited
 * and kept in the rider's freeze history.
 */
export function unfreezeRider(
  db: Db,
  input: { riderId: string; actorUserId: string; reason: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    await tx.$queryRaw`SELECT id FROM riders WHERE id = ${input.riderId} FOR UPDATE`;
    const rider = await tx.rider.findUnique({ where: { id: input.riderId } });
    if (!rider) throw new DomainError('rider_not_found', 404);
    if (!rider.frozenAt) throw new DomainError('rider_not_frozen', 409);
    const reason = input.reason.trim();
    if (reason.length < 5) throw new DomainError('reason_required', 400);
    await tx.rider.update({
      where: { id: rider.id },
      data: { frozenAt: null, frozenReason: null, frozenById: null },
    });
    await tx.riderFreeze.updateMany({
      where: { riderId: rider.id, unfrozenAt: null },
      data: { unfrozenAt: now, unfrozenById: input.actorUserId, unfreezeReason: reason },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'rider.unfreeze',
      entityType: 'rider',
      entityId: rider.id,
      before: { frozenAt: rider.frozenAt.toISOString(), frozenReason: rider.frozenReason },
      after: { frozenAt: null, reason },
    });
    return { riderId: rider.id, frozen: false };
  });
}

/** A rider's freeze state and history, newest first. */
export async function riderFreezeState(db: Db, riderId: string) {
  const rider = await db.rider.findUnique({
    where: { id: riderId },
    select: { frozenAt: true, frozenReason: true },
  });
  if (!rider) throw new DomainError('rider_not_found', 404);
  const history = await db.riderFreeze.findMany({
    where: { riderId },
    include: { unfrozenBy: { select: { name: true } } },
    orderBy: { frozenAt: 'desc' },
    take: 20,
  });
  return {
    frozen: Boolean(rider.frozenAt),
    frozenAt: rider.frozenAt,
    reason: (rider.frozenReason as FreezeReason | null) ?? null,
    history: history.map((h) => ({
      id: h.id,
      reason: h.reason as FreezeReason,
      day: h.day ? dayText(h.day) : null,
      amountPiastres: h.amountPiastres,
      frozenAt: h.frozenAt,
      unfrozenAt: h.unfrozenAt,
      unfrozenBy: h.unfrozenBy?.name ?? null,
      unfreezeReason: h.unfreezeReason,
    })),
  };
}

/** Frozen riders (optionally of some stores), longest frozen first. */
export async function listFrozenRiders(db: Db, stores: string[] | null) {
  const riders = await db.rider.findMany({
    where: { frozenAt: { not: null }, ...(stores ? { darkStoreId: { in: stores } } : {}) },
    include: {
      user: { select: { name: true } },
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
    },
    orderBy: { frozenAt: 'asc' },
  });
  const out = [];
  for (const r of riders) {
    const [cash, deducted, pending, office] = await Promise.all([
      cashToHandIn(db, r.id),
      deductedNotGivenBack(db, r.id),
      pendingBasataPiastres(db, r.id),
      riderOfficeOf(db, r.id),
    ]);
    out.push({
      riderId: r.id,
      name: r.user.name,
      badgeCode: r.badgeCode,
      store: r.darkStore,
      frozenAt: r.frozenAt!,
      reason: r.frozenReason as FreezeReason,
      cashPiastres: cash,
      deductedPiastres: deducted,
      pendingPiastres: pending,
      office: office ? { id: office.id, name: office.name } : null,
    });
  }
  return out;
}

// ─── the rider app ───────────────────────────────────────────────────────────────

/** The rider app's Basata screen: whether it is open, the most to deposit, their deposits. */
export async function riderBasata(db: Db, riderId: string, now: Date = new Date()) {
  const rider = await db.rider.findUnique({ where: { id: riderId } });
  if (!rider) throw new DomainError('rider_not_found', 404);
  const [enabled, deadlineOn, hour, max, rows, freeze] = await Promise.all([
    getSetting(db, 'cash.basata_enabled', rider.darkStoreId),
    getSetting(db, 'cash.deposit_deadline_enabled'),
    getSetting(db, 'cash.deposit_deadline_hour'),
    maxBasataDeposit(db, riderId),
    db.basataDeposit.findMany({
      where: { riderId },
      include: depositInclude,
      orderBy: { number: 'desc' },
      take: 50,
    }),
    riderFreezeState(db, riderId),
  ]);
  const nextDeadlineDay = deadlineDayOf(now, hour);
  return {
    enabled: enabled === 1,
    deadline: deadlineOn === 1 ? { hour, at: depositDeadline(nextDeadlineDay, hour) } : null,
    ...max,
    pendingPiastres: rows
      .filter((d) => d.status === 'pending')
      .reduce((s, d) => s + d.amountPiastres, 0),
    deposits: rows.map(basataDepositView),
    frozen: freeze.frozen ? { at: freeze.frozenAt, reason: freeze.reason } : null,
  };
}

// ─── Accounting ──────────────────────────────────────────────────────────────────

/** One deposit for Accounting, with the rider's cash figures beside it. */
export async function basataDepositDetail(db: Db, depositId: string) {
  const d = await db.basataDeposit.findUnique({
    where: { id: depositId },
    include: depositInclude,
  });
  if (!d) throw new DomainError('basata_deposit_not_found', 404);
  const [held, deducted, office] = await Promise.all([
    cashHeldNow(db, d.riderId),
    deductedNotGivenBack(db, d.riderId),
    riderOfficeOf(db, d.riderId),
  ]);
  return {
    deposit: basataDepositView(d),
    rider: {
      frozen: Boolean(d.rider.frozenAt),
      cashHeldPiastres: held,
      deductedPiastres: deducted,
      office: office ? { id: office.id, name: office.name } : null,
    },
  };
}

/**
 * Approved deposits not settled yet, oldest first (optionally only those deposited up to a
 * Cairo day), for the Record Basata transfer form.
 */
export async function unsettledBasataDeposits(
  db: Db,
  input: { upToDay?: string; stores?: string[] | null } = {},
) {
  if (input.upToDay && !isCalendarDay(input.upToDay)) throw new DomainError('invalid_day', 400);
  const rows = await db.basataDeposit.findMany({
    where: {
      status: 'approved',
      settlementId: null,
      ...(input.upToDay ? { depositedAt: { lt: cairoAt(addDays(input.upToDay, 1), 0) } } : {}),
      ...(input.stores ? { darkStoreId: { in: input.stores } } : {}),
    },
    include: depositInclude,
    orderBy: [{ depositedAt: 'asc' }, { number: 'asc' }],
  });
  const deposits = rows.map(basataDepositView);
  return { deposits, totalPiastres: deposits.reduce((s, d) => s + d.amountPiastres, 0) };
}

/**
 * Basata's daily transfer reached the bank: finance enters the bank (default CIB), the day and
 * the amount that arrived, and picks the approved deposits it covers. The fee is the deposits'
 * total less the amount (never below zero). One entry (Dr bank, Dr Basata fees, Cr Money at
 * Basata) and the deposits are marked settled (BT-000001). Money we already own moving between
 * our accounts: no second person, but audited. The same idempotency key records it once.
 */
export function recordBasataSettlement(
  db: Db,
  input: { body: BasataSettlementBody; actorUserId: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const body = input.body;
    const seen = await tx.basataSettlement.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
    });
    if (seen) return settlementView(tx, seen.id);
    if (!isCalendarDay(body.receivedOn)) throw new DomainError('invalid_day', 400);
    const today = cairoDay(now);
    if (body.receivedOn > today) throw new DomainError('day_in_future', 400);
    if (!Number.isSafeInteger(body.amountPiastres) || body.amountPiastres <= 0)
      throw new DomainError('invalid_amount', 400);
    const ids = [...new Set(body.depositIds)];
    await tx.$queryRaw`SELECT id FROM basata_deposits WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
    const deposits = await tx.basataDeposit.findMany({ where: { id: { in: ids } } });
    if (deposits.length !== ids.length) throw new DomainError('basata_deposit_not_found', 404);
    if (deposits.some((d) => d.status !== 'approved'))
      throw new DomainError('deposit_not_approved', 409);
    if (deposits.some((d) => d.settlementId)) throw new DomainError('deposit_already_settled', 409);
    const total = deposits.reduce((s, d) => s + d.amountPiastres, 0);
    const fee = total - body.amountPiastres;
    if (fee < 0) throw new DomainError('more_than_deposits', 409, { depositsPiastres: total });
    const transit = await lockedBalance(tx, { type: 'basata_transit' });
    if (total > transit.balance) throw new DomainError('not_enough_money', 409);
    const bank = await bankAccount(tx, body.bankAccountId);
    const number = await nextNumber(tx, 'basata_settlements');
    const label = basataSettlementNumber(number);
    const reference = body.reference?.trim() || null;
    // A day before today is booked at its noon; today at this moment.
    const at = body.receivedOn === today ? now : cairoAt(body.receivedOn, 12 * 60);
    const entry = await post(tx, {
      kind: SETTLEMENT_KIND,
      idempotencyKey: `basata_settlement:${body.idempotencyKey}`,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: `${label} Basata${reference ? ` ${reference}` : ''}`,
      data: {
        number: label,
        deposits: ids.length,
        depositsPiastres: total,
        feePiastres: fee,
        ...(reference ? { reference } : {}),
      },
      lines: [
        { account: bank, amount: body.amountPiastres },
        { account: { type: 'basata_fees' }, amount: fee },
        { account: { type: 'basata_transit' }, amount: -total },
      ],
    });
    const bankLine = await tx.ledgerLine.findFirstOrThrow({
      where: { entryId: entry!.id, amountPiastres: { gt: 0 }, account: { groupCode: 1100 } },
      select: { accountId: true },
    });
    const settlement = await tx.basataSettlement.create({
      data: {
        number,
        bankAccountId: bankLine.accountId,
        receivedOn: dayDate(body.receivedOn),
        amountPiastres: body.amountPiastres,
        depositsPiastres: total,
        feePiastres: fee,
        reference,
        entryId: entry!.id,
        createdById: input.actorUserId,
        idempotencyKey: body.idempotencyKey,
      },
    });
    const marked = await tx.basataDeposit.updateMany({
      where: { id: { in: ids }, status: 'approved', settlementId: null },
      data: { settlementId: settlement.id },
    });
    if (marked.count !== ids.length) throw new DomainError('deposit_already_settled', 409);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'basata_settlement.record',
      entityType: 'basata_settlement',
      entityId: settlement.id,
      after: {
        number: label,
        receivedOn: body.receivedOn,
        amount: body.amountPiastres,
        deposits: total,
        fee,
        depositIds: ids,
        entryId: entry!.id,
        ...(reference ? { reference } : {}),
      },
    });
    return settlementView(tx, settlement.id);
  });
}

async function settlementView(db: Db, id: string) {
  const s = await db.basataSettlement.findUniqueOrThrow({
    where: { id },
    include: {
      bankAccount: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      entry: { select: { id: true, number: true } },
      createdBy: { select: { name: true } },
      _count: { select: { deposits: true } },
    },
  });
  return {
    id: s.id,
    number: basataSettlementNumber(s.number),
    receivedOn: dayText(s.receivedOn),
    amountPiastres: s.amountPiastres,
    depositsPiastres: s.depositsPiastres,
    feePiastres: s.feePiastres,
    reference: s.reference,
    bank: s.bankAccount,
    entry: s.entry,
    createdBy: s.createdBy.name,
    deposits: s._count.deposits,
    createdAt: s.createdAt,
  };
}

/** Basata's transfers, newest first. */
export async function listBasataSettlements(db: Db, take = 30) {
  const rows = await db.basataSettlement.findMany({
    orderBy: { number: 'desc' },
    take,
    select: { id: true },
  });
  return Promise.all(rows.map((r) => settlementView(db, r.id)));
}

/**
 * The cash position's Basata lines: approved and not settled yet (at Basata, on its way to the
 * bank) and sent but not reviewed yet (still rider cash in the books), optionally of some
 * stores.
 */
export async function basataPosition(db: Db, stores: string[] | null) {
  const where = stores ? { darkStoreId: { in: stores } } : {};
  const [atBasata, waiting] = await Promise.all([
    db.basataDeposit.aggregate({
      where: { ...where, status: 'approved', settlementId: null },
      _sum: { amountPiastres: true },
      _count: true,
    }),
    db.basataDeposit.aggregate({
      where: { ...where, status: 'pending' },
      _sum: { amountPiastres: true },
      _count: true,
    }),
  ]);
  return {
    atBasataPiastres: atBasata._sum.amountPiastres ?? 0,
    atBasataCount: atBasata._count,
    waitingPiastres: waiting._sum.amountPiastres ?? 0,
    waitingCount: waiting._count,
  };
}
