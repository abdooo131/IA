import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  cairoDayStart,
  isCalendarDay,
  type StatementLineInput,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { submitExpense } from './controls';
import { balanceOf, nextNumber } from './ledger';

type Tx = Prisma.TransactionClient;

// Bank reconciliation: the bank's own statement is the proof that money in the books is
// real. Each statement line is matched to the ledger line it proves (same bank account,
// same amount, a few days apart). What stays unmatched is the work list:
//
//   in the bank, not in the books → record it (bank charges, a transfer we forgot)
//   in the books, not in the bank → find out why (a slip never deposited, a typo)
//
// A ledger line can prove only one bank line and the other way round (unique indexes).

/** How many days a bank line may sit from its ledger line and still match on its own. */
const MATCH_DAYS = 3;

async function bankAccount(tx: Tx | Db, id: string) {
  const account = await tx.ledgerAccount.findUnique({ where: { id } });
  if (!account || account.groupCode !== 1100) throw new DomainError('bank_account_not_found', 404);
  return account;
}

const dayText = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Saves a statement's lines (already read from the file) and matches what it can. Lines
 * already uploaded in an earlier, overlapping statement are skipped, so uploading the same
 * month twice changes nothing.
 */
export async function importStatement(
  db: Db,
  input: {
    accountId: string;
    fileName: string;
    lines: StatementLineInput[];
    actorUserId: string;
  },
) {
  if (input.lines.length === 0) throw new DomainError('nothing_to_import', 400);
  const today = cairoDay(new Date());
  for (const l of input.lines) {
    if (!isCalendarDay(l.day)) throw new DomainError('invalid_date', 400);
    if (l.day > today) throw new DomainError('future_date', 400);
    if (!Number.isSafeInteger(l.amountPiastres) || l.amountPiastres === 0)
      throw new DomainError('invalid_amount', 400);
  }
  return inTransaction(db, async (tx) => {
    const account = await bankAccount(tx, input.accountId);
    // Two equal lines on one day (two transfers of the same amount) are both real: the
    // fingerprint counts how many times the same line appeared in this file.
    const seen = new Map<string, number>();
    const rows = input.lines.map((l, i) => {
      const base = [
        l.day,
        l.amountPiastres,
        l.balancePiastres ?? '',
        l.description.trim(),
        l.reference ?? '',
      ].join('|');
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return {
        ...l,
        lineNo: i + 1,
        fingerprint: createHash('sha256').update(`${base}|${n}`).digest('hex'),
      };
    });
    const existing = await tx.bankStatementLine.findMany({
      where: { accountId: account.id, fingerprint: { in: rows.map((r) => r.fingerprint) } },
      select: { fingerprint: true },
    });
    const known = new Set(existing.map((e) => e.fingerprint));
    const fresh = rows.filter((r) => !known.has(r.fingerprint));
    const days = rows.map((r) => r.day).sort();
    const statement = await tx.bankStatement.create({
      data: {
        number: await nextNumber(tx, 'bank_statements'),
        accountId: account.id,
        fileName: input.fileName,
        fromDay: new Date(`${days[0]}T00:00:00Z`),
        toDay: new Date(`${days.at(-1)}T00:00:00Z`),
        lines: fresh.length,
        skipped: rows.length - fresh.length,
        createdById: input.actorUserId,
      },
    });
    if (fresh.length)
      await tx.bankStatementLine.createMany({
        data: fresh.map((r) => ({
          statementId: statement.id,
          accountId: account.id,
          lineNo: r.lineNo,
          day: new Date(`${r.day}T00:00:00Z`),
          description: r.description.trim(),
          reference: r.reference ?? null,
          amountPiastres: r.amountPiastres,
          balancePiastres: r.balancePiastres ?? null,
          fingerprint: r.fingerprint,
        })),
      });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.bank_statement_import',
      entityType: 'bank_statement',
      entityId: statement.id,
      after: {
        account: account.code,
        file: input.fileName,
        lines: fresh.length,
        skipped: rows.length - fresh.length,
      },
    });
    const matched = await autoMatch(tx, account.id);
    return { statement, imported: fresh.length, skipped: rows.length - fresh.length, matched };
  });
}

/** Ledger lines of a bank account that no bank line proves yet. */
async function openLedgerLines(tx: Tx | Db, accountId: string, from?: Date) {
  return tx.ledgerLine.findMany({
    where: { accountId, bankLine: null, ...(from ? { occurredAt: { gte: from } } : {}) },
    include: { entry: { select: { number: true, kind: true, memo: true } } },
    orderBy: { occurredAt: 'asc' },
  });
}

/**
 * Matches every unmatched bank line that has exactly one closest candidate: the same
 * amount on the same account within a few days, not proving anything else yet.
 */
export async function autoMatch(db: Tx | Db, accountId: string) {
  const lines = await db.bankStatementLine.findMany({
    where: { accountId, status: 'unmatched' },
    orderBy: [{ day: 'asc' }, { lineNo: 'asc' }],
  });
  if (lines.length === 0) return 0;
  const earliest = cairoDayStart(addDays(dayText(lines[0]!.day), -MATCH_DAYS));
  const open = await openLedgerLines(db, accountId, earliest);
  const used = new Set<string>();
  let matched = 0;
  for (const line of lines) {
    const day = dayText(line.day);
    const scored = open
      .filter((l) => !used.has(l.id) && l.amountPiastres === line.amountPiastres)
      .map((l) => ({
        l,
        gap: Math.abs(
          (Date.parse(`${cairoDay(l.occurredAt)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) /
            86_400_000,
        ),
      }))
      .filter((c) => c.gap <= MATCH_DAYS)
      .sort((a, b) => a.gap - b.gap);
    if (scored.length === 0) continue;
    // Two candidates equally close: a person decides.
    if (scored.length > 1 && scored[1]!.gap === scored[0]!.gap) continue;
    const best = scored[0]!.l;
    used.add(best.id);
    await db.bankStatementLine.update({
      where: { id: line.id },
      data: { status: 'matched', ledgerLineId: best.id, decidedAt: new Date() },
    });
    matched++;
  }
  return matched;
}

/** A person matches a bank line to a ledger line of the same account and amount. */
export function matchBankLine(
  db: Db,
  input: { bankLineId: string; ledgerLineId: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const line = await tx.bankStatementLine.findUnique({ where: { id: input.bankLineId } });
    if (!line) throw new DomainError('bank_line_not_found', 404);
    if (line.status !== 'unmatched') throw new DomainError('bank_line_not_open');
    const ledger = await tx.ledgerLine.findUnique({
      where: { id: input.ledgerLineId },
      include: { bankLine: true },
    });
    if (!ledger || ledger.accountId !== line.accountId)
      throw new DomainError('ledger_line_not_found', 404);
    if (ledger.bankLine) throw new DomainError('ledger_line_matched');
    if (ledger.amountPiastres !== line.amountPiastres) throw new DomainError('amounts_differ');
    const after = await tx.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: 'matched',
        ledgerLineId: ledger.id,
        decidedById: input.actorUserId,
        decidedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.bank_match',
      entityType: 'bank_statement_line',
      entityId: line.id,
      before: { status: line.status },
      after: { status: 'matched', ledgerLineId: ledger.id },
    });
    return after;
  });
}

/** Undoes a match or an ignore; the bank line is open again. */
export function reopenBankLine(db: Db, input: { bankLineId: string; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    const line = await tx.bankStatementLine.findUnique({ where: { id: input.bankLineId } });
    if (!line) throw new DomainError('bank_line_not_found', 404);
    if (line.status === 'unmatched') return line;
    const after = await tx.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: 'unmatched',
        ledgerLineId: null,
        note: null,
        decidedById: input.actorUserId,
        decidedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.bank_reopen',
      entityType: 'bank_statement_line',
      entityId: line.id,
      before: { status: line.status, ledgerLineId: line.ledgerLineId, note: line.note },
      after: { status: 'unmatched' },
    });
    return after;
  });
}

/** A bank line that needs no entry (a reversal the bank made and undid), with a reason. */
export async function ignoreBankLine(
  db: Db,
  input: { bankLineId: string; note: string; actorUserId: string },
) {
  if (input.note.trim().length < 5) throw new DomainError('note_required', 400);
  return inTransaction(db, async (tx) => {
    const line = await tx.bankStatementLine.findUnique({ where: { id: input.bankLineId } });
    if (!line) throw new DomainError('bank_line_not_found', 404);
    if (line.status !== 'unmatched') throw new DomainError('bank_line_not_open');
    const after = await tx.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: 'ignored',
        note: input.note.trim(),
        decidedById: input.actorUserId,
        decidedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.bank_ignore',
      entityType: 'bank_statement_line',
      entityId: line.id,
      before: { status: line.status },
      after: { status: 'ignored', note: input.note.trim() },
    });
    return after;
  });
}

/**
 * Books a charge the bank took (fees, card machine costs) as a bank charges expense from
 * that bank, then matches it. Above the approval limit it waits for a second person and is
 * matched once approved.
 */
export async function bookBankCharge(db: Db, input: { bankLineId: string; actorUserId: string }) {
  const line = await db.bankStatementLine.findUnique({
    where: { id: input.bankLineId },
    include: { statement: { select: { number: true } } },
  });
  if (!line) throw new DomainError('bank_line_not_found', 404);
  if (line.status !== 'unmatched') throw new DomainError('bank_line_not_open');
  if (line.amountPiastres >= 0) throw new DomainError('not_money_out', 400);
  const charges = await db.ledgerAccount.findUnique({ where: { key: 'expense:bank_charges' } });
  if (!charges) throw new DomainError('expense_account_not_found', 404);
  const day = dayText(line.day);
  const result = await submitExpense(db, {
    expenseAccountId: charges.id,
    paidFromAccountId: line.accountId,
    amountPiastres: -line.amountPiastres,
    reference: `BS-${String(line.statement.number).padStart(6, '0')}/${line.lineNo}`,
    memo: line.description.slice(0, 300),
    day: day === cairoDay(new Date()) ? undefined : day,
    actorUserId: input.actorUserId,
    idempotencyKey: `bankcharge:${line.id}`,
  });
  if (result.status === 'posted') {
    const money = await db.ledgerLine.findFirst({
      where: { entryId: result.entry.id, accountId: line.accountId },
    });
    if (money)
      await matchBankLine(db, {
        bankLineId: line.id,
        ledgerLineId: money.id,
        actorUserId: input.actorUserId,
      });
  }
  return result;
}

export async function listStatements(db: Db, accountId?: string) {
  const rows = await db.bankStatement.findMany({
    where: accountId ? { accountId } : undefined,
    orderBy: { number: 'desc' },
    take: 100,
    include: {
      account: { select: { code: true, nameEn: true, nameAr: true } },
      createdBy: { select: { name: true } },
    },
  });
  return rows.map((s) => ({
    id: s.id,
    number: s.number,
    account: s.account,
    fileName: s.fileName,
    fromDay: dayText(s.fromDay),
    toDay: dayText(s.toDay),
    lines: s.lines,
    skipped: s.skipped,
    createdBy: s.createdBy.name,
    createdAt: s.createdAt,
  }));
}

/**
 * Where one bank account stands against its statements on a Cairo day: the balance in our
 * books, the bank's own balance from the last statement line on or before that day, and
 * both work lists. Matching runs first, so entries approved since the upload are picked up.
 */
export async function reconciliation(db: Db, input: { accountId: string; day?: string }) {
  const account = await bankAccount(db, input.accountId);
  const day = input.day ?? cairoDay(new Date());
  if (!isCalendarDay(day)) throw new DomainError('invalid_date', 400);
  await autoMatch(db, account.id);
  const end = cairoDayStart(addDays(day, 1));
  const endDate = new Date(`${day}T00:00:00Z`);
  const [bookBalance, lastBank, first, bankOpen, counts] = await Promise.all([
    balanceOf(db, { id: account.id }, end),
    db.bankStatementLine.findFirst({
      where: { accountId: account.id, day: { lte: endDate }, balancePiastres: { not: null } },
      orderBy: [{ day: 'desc' }, { statement: { number: 'desc' } }, { lineNo: 'desc' }],
    }),
    db.bankStatementLine.findFirst({
      where: { accountId: account.id },
      orderBy: { day: 'asc' },
    }),
    db.bankStatementLine.findMany({
      where: { accountId: account.id, status: 'unmatched', day: { lte: endDate } },
      orderBy: [{ day: 'asc' }, { lineNo: 'asc' }],
      include: { statement: { select: { number: true } } },
    }),
    db.bankStatementLine.groupBy({
      by: ['status'],
      where: { accountId: account.id },
      _count: { _all: true },
    }),
  ]);
  // Book lines are checked from the first day any statement covers: older history was
  // never compared with the bank.
  const since = first ? cairoDayStart(dayText(first.day)) : null;
  const booksOpen = since
    ? (await openLedgerLines(db, account.id, since)).filter((l) => l.occurredAt < end)
    : [];
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  return {
    account: { id: account.id, code: account.code, nameEn: account.nameEn, nameAr: account.nameAr },
    day,
    bookBalancePiastres: bookBalance,
    bankBalancePiastres: lastBank?.balancePiastres ?? null,
    bankBalanceDay: lastBank ? dayText(lastBank.day) : null,
    differencePiastres:
      lastBank?.balancePiastres != null ? lastBank.balancePiastres - bookBalance : null,
    matched: count('matched'),
    ignored: count('ignored'),
    checkedSince: first ? dayText(first.day) : null,
    bankOnly: bankOpen.map((l) => ({
      id: l.id,
      statement: l.statement.number,
      lineNo: l.lineNo,
      day: dayText(l.day),
      description: l.description,
      reference: l.reference,
      amountPiastres: l.amountPiastres,
      balancePiastres: l.balancePiastres,
    })),
    booksOnly: booksOpen.map((l) => ({
      id: l.id,
      entryNumber: l.entry.number,
      kind: l.entry.kind,
      memo: l.entry.memo,
      at: l.occurredAt,
      amountPiastres: l.amountPiastres,
    })),
  };
}
