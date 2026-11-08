import type { PayoutSchedule } from '@prisma/client';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { payoutNeedsApproval } from './controls';
import { type AccountRef, balanceOf, nextNumber, post } from './ledger';
import { queuePayoutEmails } from '../email';
import { payoutMinimumFor } from './contracts';
import { cairoDay } from '@shiplynow/shared';
import { chargeShortageToRider } from './rider-wallet';

/** Flips a sign without producing -0. */
const negate = (value: number) => 0 - value;

const positive = (amount: number) => {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('invalid_amount', 400);
};

/**
 * The bank that paid or received: one finance chose, or the main bank (CIB, 1101). A chosen
 * account must be an open bank account.
 */
export async function bankAccount(tx: Db, bankAccountId?: string): Promise<AccountRef> {
  if (!bankAccountId) return { type: 'bank' };
  const account = await tx.ledgerAccount.findUnique({ where: { id: bankAccountId } });
  if (!account || account.groupCode !== 1100) throw new DomainError('bank_account_not_found', 404);
  if (!account.isActive) throw new DomainError('account_inactive');
  return { id: account.id };
}

// ─── rider cash ────────────────────────────────────────────────────────────────

/** Cash a rider carries: collected on delivery and not yet handed to a store. */
export function riderCash(db: Db, riderId: string) {
  return balanceOf(db, { type: 'rider_cash', riderId });
}

/** Rider pay earned and not yet paid (held or not; see rider-wallet.ts for what is available). */
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
        number: await nextNumber(tx, 'cash_handovers'),
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
    if (input.decision === 'charge_rider')
      // A shortage kept on the rider is owed by them and taken from their next withdrawal.
      await chargeShortageToRider(tx, {
        handoverId: before.id,
        riderId: before.riderId,
        amountPiastres: before.differencePiastres,
        actorUserId: input.actorUserId,
      });
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
    bankAccountId?: string;
    actorUserId: string;
    idempotencyKey: string;
  },
) {
  positive(input.amountPiastres);
  return inTransaction(db, async (tx) => {
    const bank = await bankAccount(tx, input.bankAccountId);
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
        { account: bank, amount: input.amountPiastres },
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

/** COD of the merchant's delivered next day parcels whose courier run is not closed yet. */
export async function parcelCashWithCouriers(db: Db, merchantId: string) {
  const r = await db.shipment.aggregate({
    where: {
      merchantId,
      payoutId: null,
      status: 'DELIVERED',
      NOT: { runItems: { some: { result: 'DELIVERED', run: { status: 'CLOSED' } } } },
    },
    _sum: { codCollected: true },
  });
  return r._sum.codCollected ?? 0;
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
 * A merchant owed less than the payout minimum (their contract's, else
 * finance.payout_minimum_piastres) waits until the balance reaches it.
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
    // Next day cash a courier still holds (run not closed) is booked to the wallet at delivery
    // but has not reached us: it waits for a later payout (the network's rule before the merge).
    const withCouriers = await parcelCashWithCouriers(tx, merchant.id);
    // Never pay more than is owed now, in case fees were posted after the cutoff.
    const amount = Math.min(owedAtCutoff, await merchantOwed(tx, merchant.id)) - withCouriers;
    if (amount <= 0) throw new DomainError('nothing_to_pay');
    const cutoffDay = cairoDay(new Date(input.cutoffAt.getTime() - 1));
    const minimum = await payoutMinimumFor(tx, merchant.id, cutoffDay);
    if (amount < minimum)
      throw new DomainError('below_payout_minimum', 409, {
        amountPiastres: amount,
        minimumPiastres: minimum,
      });
    const payout = await tx.payout.create({
      data: {
        number: await nextNumber(tx, 'payouts'),
        merchantId: merchant.id,
        cutoffAt: input.cutoffAt,
        amountPiastres: amount,
        note: input.note,
        createdById: input.actorUserId,
      },
    });
    // The next day parcels this payout settles: closed (their courier run is closed) by the
    // cutoff and not in another payout. The parcel pages and statements read the link.
    await tx.shipment.updateMany({
      where: {
        merchantId: merchant.id,
        payoutId: null,
        status: { in: ['DELIVERED', 'RETURNED'] },
        closedAt: { lte: input.cutoffAt },
        runItems: {
          some: { result: { in: ['DELIVERED', 'RETURNED'] }, run: { status: 'CLOSED' } },
        },
      },
      data: { payoutId: payout.id },
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
  input: { payoutId: string; reference: string; bankAccountId?: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const bank = await bankAccount(tx, input.bankAccountId);
    const payout = await tx.payout.findUnique({ where: { id: input.payoutId } });
    if (!payout) throw new DomainError('payout_not_found', 404);
    if (payout.status !== 'draft') throw new DomainError('payout_not_draft');
    // From the approval limit, a second person must have approved it first.
    if (!payout.approvedById && (await payoutNeedsApproval(tx, payout.amountPiastres)))
      throw new DomainError('approval_needed');
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
        { account: bank, amount: -payout.amountPiastres },
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
    // The payout notice and the period's statement go out with the payment, or not at all.
    await queuePayoutEmails(tx, payout.id);
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
    // Its parcels go back to waiting for the next payout.
    await tx.shipment.updateMany({
      where: { payoutId: input.payoutId },
      data: { payoutId: null },
    });
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
    bankAccountId?: string;
    actorUserId: string;
    idempotencyKey: string;
  },
) {
  positive(input.amountPiastres);
  return inTransaction(db, async (tx) => {
    const bank = await bankAccount(tx, input.bankAccountId);
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const entry = await post(tx, {
      kind: 'merchant_receipt',
      idempotencyKey: `receipt:${input.idempotencyKey}`,
      createdById: input.actorUserId,
      memo: input.reference,
      data: { reference: input.reference },
      lines: [
        { account: bank, amount: input.amountPiastres },
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

// Rider bonuses are paid through rider withdrawals (rider-wallet.ts): the manual payout
// (rider_bonus_payout entries) was replaced; its entries stay in the books as paid out.
