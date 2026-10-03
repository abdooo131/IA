import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { Tx } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { ACC } from './posting';

export const REPORT_KINDS = ['trial_balance', 'income_statement', 'balance_sheet', 'cash_flow', 'daily_cod', 'merchant_profitability'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'money' | 'int';
}
export type ReportRow = { style?: 'section' | 'subtotal' | 'total' } & Record<string, string | number | null | undefined>;

export interface ReportData {
  kind: ReportKind;
  title: string;
  period: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  checks: { label: string; ok: boolean }[];
}

export interface ReportParams {
  from?: string;
  to?: string;
  asOf?: string;
}

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Builds every finance report from the ledger. Day boundaries follow finance.timezone (Cairo). */
@Injectable()
export class ReportsService {
  constructor(private readonly ledger: LedgerService, private readonly config: ConfigService) {}

  async build(tx: Tx, kind: ReportKind, p: ReportParams): Promise<ReportData> {
    const tz = await this.config.getString('finance.timezone', tx);
    const today = new Date().toISOString().slice(0, 10);
    const from = isDate(p.from) ? p.from! : today.slice(0, 8) + '01';
    const to = isDate(p.to) ? p.to! : today;
    const asOf = isDate(p.asOf) ? p.asOf! : today;
    if (from > to) throw new BadRequestException('The start date must be before the end date');
    switch (kind) {
      case 'trial_balance':
        return this.trialBalance(tx, asOf, tz);
      case 'income_statement':
        return this.incomeStatement(tx, from, to, tz);
      case 'balance_sheet':
        return this.balanceSheet(tx, asOf, tz);
      case 'cash_flow':
        return this.cashFlow(tx, from, to, tz);
      case 'daily_cod':
        return this.dailyCod(tx, from, to, tz);
      case 'merchant_profitability':
        return this.merchantProfitability(tx, from, to, tz);
      default:
        throw new BadRequestException(`Unknown report ${kind}`);
    }
  }

  /** Start of a local calendar day in the finance timezone, as an instant. */
  private async dayStart(tx: Tx, day: string, tz: string, addDays = 0): Promise<Date> {
    const [r] = await tx.$queryRaw<{ t: Date }[]>`SELECT ((${day}::date + ${addDays}::int)::timestamp AT TIME ZONE ${tz}) AS t`;
    return r.t;
  }

  private async trialBalance(tx: Tx, asOf: string, tz: string): Promise<ReportData> {
    const end = await this.dayStart(tx, asOf, tz, 1);
    const accounts = await this.ledger.accountBalances(tx, end);
    const rows: ReportRow[] = [];
    let td = 0;
    let tc = 0;
    for (const a of accounts) {
      const net = a.debit - a.credit;
      if (a.debit === 0 && a.credit === 0) continue;
      const debit = net > 0 ? net : 0;
      const credit = net < 0 ? -net : 0;
      td += debit;
      tc += credit;
      rows.push({ code: a.code, account: a.nameEn, type: a.type, debit, credit });
    }
    rows.push({ style: 'total', code: '', account: 'Total', type: '', debit: td, credit: tc });
    return {
      kind: 'trial_balance',
      title: 'Trial balance',
      period: `As of ${asOf}`,
      columns: [
        { key: 'code', label: 'Code', type: 'text' },
        { key: 'account', label: 'Account', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'debit', label: 'Debit', type: 'money' },
        { key: 'credit', label: 'Credit', type: 'money' },
      ],
      rows,
      checks: [{ label: 'Debits equal credits', ok: td === tc }],
    };
  }

  private async incomeStatement(tx: Tx, from: string, to: string, tz: string): Promise<ReportData> {
    const start = await this.dayStart(tx, from, tz);
    const end = await this.dayStart(tx, to, tz, 1);
    const accounts = await this.ledger.accountBalances(tx, end, start);
    const rev = accounts.filter((a) => a.type === 'REVENUE');
    const exp = accounts.filter((a) => a.type === 'EXPENSE');
    const totalRev = rev.reduce((s, a) => s + a.balance, 0);
    const totalExp = exp.reduce((s, a) => s + a.balance, 0);
    const rows: ReportRow[] = [
      { style: 'section', line: 'Revenue' },
      ...rev.map((a) => ({ code: a.code, line: a.nameEn, amount: a.balance })),
      { style: 'subtotal', line: 'Total revenue', amount: totalRev },
      { style: 'section', line: 'Expenses' },
      ...exp.map((a) => ({ code: a.code, line: a.nameEn, amount: a.balance })),
      { style: 'subtotal', line: 'Total expenses', amount: totalExp },
      { style: 'total', line: 'Net profit', amount: totalRev - totalExp },
    ];
    return {
      kind: 'income_statement',
      title: 'Profit and loss',
      period: `${from} to ${to}`,
      columns: [
        { key: 'code', label: 'Code', type: 'text' },
        { key: 'line', label: 'Line', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows,
      checks: [],
    };
  }

  private async balanceSheet(tx: Tx, asOf: string, tz: string): Promise<ReportData> {
    const end = await this.dayStart(tx, asOf, tz, 1);
    const accounts = await this.ledger.accountBalances(tx, end);
    const sum = (t: string) => accounts.filter((a) => a.type === t).reduce((s, a) => s + a.balance, 0);
    const assets = accounts.filter((a) => a.type === 'ASSET');
    const liabilities = accounts.filter((a) => a.type === 'LIABILITY');
    const equity = accounts.filter((a) => a.type === 'EQUITY');
    const retained = sum('REVENUE') - sum('EXPENSE');
    const totalAssets = sum('ASSET');
    const totalLiab = sum('LIABILITY');
    const totalEquity = sum('EQUITY') + retained;
    const rows: ReportRow[] = [
      { style: 'section', line: 'Assets' },
      ...assets.map((a) => ({ code: a.code, line: a.nameEn, amount: a.balance })),
      { style: 'subtotal', line: 'Total assets', amount: totalAssets },
      { style: 'section', line: 'Liabilities' },
      ...liabilities.map((a) => ({ code: a.code, line: a.nameEn, amount: a.balance })),
      { style: 'subtotal', line: 'Total liabilities', amount: totalLiab },
      { style: 'section', line: 'Equity' },
      ...equity.map((a) => ({ code: a.code, line: a.nameEn, amount: a.balance })),
      { code: '', line: 'Retained earnings (revenue less expenses to date)', amount: retained },
      { style: 'subtotal', line: 'Total equity', amount: totalEquity },
      { style: 'total', line: 'Total liabilities and equity', amount: totalLiab + totalEquity },
    ];
    return {
      kind: 'balance_sheet',
      title: 'Balance sheet',
      period: `As of ${asOf}`,
      columns: [
        { key: 'code', label: 'Code', type: 'text' },
        { key: 'line', label: 'Line', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows,
      checks: [{ label: 'Assets equal liabilities plus equity', ok: totalAssets === totalLiab + totalEquity }],
    };
  }

  private async cashFlow(tx: Tx, from: string, to: string, tz: string): Promise<ReportData> {
    const start = await this.dayStart(tx, from, tz);
    const end = await this.dayStart(tx, to, tz, 1);
    const cashAccounts = [ACC.BANK, ACC.CASH_WITH_DRIVERS, ACC.FAWRY_RECEIVABLE];
    const names = await tx.ledgerAccount.findMany({ where: { code: { in: cashAccounts } } });
    const rows: ReportRow[] = [];
    let ok = true;
    for (const code of cashAccounts) {
      const name = names.find((n) => n.code === code)?.nameEn ?? code;
      const [open] = await tx.$queryRaw<{ b: bigint | null }[]>`
        SELECT sum(debit - credit) AS b FROM ledger_entries WHERE account_code = ${code} AND occurred_at < ${start}`;
      const moves = await tx.$queryRaw<{ type: string; inflow: bigint; outflow: bigint }[]>`
        SELECT j.type::text AS type, sum(l.debit) AS inflow, sum(l.credit) AS outflow
        FROM ledger_entries l JOIN journal_entries j ON j.id = l.journal_id
        WHERE l.account_code = ${code} AND l.occurred_at >= ${start} AND l.occurred_at < ${end}
        GROUP BY j.type ORDER BY j.type`;
      const [close] = await tx.$queryRaw<{ b: bigint | null }[]>`
        SELECT sum(debit - credit) AS b FROM ledger_entries WHERE account_code = ${code} AND occurred_at < ${end}`;
      const opening = Number(open.b ?? 0);
      const closing = Number(close.b ?? 0);
      rows.push({ style: 'section', line: `${code} ${name}` });
      rows.push({ line: 'Opening balance', inflow: null, outflow: null, amount: opening });
      let net = 0;
      for (const m of moves) {
        const i = Number(m.inflow);
        const o = Number(m.outflow);
        net += i - o;
        rows.push({ line: humanType(m.type), inflow: i, outflow: o, amount: i - o });
      }
      rows.push({ style: 'subtotal', line: 'Closing balance', inflow: null, outflow: null, amount: closing });
      ok = ok && opening + net === closing;
    }
    return {
      kind: 'cash_flow',
      title: 'Cash flow',
      period: `${from} to ${to}`,
      columns: [
        { key: 'line', label: 'Line', type: 'text' },
        { key: 'inflow', label: 'In', type: 'money' },
        { key: 'outflow', label: 'Out', type: 'money' },
        { key: 'amount', label: 'Net / balance', type: 'money' },
      ],
      rows,
      checks: [{ label: 'Opening plus movements equals closing', ok }],
    };
  }

  private async dailyCod(tx: Tx, from: string, to: string, tz: string): Promise<ReportData> {
    const start = await this.dayStart(tx, from, tz);
    const end = await this.dayStart(tx, to, tz, 1);
    const days = await tx.$queryRaw<{ day: string; delivered: bigint; collected: bigint; settled: bigint; deposited: bigint }[]>`
      WITH days AS (
        SELECT generate_series(${from}::date, ${to}::date, interval '1 day')::date AS day
      ), l AS (
        SELECT (l.occurred_at AT TIME ZONE ${tz})::date AS day, j.type, l.account_code, l.debit, l.credit
        FROM ledger_entries l JOIN journal_entries j ON j.id = l.journal_id
        WHERE l.occurred_at >= ${start} AND l.occurred_at < ${end}
      )
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
        (SELECT count(*) FROM l WHERE l.day = d.day AND l.type = 'COD_COLLECTED' AND l.account_code = ${ACC.CASH_WITH_DRIVERS}) AS delivered,
        (SELECT coalesce(sum(debit), 0) FROM l WHERE l.day = d.day AND l.type = 'COD_COLLECTED' AND l.account_code = ${ACC.CASH_WITH_DRIVERS}) AS collected,
        (SELECT coalesce(sum(debit), 0) FROM l WHERE l.day = d.day AND l.type = 'ORDER_SETTLEMENT' AND l.account_code = ${ACC.COD_AWAITING_SETTLEMENT}) AS settled,
        (SELECT coalesce(sum(credit), 0) FROM l WHERE l.day = d.day AND l.type = 'CASH_DEPOSIT' AND l.account_code = ${ACC.CASH_WITH_DRIVERS}) AS deposited
      FROM days d ORDER BY d.day`;
    const [open] = await tx.$queryRaw<{ b: bigint | null }[]>`
      SELECT sum(debit - credit) AS b FROM ledger_entries WHERE account_code = ${ACC.CASH_WITH_DRIVERS} AND occurred_at < ${start}`;
    let withDrivers = Number(open.b ?? 0);
    const totals = { delivered: 0, collected: 0, settled: 0, deposited: 0 };
    const rows: ReportRow[] = days.map((d) => {
      const r = { delivered: Number(d.delivered), collected: Number(d.collected), settled: Number(d.settled), deposited: Number(d.deposited) };
      withDrivers += r.collected - r.deposited;
      totals.delivered += r.delivered;
      totals.collected += r.collected;
      totals.settled += r.settled;
      totals.deposited += r.deposited;
      return { day: d.day, ...r, withDrivers };
    });
    rows.push({ style: 'total', day: 'Total', ...totals, withDrivers });
    return {
      kind: 'daily_cod',
      title: 'Daily COD',
      period: `${from} to ${to}`,
      columns: [
        { key: 'day', label: 'Day', type: 'text' },
        { key: 'delivered', label: 'COD orders delivered', type: 'int' },
        { key: 'collected', label: 'COD collected', type: 'money' },
        { key: 'settled', label: 'Settled to merchants', type: 'money' },
        { key: 'deposited', label: 'Deposited by drivers', type: 'money' },
        { key: 'withDrivers', label: 'Still with drivers', type: 'money' },
      ],
      rows,
      checks: [],
    };
  }

  private async merchantProfitability(tx: Tx, from: string, to: string, tz: string): Promise<ReportData> {
    const start = await this.dayStart(tx, from, tz);
    const end = await this.dayStart(tx, to, tz, 1);
    const data = await tx.$queryRaw<
      { code: string; name: string; created: bigint; delivered: bigint; failed: bigint; cod: bigint; revenue: bigint; vat: bigint; compensation: bigint }[]
    >`
      SELECT m.code, m.name_en AS name,
        (SELECT count(*) FROM orders o WHERE o.merchant_id = m.id AND o.created_at >= ${start} AND o.created_at < ${end}) AS created,
        (SELECT count(*) FROM orders o WHERE o.merchant_id = m.id AND o.status = 'DELIVERED' AND o.finalized_at >= ${start} AND o.finalized_at < ${end}) AS delivered,
        (SELECT count(*) FROM orders o WHERE o.merchant_id = m.id AND o.status IN ('RETURNED', 'UNSUCCESSFUL') AND o.finalized_at >= ${start} AND o.finalized_at < ${end}) AS failed,
        (SELECT coalesce(sum(credit), 0) FROM ledger_entries l WHERE l.merchant_id = m.id AND l.account_code = ${ACC.COD_AWAITING_SETTLEMENT} AND l.occurred_at >= ${start} AND l.occurred_at < ${end}) AS cod,
        (SELECT coalesce(sum(credit - debit), 0) FROM ledger_entries l WHERE l.merchant_id = m.id AND l.account_code LIKE '4%' AND l.occurred_at >= ${start} AND l.occurred_at < ${end}) AS revenue,
        (SELECT coalesce(sum(credit - debit), 0) FROM ledger_entries l WHERE l.merchant_id = m.id AND l.account_code = ${ACC.VAT_PAYABLE} AND l.occurred_at >= ${start} AND l.occurred_at < ${end}) AS vat,
        (SELECT coalesce(sum(debit - credit), 0) FROM ledger_entries l WHERE l.merchant_id = m.id AND l.account_code = ${ACC.EXP_COMPENSATION} AND l.occurred_at >= ${start} AND l.occurred_at < ${end}) AS compensation
      FROM merchants m WHERE NOT m.archived ORDER BY m.name_en`;
    const totals = { created: 0, delivered: 0, failed: 0, cod: 0, revenue: 0, vat: 0, compensation: 0, contribution: 0 };
    const rows: ReportRow[] = data.map((d) => {
      const r = {
        created: Number(d.created), delivered: Number(d.delivered), failed: Number(d.failed), cod: Number(d.cod),
        revenue: Number(d.revenue), vat: Number(d.vat), compensation: Number(d.compensation),
      };
      const contribution = r.revenue - r.compensation;
      for (const k of Object.keys(r) as (keyof typeof r)[]) totals[k] += r[k];
      totals.contribution += contribution;
      return { merchant: `${d.name} (${d.code})`, ...r, contribution };
    });
    rows.push({ style: 'total', merchant: 'Total', ...totals });
    return {
      kind: 'merchant_profitability',
      title: 'Merchant profitability',
      period: `${from} to ${to}`,
      columns: [
        { key: 'merchant', label: 'Merchant', type: 'text' },
        { key: 'created', label: 'Orders created', type: 'int' },
        { key: 'delivered', label: 'Delivered', type: 'int' },
        { key: 'failed', label: 'Failed', type: 'int' },
        { key: 'cod', label: 'COD handled', type: 'money' },
        { key: 'revenue', label: 'Revenue', type: 'money' },
        { key: 'vat', label: 'VAT', type: 'money' },
        { key: 'compensation', label: 'Compensation', type: 'money' },
        { key: 'contribution', label: 'Contribution', type: 'money' },
      ],
      rows,
      checks: [],
    };
  }
}

export function humanType(t: string) {
  return t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' ');
}
