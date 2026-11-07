import { ACCOUNT_LIST, type PartyType } from '@shiply/shared';
import { DomainError } from '../common/errors';
import type { PrismaService, Tx } from '../common/prisma.service';
import { todayInCairo } from '../core/shipments.core';

export interface Line {
  /** Account code, for example ACCOUNTS.BANK.code. */
  account: string;
  party?: { type: PartyType; id: string } | null;
  debit?: number;
  credit?: number;
  memo?: string;
}

export interface EntryInput {
  memo: string;
  source: string;
  /** Posting the same key twice does nothing: events can be retried safely. */
  key?: string;
  date?: string;
  userId?: string | null;
  lines: Line[];
}

const PARTY_OF = new Map(ACCOUNT_LIST.map((a) => [a.code, (a as { party?: PartyType }).party ?? null]));

/**
 * The only way money enters the books. Checks that every line is one sided, that wallet accounts
 * name their party, that the entry balances, and that the date is after the closed period.
 * The database checks the balance again at commit.
 */
export async function post(tx: Tx, e: EntryInput) {
  if (e.key) {
    const done = await tx.journalEntry.findUnique({ where: { key: e.key } });
    if (done) return done;
  }
  const lines = e.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
  if (lines.length === 0) return null;
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    const d = l.debit ?? 0;
    const c = l.credit ?? 0;
    if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0 || (d > 0 && c > 0)) throw new Error(`bad journal line on ${l.account}`);
    debit += d;
    credit += c;
    const party = PARTY_OF.get(l.account);
    if (party === undefined) {
      const acc = await tx.account.findUnique({ where: { code: l.account } });
      if (!acc || !acc.active) throw new DomainError('invalid_input', `Unknown account ${l.account}`, 422);
      if (acc.party && l.party?.type !== acc.party) throw new DomainError('invalid_input', `Account ${l.account} needs a ${acc.party.toLowerCase()}`, 422);
    } else if (party && l.party?.type !== party) {
      throw new Error(`account ${l.account} needs a ${party} party`);
    }
  }
  if (debit !== credit) throw new DomainError('unbalanced', `Debits ${debit} and credits ${credit} do not match`, 422);
  const date = e.date ?? todayInCairo();
  const closed = await tx.setting.findUnique({ where: { key: 'books.closed_through' } });
  const closedThrough = typeof closed?.value === 'string' ? closed.value : '';
  if (closedThrough && date <= closedThrough) throw new DomainError('books_closed', `The books are closed through ${closedThrough}`, 409);
  return tx.journalEntry.create({
    data: {
      date,
      memo: e.memo.slice(0, 300),
      source: e.source,
      key: e.key ?? null,
      createdById: e.userId ?? null,
      lines: {
        create: lines.map((l) => ({
          accountCode: l.account,
          partyType: l.party?.type ?? null,
          partyId: l.party?.id ?? null,
          debit: l.debit ?? 0,
          credit: l.credit ?? 0,
          memo: (l.memo ?? '').slice(0, 200),
        })),
      },
    },
  });
}

/** Debits minus credits on an account, for one party or all of them. */
export async function rawBalance(db: Tx | PrismaService, account: string, party?: { type: PartyType; id: string }, through?: string) {
  const r = await db.journalLine.aggregate({
    where: { accountCode: account, ...(party ? { partyType: party.type, partyId: party.id } : {}), ...(through ? { entry: { date: { lte: through } } } : {}) },
    _sum: { debit: true, credit: true },
  });
  return (r._sum.debit ?? 0) - (r._sum.credit ?? 0);
}

/** Balance of every party on one account, as a map of party id to debits minus credits. */
export async function partyBalances(db: Tx | PrismaService, account: string): Promise<Map<string, number>> {
  const rows = await db.journalLine.groupBy({ by: ['partyId'], where: { accountCode: account, partyId: { not: null } }, _sum: { debit: true, credit: true } });
  return new Map(rows.map((r) => [r.partyId!, (r._sum.debit ?? 0) - (r._sum.credit ?? 0)]));
}
