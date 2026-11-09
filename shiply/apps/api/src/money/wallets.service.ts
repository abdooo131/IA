import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, Tx } from '@shiply/db';
import { MerchantsService } from '../merchants';
import { DB, SettingsService } from '../platform';
import { LedgerService, type CompanyKey } from './ledger.service';

export type FeeKind = 'delivery' | 'cod' | 'return' | 'open_package' | 'storage' | 'receiving' | 'packaging' | 'cash_out' | 'other';

/** Which income account a fee goes to, per company. */
function incomeAccount(company: CompanyKey, kind: FeeKind): string {
  if (kind === 'packaging') return '4305';
  if (kind === 'other') return '4201';
  if (kind === 'cash_out') return '4304';
  if (company === 'shiply_now') return '4101';
  return { delivery: '4301', open_package: '4301', cod: '4302', return: '4303' }[kind as 'delivery'] ?? '4301';
}

/** A merchant's wallet: what we collected for them, less our fees and VAT, less what we paid out. */
@Injectable()
export class WalletsService {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(MerchantsService) private readonly merchants: MerchantsService,
  ) {}

  /** A fee to a merchant: the fee and VAT on top come out of the merchant's balance. */
  async feeCharged(tx: Tx, p: { companyKey: CompanyKey; merchantId: string; kind: FeeKind; amount: number; costCentreId?: string; sourceType: string; sourceId: string }) {
    const rate = await this.settings.get<number>('money.vat_rate_bp');
    const vat = Math.round((p.amount * rate) / 10_000);
    const party = { partyType: 'merchant' as const, partyId: p.merchantId };
    const lines = [
      { accountCode: '2101', debit: p.amount, credit: 0, ...party },
      { accountCode: incomeAccount(p.companyKey, p.kind), debit: 0, credit: p.amount, costCentreId: p.costCentreId ?? null, ...party },
    ];
    if (vat) lines.push({ accountCode: '2101', debit: vat, credit: 0, ...party }, { accountCode: '2301', debit: 0, credit: vat, ...party });
    await this.ledger.post(tx, {
      companyKey: p.companyKey,
      date: new Date(),
      memo: `${p.kind} fee (${p.sourceType} ${p.sourceId})`,
      sourceType: 'fee.charged',
      sourceId: p.sourceId,
      sourceKey: `fee.charged:${p.kind}:${p.sourceType}:${p.sourceId}`,
      lines,
    });
  }

  /** What we owe the merchant now (credits less debits on 2101). */
  async available(merchantId: string, tx?: Tx) {
    return -(await this.ledger.balance({ accountCode: '2101', partyType: 'merchant', partyId: merchantId }, tx));
  }

  async list(q?: string) {
    const lines = await this.db.journalLine.findMany({ where: { partyType: 'merchant' }, select: { partyId: true, accountCode: true, debit: true, credit: true, entry: { select: { sourceType: true } } } });
    const sums = new Map<string, { collected: number; fees: number; vat: number; paidOut: number; available: number }>();
    for (const l of lines) {
      const s = sums.get(l.partyId!) ?? { collected: 0, fees: 0, vat: 0, paidOut: 0, available: 0 };
      if (l.accountCode === '2101') {
        s.available += l.credit - l.debit;
        if (l.entry.sourceType === 'cash.collected') s.collected += l.credit - l.debit;
        if (l.entry.sourceType === 'payout') s.paidOut += l.debit - l.credit;
      } else if (l.accountCode === '2301') s.vat += l.credit - l.debit;
      else if (l.accountCode.startsWith('4')) s.fees += l.credit - l.debit;
      sums.set(l.partyId!, s);
    }
    const names = new Map((await this.merchants.names([...sums.keys()])).map((m) => [m.id, m]));
    const needle = q?.trim().toLowerCase();
    const rows = [...sums.entries()]
      .map(([merchantId, s]) => ({ merchantId, name: names.get(merchantId)?.name ?? merchantId, code: names.get(merchantId)?.code ?? '', ...s }))
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.code.toLowerCase().includes(needle))
      .sort((a, b) => b.available - a.available);
    return { rows, total: rows.length };
  }

  /** Every movement on the merchant's balance, oldest first, with the running balance. */
  async statement(merchantId: string, from?: Date, to?: Date) {
    const lines = await this.db.journalLine.findMany({
      where: { accountCode: '2101', partyType: 'merchant', partyId: merchantId, ...(from || to ? { entry: { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } } : {}) },
      include: { entry: { select: { date: true, memo: true, sourceType: true, sourceId: true, createdAt: true } } },
    });
    lines.sort((a, b) => a.entry.createdAt.getTime() - b.entry.createdAt.getTime() || a.id.localeCompare(b.id));
    let running = from ? -(await this.ledger.balance({ accountCode: '2101', partyType: 'merchant', partyId: merchantId, to: new Date(from.getTime() - 1) })) : 0;
    const out = lines.map((l) => {
      const amount = l.credit - l.debit;
      running += amount;
      return { date: l.entry.date, memo: l.entry.memo, sourceType: l.entry.sourceType, sourceId: l.entry.sourceId, amount, running };
    });
    return { merchantId, lines: out, balance: await this.available(merchantId) };
  }
}
