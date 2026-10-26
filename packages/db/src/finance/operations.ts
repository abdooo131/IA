import type { PayoutSchedule, Prisma } from '@prisma/client';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { type AccountRef, balanceOf, post } from './ledger';

type Tx = Prisma.TransactionClient;

/** Flips a sign without producing -0. */
const negate = (value: number) => 0 - value;

const positive = (amount: number) => {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('invalid_amount', 400);
};

// ─── rider cash ────────────────────────────────────────────────────────────────

/** Cash a rider carries: collected on delivery and not yet handed to a store. */
export function riderCash(db: Db, riderId: string) {
  return balanceOf(db, { type: 'rider_cash', riderId });
}

/** Delivery bonuses earned and not yet paid. */
export async function riderBonusOwed(db: Db, riderId: string) {
  return negate(await balanceOf(db, { type: 'rider_bonus', riderId }));
}

/**
 * Staff count the cash a rider hands in. The counted cash moves to the store's cash box at
 * once; a difference waits for finance, who either write it off or leave it on the rider.
 */
export function recordCashHandover(
  db: Db,
  input: {
    riderId: string;
    darkStoreId: string;
    countedPiastres: number;
    note?: string;
    receivedById: string;
    idempotencyKey: string;
  },
) {
  if (!Number.isSafeInteger(input.countedPiastres) || input.countedPiastres < 0)
    throw new DomainError('invalid_amount', 400);
  return inTransaction(db, async (tx) => {
    const seen = await tx.cashHandover.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (seen) return seen;
    const rider = await tx.rider.findUnique({ where: { id: input.riderId } });
    if (!rider) throw new DomainError('rider_not_found', 404);
    if (rider.darkStoreId !== input.darkStoreId) throw new DomainError('rider_other_store');
    // Lock the rider row so two handovers for one rider cannot read the same balance.
    await tx.$queryRaw`SELECT id FROM riders WHERE id = ${rider.id} FOR UPDATE`;
    const expected = Math.max(0, await riderCash(tx, rider.id));
    const difference = expected - input.countedPiastres;
    const handover = await tx.cashHandover.create({
      data: {
        riderId: rider.id,
        darkStoreId: input.darkStoreId,
        expectedPiastres: expected,
        countedPiastres: input.countedPiastres,
        differencePiastres: difference,
        status: difference === 0 ? 'balanced' : 'pending',
        note: input.note,
        receivedById: input.receivedById,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await post(tx, {
      kind: 'cash_handover',
      idempotencyKey: `handover:${handover.id}`,
      createdById: input.receivedById,
      data: { handoverId: handover.id, expected, counted: input.countedPiastres },
      lines: [
        {
          account: { type: 'store_cash', darkStoreId: input.darkStoreId },
          amount: input.countedPiastres,
        },
        { account: { type: 'rider_cash', riderId: rider.id }, amount: -input.countedPiastres },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.receivedById,
      action: 'finance.cash_handover',
      entityType: 'cash_handover',
      entityId: handover.id,
      after: { riderId: rider.id, expected, counted: input.countedPiastres, difference },
    });
    return handover;
  });
}

/** Finance decides on a cash difference: write it off, or keep it on the rider's wallet. */
export function reviewCashHandover(
  db: Db,
  input: {
    handoverId: string;
    decision: 'write_off' | 'charge_rider';
    note: string;
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.cashHandover.findUnique({ where: { id: input.handoverId } });
    if (!before) throw new DomainError('handover_not_found', 404);
    if (before.status !== 'pending') throw new DomainError('handover_not_pending');
    const status = input.decision === 'write_off' ? 'written_off' : 'charged_to_rider';
    const updated = await tx.cashHandover.updateMany({
      where: { id: before.id, status: 'pending' },
      data: {
        status,
        reviewedById: input.actorUserId,
        reviewedAt: new Date(),
        reviewNote: input.note,
      },
    });
    if (updated.count !== 1) throw new DomainError('handover_not_pending');
    if (input.decision === 'write_off') {
      // A shortage becomes a company loss; a surplus becomes company income.
      await post(tx, {
        kind: 'cash_difference',
        idempotencyKey: `handover:${before.id}:write_off`,
        createdById: input.actorUserId,
        memo: input.note,
        data: { handoverId: before.id },
        lines: [
          { account: { type: 'cash_difference' }, amount: before.differencePiastres },
          {
            account: { type: 'rider_cash', riderId: before.riderId },
            amount: -before.differencePiastres,
          },
        ],
      });
    }
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.cash_handover_review',
      entityType: 'cash_handover',
      entityId: before.id,
      before: { status: before.status },
      after: { status, note: input.note, difference: before.differencePiastres },
    });
    return { status };
  });
}

/** Finance takes cash from a store's box to the bank. */
export function recordBankDeposit(
  db: Db,
  input: {
    darkStoreId: string;
    amountPiastres: number;
    reference: string;
    actorUserId: string;
    idempotencyKey: string;
  },
) {
  positive(input.amountPiastres);
  return inTransaction(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM dark_stores WHERE id = ${input.darkStoreId} FOR UPDATE`;
    const inBox = await balanceOf(tx, { type: 'store_cash', darkStoreId: input.darkStoreId });
    if (input.amountPiastres > inBox) throw new DomainError('more_than_cash_in_store');
    const entry = await post(tx, {
      kind: 'bank_deposit',
      idempotencyKey: `deposit:${input.idempotencyKey}`,
      createdById: input.actorUserId,
      memo: input.reference,
      data: { darkStoreId: input.darkStoreId, reference: input.reference },
      lines: [
        { account: { type: 'bank' }, amount: input.amountPiastres },
        {
          account: { type: 'store_cash', darkStoreId: input.darkStoreId },
          amount: -input.amountPiastres,
        },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.bank_deposit',
      entityType: 'ledger_entry',
      entityId: entry!.id,
      after: {
        darkStoreId: input.darkStoreId,
        amount: input.amountPiastres,
        reference: input.reference,
      },
    });
    return entry!;
  });
}

// ─── merchants ─────────────────────────────────────────────────────────────────

/** What we owe the merchant (negative when the merchant owes us), optionally at a moment. */
export async function merchantOwed(db: Db, merchantId: string, before?: Date) {
  return negate(await balanceOf(db, { type: 'merchant', merchantId }, before));
}

/** Whether a merchant is due a payout on a Cairo weekday (0 is Sunday). */
export function payoutDueOn(schedule: PayoutSchedule, weekday: number) {
  if (schedule === 'daily') return true;
  if (schedule === 'twice_weekly') return weekday === 0 || weekday === 3;
  return weekday === 0;
}

/**
 * Prepares a payout of what we owe the merchant up to the cutoff. One open draft per
 * merchant at a time, so nothing is ever paid twice. Nothing moves until it is marked paid.
 */
export function createPayout(
  db: Db,
  input: { merchantId: string; cutoffAt: Date; note?: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${input.merchantId} FOR UPDATE`;
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const open = await tx.payout.findFirst({ where: { merchantId: merchant.id, status: 'draft' } });
    if (open) throw new DomainError('payout_already_open');
    const owedAtCutoff = await merchantOwed(tx, merchant.id, input.cutoffAt);
    // Never pay more than is owed now, in case fees were posted after the cutoff.
    const amount = Math.min(owedAtCutoff, await merchantOwed(tx, merchant.id));
    if (amount <= 0) throw new DomainError('nothing_to_pay');
    const payout = await tx.payout.create({
      data: {
        merchantId: merchant.id,
        cutoffAt: input.cutoffAt,
        amountPiastres: amount,
        note: input.note,
        createdById: input.actorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.payout_create',
      entityType: 'payout',
      entityId: payout.id,
      after: { merchantId: merchant.id, amount, cutoffAt: input.cutoffAt.toISOString() },
    });
    return payout;
  });
}

/** Finance sent the bank transfer: the merchant's balance drops by the amount paid. */
export function markPayoutPaid(
  db: Db,
  input: { payoutId: string; reference: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: input.payoutId } });
    if (!payout) throw new DomainError('payout_not_found', 404);
    if (payout.status !== 'draft') throw new DomainError('payout_not_draft');
    const now = new Date();
    const updated = await tx.payout.updateMany({
      where: { id: payout.id, status: 'draft' },
      data: {
        status: 'paid',
        reference: input.reference,
        paidById: input.actorUserId,
        paidAt: now,
      },
    });
    if (updated.count !== 1) throw new DomainError('payout_not_draft');
    await post(tx, {
      kind: 'merchant_payout',
      idempotencyKey: `payout:${payout.id}`,
      occurredAt: now,
      createdById: input.actorUserId,
      memo: input.reference,
      data: { payoutId: payout.id, reference: input.reference },
      lines: [
        {
          account: { type: 'merchant', merchantId: payout.merchantId },
          amount: payout.amountPiastres,
        },
        { account: { type: 'bank' }, amount: -payout.amountPiastres },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.payout_paid',
      entityType: 'payout',
      entityId: payout.id,
      before: { status: 'draft' },
      after: { status: 'paid', reference: input.reference, amount: payout.amountPiastres },
    });
    return { status: 'paid' as const };
  });
}

export function cancelPayout(
  db: Db,
  input: { payoutId: string; note: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const updated = await tx.payout.updateMany({
      where: { id: input.payoutId, status: 'draft' },
      data: { status: 'cancelled', note: input.note },
    });
    if (updated.count !== 1) throw new DomainError('payout_not_draft');
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.payout_cancel',
      entityType: 'payout',
      entityId: input.payoutId,
      before: { status: 'draft' },
      after: { status: 'cancelled', note: input.note },
    });
    return { status: 'cancelled' as const };
  });
}

/** A merchant who owed us (fees above COD) paid by bank transfer. */
export function recordMerchantReceipt(
  db: Db,
  input: {
    merchantId: string;
    amountPiastres: number;
    reference: string;
    actorUserId: string;
    idempotencyKey: string;
  },
) {
  positive(input.amountPiastres);
  return inTransaction(db, async (tx) => {
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const entry = await post(tx, {
      kind: 'merchant_receipt',
      idempotencyKey: `receipt:${input.idempotencyKey}`,
      createdById: input.actorUserId,
      memo: input.reference,
      data: { reference: input.reference },
      lines: [
        { account: { type: 'bank' }, amount: input.amountPiastres },
        { account: { type: 'merchant', merchantId: merchant.id }, amount: -input.amountPiastres },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.merchant_receipt',
      entityType: 'merchant',
      entityId: merchant.id,
      after: { amount: input.amountPiastres, reference: input.reference },
    });
    return entry!;
  });
}

/**
 * A manual correction on a merchant's balance with a written reason. A positive amount
 * is a credit (we owe the merchant more, booked against revenue); negative is a charge.
 */
export function recordMerchantAdjustment(
  db: Db,
  input: {
    merchantId: string;
    amountPiastres: number;
    reason: string;
    actorUserId: string;
    idempotencyKey: string;
  },
) {
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres === 0)
    throw new DomainError('invalid_amount', 400);
  if (input.reason.trim().length < 5) throw new DomainError('reason_required', 400);
  return inTransaction(db, async (tx) => {
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const entry = await post(tx, {
      kind: 'adjustment',
      idempotencyKey: `adjustment:${input.idempotencyKey}`,
      createdById: input.actorUserId,
      memo: input.reason,
      data: { reason: input.reason },
      lines: [
        { account: { type: 'revenue' }, amount: input.amountPiastres },
        { account: { type: 'merchant', merchantId: merchant.id }, amount: -input.amountPiastres },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.merchant_adjustment',
      entityType: 'merchant',
      entityId: merchant.id,
      after: { amount: input.amountPiastres, reason: input.reason },
    });
    return entry!;
  });
}

// ─── rider bonuses ─────────────────────────────────────────────────────────────

/** Pays a rider's earned bonuses, by bank or from a store's cash box. */
export function payRiderBonus(
  db: Db,
  input: {
    riderId: string;
    amountPiastres: number;
    from: 'bank' | 'store_cash';
    reference: string;
    actorUserId: string;
    idempotencyKey: string;
  },
) {
  positive(input.amountPiastres);
  return inTransaction(db, async (tx: Tx) => {
    const rider = await tx.rider.findUnique({ where: { id: input.riderId } });
    if (!rider) throw new DomainError('rider_not_found', 404);
    await tx.$queryRaw`SELECT id FROM riders WHERE id = ${rider.id} FOR UPDATE`;
    if (input.amountPiastres > (await riderBonusOwed(tx, rider.id)))
      throw new DomainError('more_than_owed');
    const source: AccountRef =
      input.from === 'bank'
        ? { type: 'bank' }
        : { type: 'store_cash', darkStoreId: rider.darkStoreId };
    if (input.from === 'store_cash' && input.amountPiastres > (await balanceOf(tx, source)))
      throw new DomainError('more_than_cash_in_store');
    const entry = await post(tx, {
      kind: 'rider_bonus_payout',
      idempotencyKey: `bonus_payout:${input.idempotencyKey}`,
      createdById: input.actorUserId,
      memo: input.reference,
      data: { riderId: rider.id, from: input.from },
      lines: [
        { account: { type: 'rider_bonus', riderId: rider.id }, amount: input.amountPiastres },
        { account: source, amount: -input.amountPiastres },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.rider_bonus_payout',
      entityType: 'rider',
      entityId: rider.id,
      after: { amount: input.amountPiastres, from: input.from, reference: input.reference },
    });
    return entry!;
  });
}
