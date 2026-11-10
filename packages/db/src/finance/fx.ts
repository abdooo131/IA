import type { Prisma } from '@prisma/client';
import { addDays, cairoDay, cairoDayStart } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { post } from './ledger';

type Tx = Prisma.TransactionClient;

// Bank accounts held in another currency (USD, EUR). The books stay in EGP: every line on such
// an account carries its EGP amount like any other line, plus the amount in the account's own
// currency (foreign_cents, signed like the line) and the rate used. So each account has two
// balances: the EGP one (what the books show) and the foreign one (what the bank shows).
//
//   buy USD       Dr USD bank (EGP paid, +cents)              Cr EGP bank
//   sell USD      Dr EGP bank (EGP received)  Dr/Cr 5901       Cr USD bank (book value, −cents)
//   USD to USD    Dr USD bank (book value, +cents)            Cr USD bank (book value, −cents)
//   pay USD bill  Dr supplier (bill rate)     Dr/Cr 5901       Cr USD bank (book value, −cents)
//   month end     Dr/Cr USD bank (0 cents)    Cr/Dr 5901       foreign balance × month end rate
//
// "Book value" is the EGP the cents being moved stand for in that account: its EGP balance ×
// cents ÷ its foreign balance (all of the EGP balance when every cent leaves), so no exchange
// difference hides in a transfer; differences only ever go to 5901.

/** "48.75" EGP for one unit → 48,750,000 (rate × 1,000,000, exact). */
export function fxRateMicro(text: string) {
  const m = /^(\d{1,6})(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) throw new DomainError('invalid_rate', 400);
  const micro = Number(m[1]) * 1_000_000 + Number((m[2] ?? '').padEnd(6, '0'));
  if (micro <= 0) throw new DomainError('invalid_rate', 400);
  return micro;
}

/** The rate (× 1,000,000) an EGP amount and a foreign amount stand for, rounded half up. */
export const impliedRateMicro = (piastres: number, cents: number) =>
  cents === 0
    ? null
    : Math.floor((Math.abs(piastres) * 1_000_000 + Math.abs(cents) / 2) / Math.abs(cents));

/** The EGP and foreign balances of an account, optionally before a moment. */
export async function bothBalances(db: Db, accountId: string, before?: Date) {
  const sum = await db.ledgerLine.aggregate({
    where: { accountId, ...(before ? { occurredAt: { lt: before } } : {}) },
    _sum: { amountPiastres: true, foreignCents: true },
  });
  return { piastres: sum._sum.amountPiastres ?? 0, cents: sum._sum.foreignCents ?? 0 };
}

/**
 * The EGP value of `cents` leaving a foreign account (locked by the caller), refusing more
 * than it holds in its own currency.
 */
export async function bookValueOut(tx: Tx, accountId: string, cents: number) {
  const { piastres, cents: held } = await bothBalances(tx, accountId);
  if (cents > held) throw new DomainError('not_enough_money');
  if (cents === held) return piastres;
  return Math.floor((piastres * cents + Math.floor(held / 2)) / held);
}

/** Foreign balances of every account in another currency, keyed by account id. */
export async function foreignBalances(db: Db) {
  const rows = await db.ledgerLine.groupBy({
    by: ['accountId'],
    where: { account: { currency: { not: 'EGP' } } },
    _sum: { foreignCents: true },
  });
  return new Map(rows.map((r) => [r.accountId, r._sum.foreignCents ?? 0]));
}

/**
 * Month end revaluation of a bank account in another currency: its EGP balance at the end of
 * the month is brought to its foreign balance × the rate entered, the difference going to
 * 5901 exchange differences. Once per account and month (key fx_reval:<account>:<month>);
 * only a month that is over, booked at its last moment, and never inside closed books.
 */
export async function revalueForeignBank(
  db: Db,
  input: { accountId: string; month: string; fxRate: string; actorUserId: string; now?: Date },
) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new DomainError('invalid_month', 400);
  const micro = fxRateMicro(input.fxRate);
  const now = input.now ?? new Date();
  if (input.month >= cairoDay(now).slice(0, 7)) throw new DomainError('month_not_over', 400);
  const [y, m] = input.month.split('-').map(Number) as [number, number];
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const end = cairoDayStart(next);
  const at = new Date(end.getTime() - 1);
  const key = `fx_reval:${input.accountId}:${input.month}`;
  return inTransaction(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id = ${input.accountId} FOR UPDATE`;
    const account = await tx.ledgerAccount.findUnique({ where: { id: input.accountId } });
    if (!account || account.groupCode !== 1100) throw new DomainError('account_not_found', 404);
    if (account.currency === 'EGP') throw new DomainError('not_foreign_account', 400);
    if (await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } }))
      throw new DomainError('already_revalued');
    const { piastres, cents } = await bothBalances(tx, account.id, end);
    const target = Math.floor((cents * micro + 500_000) / 1_000_000);
    const diff = target - piastres;
    const entry = await post(tx, {
      kind: 'fx_revaluation',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: `${account.code} ${account.currency} ${input.month} @ ${input.fxRate}`,
      data: {
        accountId: account.id,
        month: input.month,
        currency: account.currency,
        fxRate: input.fxRate,
        foreignCents: cents,
        before: piastres,
        after: target,
      },
      lines: [
        { account: { id: account.id }, amount: diff, foreign: { cents: 0, rateMicro: micro } },
        { account: { type: 'fx_difference' }, amount: -diff },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.fx_revalue',
      entityType: 'ledger_account',
      entityId: account.id,
      before: { piastres, cents },
      after: { piastres: target, rate: input.fxRate, month: input.month, entry: entry?.number },
    });
    return {
      month: input.month,
      foreignCents: cents,
      beforePiastres: piastres,
      afterPiastres: target,
      differencePiastres: diff,
      entryId: entry?.id ?? null,
    };
  });
}

/** For the month end screens: foreign banks and whether each month is revalued. */
export async function foreignBanks(db: Db, now: Date = new Date()) {
  const accounts = await db.ledgerAccount.findMany({
    where: { groupCode: 1100, currency: { not: 'EGP' } },
    orderBy: { code: 'asc' },
  });
  const lastMonth = addDays(`${cairoDay(now).slice(0, 7)}-01`, -1).slice(0, 7);
  const out = [];
  for (const a of accounts) {
    const b = await bothBalances(db, a.id);
    const done = await db.ledgerEntry.findUnique({
      where: { idempotencyKey: `fx_reval:${a.id}:${lastMonth}` },
      select: { id: true, number: true },
    });
    out.push({
      id: a.id,
      code: a.code,
      nameEn: a.nameEn,
      nameAr: a.nameAr,
      currency: a.currency,
      isActive: a.isActive,
      balancePiastres: b.piastres,
      foreignBalanceCents: b.cents,
      lastMonth,
      lastMonthRevalued: done !== null,
    });
  }
  return out;
}
