import type { LedgerAccount, Prisma } from '@prisma/client';
import {
  accountGroup,
  addDays,
  cairoDay,
  cairoDayStart,
  debitNormal,
  entryNumber,
  isCalendarDay,
  type ManualAccountType,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { type AccountRef, balanceOf, CATEGORY, nextAccountCode, post } from './ledger';

type Tx = Prisma.TransactionClient;

// The company's books on top of the ledger: the chart of accounts, moving money between
// banks and cash boxes, expenses, owner money, other income, free journal entries, and the
// reports an accountant reads (statement, trial balance, profit and loss, balance sheet).

/** Keys of accounts the system itself posts to; they can be renamed but never closed. */
const LOCKED_KEYS = new Set([
  'bank',
  'revenue',
  'vat_payable',
  'rider_bonus_expense',
  'damage_expense',
  'cash_difference',
  'equity:capital',
  'equity:drawings',
]);

const isWallet = (a: Pick<LedgerAccount, 'merchantId' | 'riderId' | 'darkStoreId'>) =>
  a.merchantId != null || a.riderId != null || a.darkStoreId != null;

/** When a money event happened: a past Cairo day at noon, or now for today and no day. */
export function eventTime(day: string | undefined, now: Date = new Date()) {
  if (!day || day === cairoDay(now)) return now;
  if (!isCalendarDay(day)) throw new DomainError('invalid_date', 400);
  if (day > cairoDay(now)) throw new DomainError('future_date', 400);
  return new Date(cairoDayStart(day).getTime() + 12 * 3600_000);
}

// ─── chart of accounts ─────────────────────────────────────────────────────────

/** Names for accounts that belong to a merchant, rider or store, in both languages. */
async function ownerNames(db: Db) {
  const [merchants, riders, stores] = await Promise.all([
    db.merchant.findMany({ select: { id: true, name: true } }),
    db.rider.findMany({ select: { id: true, badgeCode: true, user: { select: { name: true } } } }),
    db.darkStore.findMany({ select: { id: true, code: true, nameEn: true, nameAr: true } }),
  ]);
  return (
    a: Pick<LedgerAccount, 'nameEn' | 'nameAr' | 'merchantId' | 'riderId' | 'darkStoreId'>,
  ) => {
    if (a.merchantId) {
      const name = merchants.find((m) => m.id === a.merchantId)?.name ?? a.merchantId;
      return { nameEn: name, nameAr: name };
    }
    if (a.riderId) {
      const r = riders.find((x) => x.id === a.riderId);
      const name = r ? `${r.user.name} (${r.badgeCode})` : a.riderId;
      return { nameEn: name, nameAr: name };
    }
    if (a.darkStoreId) {
      const s = stores.find((x) => x.id === a.darkStoreId);
      return s
        ? { nameEn: `${s.nameEn} cash box`, nameAr: `خزنة ${s.nameAr}` }
        : { nameEn: a.darkStoreId, nameAr: a.darkStoreId };
    }
    return { nameEn: a.nameEn ?? '', nameAr: a.nameAr ?? a.nameEn ?? '' };
  };
}

/** The balance as an accountant reads it: assets and expenses debit, the rest credit. */
const natural = (category: LedgerAccount['category'], raw: number) =>
  debitNormal(category) ? raw : 0 - raw;

/** Every account with its code, name, group and balance, in code order. */
export async function chartOfAccounts(db: Db, options: { includeInactive?: boolean } = {}) {
  const [accounts, sums, name] = await Promise.all([
    db.ledgerAccount.findMany({
      where: options.includeInactive ? undefined : { isActive: true },
      orderBy: { code: 'asc' },
    }),
    db.ledgerLine.groupBy({ by: ['accountId'], _sum: { amountPiastres: true } }),
    ownerNames(db),
  ]);
  return accounts.map((a) => {
    const raw = sums.find((s) => s.accountId === a.id)?._sum.amountPiastres ?? 0;
    return {
      id: a.id,
      code: a.code,
      type: a.type,
      category: a.category,
      groupCode: a.groupCode,
      ...name(a),
      bankName: a.bankName,
      accountNumber: a.accountNumber,
      iban: a.iban,
      note: a.note,
      isActive: a.isActive,
      /** Owned by a merchant, rider or store: named after them, opened by the system */
      wallet: isWallet(a),
      locked: LOCKED_KEYS.has(a.key) || isWallet(a),
      money: accountGroup(a.groupCode)?.money ?? false,
      balancePiastres: natural(a.category, raw),
    };
  });
}

export async function createAccount(
  db: Db,
  input: {
    groupCode: number;
    nameEn: string;
    nameAr: string;
    bankName?: string;
    accountNumber?: string;
    iban?: string;
    note?: string;
    actorUserId: string;
  },
) {
  const group = accountGroup(input.groupCode);
  if (!group?.manualType) throw new DomainError('group_not_open', 400);
  if (group.code === 1100 && (!input.bankName || !input.accountNumber))
    throw new DomainError('bank_details_required', 400);
  const type: ManualAccountType = group.manualType;
  return inTransaction(db, async (tx) => {
    const sameName = await tx.ledgerAccount.findFirst({
      where: {
        groupCode: group.code,
        OR: [{ nameEn: { equals: input.nameEn, mode: 'insensitive' } }, { nameAr: input.nameAr }],
      },
    });
    if (sameName) throw new DomainError('account_name_taken');
    if (input.accountNumber) {
      const sameNumber = await tx.ledgerAccount.findFirst({
        where: {
          accountNumber: input.accountNumber,
          bankName: { equals: input.bankName, mode: 'insensitive' },
        },
      });
      if (sameNumber) throw new DomainError('bank_account_exists');
    }
    const code = await nextAccountCode(tx, group.code, false);
    const account = await tx.ledgerAccount.create({
      data: {
        key: `acct:${code}`,
        type,
        code,
        groupCode: group.code,
        category: CATEGORY[type],
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        bankName: input.bankName ?? null,
        accountNumber: input.accountNumber ?? null,
        iban: input.iban ?? null,
        note: input.note ?? null,
        createdById: input.actorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.account_create',
      entityType: 'ledger_account',
      entityId: account.id,
      after: { code, nameEn: input.nameEn, group: group.code },
    });
    return account;
  });
}

export async function updateAccount(
  db: Db,
  input: {
    accountId: string;
    nameEn?: string;
    nameAr?: string;
    bankName?: string;
    accountNumber?: string;
    iban?: string;
    note?: string;
    isActive?: boolean;
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.ledgerAccount.findUnique({ where: { id: input.accountId } });
    if (!before) throw new DomainError('account_not_found', 404);
    if (isWallet(before) && (input.nameEn || input.nameAr || input.isActive === false))
      throw new DomainError('account_locked');
    if (input.isActive === false) {
      if (LOCKED_KEYS.has(before.key)) throw new DomainError('account_locked');
      if ((await balanceOf(tx, { id: before.id })) !== 0)
        throw new DomainError('account_has_balance');
    }
    const data: Prisma.LedgerAccountUpdateInput = {};
    if (input.nameEn) data.nameEn = input.nameEn;
    if (input.nameAr) data.nameAr = input.nameAr;
    if (input.bankName !== undefined) data.bankName = input.bankName || null;
    if (input.accountNumber !== undefined) data.accountNumber = input.accountNumber || null;
    if (input.iban !== undefined) data.iban = input.iban || null;
    if (input.note !== undefined) data.note = input.note || null;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (before.groupCode === 1100 && data.accountNumber === null)
      throw new DomainError('bank_details_required', 400);
    const after = await tx.ledgerAccount.update({ where: { id: before.id }, data });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.account_update',
      entityType: 'ledger_account',
      entityId: before.id,
      before: {
        nameEn: before.nameEn,
        nameAr: before.nameAr,
        bankName: before.bankName,
        accountNumber: before.accountNumber,
        iban: before.iban,
        isActive: before.isActive,
      },
      after: {
        nameEn: after.nameEn,
        nameAr: after.nameAr,
        bankName: after.bankName,
        accountNumber: after.accountNumber,
        iban: after.iban,
        isActive: after.isActive,
      },
    });
    return after;
  });
}

// ─── money movements ───────────────────────────────────────────────────────────

/** An open account of the given groups, locked so two moves cannot spend the same money. */
async function openAccount(tx: Tx, id: string, groups: number[], notFound: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ledger_accounts WHERE id = ${id} FOR UPDATE`;
  const account = rows.length ? await tx.ledgerAccount.findUnique({ where: { id } }) : null;
  if (!account || !groups.includes(account.groupCode)) throw new DomainError(notFound, 404);
  if (!account.isActive) throw new DomainError('account_inactive');
  return account;
}

const MONEY_GROUPS = [1100, 1200];

/** Money cannot leave a bank or cash box that does not hold it. */
async function mustHold(tx: Tx, account: LedgerAccount, amount: number) {
  if (amount > (await balanceOf(tx, { id: account.id }))) throw new DomainError('not_enough_money');
}

const positive = (amount: number) => {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('invalid_amount', 400);
};

interface MoveBase {
  amountPiastres: number;
  reference: string;
  memo?: string;
  day?: string;
  actorUserId: string;
  idempotencyKey: string;
}

/** Bank to cash box, cash box to bank, bank to bank or cash box to cash box. */
export async function transferMoney(
  db: Db,
  input: MoveBase & { fromAccountId: string; toAccountId: string },
) {
  positive(input.amountPiastres);
  if (input.fromAccountId === input.toAccountId) throw new DomainError('same_account', 400);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const from = await openAccount(tx, input.fromAccountId, MONEY_GROUPS, 'account_not_found');
    const to = await openAccount(tx, input.toAccountId, MONEY_GROUPS, 'account_not_found');
    const seen = await tx.ledgerEntry.findUnique({
      where: { idempotencyKey: `transfer:${input.idempotencyKey}` },
    });
    if (seen) return seen;
    await mustHold(tx, from, input.amountPiastres);
    const entry = await post(tx, {
      kind: 'money_transfer',
      idempotencyKey: `transfer:${input.idempotencyKey}`,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.memo ?? input.reference,
      data: { reference: input.reference, from: from.code, to: to.code },
      lines: [
        { account: { id: to.id }, amount: input.amountPiastres },
        { account: { id: from.id }, amount: -input.amountPiastres },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.money_transfer',
      entityType: 'ledger_entry',
      entityId: entry!.id,
      after: { from: from.code, to: to.code, amount: input.amountPiastres, ref: input.reference },
    });
    return entry!;
  });
}

/** A bill paid from a bank or cash box, booked to an expense category (VAT apart). */
export async function recordExpense(
  db: Db,
  input: MoveBase & {
    expenseAccountId: string;
    paidFromAccountId: string;
    vatPiastres?: number;
    memo: string;
  },
) {
  positive(input.amountPiastres);
  const vat = input.vatPiastres ?? 0;
  if (!Number.isSafeInteger(vat) || vat < 0 || vat >= input.amountPiastres)
    throw new DomainError('invalid_vat', 400);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const expense = await openAccount(
      tx,
      input.expenseAccountId,
      [5400, 5500],
      'expense_account_not_found',
    );
    const from = await openAccount(tx, input.paidFromAccountId, MONEY_GROUPS, 'account_not_found');
    const seen = await tx.ledgerEntry.findUnique({
      where: { idempotencyKey: `expense:${input.idempotencyKey}` },
    });
    if (seen) return seen;
    await mustHold(tx, from, input.amountPiastres);
    const entry = await post(tx, {
      kind: 'expense',
      idempotencyKey: `expense:${input.idempotencyKey}`,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.memo,
      data: { reference: input.reference, vat },
      lines: [
        { account: { id: expense.id }, amount: input.amountPiastres - vat },
        // VAT we paid on a bill is claimed back against the VAT we owe.
        { account: { type: 'vat_payable' }, amount: vat },
        { account: { id: from.id }, amount: -input.amountPiastres },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.expense',
      entityType: 'ledger_entry',
      entityId: entry!.id,
      after: {
        expense: expense.code,
        from: from.code,
        amount: input.amountPiastres,
        vat,
        ref: input.reference,
      },
    });
    return entry!;
  });
}

/** The owner puts money in (capital) or takes money out (drawings). */
export async function recordCapital(
  db: Db,
  input: MoveBase & { direction: 'in' | 'out'; moneyAccountId: string; equityAccountId?: string },
) {
  positive(input.amountPiastres);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const money = await openAccount(tx, input.moneyAccountId, MONEY_GROUPS, 'account_not_found');
    const equity: AccountRef = input.equityAccountId
      ? {
          id: (
            await openAccount(tx, input.equityAccountId, [3100, 3200], 'equity_account_not_found')
          ).id,
        }
      : { id: await defaultEquity(tx, input.direction) };
    const key = `capital:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    if (input.direction === 'out') await mustHold(tx, money, input.amountPiastres);
    const sign = input.direction === 'in' ? 1 : -1;
    const entry = await post(tx, {
      kind: input.direction === 'in' ? 'capital_in' : 'capital_out',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.memo ?? input.reference,
      data: { reference: input.reference },
      lines: [
        { account: { id: money.id }, amount: sign * input.amountPiastres },
        { account: equity, amount: -sign * input.amountPiastres },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: `finance.capital_${input.direction}`,
      entityType: 'ledger_entry',
      entityId: entry!.id,
      after: { account: money.code, amount: input.amountPiastres, ref: input.reference },
    });
    return entry!;
  });
}

async function defaultEquity(tx: Tx, direction: 'in' | 'out') {
  const key = direction === 'in' ? 'equity:capital' : 'equity:drawings';
  const account = await tx.ledgerAccount.findUnique({ where: { key } });
  if (!account) throw new DomainError('equity_account_not_found', 404);
  return account.id;
}

/** Money received that is not a merchant fee: interest, selling old equipment. */
export async function recordOtherIncome(
  db: Db,
  input: MoveBase & { incomeAccountId: string; moneyAccountId: string; memo: string },
) {
  positive(input.amountPiastres);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const income = await openAccount(tx, input.incomeAccountId, [4200], 'income_account_not_found');
    const money = await openAccount(tx, input.moneyAccountId, MONEY_GROUPS, 'account_not_found');
    const key = `income:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    const entry = await post(tx, {
      kind: 'other_income',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.memo,
      data: { reference: input.reference },
      lines: [
        { account: { id: money.id }, amount: input.amountPiastres },
        { account: { id: income.id }, amount: -input.amountPiastres },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.other_income',
      entityType: 'ledger_entry',
      entityId: entry!.id,
      after: { income: income.code, to: money.code, amount: input.amountPiastres },
    });
    return entry!;
  });
}

/**
 * A free journal entry for the accountant (accruals, reclassifications, opening balances).
 * Lines must balance and carry either a debit or a credit. Wallets of merchants and riders
 * are left to their own screens, so their statements always tell the whole story.
 */
export async function recordJournalEntry(
  db: Db,
  input: {
    lines: { accountId: string; debitPiastres: number; creditPiastres: number }[];
    reason: string;
    day?: string;
    actorUserId: string;
    idempotencyKey: string;
  },
) {
  if (input.reason.trim().length < 5) throw new DomainError('reason_required', 400);
  const lines = input.lines.map((l) => {
    if (
      !Number.isSafeInteger(l.debitPiastres) ||
      !Number.isSafeInteger(l.creditPiastres) ||
      l.debitPiastres < 0 ||
      l.creditPiastres < 0 ||
      l.debitPiastres > 0 === l.creditPiastres > 0
    )
      throw new DomainError('invalid_line', 400);
    return { accountId: l.accountId, amount: l.debitPiastres - l.creditPiastres };
  });
  if (lines.length < 2) throw new DomainError('invalid_line', 400);
  if (lines.reduce((s, l) => s + l.amount, 0) !== 0) throw new DomainError('not_balanced', 400);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const key = `journal:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    for (const l of lines) {
      const account = await tx.ledgerAccount.findUnique({ where: { id: l.accountId } });
      if (!account) throw new DomainError('account_not_found', 404);
      if (isWallet(account) && account.darkStoreId == null)
        throw new DomainError('wallet_not_allowed');
    }
    const entry = await post(tx, {
      kind: 'journal',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.reason,
      data: { reason: input.reason },
      lines: lines.map((l) => ({ account: { id: l.accountId }, amount: l.amount })),
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.journal',
      entityType: 'ledger_entry',
      entityId: entry!.id,
      after: { reason: input.reason, lines: lines.length },
    });
    return entry!;
  });
}

// ─── reports ───────────────────────────────────────────────────────────────────

/** One account's movements in a period, with the opening and a running balance. */
export async function accountStatement(db: Db, accountId: string, from: Date, to: Date) {
  const account = await db.ledgerAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new DomainError('account_not_found', 404);
  const name = await ownerNames(db);
  const [opening, lines] = await Promise.all([
    db.ledgerLine.aggregate({
      where: { accountId, occurredAt: { lt: from } },
      _sum: { amountPiastres: true },
    }),
    db.ledgerLine.findMany({
      where: { accountId, occurredAt: { gte: from, lt: to } },
      include: {
        entry: {
          include: {
            lines: { include: { account: true } },
            order: { select: { number: true } },
            createdBy: { select: { name: true } },
          },
        },
      },
      orderBy: [{ occurredAt: 'asc' }, { entry: { number: 'asc' } }],
    }),
  ]);
  const openingRaw = opening._sum.amountPiastres ?? 0;
  let running = openingRaw;
  const rows = lines.map((l) => {
    running += l.amountPiastres;
    const data = (l.entry.data ?? {}) as { reference?: string };
    return {
      at: l.occurredAt,
      number: entryNumber(l.entry.number),
      entryId: l.entryId,
      kind: l.entry.kind,
      memo: l.entry.memo,
      reference: data.reference ?? null,
      orderNumber: l.entry.order?.number ?? null,
      by: l.entry.createdBy?.name ?? null,
      /** The other side(s) of the entry */
      against: l.entry.lines
        .filter((x) => x.accountId !== accountId)
        .map((x) => ({ code: x.account.code, ...name(x.account) })),
      debitPiastres: l.amountPiastres > 0 ? l.amountPiastres : 0,
      creditPiastres: l.amountPiastres < 0 ? 0 - l.amountPiastres : 0,
      balancePiastres: natural(account.category, running),
    };
  });
  return {
    account: {
      id: account.id,
      code: account.code,
      category: account.category,
      groupCode: account.groupCode,
      ...name(account),
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      iban: account.iban,
    },
    from,
    to,
    openingPiastres: natural(account.category, openingRaw),
    closingPiastres: natural(account.category, running),
    totalDebitPiastres: rows.reduce((s, r) => s + r.debitPiastres, 0),
    totalCreditPiastres: rows.reduce((s, r) => s + r.creditPiastres, 0),
    lines: rows,
  };
}

/** Sums of each account's lines in a period (both bounds optional). */
async function sumsByAccount(db: Db, from?: Date, to?: Date) {
  const rows = await db.$queryRaw<{ account_id: string; debit: bigint; credit: bigint }[]>`
    SELECT account_id,
      COALESCE(SUM(CASE WHEN amount_piastres > 0 THEN amount_piastres END), 0) AS debit,
      COALESCE(SUM(CASE WHEN amount_piastres < 0 THEN -amount_piastres END), 0) AS credit
    FROM ledger_lines
    WHERE (${from ?? null}::timestamptz IS NULL OR occurred_at >= ${from ?? null}::timestamptz)
      AND (${to ?? null}::timestamptz IS NULL OR occurred_at < ${to ?? null}::timestamptz)
    GROUP BY account_id`;
  return new Map(
    rows.map((r) => [r.account_id, { debit: Number(r.debit), credit: Number(r.credit) }]),
  );
}

/** Debits and credits of every account in a period; the two totals always match. */
export async function trialBalance(db: Db, from?: Date, to?: Date) {
  const [accounts, sums, name] = await Promise.all([
    db.ledgerAccount.findMany({ orderBy: { code: 'asc' } }),
    sumsByAccount(db, from, to),
    ownerNames(db),
  ]);
  const rows = accounts
    .filter((a) => sums.has(a.id))
    .map((a) => {
      const s = sums.get(a.id)!;
      return {
        id: a.id,
        code: a.code,
        category: a.category,
        groupCode: a.groupCode,
        ...name(a),
        debitPiastres: s.debit,
        creditPiastres: s.credit,
        balancePiastres: s.debit - s.credit,
      };
    });
  return {
    rows,
    totalDebitPiastres: rows.reduce((s, r) => s + r.debitPiastres, 0),
    totalCreditPiastres: rows.reduce((s, r) => s + r.creditPiastres, 0),
  };
}

/** Income and expenses of a period, per account, and the profit (or loss). */
export async function profitAndLoss(db: Db, from: Date, to: Date) {
  const [accounts, sums, name] = await Promise.all([
    db.ledgerAccount.findMany({
      where: { category: { in: ['revenue', 'expense'] } },
      orderBy: { code: 'asc' },
    }),
    sumsByAccount(db, from, to),
    ownerNames(db),
  ]);
  const line = (a: LedgerAccount) => {
    const s = sums.get(a.id) ?? { debit: 0, credit: 0 };
    return {
      id: a.id,
      code: a.code,
      ...name(a),
      amountPiastres: natural(a.category, s.debit - s.credit),
    };
  };
  const income = accounts.filter((a) => a.category === 'revenue').map(line);
  const expenses = accounts.filter((a) => a.category === 'expense').map(line);
  const totalIncome = income.reduce((s, r) => s + r.amountPiastres, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.amountPiastres, 0);
  return {
    from,
    to,
    income: income.filter((r) => r.amountPiastres !== 0),
    expenses: expenses.filter((r) => r.amountPiastres !== 0),
    totalIncomePiastres: totalIncome,
    totalExpensesPiastres: totalExpenses,
    profitPiastres: totalIncome - totalExpenses,
  };
}

/**
 * What the company owns and owes at the end of a Cairo day. Assets equal liabilities plus
 * equity plus the profit made so far (not yet closed into equity).
 */
export async function balanceSheet(db: Db, day: string) {
  const at = cairoDayStart(addDays(day, 1));
  const [accounts, sums, name] = await Promise.all([
    db.ledgerAccount.findMany({ orderBy: { code: 'asc' } }),
    sumsByAccount(db, undefined, at),
    ownerNames(db),
  ]);
  const balance = (a: LedgerAccount) => {
    const s = sums.get(a.id) ?? { debit: 0, credit: 0 };
    return natural(a.category, s.debit - s.credit);
  };
  const section = (category: LedgerAccount['category']) => {
    // Wallets are many; they are shown as one line per group.
    const rows: {
      code: string;
      groupCode: number;
      nameEn: string;
      nameAr: string;
      amountPiastres: number;
      wallets?: number;
    }[] = [];
    for (const a of accounts.filter((x) => x.category === category)) {
      const amount = balance(a);
      if (isWallet(a) && a.darkStoreId == null) {
        const group = rows.find((r) => r.groupCode === a.groupCode && r.wallets !== undefined);
        if (group) {
          group.amountPiastres += amount;
          group.wallets! += 1;
        } else
          rows.push({
            code: String(a.groupCode),
            groupCode: a.groupCode,
            nameEn: '',
            nameAr: '',
            amountPiastres: amount,
            wallets: 1,
          });
      } else if (amount !== 0)
        rows.push({ code: a.code, groupCode: a.groupCode, ...name(a), amountPiastres: amount });
    }
    return rows;
  };
  const total = (rows: { amountPiastres: number }[]) =>
    rows.reduce((s, r) => s + r.amountPiastres, 0);
  const assets = section('asset');
  const liabilities = section('liability');
  const equity = section('equity');
  const earnings =
    total(
      accounts.filter((a) => a.category === 'revenue').map((a) => ({ amountPiastres: balance(a) })),
    ) -
    total(
      accounts.filter((a) => a.category === 'expense').map((a) => ({ amountPiastres: balance(a) })),
    );
  return {
    day,
    assets,
    liabilities,
    equity,
    earningsPiastres: earnings,
    totalAssetsPiastres: total(assets),
    totalLiabilitiesPiastres: total(liabilities),
    totalEquityPiastres: total(equity) + earnings,
  };
}

/** Banks and cash boxes that can send or receive money, for the movement forms. */
export async function moneyAccounts(db: Db) {
  const chart = await chartOfAccounts(db);
  return chart.filter((a) => a.money);
}
