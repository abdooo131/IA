import type { Cheque, FinanceRequest, Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  type ChequeBody,
  chequeLabel,
  egpText,
  isCalendarDay,
  RECEIVED_PURPOSES,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { getSetting } from '../settings';
import { eventTime } from './books';
import { payoutNeedsApproval, submitMovement } from './controls';
import { type AccountRef, balanceOf, nextNumber, post } from './ledger';
import { bankAccount } from './operations';
import { payBill, withholdingFor } from './payables';

type Tx = Prisma.TransactionClient;

// The cheques register. A cheque is booked when it changes hands and moves money only when
// the bank pays it:
//
//   received ──book──▶ received ──deposit──▶ deposited ──clear (on or after the due day)──▶ cleared
//      Dr 1151 cheques under collection / Cr the party      Dr bank / Cr 1151
//   issued   ──book──▶ issued ──clear──▶ cleared
//      Dr the party (bill, payout, deposit) / Cr 2451 cheques payable    Dr 2451 / Cr bank
//
// A bounced or cancelled cheque is undone by an entry with the booking's lines turned round
// (the party owes or is owed again; a bill is open again, a payout is cancelled). Booking
// follows the second person rule: a cheque given to us is claimed money in (always reviewed
// while finance.approve_money_in is on); a cheque we write is money going out (reviewed from
// finance.approval_threshold_piastres). Until then it waits as awaiting_approval.

export interface ChequeBookInput {
  chequeId: string;
  amountPiastres: number;
  reference: string;
  idempotencyKey: string;
}

const negate = (value: number) => 0 - value;
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);
const dayText = (d: Date) => d.toISOString().slice(0, 10);

/** Locks the cheque row so two people cannot clear or bounce it at once. */
async function lockCheque(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM cheques WHERE id = ${id} FOR UPDATE`;
  const cheque = await tx.cheque.findUnique({ where: { id } });
  if (!cheque) throw new DomainError('cheque_not_found', 404);
  return cheque;
}

/** Our bank account given by id (group 1100, open), with a name to print. */
async function ourBank(tx: Tx, id: string | undefined) {
  if (!id) throw new DomainError('bank_account_required', 400);
  const account = await tx.ledgerAccount.findUnique({ where: { id } });
  if (!account || account.groupCode !== 1100) throw new DomainError('bank_account_not_found', 404);
  if (!account.isActive) throw new DomainError('account_inactive');
  return account;
}

/**
 * Registers a cheque received or issued and books it, at once or after a second person. A
 * payout cheque follows the payout's own approval (approved first from the limit).
 */
export async function registerCheque(db: Db, input: ChequeBody & { actorUserId: string }) {
  if (!isCalendarDay(input.issueDate) || !isCalendarDay(input.dueDate))
    throw new DomainError('invalid_date', 400);
  if (input.dueDate < input.issueDate) throw new DomainError('due_before_issue', 400);
  const received = (RECEIVED_PURPOSES as readonly string[]).includes(input.purpose);
  if (received !== (input.direction === 'received'))
    throw new DomainError('purpose_direction', 400);

  return inTransaction(db, async (tx) => {
    const seen = await tx.cheque.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (seen) return { status: 'posted' as const, cheque: seen, entry: null, request: null };

    let amount = input.amountPiastres ?? 0;
    let partyName = input.partyName ?? '';
    let bankName = input.bankName ?? '';
    const link: Partial<
      Pick<
        Cheque,
        'merchantId' | 'supplierId' | 'billId' | 'payoutId' | 'incomeAccountId' | 'bankAccountId'
      >
    > = {};

    if (input.direction === 'received') {
      if (!bankName) throw new DomainError('bank_name_required', 400);
      if (input.purpose === 'merchant' || input.purpose === 'deposit') {
        const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId ?? '' } });
        if (!merchant) throw new DomainError('merchant_not_found', 404);
        link.merchantId = merchant.id;
        partyName ||= merchant.legalName ?? merchant.name;
      } else if (input.purpose === 'supplier') {
        const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId ?? '' } });
        if (!supplier) throw new DomainError('supplier_not_found', 404);
        link.supplierId = supplier.id;
        partyName ||= supplier.name;
      } else {
        const income = await tx.ledgerAccount.findUnique({
          where: { id: input.incomeAccountId ?? '' },
        });
        if (!income || income.groupCode !== 4200) throw new DomainError('account_not_found', 404);
        if (!income.isActive) throw new DomainError('account_inactive');
        link.incomeAccountId = income.id;
        if (!partyName) throw new DomainError('party_name_required', 400);
      }
    } else {
      const bank = await ourBank(tx, input.bankAccountId);
      link.bankAccountId = bank.id;
      bankName = bank.bankName ?? bank.nameEn ?? bank.code;
      if (input.purpose === 'bill') {
        const bill = await tx.bill.findUnique({
          where: { id: input.billId ?? '' },
          include: { supplier: true },
        });
        if (!bill) throw new DomainError('bill_not_found', 404);
        if (bill.status !== 'open') throw new DomainError('bill_not_open');
        if (bill.currency !== 'EGP') throw new DomainError('cheque_egp_only', 400);
        const settles = input.amountPiastres ?? 0;
        if (settles <= 0) throw new DomainError('invalid_amount', 400);
        if (settles > bill.totalPiastres - bill.paidPiastres)
          throw new DomainError('more_than_owed');
        // The cheque is for what the bill is settled by, less the tax kept back.
        amount = settles - withholdingFor(bill, settles);
        link.billId = bill.id;
        link.supplierId = bill.supplierId;
        partyName ||= bill.supplier.name;
      } else if (input.purpose === 'payout') {
        const payout = await tx.payout.findUnique({
          where: { id: input.payoutId ?? '' },
          include: { merchant: true },
        });
        if (!payout) throw new DomainError('payout_not_found', 404);
        if (payout.status !== 'draft') throw new DomainError('payout_not_draft');
        if (!payout.approvedById && (await payoutNeedsApproval(tx, payout.amountPiastres)))
          throw new DomainError('approval_needed');
        amount = payout.amountPiastres;
        link.payoutId = payout.id;
        link.merchantId = payout.merchantId;
        partyName ||= payout.merchant.beneficiaryName ?? payout.merchant.name;
      } else {
        const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId ?? '' } });
        if (!merchant) throw new DomainError('merchant_not_found', 404);
        if (amount > (await depositHeldTx(tx, merchant.id)))
          throw new DomainError('more_than_deposit');
        link.merchantId = merchant.id;
        partyName ||= merchant.beneficiaryName ?? merchant.name;
      }
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('invalid_amount', 400);

    const live = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM cheques WHERE direction = ${input.direction}::cheque_direction
        AND lower(bank_name) = lower(${bankName}) AND cheque_number = ${input.chequeNumber}
        AND status NOT IN ('cancelled', 'bounced')`;
    if (live.length) throw new DomainError('cheque_exists');

    const cheque = await tx.cheque.create({
      data: {
        number: await nextNumber(tx, 'cheques'),
        direction: input.direction,
        purpose: input.purpose,
        status: 'awaiting_approval',
        chequeNumber: input.chequeNumber,
        bankName,
        partyName,
        amountPiastres: amount,
        issueDate: dateOf(input.issueDate),
        dueDate: dateOf(input.dueDate),
        ...link,
        photoId: input.receiptPhotoId ?? null,
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey,
        createdById: input.actorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.cheque_register',
      entityType: 'cheque',
      entityId: cheque.id,
      after: {
        number: chequeLabel(cheque.number),
        direction: cheque.direction,
        purpose: cheque.purpose,
        chequeNumber: cheque.chequeNumber,
        bank: bankName,
        party: partyName,
        amount,
        due: input.dueDate,
      },
    });

    const book: ChequeBookInput = {
      chequeId: cheque.id,
      amountPiastres: amount,
      reference: `${chequeLabel(cheque.number)} ${cheque.chequeNumber}`,
      idempotencyKey: `cheque:${cheque.id}`,
    };
    if (input.purpose === 'payout') {
      const entry = await bookCheque(tx, { ...book, actorUserId: input.actorUserId });
      return {
        status: 'posted' as const,
        cheque: await tx.cheque.findUniqueOrThrow({ where: { id: cheque.id } }),
        entry,
        request: null,
      };
    }
    const result = await submitMovement(
      tx,
      { kind: received ? 'cheque_in' : 'cheque_out', input: book },
      input.actorUserId,
      input.receiptPhotoId,
    );
    return {
      status: result.status,
      cheque: await tx.cheque.findUniqueOrThrow({ where: { id: cheque.id } }),
      entry: result.status === 'posted' ? result.entry : null,
      request: result.status === 'pending' ? result.request : null,
    };
  });
}

/** What the booking entry credits or debits for the cheque's party. */
function partyAccount(cheque: Cheque): AccountRef {
  switch (cheque.purpose) {
    case 'merchant':
      return { type: 'merchant', merchantId: cheque.merchantId! };
    case 'deposit':
    case 'deposit_refund':
      return { type: 'merchant_deposit', merchantId: cheque.merchantId! };
    case 'supplier':
      return { type: 'supplier', supplierId: cheque.supplierId! };
    case 'other_income':
      return { id: cheque.incomeAccountId! };
    default:
      throw new DomainError('cheque_purpose_invalid', 400);
  }
}

/**
 * Books a registered cheque (after approval when it needed one). A cheque given to us sits in
 * cheques under collection; one we wrote is owed in cheques payable. Safe to run twice.
 */
export async function bookCheque(db: Db, input: ChequeBookInput & { actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    const cheque = await lockCheque(tx, input.chequeId);
    if (cheque.bookEntryId)
      return tx.ledgerEntry.findUniqueOrThrow({ where: { id: cheque.bookEntryId } });
    if (cheque.status !== 'awaiting_approval') throw new DomainError('cheque_not_open');
    const label = chequeLabel(cheque.number);
    const memo = `${label} ${cheque.chequeNumber} ${cheque.partyName}`;
    let entry: { id: string; number: number };
    if (cheque.direction === 'received') {
      entry = (await post(tx, {
        kind: 'cheque_received',
        idempotencyKey: `cheque:${cheque.id}:book`,
        occurredAt: new Date(),
        createdById: input.actorUserId,
        memo,
        merchantId: cheque.merchantId,
        data: { chequeId: cheque.id, purpose: cheque.purpose, due: dayText(cheque.dueDate) },
        lines: [
          { account: { type: 'cheques_under_collection' }, amount: cheque.amountPiastres },
          { account: partyAccount(cheque), amount: negate(cheque.amountPiastres) },
        ],
      }))!;
    } else if (cheque.purpose === 'bill') {
      const bill = await tx.bill.findUniqueOrThrow({ where: { id: cheque.billId! } });
      // Find how much of the bill this cheque settles: the amount whose cash part (less the
      // tax kept back) is the cheque. Withholding is a share, so search the nearest piastre.
      if (bill.status !== 'open') throw new DomainError('bill_not_open');
      const settles = settledFor(bill, cheque.amountPiastres);
      // Paid in part meanwhile so the cheque no longer fits what is left: cancel and write again.
      if (settles - withholdingFor(bill, settles) !== cheque.amountPiastres)
        throw new DomainError('cheque_amount_mismatch');
      entry = await payBill(tx, {
        billId: bill.id,
        amountPiastres: settles,
        moneyAccountId: '',
        viaChequesPayable: true,
        reference: label,
        actorUserId: input.actorUserId,
        idempotencyKey: `cheque:${cheque.id}`,
      });
    } else if (cheque.purpose === 'payout') {
      const payout = await tx.payout.findUniqueOrThrow({ where: { id: cheque.payoutId! } });
      if (payout.status !== 'draft') throw new DomainError('payout_not_draft');
      const now = new Date();
      const updated = await tx.payout.updateMany({
        where: { id: payout.id, status: 'draft' },
        data: {
          status: 'paid',
          reference: `${label} ${cheque.chequeNumber}`,
          paidById: input.actorUserId,
          paidAt: now,
        },
      });
      if (updated.count !== 1) throw new DomainError('payout_not_draft');
      entry = (await post(tx, {
        kind: 'merchant_payout',
        idempotencyKey: `payout:${payout.id}`,
        occurredAt: now,
        createdById: input.actorUserId,
        memo,
        data: { payoutId: payout.id, reference: label, chequeId: cheque.id },
        lines: [
          {
            account: { type: 'merchant', merchantId: payout.merchantId },
            amount: payout.amountPiastres,
          },
          { account: { type: 'cheques_payable' }, amount: negate(payout.amountPiastres) },
        ],
      }))!;
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'finance.payout_paid',
        entityType: 'payout',
        entityId: payout.id,
        before: { status: 'draft' },
        after: { status: 'paid', reference: label, amount: payout.amountPiastres },
      });
    } else {
      if (cheque.amountPiastres > (await depositHeldTx(tx, cheque.merchantId!)))
        throw new DomainError('more_than_deposit');
      entry = (await post(tx, {
        kind: 'deposit_refunded',
        idempotencyKey: `cheque:${cheque.id}:book`,
        occurredAt: new Date(),
        createdById: input.actorUserId,
        memo,
        merchantId: cheque.merchantId,
        data: { chequeId: cheque.id },
        lines: [
          { account: partyAccount(cheque), amount: cheque.amountPiastres },
          { account: { type: 'cheques_payable' }, amount: negate(cheque.amountPiastres) },
        ],
      }))!;
    }
    const status = cheque.direction === 'received' ? 'received' : 'issued';
    await tx.cheque.update({ where: { id: cheque.id }, data: { status, bookEntryId: entry.id } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.cheque_book',
      entityType: 'cheque',
      entityId: cheque.id,
      before: { status: cheque.status },
      after: { status, entry: entry.number },
    });
    return entry;
  });
}

/** The bill amount a cheque of `cash` settles, withholding tax included. */
function settledFor(
  bill: { netPiastres: number; totalPiastres: number; whtBp: number; paidPiastres: number },
  cash: number,
) {
  const left = bill.totalPiastres - bill.paidPiastres;
  // The cash part grows with the amount settled; start from the exact share and walk.
  let settles = Math.min(
    left,
    Math.round(
      (cash * bill.totalPiastres) / (bill.totalPiastres - (bill.netPiastres * bill.whtBp) / 10_000),
    ),
  );
  for (let i = 0; i < 1000 && settles - withholdingFor(bill, settles) > cash; i++) settles--;
  for (let i = 0; i < 1000 && settles < left && settles - withholdingFor(bill, settles) < cash; i++)
    settles++;
  return settles;
}

/** A received cheque handed to our bank for collection (no money moves yet). */
export function depositCheque(
  db: Db,
  input: { chequeId: string; bankAccountId?: string; day?: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const cheque = await lockCheque(tx, input.chequeId);
    if (cheque.direction !== 'received' || cheque.status !== 'received')
      throw new DomainError('cheque_not_open');
    const bank = await bankAccount(tx, input.bankAccountId);
    const bankId =
      'id' in bank
        ? bank.id
        : (await tx.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } })).id;
    const at = eventTime(input.day);
    await tx.cheque.update({
      where: { id: cheque.id },
      data: { status: 'deposited', bankAccountId: bankId, depositedAt: at },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.cheque_deposit',
      entityType: 'cheque',
      entityId: cheque.id,
      before: { status: cheque.status },
      after: { status: 'deposited', bankAccountId: bankId },
    });
    return { status: 'deposited' as const };
  });
}

/**
 * The bank paid the cheque. A received cheque moves from cheques under collection into the
 * bank (never before its due day); one we wrote leaves the bank, which must hold the money.
 */
export function clearCheque(
  db: Db,
  input: { chequeId: string; bankAccountId?: string; day?: string; actorUserId: string },
) {
  const at = eventTime(input.day);
  const day = cairoDay(at);
  return inTransaction(db, async (tx) => {
    const cheque = await lockCheque(tx, input.chequeId);
    const open =
      cheque.direction === 'received'
        ? cheque.status === 'received' || cheque.status === 'deposited'
        : cheque.status === 'issued';
    if (!open) throw new DomainError('cheque_not_open');
    if (cheque.direction === 'received' && day < dayText(cheque.dueDate))
      throw new DomainError('cheque_not_due');
    const bankId =
      cheque.direction === 'issued'
        ? cheque.bankAccountId!
        : (input.bankAccountId ?? cheque.bankAccountId ?? undefined);
    const bank = await bankAccount(tx, bankId);
    if (cheque.direction === 'issued') {
      await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id = ${cheque.bankAccountId} FOR UPDATE`;
      if (cheque.amountPiastres > (await balanceOf(tx, bank)))
        throw new DomainError('not_enough_money');
    }
    const label = chequeLabel(cheque.number);
    const amount = cheque.amountPiastres;
    const entry = (await post(tx, {
      kind: 'cheque_cleared',
      idempotencyKey: `cheque:${cheque.id}:clear`,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: `${label} ${cheque.chequeNumber} ${cheque.partyName}`,
      merchantId: cheque.merchantId,
      data: { chequeId: cheque.id, direction: cheque.direction },
      lines:
        cheque.direction === 'received'
          ? [
              { account: bank, amount },
              { account: { type: 'cheques_under_collection' }, amount: negate(amount) },
            ]
          : [
              { account: { type: 'cheques_payable' }, amount },
              { account: bank, amount: negate(amount) },
            ],
    }))!;
    const bankAccountId =
      'id' in bank
        ? bank.id
        : (await tx.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } })).id;
    await tx.cheque.update({
      where: { id: cheque.id },
      data: { status: 'cleared', clearedAt: at, clearEntryId: entry.id, bankAccountId },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.cheque_clear',
      entityType: 'cheque',
      entityId: cheque.id,
      before: { status: cheque.status },
      after: { status: 'cleared', entry: entry.number },
    });
    return { status: 'cleared' as const, entryId: entry.id, number: entry.number };
  });
}

/**
 * Undoes a booked cheque with its booking's lines turned round: the party owes (or is owed)
 * again, a bill is open again for what the cheque settled, a payout paid by it is cancelled.
 */
async function reverseBooking(
  tx: Tx,
  cheque: Cheque,
  kind: 'cheque_bounced' | 'cheque_cancelled',
  at: Date,
  actorUserId: string,
  why: string,
) {
  const booked = await tx.ledgerEntry.findUniqueOrThrow({
    where: { id: cheque.bookEntryId! },
    include: { lines: true },
  });
  const entry = (await post(tx, {
    kind,
    idempotencyKey: `cheque:${cheque.id}:reverse`,
    occurredAt: at,
    createdById: actorUserId,
    memo: `${chequeLabel(cheque.number)} ${cheque.chequeNumber}: ${why}`,
    merchantId: cheque.merchantId,
    data: { chequeId: cheque.id, reverses: booked.id },
    lines: booked.lines.map((l) => ({
      account: { id: l.accountId },
      amount: negate(l.amountPiastres),
      tags: {
        darkStoreId: l.darkStoreId,
        merchantId: l.merchantId,
        riderId: l.riderId,
        userId: l.userId,
      },
    })),
  }))!;
  if (cheque.purpose === 'bill') {
    const gross = (booked.data as { gross?: number } | null)?.gross ?? 0;
    const bill = await tx.bill.findUniqueOrThrow({ where: { id: cheque.billId! } });
    await tx.bill.update({
      where: { id: bill.id },
      data: { paidPiastres: bill.paidPiastres - gross, status: 'open' },
    });
    await recordAudit(tx, {
      actorUserId,
      action: 'finance.bill_payment_undone',
      entityType: 'bill',
      entityId: bill.id,
      before: { paid: bill.paidPiastres, status: bill.status },
      after: {
        paid: bill.paidPiastres - gross,
        status: 'open',
        cheque: chequeLabel(cheque.number),
      },
    });
  }
  if (cheque.purpose === 'payout') {
    await tx.payout.updateMany({
      where: { id: cheque.payoutId!, status: 'paid' },
      data: { status: 'cancelled', note: `${chequeLabel(cheque.number)}: ${why}` },
    });
    await recordAudit(tx, {
      actorUserId,
      action: 'finance.payout_cancel',
      entityType: 'payout',
      entityId: cheque.payoutId!,
      before: { status: 'paid' },
      after: { status: 'cancelled', note: why },
    });
  }
  return entry;
}

/** The cheque came back unpaid: its booking is undone and admin and finance are alerted. */
export function bounceCheque(
  db: Db,
  input: { chequeId: string; reason: string; day?: string; actorUserId: string },
) {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new DomainError('reason_required', 400);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const cheque = await lockCheque(tx, input.chequeId);
    const open =
      cheque.direction === 'received'
        ? cheque.status === 'received' || cheque.status === 'deposited'
        : cheque.status === 'issued';
    if (!open || !cheque.bookEntryId) throw new DomainError('cheque_not_open');
    const entry = await reverseBooking(tx, cheque, 'cheque_bounced', at, input.actorUserId, reason);
    await tx.cheque.update({
      where: { id: cheque.id },
      data: { status: 'bounced', bouncedAt: at, bounceReason: reason, reverseEntryId: entry.id },
    });
    await tx.alert.createMany({
      data: [
        {
          type: 'cheque_bounced',
          key: `cheque_bounced:${cheque.id}`,
          merchantId: cheque.merchantId,
          data: {
            chequeId: cheque.id,
            number: chequeLabel(cheque.number),
            chequeNumber: cheque.chequeNumber,
            party: cheque.partyName,
            amount: egpText(cheque.amountPiastres),
            reason,
          },
        },
      ],
      skipDuplicates: true,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.cheque_bounce',
      entityType: 'cheque',
      entityId: cheque.id,
      before: { status: cheque.status },
      after: { status: 'bounced', reason, entry: entry.number },
    });
    return { status: 'bounced' as const, entryId: entry.id };
  });
}

/**
 * Cancels a cheque that never reached the bank: one still waiting for approval (its request
 * is withdrawn) or one booked and not yet deposited or cleared (its booking is undone).
 */
export function cancelCheque(
  db: Db,
  input: { chequeId: string; note: string; actorUserId: string },
) {
  const note = input.note.trim();
  if (note.length < 3) throw new DomainError('note_required', 400);
  return inTransaction(db, async (tx) => {
    const cheque = await lockCheque(tx, input.chequeId);
    let reverseEntryId: string | null = null;
    if (cheque.status === 'awaiting_approval') {
      const requests = await pendingRequestsFor(tx, cheque.id);
      for (const r of requests)
        await tx.financeRequest.updateMany({
          where: { id: r.id, status: 'pending' },
          data: {
            status: 'cancelled',
            decidedAt: new Date(),
            decidedById: input.actorUserId,
            decisionNote: note,
          },
        });
    } else if (cheque.status === 'received' || cheque.status === 'issued') {
      reverseEntryId = (
        await reverseBooking(tx, cheque, 'cheque_cancelled', new Date(), input.actorUserId, note)
      ).id;
    } else throw new DomainError('cheque_not_cancellable');
    await tx.cheque.update({
      where: { id: cheque.id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelNote: note, reverseEntryId },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.cheque_cancel',
      entityType: 'cheque',
      entityId: cheque.id,
      before: { status: cheque.status },
      after: { status: 'cancelled', note },
    });
    return { status: 'cancelled' as const };
  });
}

function pendingRequestsFor(tx: Tx, chequeId: string) {
  return tx.financeRequest.findMany({
    where: {
      status: 'pending',
      kind: { in: ['cheque_in', 'cheque_out'] },
      payload: { path: ['input', 'chequeId'], equals: chequeId },
    },
  });
}

/** A cheque's request was rejected or withdrawn: the cheque is cancelled with the note. */
export async function dropChequeRequest(tx: Tx, request: FinanceRequest, note: string | null) {
  if (request.kind !== 'cheque_in' && request.kind !== 'cheque_out') return;
  const chequeId = (request.payload as { input?: { chequeId?: string } }).input?.chequeId;
  if (!chequeId) return;
  await tx.cheque.updateMany({
    where: { id: chequeId, status: 'awaiting_approval' },
    data: {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelNote: note ?? request.status,
    },
  });
}

// ─── lists ───────────────────────────────────────────────────────────────────────

const LIST_INCLUDE = {
  merchant: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  bill: { select: { id: true, number: true, reference: true } },
  payout: { select: { id: true, number: true } },
  bankAccount: { select: { id: true, code: true, nameEn: true, nameAr: true } },
} satisfies Prisma.ChequeInclude;

type ChequeRow = Prisma.ChequeGetPayload<{ include: typeof LIST_INCLUDE }>;

function chequeView(c: ChequeRow) {
  return {
    id: c.id,
    number: c.number,
    label: chequeLabel(c.number),
    direction: c.direction,
    purpose: c.purpose,
    status: c.status,
    chequeNumber: c.chequeNumber,
    bankName: c.bankName,
    partyName: c.partyName,
    amountPiastres: c.amountPiastres,
    issueDate: dayText(c.issueDate),
    dueDate: dayText(c.dueDate),
    merchant: c.merchant,
    supplier: c.supplier,
    bill: c.bill,
    payout: c.payout,
    bankAccount: c.bankAccount,
    createdAt: c.createdAt,
  };
}

/** The register, newest first, optionally by status or direction. */
export async function listCheques(
  db: Db,
  filter: { status?: Cheque['status']; direction?: Cheque['direction'] } = {},
) {
  const rows = await db.cheque.findMany({
    where: { status: filter.status, direction: filter.direction },
    include: LIST_INCLUDE,
    orderBy: { number: 'desc' },
    take: 500,
  });
  return rows.map(chequeView);
}

/** Cheques still waiting for their money: overdue, and due within the next seven days. */
export async function chequesDue(db: Db, today: string = cairoDay(new Date())) {
  const rows = await db.cheque.findMany({
    where: {
      status: { in: ['received', 'deposited', 'issued'] },
      dueDate: { lte: dateOf(addDays(today, 6)) },
    },
    include: LIST_INCLUDE,
    orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
  });
  const views = rows.map(chequeView);
  return {
    today,
    overdue: views.filter((c) => c.dueDate < today),
    thisWeek: views.filter((c) => c.dueDate >= today),
  };
}

/** One cheque with its entries and any request waiting for a second person. */
export async function getCheque(db: Db, id: string) {
  const c = await db.cheque.findUnique({
    where: { id },
    include: {
      ...LIST_INCLUDE,
      incomeAccount: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      bookEntry: { select: { id: true, number: true } },
      clearEntry: { select: { id: true, number: true } },
      reverseEntry: { select: { id: true, number: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!c) throw new DomainError('cheque_not_found', 404);
  const request =
    c.status === 'awaiting_approval' ? (await pendingRequestsFor(db as Tx, c.id))[0] : null;
  return {
    ...chequeView(c),
    note: c.note,
    photoId: c.photoId,
    incomeAccount: c.incomeAccount,
    bookEntry: c.bookEntry,
    clearEntry: c.clearEntry,
    reverseEntry: c.reverseEntry,
    depositedAt: c.depositedAt,
    clearedAt: c.clearedAt,
    bouncedAt: c.bouncedAt,
    bounceReason: c.bounceReason,
    cancelledAt: c.cancelledAt,
    cancelNote: c.cancelNote,
    createdBy: c.createdBy.name,
    requestId: request?.id ?? null,
    approvalThresholdPiastres: await getSetting(db, 'finance.approval_threshold_piastres'),
  };
}

/** The security deposit we hold for a merchant (credit balance of its 2600 wallet). */
async function depositHeldTx(tx: Db, merchantId: string) {
  return negate(await balanceOf(tx, { type: 'merchant_deposit', merchantId }));
}
