import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, Tx } from '@shiply/db';
import { DB } from '../platform';

export type CompanyKey = 'shiply_now' | 'shiply';

export interface LineInput {
  accountCode: string;
  debit: number;
  credit: number;
  costCentreId?: string | null;
  partyType?: 'merchant' | 'holder' | 'supplier' | null;
  partyId?: string | null;
}

export interface EntryInput {
  companyKey: CompanyKey;
  date: Date;
  memo: string;
  sourceType: string;
  sourceId: string;
  /** books a source once: the same key again is ignored */
  sourceKey: string;
  createdById?: string | null;
  lines: LineInput[];
}

export interface BalanceQuery {
  accountCode?: string;
  accountCodes?: string[];
  partyType?: string;
  partyId?: string;
  companyKey?: CompanyKey;
  to?: Date;
}

/** Double entry, append only. The only writer of journal entries. */
@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: PrismaClient) {}

  /** Books an entry in the caller's transaction. Returns null when its sourceKey is already booked. */
  async post(tx: Tx, e: EntryInput): Promise<string | null> {
    let debit = 0;
    let credit = 0;
    for (const l of e.lines) {
      const ok = Number.isInteger(l.debit) && Number.isInteger(l.credit) && l.debit >= 0 && l.credit >= 0 && (l.debit === 0) !== (l.credit === 0);
      if (!ok) throw new Error('unbalanced: each line has one positive side, in whole piastres');
      debit += l.debit;
      credit += l.credit;
    }
    if (e.lines.length < 2 || debit !== credit) throw new Error(`unbalanced: debits ${debit} and credits ${credit}`);
    if (await tx.journalEntry.findUnique({ where: { sourceKey: e.sourceKey } })) return null;
    const entry = await tx.journalEntry.create({
      data: {
        companyKey: e.companyKey,
        date: e.date,
        memo: e.memo,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        sourceKey: e.sourceKey,
        createdById: e.createdById ?? null,
        lines: { create: e.lines.map((l) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit, costCentreId: l.costCentreId ?? null, partyType: l.partyType ?? null, partyId: l.partyId ?? null })) },
      },
    });
    return entry.id;
  }

  /** A correction: the same lines with sides swapped. An entry is reversed once. */
  async reverse(tx: Tx, entryId: string, userId: string | null): Promise<string | null> {
    const e = await tx.journalEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: true } });
    const id = await this.post(tx, {
      companyKey: e.companyKey as CompanyKey,
      date: new Date(),
      memo: `Reversal: ${e.memo}`,
      sourceType: 'reversal',
      sourceId: e.id,
      sourceKey: `reversal:${e.id}`,
      createdById: userId,
      lines: e.lines.map((l) => ({ accountCode: l.accountCode, debit: l.credit, credit: l.debit, costCentreId: l.costCentreId, partyType: l.partyType as LineInput['partyType'], partyId: l.partyId })),
    });
    if (id) await tx.journalEntry.update({ where: { id }, data: { reversesId: e.id } });
    return id;
  }

  private where(q: BalanceQuery) {
    return {
      ...(q.accountCode ? { accountCode: q.accountCode } : {}),
      ...(q.accountCodes ? { accountCode: { in: q.accountCodes } } : {}),
      ...(q.partyType ? { partyType: q.partyType } : {}),
      ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(q.companyKey || q.to ? { entry: { ...(q.companyKey ? { companyKey: q.companyKey } : {}), ...(q.to ? { date: { lte: q.to } } : {}) } } : {}),
    };
  }

  /** Debits minus credits (positive for assets and expenses). */
  async balance(q: BalanceQuery, tx: Tx = this.db): Promise<number> {
    const s = await tx.journalLine.aggregate({ where: this.where(q), _sum: { debit: true, credit: true } });
    return (s._sum.debit ?? 0) - (s._sum.credit ?? 0);
  }

  async trialBalance(companyKey?: CompanyKey) {
    const rows = await this.db.journalLine.groupBy({ by: ['accountCode'], where: companyKey ? { entry: { companyKey } } : {}, _sum: { debit: true, credit: true } });
    const accounts = new Map((await this.db.account.findMany()).map((a) => [a.code, a]));
    return rows
      .map((r) => ({ accountCode: r.accountCode, nameEn: accounts.get(r.accountCode)?.nameEn ?? r.accountCode, nameAr: accounts.get(r.accountCode)?.nameAr ?? r.accountCode, debit: r._sum.debit ?? 0, credit: r._sum.credit ?? 0 }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  async profitAndLoss(q: { companyKey?: CompanyKey; costCentreId?: string; from: Date; to: Date }) {
    const accounts = await this.db.account.findMany({ where: { type: { in: ['income', 'expense'] } } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const rows = await this.db.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        accountCode: { in: accounts.map((a) => a.code) },
        ...(q.costCentreId ? { costCentreId: q.costCentreId } : {}),
        entry: { date: { gte: q.from, lte: q.to }, ...(q.companyKey ? { companyKey: q.companyKey } : {}) },
      },
      _sum: { debit: true, credit: true },
    });
    const lines = rows
      .map((r) => {
        const a = byCode.get(r.accountCode)!;
        const net = (r._sum.credit ?? 0) - (r._sum.debit ?? 0);
        return { accountCode: a.code, nameEn: a.nameEn, nameAr: a.nameAr, type: a.type, amount: a.type === 'income' ? net : -net };
      })
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const income = lines.filter((l) => l.type === 'income').reduce((s, l) => s + l.amount, 0);
    const expense = lines.filter((l) => l.type === 'expense').reduce((s, l) => s + l.amount, 0);
    return { income, expense, net: income - expense, lines };
  }
}
