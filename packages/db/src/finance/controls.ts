import type { Prisma } from '@prisma/client';
import { addDays, cairoDay, cairoDayStart, debitNormal, isCalendarDay } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { getSetting } from '../settings';
import { eventTime, recordCapital, recordExpense, recordOtherIncome } from './books';
import { post } from './ledger';
import { recordMerchantAdjustment, recordMerchantReceipt } from './operations';

type Tx = Prisma.TransactionClient;

// Controls on top of the books: closing months, a second person for large amounts, receipts
// attached to money movements, and the opening balances of the day the books start.
//
//   expense / drawings ──(below the limit)──────────────────────▶ posted at once
//          └──(from the limit)──▶ request: pending ──approve (another person)──▶ posted
//                                              └──reject (with a note)
//   payout: draft ──approve (another person, from the limit)──▶ paid ──▶ posted

// ─── closing months ─────────────────────────────────────────────────────────────

/** Through which Cairo day the books are closed, or null while nothing is closed. */
export async function booksLock(db: Db) {
  const lock = await db.booksLock.findUnique({
    where: { id: 'books' },
    include: { updatedBy: { select: { name: true } } },
  });
  return lock
    ? {
        closedThrough: lock.closedThrough.toISOString().slice(0, 10),
        lockedBefore: lock.lockedBefore,
        updatedAt: lock.updatedAt,
        updatedBy: lock.updatedBy.name,
      }
    : null;
}

/**
 * Closes the books through a Cairo day (only days already over), so nothing can be posted
 * on or before it. Moving the date back reopens days: admin only, with a written reason.
 */
export async function closeBooks(
  db: Db,
  input: {
    day: string;
    reason?: string;
    actorUserId: string;
    actorRole: 'admin' | 'finance';
    now?: Date;
  },
) {
  if (!isCalendarDay(input.day)) throw new DomainError('invalid_date', 400);
  const today = cairoDay(input.now ?? new Date());
  if (input.day >= today) throw new DomainError('day_not_over', 400);
  return inTransaction(db, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('books_lock'))`;
    const before = await tx.booksLock.findUnique({ where: { id: 'books' } });
    const was = before?.closedThrough.toISOString().slice(0, 10) ?? null;
    if (was === input.day) return { closedThrough: was, changed: false };
    const reopening = was !== null && input.day < was;
    const reason = input.reason?.trim() ?? '';
    if (reopening) {
      if (input.actorRole !== 'admin') throw new DomainError('reopen_admin_only', 403);
      if (reason.length < 5) throw new DomainError('reason_required', 400);
    }
    const data = {
      closedThrough: new Date(`${input.day}T00:00:00Z`),
      lockedBefore: cairoDayStart(addDays(input.day, 1)),
      updatedById: input.actorUserId,
    };
    await tx.booksLock.upsert({ where: { id: 'books' }, create: data, update: data });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: reopening ? 'finance.books_reopen' : 'finance.books_close',
      entityType: 'books',
      entityId: 'books',
      before: { closedThrough: was },
      after: { closedThrough: input.day, ...(reason ? { reason } : {}) },
    });
    return { closedThrough: input.day, changed: true };
  });
}

// ─── a second person for large amounts ─────────────────────────────────────────

/** From this amount (piastres) a second person approves; 0 means nobody needs to. */
export function approvalThreshold(db: Db) {
  return getSetting(db, 'finance.approval_threshold_piastres');
}

async function needsApproval(db: Db, amount: number) {
  const limit = await approvalThreshold(db);
  return limit > 0 && amount >= limit;
}

type ExpenseInput = Parameters<typeof recordExpense>[1];
type CapitalInput = Omit<Parameters<typeof recordCapital>[1], 'direction'>;
type IncomeInput = Parameters<typeof recordOtherIncome>[1];
type ReceiptInput = Parameters<typeof recordMerchantReceipt>[1];
type AdjustmentInput = Parameters<typeof recordMerchantAdjustment>[1];
type Stored<T> = Omit<T, 'actorUserId'>;
export type RequestPayload =
  | { kind: 'expense'; input: Stored<ExpenseInput> }
  | { kind: 'drawings'; input: Stored<CapitalInput> }
  | { kind: 'capital_in'; input: Stored<CapitalInput> }
  | { kind: 'other_income'; input: Stored<IncomeInput> }
  | { kind: 'merchant_receipt'; input: Stored<ReceiptInput> }
  | { kind: 'merchant_adjustment'; input: Stored<AdjustmentInput> };

/**
 * Money said to come in (owner capital, other income, a merchant paying us) and changes to
 * what we owe a merchant are where money could be created on paper and then taken out as a
 * payout or an expense. While finance.approve_money_in is on, each waits for a second
 * person whatever the amount; money going out waits from the approval limit.
 */
const ALWAYS_REVIEWED = new Set([
  'capital_in',
  'other_income',
  'merchant_receipt',
  'merchant_adjustment',
]);

const referenceOf = (p: RequestPayload) =>
  'reference' in p.input ? p.input.reference : 'reason' in p.input ? p.input.reason : '';
const dayOf = (p: RequestPayload) => ('day' in p.input ? p.input.day : undefined);

/** Posts the movement now, or keeps it as a request when it needs a second person. */
async function submit(
  db: Db,
  payload: RequestPayload,
  actorUserId: string,
  receiptPhotoId?: string,
) {
  const amount = Math.abs(payload.input.amountPiastres);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('invalid_amount', 400);
  const reviewed = ALWAYS_REVIEWED.has(payload.kind)
    ? (await getSetting(db, 'finance.approve_money_in')) === 1
    : await needsApproval(db, amount);
  if (!reviewed) {
    const entry = await execute(db, payload, actorUserId);
    if (receiptPhotoId)
      await attachReceipt(db, { entryId: entry.id, photoId: receiptPhotoId, actorUserId });
    return { status: 'posted' as const, entry };
  }
  // Same check the movement makes when it is finally posted, so a bad request fails now.
  eventTime(dayOf(payload));
  return inTransaction(db, async (tx) => {
    const seen = await tx.financeRequest.findFirst({
      where: {
        payload: { path: ['input', 'idempotencyKey'], equals: payload.input.idempotencyKey },
      },
    });
    if (seen) return { status: 'pending' as const, request: seen };
    const request = await tx.financeRequest.create({
      data: {
        kind: payload.kind,
        amountPiastres: amount,
        payload: payload as unknown as Prisma.InputJsonValue,
        requestedById: actorUserId,
      },
    });
    if (receiptPhotoId)
      await attachReceipt(tx, { requestId: request.id, photoId: receiptPhotoId, actorUserId });
    await recordAudit(tx, {
      actorUserId,
      action: 'finance.request_create',
      entityType: 'finance_request',
      entityId: request.id,
      after: {
        kind: payload.kind,
        amount: payload.input.amountPiastres,
        reference: referenceOf(payload),
      },
    });
    return { status: 'pending' as const, request };
  });
}

function execute(db: Db, p: RequestPayload, actorUserId: string): Promise<{ id: string }> {
  switch (p.kind) {
    case 'expense':
      return recordExpense(db, { ...p.input, actorUserId });
    case 'drawings':
      return recordCapital(db, { ...p.input, direction: 'out', actorUserId });
    case 'capital_in':
      return recordCapital(db, { ...p.input, direction: 'in', actorUserId });
    case 'other_income':
      return recordOtherIncome(db, { ...p.input, actorUserId });
    case 'merchant_receipt':
      return recordMerchantReceipt(db, { ...p.input, actorUserId });
    case 'merchant_adjustment':
      return recordMerchantAdjustment(db, { ...p.input, actorUserId });
  }
}

type WithReceipt<T> = T & { receiptPhotoId?: string };
const submitter =
  <K extends RequestPayload['kind'], T extends { actorUserId: string }>(kind: K) =>
  (db: Db, input: WithReceipt<T>) => {
    const { actorUserId, receiptPhotoId, ...rest } = input;
    return submit(
      db,
      { kind, input: rest } as unknown as RequestPayload,
      actorUserId,
      receiptPhotoId,
    );
  };

/** An expense: posted at once below the approval limit, otherwise waiting for approval. */
export const submitExpense = submitter<'expense', ExpenseInput>('expense');
/** The owner takes money out: posted at once below the limit, otherwise waiting. */
export const submitDrawings = submitter<'drawings', CapitalInput>('drawings');
/** The owner puts money in: waits for a second person (finance.approve_money_in). */
export const submitCapitalIn = submitter<'capital_in', CapitalInput>('capital_in');
/** Income that is not a fee: waits for a second person (finance.approve_money_in). */
export const submitOtherIncome = submitter<'other_income', IncomeInput>('other_income');
/** A merchant paid us by transfer: waits for a second person (finance.approve_money_in). */
export const submitMerchantReceipt = submitter<'merchant_receipt', ReceiptInput>(
  'merchant_receipt',
);
/** A change to what we owe a merchant: waits for a second person (finance.approve_money_in). */
export const submitMerchantAdjustment = submitter<'merchant_adjustment', AdjustmentInput>(
  'merchant_adjustment',
);

/** Requests waiting for (or decided by) a second person, newest first. */
export async function listFinanceRequests(
  db: Db,
  status?: Prisma.FinanceRequestWhereInput['status'],
) {
  const rows = await db.financeRequest.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      requestedBy: { select: { id: true, name: true } },
      decidedBy: { select: { name: true } },
      entry: { select: { number: true } },
      _count: { select: { receipts: true } },
    },
  });
  return rows.map((r) => {
    const p = r.payload as unknown as RequestPayload;
    return {
      id: r.id,
      kind: r.kind,
      amountPiastres: r.amountPiastres,
      status: r.status,
      reference: referenceOf(p),
      memo: 'memo' in p.input ? (p.input.memo ?? null) : null,
      day: dayOf(p) ?? null,
      requestedBy: r.requestedBy,
      createdAt: r.createdAt,
      decidedBy: r.decidedBy?.name ?? null,
      decidedAt: r.decidedAt,
      decisionNote: r.decisionNote,
      entryNumber: r.entry?.number ?? null,
      receipts: r._count.receipts,
    };
  });
}

/**
 * A second person approves (the movement is posted as entered) or rejects (with a note) a
 * waiting request. Whoever asked can never decide it.
 */
export async function decideFinanceRequest(
  db: Db,
  input: { requestId: string; approve: boolean; note?: string; actorUserId: string },
) {
  const request = await db.financeRequest.findUnique({ where: { id: input.requestId } });
  if (!request) throw new DomainError('request_not_found', 404);
  if (request.status !== 'pending') throw new DomainError('request_not_pending');
  if (request.requestedById === input.actorUserId) throw new DomainError('same_person', 403);
  const note = input.note?.trim() || null;
  if (!input.approve && !note) throw new DomainError('note_required', 400);
  return inTransaction(db, async (tx) => {
    // Claim the request first, so two approvers at once cannot both post it.
    const claimed = await tx.financeRequest.updateMany({
      where: { id: request.id, status: 'pending' },
      data: {
        status: input.approve ? 'approved' : 'rejected',
        decidedById: input.actorUserId,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    if (claimed.count !== 1) throw new DomainError('request_not_pending');
    let entryId: string | null = null;
    if (input.approve) {
      const entry = await execute(
        tx,
        request.payload as unknown as RequestPayload,
        request.requestedById,
      );
      entryId = entry.id;
      await tx.financeRequest.update({ where: { id: request.id }, data: { entryId } });
    }
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: input.approve ? 'finance.request_approve' : 'finance.request_reject',
      entityType: 'finance_request',
      entityId: request.id,
      before: { status: 'pending' },
      after: { status: input.approve ? 'approved' : 'rejected', note, entryId },
    });
    return { status: input.approve ? ('approved' as const) : ('rejected' as const), entryId };
  });
}

/** Whoever asked may take back a request nobody has decided yet. */
export function cancelFinanceRequest(db: Db, input: { requestId: string; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    const request = await tx.financeRequest.findUnique({ where: { id: input.requestId } });
    if (!request) throw new DomainError('request_not_found', 404);
    if (request.requestedById !== input.actorUserId) throw new DomainError('not_your_request', 403);
    const updated = await tx.financeRequest.updateMany({
      where: { id: request.id, status: 'pending' },
      data: { status: 'cancelled', decidedAt: new Date() },
    });
    if (updated.count !== 1) throw new DomainError('request_not_pending');
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.request_cancel',
      entityType: 'finance_request',
      entityId: request.id,
      before: { status: 'pending' },
      after: { status: 'cancelled' },
    });
    return { status: 'cancelled' as const };
  });
}

/** Whether a payout of this amount needs a second person before it is paid. */
export function payoutNeedsApproval(db: Db, amount: number) {
  return needsApproval(db, amount);
}

/** A second person approves a large payout; whoever prepared it never can. */
export function approvePayout(db: Db, input: { payoutId: string; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: input.payoutId } });
    if (!payout) throw new DomainError('payout_not_found', 404);
    if (payout.status !== 'draft') throw new DomainError('payout_not_draft');
    if (payout.approvedById) throw new DomainError('already_approved');
    if (payout.createdById === input.actorUserId) throw new DomainError('same_person', 403);
    const updated = await tx.payout.updateMany({
      where: { id: payout.id, status: 'draft', approvedById: null },
      data: { approvedById: input.actorUserId, approvedAt: new Date() },
    });
    if (updated.count !== 1) throw new DomainError('payout_not_draft');
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.payout_approve',
      entityType: 'payout',
      entityId: payout.id,
      after: { amount: payout.amountPiastres },
    });
    return { approved: true };
  });
}

// ─── receipts ──────────────────────────────────────────────────────────────────

/** Attaches a receipt or transfer slip photo to one entry, payout or request. */
export async function attachReceipt(
  db: Db,
  input: {
    entryId?: string;
    payoutId?: string;
    requestId?: string;
    photoId: string;
    actorUserId: string;
  },
) {
  const targets = [input.entryId, input.payoutId, input.requestId].filter(Boolean);
  if (targets.length !== 1) throw new DomainError('receipt_target_invalid', 400);
  const photo = await db.photo.findUnique({ where: { id: input.photoId }, select: { kind: true } });
  if (!photo || photo.kind !== 'receipt') throw new DomainError('photo_not_found', 404);
  if (input.entryId && !(await db.ledgerEntry.findUnique({ where: { id: input.entryId } })))
    throw new DomainError('entry_not_found', 404);
  if (input.payoutId && !(await db.payout.findUnique({ where: { id: input.payoutId } })))
    throw new DomainError('payout_not_found', 404);
  if (input.requestId && !(await db.financeRequest.findUnique({ where: { id: input.requestId } })))
    throw new DomainError('request_not_found', 404);
  const receipt = await db.financeReceipt.create({
    data: {
      photoId: input.photoId,
      entryId: input.entryId ?? null,
      payoutId: input.payoutId ?? null,
      requestId: input.requestId ?? null,
      createdById: input.actorUserId,
    },
  });
  await recordAudit(db as Tx, {
    actorUserId: input.actorUserId,
    action: 'finance.receipt_attach',
    entityType: input.entryId ? 'ledger_entry' : input.payoutId ? 'payout' : 'finance_request',
    entityId: (input.entryId ?? input.payoutId ?? input.requestId)!,
    after: { photoId: input.photoId },
  });
  return { id: receipt.id };
}

/** Photos attached to an entry (directly, through its payout or its approved request). */
export async function receiptsFor(db: Db, target: { entryId?: string; payoutId?: string }) {
  if (target.payoutId)
    return (
      await db.financeReceipt.findMany({
        where: { payoutId: target.payoutId },
        orderBy: { createdAt: 'asc' },
      })
    ).map((r) => ({ id: r.id, photoId: r.photoId, createdAt: r.createdAt }));
  const rows = await db.$queryRaw<{ id: string; photo_id: string; created_at: Date }[]>`
    SELECT r.id, r.photo_id, r.created_at FROM finance_receipts r
    WHERE r.entry_id = ${target.entryId}
       OR r.request_id IN (SELECT id FROM finance_requests WHERE entry_id = ${target.entryId})
       OR r.payout_id IN (SELECT (data->>'payoutId') FROM ledger_entries WHERE id = ${target.entryId})
    ORDER BY r.created_at`;
  return rows.map((r) => ({ id: r.id, photoId: r.photo_id, createdAt: r.created_at }));
}

/** Kinds of entry an auditor expects a receipt or transfer slip for. */
export const RECEIPT_KINDS = [
  'expense',
  'bank_deposit',
  'money_transfer',
  'capital_in',
  'capital_out',
  'other_income',
  'merchant_payout',
  'merchant_receipt',
  'rider_bonus_payout',
];

/** Money movements without any receipt yet, newest first, and how many there are. */
export async function missingReceipts(db: Db, limit = 200) {
  const where = (alias: string) => `
    ${alias}.kind = ANY($1)
    AND NOT EXISTS (SELECT 1 FROM finance_receipts r WHERE r.entry_id = ${alias}.id)
    AND NOT EXISTS (SELECT 1 FROM finance_receipts r JOIN finance_requests q ON q.id = r.request_id
                    WHERE q.entry_id = ${alias}.id)
    AND NOT EXISTS (SELECT 1 FROM finance_receipts r WHERE r.payout_id = ${alias}.data->>'payoutId')`;
  const [count] = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM ledger_entries e WHERE ${where('e')}`,
    RECEIPT_KINDS,
  );
  const rows = await db.$queryRawUnsafe<
    {
      id: string;
      number: number;
      kind: string;
      occurred_at: Date;
      memo: string | null;
      amount: bigint;
    }[]
  >(
    `SELECT e.id, e.number, e.kind, e.occurred_at, e.memo,
       (SELECT SUM(amount_piastres) FROM ledger_lines l WHERE l.entry_id = e.id AND amount_piastres > 0) AS amount
     FROM ledger_entries e WHERE ${where('e')}
     ORDER BY e.occurred_at DESC LIMIT $2`,
    RECEIPT_KINDS,
    limit,
  );
  return {
    count: Number(count?.n ?? 0),
    entries: rows.map((r) => ({
      id: r.id,
      number: r.number,
      kind: r.kind,
      at: r.occurred_at,
      memo: r.memo,
      amountPiastres: Number(r.amount ?? 0),
    })),
  };
}

// ─── opening balances ──────────────────────────────────────────────────────────

/**
 * The balances the books start from on the first day (banks, cash, what is owed both ways),
 * as one entry against the Opening balances account. Amounts are as an accountant reads
 * them: positive is the account's normal side (money held, money owed to the creditor).
 * Posted once; later corrections are journal entries.
 */
export function recordOpeningBalances(
  db: Db,
  input: {
    day: string;
    lines: { accountId: string; amountPiastres: number }[];
    actorUserId: string;
  },
) {
  if (!isCalendarDay(input.day)) throw new DomainError('invalid_date', 400);
  if (input.day > cairoDay(new Date())) throw new DomainError('future_date', 400);
  // The very start of the first day, before anything else that day.
  const at = cairoDayStart(input.day);
  const lines = input.lines.filter((l) => l.amountPiastres !== 0);
  if (lines.length === 0) throw new DomainError('nothing_to_post', 400);
  if (new Set(lines.map((l) => l.accountId)).size !== lines.length)
    throw new DomainError('account_twice', 400);
  return inTransaction(db, async (tx) => {
    if (await tx.ledgerEntry.findUnique({ where: { idempotencyKey: 'opening_balance' } }))
      throw new DomainError('opening_already_posted');
    const opening = await tx.ledgerAccount.findUnique({ where: { key: 'equity:opening' } });
    if (!opening) throw new DomainError('account_not_found', 404);
    const posted: { account: { id: string }; amount: number }[] = [];
    for (const l of lines) {
      if (!Number.isSafeInteger(l.amountPiastres)) throw new DomainError('invalid_amount', 400);
      const account = await tx.ledgerAccount.findUnique({ where: { id: l.accountId } });
      if (!account || account.id === opening.id) throw new DomainError('account_not_found', 404);
      if (!account.isActive) throw new DomainError('account_inactive');
      const debit = debitNormal(account.category) ? l.amountPiastres : -l.amountPiastres;
      posted.push({ account: { id: account.id }, amount: debit });
    }
    const total = posted.reduce((s, l) => s + l.amount, 0);
    if (total !== 0) posted.push({ account: { id: opening.id }, amount: -total });
    const entry = await post(tx, {
      kind: 'opening_balance',
      idempotencyKey: 'opening_balance',
      occurredAt: at,
      createdById: input.actorUserId,
      memo: `Opening balances ${input.day}`,
      data: { day: input.day },
      lines: posted,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.opening_balances',
      entityType: 'ledger_entry',
      entityId: entry!.id,
      after: { day: input.day, accounts: lines.length, openingEquity: -total },
    });
    return entry!;
  });
}
