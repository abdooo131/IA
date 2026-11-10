import type { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  claimCancellable,
  employeeCode,
  expenseClaimNumber,
  type ExpenseClaimBody,
  type ExpenseClaimStatus,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { managerOf } from '../hr-org';
import { getSetting } from '../settings';
import { mustHold } from './books';
import { payoutNeedsApproval } from './controls';
import { nextNumber, post } from './ledger';

type Tx = Prisma.TransactionClient;

// Employee expense claims (EC-000001): a person paid a work cost from their own pocket and
// claims it back from My HR with a receipt photo.
//
//   pending_manager ──manager in force approves──▶ pending_accounting ──accounting pays──▶ paid
//        │ (no manager: straight to pending_accounting)        │
//        ├── the person cancels before any approval            └── rejected (reason)
//        └── rejected with a reason (manager)
//
// Paying posts one entry, tagged with the store (none: company wide) and the person:
//
//   Dr expense category (claimable)   amount
//   Cr bank or cash box               amount   (never more than it holds, row locked)
//
// No VAT is split out: the receipt is a small purchase paid by a person, so the whole amount is
// the cost. Nobody decides their own claim; from finance.approval_threshold_piastres the
// person who pays must not be the manager who approved it (the second person rule).

const EXPENSE_GROUPS = [5400, 5500];
const MONEY_GROUPS = [1100, 1200];

const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);
const dayText = (d: Date) => d.toISOString().slice(0, 10);

// ─── categories ─────────────────────────────────────────────────────────────────

/** Expense categories, and which of them employees may claim. */
export async function claimCategories(db: Db, onlyClaimable = false) {
  const rows = await db.ledgerAccount.findMany({
    where: {
      groupCode: { in: EXPENSE_GROUPS },
      isActive: true,
      ...(onlyClaimable ? { claimable: true } : {}),
    },
    select: { id: true, code: true, nameEn: true, nameAr: true, claimable: true },
    orderBy: { code: 'asc' },
  });
  return rows.map((r) => ({
    ...r,
    nameEn: r.nameEn ?? r.code,
    nameAr: r.nameAr ?? r.nameEn ?? '',
  }));
}

/** Finance marks an expense category as one employees may claim (audited). */
export function setClaimableCategory(
  db: Db,
  input: { accountId: string; claimable: boolean; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.ledgerAccount.findUnique({ where: { id: input.accountId } });
    if (!before || !EXPENSE_GROUPS.includes(before.groupCode))
      throw new DomainError('expense_account_not_found', 404);
    if (before.claimable === input.claimable) return { claimable: before.claimable };
    await tx.ledgerAccount.update({
      where: { id: before.id },
      data: { claimable: input.claimable },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.claimable_category',
      entityType: 'ledger_account',
      entityId: before.id,
      before: { claimable: before.claimable },
      after: { claimable: input.claimable },
    });
    return { claimable: input.claimable };
  });
}

// ─── the claim ──────────────────────────────────────────────────────────────────

const claimInclude = {
  employee: {
    select: {
      id: true,
      number: true,
      nameEn: true,
      nameAr: true,
      homeStoreId: true,
    },
  },
  user: { select: { id: true, name: true } },
  darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  expenseAccount: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  managerDecidedBy: { select: { name: true } },
  paidBy: { select: { name: true } },
  paidFrom: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  rejectedBy: { select: { name: true } },
  entry: { select: { id: true, number: true } },
} as const;
type ClaimRow = Prisma.ExpenseClaimGetPayload<{ include: typeof claimInclude }>;

export function claimView(c: ClaimRow) {
  return {
    id: c.id,
    number: expenseClaimNumber(c.number),
    status: c.status as ExpenseClaimStatus,
    employee: {
      id: c.employee.id,
      code: employeeCode(c.employee.number),
      nameEn: c.employee.nameEn,
      nameAr: c.employee.nameAr,
    },
    userId: c.userId,
    store: c.darkStore,
    darkStoreId: c.darkStoreId,
    category: {
      id: c.expenseAccount.id,
      code: c.expenseAccount.code,
      nameEn: c.expenseAccount.nameEn ?? c.expenseAccount.code,
      nameAr: c.expenseAccount.nameAr ?? c.expenseAccount.nameEn ?? '',
    },
    amountPiastres: c.amountPiastres,
    paidOn: dayText(c.paidOn),
    note: c.note,
    photoId: c.photoId,
    hasManager: Boolean(c.managerEmployeeId),
    managerDecidedBy: c.managerDecidedBy?.name ?? null,
    managerDecidedAt: c.managerDecidedAt,
    paidBy: c.paidBy?.name ?? null,
    paidAt: c.paidAt,
    paidFrom: c.paidFrom
      ? {
          id: c.paidFrom.id,
          code: c.paidFrom.code,
          nameEn: c.paidFrom.nameEn ?? c.paidFrom.code,
          nameAr: c.paidFrom.nameAr ?? c.paidFrom.nameEn ?? c.paidFrom.code,
        }
      : null,
    reference: c.reference,
    entry: c.entry,
    rejectedBy: c.rejectedBy?.name ?? null,
    rejectedAt: c.rejectedAt,
    rejectReason: c.rejectReason,
    rejectedStep: c.rejectedStep,
    cancelledAt: c.cancelledAt,
    cancellable: claimCancellable({
      status: c.status as ExpenseClaimStatus,
      managerDecidedAt: c.managerDecidedAt,
    }),
    createdAt: c.createdAt,
  };
}
export type ClaimView = ReturnType<typeof claimView>;

/**
 * A person claims back a work cost: a claimable category, the store it belongs to (or company
 * wide), the day they paid (never ahead of today, never older than claims.max_age_days), a note
 * and a receipt photo. It goes to their manager in force, or straight to accounting without
 * one. The same idempotency key records it once.
 */
export function submitExpenseClaim(
  db: Db,
  input: { userId: string; body: ExpenseClaimBody; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const body = input.body;
    const seen = await tx.expenseClaim.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
      include: claimInclude,
    });
    if (seen) {
      if (seen.userId !== input.userId) throw new DomainError('idempotency_key_reused');
      return claimView(seen);
    }
    if (!Number.isSafeInteger(body.amountPiastres) || body.amountPiastres <= 0)
      throw new DomainError('invalid_amount', 400);
    const e = await tx.employee.findUnique({
      where: { userId: input.userId },
      include: { user: { select: { isActive: true } } },
    });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (e.status === 'left' || !e.user.isActive) throw new DomainError('employee_not_active', 403);
    const today = cairoDay(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.paidOn) || Number.isNaN(dayDate(body.paidOn).getTime()))
      throw new DomainError('invalid_day', 400);
    if (body.paidOn > today) throw new DomainError('day_in_future', 400);
    const maxAge = await getSetting(tx, 'claims.max_age_days');
    if (body.paidOn < addDays(today, -maxAge))
      throw new DomainError('claim_too_old', 400, { days: maxAge });
    const account = await tx.ledgerAccount.findUnique({ where: { id: body.expenseAccountId } });
    if (
      !account ||
      !account.claimable ||
      !account.isActive ||
      !EXPENSE_GROUPS.includes(account.groupCode)
    )
      throw new DomainError('claim_category_not_found', 404);
    if (body.darkStoreId && !(await tx.darkStore.findUnique({ where: { id: body.darkStoreId } })))
      throw new DomainError('store_not_found', 404);
    const photo = await tx.photo.findUnique({
      where: { id: body.photoId },
      select: { kind: true, createdById: true },
    });
    // The receipt is the person's own upload: nobody claims with someone else's photo.
    if (!photo || photo.kind !== 'receipt' || photo.createdById !== input.userId)
      throw new DomainError('receipt_required', 400);
    const manager = await managerOf(tx, e.id);
    const created = await tx.expenseClaim.create({
      data: {
        number: await nextNumber(tx, 'expense_claims'),
        employeeId: e.id,
        userId: input.userId,
        darkStoreId: body.darkStoreId,
        expenseAccountId: account.id,
        amountPiastres: body.amountPiastres,
        paidOn: dayDate(body.paidOn),
        note: body.note.trim(),
        photoId: body.photoId,
        status: manager.managerId ? 'pending_manager' : 'pending_accounting',
        managerEmployeeId: manager.managerId,
        idempotencyKey: body.idempotencyKey,
        createdAt: now,
      },
      include: claimInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.userId,
      action: 'expense_claim.submit',
      entityType: 'expense_claim',
      entityId: created.id,
      after: {
        number: expenseClaimNumber(created.number),
        amount: created.amountPiastres,
        account: account.code,
        darkStoreId: created.darkStoreId,
        paidOn: body.paidOn,
        status: created.status,
      },
    });
    return claimView(created);
  });
}

async function lockClaim(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM expense_claims WHERE id = ${id} FOR UPDATE`;
  const c = await tx.expenseClaim.findUnique({ where: { id }, include: claimInclude });
  if (!c) throw new DomainError('expense_claim_not_found', 404);
  return c;
}

async function audit(
  tx: Tx,
  actorUserId: string,
  action: string,
  c: ClaimRow,
  after: Record<string, unknown>,
) {
  await recordAudit(tx, {
    actorUserId,
    action: `expense_claim.${action}`,
    entityType: 'expense_claim',
    entityId: c.id,
    before: { status: c.status },
    after: after as Prisma.InputJsonValue,
  });
}

/**
 * Step one: the claimant's manager in force approves (to accounting) or refuses with a reason.
 * Nobody decides their own claim; only the manager in force now (as leave requests find him).
 */
export function managerDecideClaim(
  db: Db,
  input: { claimId: string; actorUserId: string; approve: boolean; reason?: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const c = await lockClaim(tx, input.claimId);
    if (c.userId === input.actorUserId) throw new DomainError('own_claim', 403);
    const me = await tx.employee.findUnique({
      where: { userId: input.actorUserId },
      select: { id: true },
    });
    if (!me || (await managerOf(tx, c.employeeId)).managerId !== me.id)
      throw new DomainError('not_your_team', 403);
    if (c.status !== 'pending_manager') throw new DomainError('claim_not_waiting', 409);
    const reason = input.reason?.trim();
    if (!input.approve && (!reason || reason.length < 3))
      throw new DomainError('reason_required', 400);
    const after = await tx.expenseClaim.update({
      where: { id: c.id },
      data: input.approve
        ? {
            status: 'pending_accounting',
            managerDecidedById: input.actorUserId,
            managerDecidedAt: now,
          }
        : {
            status: 'rejected',
            managerDecidedById: input.actorUserId,
            managerDecidedAt: now,
            rejectedById: input.actorUserId,
            rejectedAt: now,
            rejectReason: reason,
            rejectedStep: 'manager',
          },
      include: claimInclude,
    });
    await audit(tx, input.actorUserId, input.approve ? 'manager_approve' : 'reject', c, {
      status: after.status,
      ...(reason ? { reason } : {}),
      step: 'manager',
    });
    return claimView(after);
  });
}

/** The person takes back a claim nobody has approved yet. */
export function cancelExpenseClaim(
  db: Db,
  input: { claimId: string; actorUserId: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const c = await lockClaim(tx, input.claimId);
    if (c.userId !== input.actorUserId) throw new DomainError('expense_claim_not_found', 404);
    if (!claimCancellable(c)) throw new DomainError('claim_not_cancellable', 409);
    const after = await tx.expenseClaim.update({
      where: { id: c.id },
      data: { status: 'cancelled', cancelledAt: input.now ?? new Date() },
      include: claimInclude,
    });
    await audit(tx, input.actorUserId, 'cancel', c, { status: 'cancelled' });
    return claimView(after);
  });
}

/** Accounting refuses an approved claim with a reason (never their own). */
export function rejectExpenseClaim(
  db: Db,
  input: { claimId: string; actorUserId: string; reason: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const c = await lockClaim(tx, input.claimId);
    if (c.userId === input.actorUserId) throw new DomainError('own_claim', 403);
    if (c.status !== 'pending_accounting') throw new DomainError('claim_not_waiting', 409);
    const reason = input.reason.trim();
    if (reason.length < 3) throw new DomainError('reason_required', 400);
    const after = await tx.expenseClaim.update({
      where: { id: c.id },
      data: {
        status: 'rejected',
        rejectedById: input.actorUserId,
        rejectedAt: now,
        rejectReason: reason,
        rejectedStep: 'accounting',
      },
      include: claimInclude,
    });
    await audit(tx, input.actorUserId, 'reject', c, {
      status: 'rejected',
      reason,
      step: 'accounting',
    });
    return claimView(after);
  });
}

/**
 * Accounting pays an approved claim back from a bank or cash box: one entry, the expense
 * category against the money, tagged with the store and the person. Never more than the bank
 * or box holds (its row locked first, then mustHold). Never the claimant's own claim; from
 * finance.approval_threshold_piastres never the manager who approved it. Paying again answers
 * the same claim (the entry's key is expense_claim:<id>).
 */
export function payExpenseClaim(
  db: Db,
  input: {
    claimId: string;
    moneyAccountId: string;
    reference?: string;
    actorUserId: string;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const c = await lockClaim(tx, input.claimId);
    if (c.userId === input.actorUserId) throw new DomainError('own_claim', 403);
    if (c.status === 'paid') return claimView(c);
    if (c.status !== 'pending_accounting') throw new DomainError('claim_not_waiting', 409);
    if (
      c.managerDecidedById === input.actorUserId &&
      (await payoutNeedsApproval(tx, c.amountPiastres))
    )
      throw new DomainError('same_person', 403);
    await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id = ${input.moneyAccountId} FOR UPDATE`;
    const money = await tx.ledgerAccount.findUnique({ where: { id: input.moneyAccountId } });
    if (!money || !MONEY_GROUPS.includes(money.groupCode))
      throw new DomainError('account_not_found', 404);
    if (!money.isActive) throw new DomainError('account_inactive');
    await mustHold(tx, money, c.amountPiastres, now);
    const reference = input.reference?.trim() || null;
    const tags = { darkStoreId: c.darkStoreId, userId: c.userId };
    const label = expenseClaimNumber(c.number);
    const entry = await post(tx, {
      kind: 'expense_claim',
      idempotencyKey: `expense_claim:${c.id}`,
      occurredAt: now,
      createdById: input.actorUserId,
      memo: `${label} ${c.user.name}: ${c.note}`.slice(0, 500),
      darkStoreId: c.darkStoreId,
      data: {
        expenseClaimId: c.id,
        number: label,
        userId: c.userId,
        paidOn: dayText(c.paidOn),
        ...(reference ? { reference } : {}),
      },
      lines: [
        { account: { id: c.expenseAccountId }, amount: c.amountPiastres, tags },
        { account: { id: money.id }, amount: -c.amountPiastres, tags },
      ],
    });
    // The receipt the person photographed stays with the entry.
    await tx.financeReceipt.create({
      data: { photoId: c.photoId, entryId: entry!.id, createdById: input.actorUserId },
    });
    const after = await tx.expenseClaim.update({
      where: { id: c.id },
      data: {
        status: 'paid',
        paidById: input.actorUserId,
        paidAt: now,
        paidFromAccountId: money.id,
        reference,
        entryId: entry!.id,
      },
      include: claimInclude,
    });
    await audit(tx, input.actorUserId, 'pay', c, {
      status: 'paid',
      amount: c.amountPiastres,
      from: money.code,
      entryId: entry!.id,
      ...(reference ? { reference } : {}),
    });
    return claimView(after);
  });
}

// ─── reading ────────────────────────────────────────────────────────────────────

/** My HR: the person's own claims, newest first, and the form's choices. */
export async function myExpenseClaims(db: Db, userId: string, now: Date = new Date()) {
  const e = await db.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!e) throw new DomainError('employee_not_found', 404);
  const [rows, categories, stores, maxAge] = await Promise.all([
    db.expenseClaim.findMany({
      where: { userId },
      include: claimInclude,
      orderBy: { number: 'desc' },
      take: 200,
    }),
    claimCategories(db, true),
    db.darkStore.findMany({
      where: { isActive: true },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: 'asc' },
    }),
    getSetting(db, 'claims.max_age_days'),
  ]);
  const today = cairoDay(now);
  return {
    claims: rows.map(claimView),
    categories: categories.map(({ claimable: _c, ...c }) => c),
    stores,
    maxAgeDays: maxAge,
    earliestDay: addDays(today, -maxAge),
    today,
  };
}

/**
 * One claim for its reader: the claimant (self), their manager in force or the manager who
 * decided it (team), or accounting (any; the API keeps it inside their stores).
 */
export async function expenseClaimDetail(
  db: Db,
  input: { claimId: string; viewerUserId: string; scope: 'self' | 'manager' | 'accounting' },
) {
  const c = await db.expenseClaim.findUnique({
    where: { id: input.claimId },
    include: claimInclude,
  });
  if (!c) throw new DomainError('expense_claim_not_found', 404);
  if (input.scope === 'self' && c.userId !== input.viewerUserId)
    throw new DomainError('expense_claim_not_found', 404);
  if (input.scope === 'manager') {
    const me = await db.employee.findUnique({
      where: { userId: input.viewerUserId },
      select: { id: true },
    });
    const isManager =
      me &&
      (c.managerEmployeeId === me.id ||
        c.managerDecidedById === input.viewerUserId ||
        (await managerOf(db, c.employeeId)).managerId === me.id);
    if (!isManager || c.userId === input.viewerUserId)
      throw new DomainError('expense_claim_not_found', 404);
  }
  return claimView(c);
}

/** The claims waiting for a manager: their direct reports' claims at the first step. */
export async function claimsWaitingForManager(db: Db, managerUserId: string, reports: string[]) {
  if (!reports.length) return [];
  const rows = await db.expenseClaim.findMany({
    where: {
      status: 'pending_manager',
      employeeId: { in: reports },
      userId: { not: managerUserId },
    },
    include: claimInclude,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(claimView);
}
