import type { PayoutSchedule } from '@prisma/client';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { payoutNeedsApproval } from './controls';
import { type AccountRef, balanceOf, lockedBalance, nextNumber, post } from './ledger';
import { queuePayoutEmails } from '../email';
import { payoutMinimumFor } from './contracts';
import { eventTime } from './books';
import { cairoDay, chequeLabel } from '@shiplynow/shared';
import { chargeShortageToRider } from './rider-wallet';
import { getSetting } from '../settings';
import { assertReadyToPay, freezePayoutStatement } from './payout-proof';
import { bookCheque, liveChequeOf } from './cheques';

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

/**
 * The cash a rider is expected to hand in now: their rider cash less the differences of
 * earlier handovers still waiting for finance (a shortage less, a surplus more) and less the
 * Basata deposits they sent that Accounting has not decided yet. Such a difference stays in
 * rider cash until finance writes it off or charges the rider, and a deposit until it is
 * approved, so counting them again would record them twice. Never below zero.
 */
export async function cashToHandIn(db: Db, riderId: string) {
  const [pending, deposits] = await Promise.all([
    db.cashHandover.aggregate({
      where: { riderId, status: 'pending' },
      _sum: { differencePiastres: true },
    }),
    db.basataDeposit.aggregate({
      where: { riderId, status: 'pending' },
      _sum: { amountPiastres: true },
    }),
  ]);
  return Math.max(
    0,
    (await riderCash(db, riderId)) -
      (pending._sum.differencePiastres ?? 0) -
      (deposits._sum.amountPiastres ?? 0),
  );
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
    // The store channel can be closed for a store in case of a problem (Basata stays open).
    if ((await getSetting(tx, 'cash.store_handover_enabled', input.darkStoreId)) !== 1)
      throw new DomainError('store_handover_closed', 409);
    const rider = await tx.rider.findUnique({ where: { id: input.riderId } });
    if (!rider) throw new DomainError('rider_not_found', 404);
    if (rider.darkStoreId !== input.darkStoreId) throw new DomainError('rider_other_store');
    // Lock the rider row so two handovers for one rider cannot read the same balance.
    await tx.$queryRaw`SELECT id FROM riders WHERE id = ${rider.id} FOR UPDATE`;
    const expected = await cashToHandIn(tx, rider.id);
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
  const idempotencyKey = `deposit:${input.idempotencyKey}`;
  return inTransaction(db, async (tx) => {
    // A repeat answers the first deposit (the box no longer holds the money it took).
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
    if (seen) return seen;
    const bank = await bankAccount(tx, input.bankAccountId);
    const box = await lockedBalance(tx, { type: 'store_cash', darkStoreId: input.darkStoreId });
    if (input.amountPiastres > box.balance) throw new DomainError('more_than_cash_in_store');
    const entry = await post(tx, {
      kind: 'bank_deposit',
      idempotencyKey,
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
    // Never pay more than is owed now, in case fees were posted after the cutoff.
    const amount = Math.min(owedAtCutoff, await merchantOwed(tx, merchant.id));
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
    // The statement of account (SOA) is frozen with the draft: its net is this amount.
    await freezePayoutStatement(tx, payout.id, input.actorUserId);
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

/**
 * A payout is never more than the merchant is owed at the moment it is paid (what createPayout
 * counts as owed now): fees, adjustments or credit notes posted after the draft may have
 * lowered the wallet. Finance then cancels the draft and prepares a new one. Locks the
 * merchant row as createPayout does.
 */
export async function assertPayoutOwed(
  tx: Db,
  payout: { merchantId: string; amountPiastres: number },
) {
  await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${payout.merchantId} FOR UPDATE`;
  const owed = await merchantOwed(tx, payout.merchantId);
  if (payout.amountPiastres > owed)
    throw new DomainError('payout_more_than_owed', 409, {
      amountPiastres: payout.amountPiastres,
      owedPiastres: owed,
    });
}

/**
 * Finance sent the bank transfer: the merchant's balance drops by the amount paid. Needs the
 * payout's proof of transfer (its amount the payout's), its frozen statement (net the same)
 * and every active payout check, the second person check ticked by someone else than the
 * payer (assertReadyToPay). The reference defaults to the one typed on the proof.
 */
export function markPayoutPaid(
  db: Db,
  input: {
    payoutId: string;
    reference?: string;
    bankAccountId?: string;
    /** The Cairo day the transfer went out (a past day is booked at its noon); empty is now */
    day?: string;
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const bank = await bankAccount(tx, input.bankAccountId);
    const payout = await tx.payout.findUnique({ where: { id: input.payoutId } });
    if (!payout) throw new DomainError('payout_not_found', 404);
    if (payout.status !== 'draft') throw new DomainError('payout_not_draft');
    // From the approval limit, a second person must have approved it first.
    if (!payout.approvedById && (await payoutNeedsApproval(tx, payout.amountPiastres)))
      throw new DomainError('approval_needed');
    // Paid by a registered cheque: booking the cheque pays it, after the same checks (the
    // cheque is the proof) and with the same emails; no bank moves until the cheque clears.
    const cheque = await liveChequeOf(tx, payout.id);
    if (cheque) {
      await bookCheque(tx, {
        chequeId: cheque.id,
        amountPiastres: cheque.amountPiastres,
        reference: `${chequeLabel(cheque.number)} ${cheque.chequeNumber}`,
        idempotencyKey: `cheque:${cheque.id}`,
        actorUserId: input.actorUserId,
      });
      return { status: 'paid' as const };
    }
    // Proof of transfer, statement of account and the checks before paying.
    const proof = await assertReadyToPay(tx, payout, input.actorUserId);
    const reference = input.reference?.trim() || proof.reference;
    // The wallet may have dropped since the draft (fees, adjustments, credit notes).
    await assertPayoutOwed(tx, payout);
    // Money never leaves a bank that does not hold it.
    const from = await lockedBalance(tx, bank);
    if (payout.amountPiastres > from.balance) throw new DomainError('not_enough_money');
    const now = eventTime(input.day);
    const updated = await tx.payout.updateMany({
      where: { id: payout.id, status: 'draft' },
      data: {
        status: 'paid',
        reference,
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
      memo: reference,
      data: { payoutId: payout.id, reference },
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
      after: { status: 'paid', reference, amount: payout.amountPiastres },
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
  const idempotencyKey = `receipt:${input.idempotencyKey}`;
  return inTransaction(db, async (tx) => {
    // A repeat answers the first receipt and writes no second audit row.
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
    if (seen) return seen;
    const bank = await bankAccount(tx, input.bankAccountId);
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const entry = await post(tx, {
      kind: 'merchant_receipt',
      idempotencyKey,
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
  const idempotencyKey = `adjustment:${input.idempotencyKey}`;
  return inTransaction(db, async (tx) => {
    // A repeat answers the first adjustment and writes no second audit row.
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
    if (seen) return seen;
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const entry = await post(tx, {
      kind: 'adjustment',
      idempotencyKey,
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
