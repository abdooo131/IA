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
  lang?: 'en' | 'ar';
}

export interface ReportParams {
  from?: string;
  to?: string;
  asOf?: string;
  lang?: 'en' | 'ar';
}

type Lang = 'en' | 'ar';
const L = (lang: Lang, en: string, ar: string) => (lang === 'ar' ? ar : en);

const JOURNAL_TYPE_AR: Record<string, string> = {
  COD_COLLECTED: 'تحصيل الدفع عند الاستلام',
  ORDER_SETTLEMENT: 'تسوية الطلبات',
  FAILED_DELIVERY_FEE: 'رسوم التوصيل الفاشل',
  CASH_DEPOSIT: 'إيداع نقدي',
  MERCHANT_CASHOUT: 'تحويل للتاجر',
  MERCHANT_ADJUSTMENT: 'تعديل محفظة تاجر',
  REVERSAL: 'قيد عكسي',
  EXPENSE: 'مصروف',
  MANUAL: 'قيد يدوي',
  OPENING_BALANCE: 'رصيد افتتاحي',
  DRIVER_HANDOVER: 'تسليم نقدية المندوب',
};

const TYPE_AR: Record<string, string> = { ASSET: 'أصول', LIABILITY: 'خصوم', EQUITY: 'حقوق ملكية', REVENUE: 'إيرادات', EXPENSE: 'مصروفات' };
const accName = (a: { nameEn: string; nameAr: string }, lang: Lang) => (lang === 'ar' ? a.nameAr : a.nameEn);
const range = (from: string, to: string, lang: Lang) => `${from} ${L(lang, 'to', 'إلى')} ${to}`;

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Builds every finance report from the ledger. Day boundaries follow finance.timezone (Cairo). */
@Injectable()
export class ReportsService {
  constructor(private readonly ledger: LedgerService, private readonly config: ConfigService) {}

  async build(tx: Tx, kind: ReportKind, p: ReportParams): Promise<ReportData> {
    const data = await this.buildInner(tx, kind, p);
    return { ...data, lang: p.lang === 'ar' ? 'ar' : 'en' };
  }

  private async buildInner(tx: Tx, kind: ReportKind, p: ReportParams): Promise<ReportData> {
    const lang: Lang = p.lang === 'ar' ? 'ar' : 'en';
    const tz = await this.config.getString('finance.timezone', tx);
    const today = new Date().toISOString().slice(0, 10);
    const from = isDate(p.from) ? p.from! : today.slice(0, 8) + '01';
    const to = isDate(p.to) ? p.to! : today;
    const asOf = isDate(p.asOf) ? p.asOf! : today;
    if (from > to) throw new BadRequestException('The start date must be before the end date');
    switch (kind) {
      case 'trial_balance':
        return this.trialBalance(tx, asOf, tz, lang);
      case 'income_statement':
        return this.incomeStatement(tx, from, to, tz, lang);
      case 'balance_sheet':
        return this.balanceSheet(tx, asOf, tz, lang);
      case 'cash_flow':
        return this.cashFlow(tx, from, to, tz, lang);
      case 'daily_cod':
        return this.dailyCod(tx, from, to, tz, lang);
      case 'merchant_profitability':
        return this.merchantProfitability(tx, from, to, tz, lang);
      default:
        throw new BadRequestException(`Unknown report ${kind}`);
    }
  }

  /** Start of a local calendar day in the finance timezone, as an instant. */
  private async dayStart(tx: Tx, day: string, tz: string, addDays = 0): Promise<Date> {
    const [r] = await tx.$queryRaw<{ t: Date }[]>`SELECT ((${day}::date + ${addDays}::int)::timestamp AT TIME ZONE ${tz}) AS t`;
    return r.t;
  }

  private async trialBalance(tx: Tx, asOf: string, tz: string, lang: Lang): Promise<ReportData> {
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
      rows.push({ code: a.code, account: accName(a, lang), type: lang === 'ar' ? TYPE_AR[a.type] : a.type, debit, credit });
    }
    rows.push({ style: 'total', code: '', account: L(lang, 'Total', 'الإجمالي'), type: '', debit: td, credit: tc });
    return {
      kind: 'trial_balance',
      title: L(lang, 'Trial balance', 'ميزان المراجعة'),
      period: `${L(lang, 'As of', 'حتى')} ${asOf}`,
      columns: [
        { key: 'code', label: L(lang, 'Code', 'الكود'), type: 'text' },
        { key: 'account', label: L(lang, 'Account', 'الحساب'), type: 'text' },
        { key: 'type', label: L(lang, 'Type', 'النوع'), type: 'text' },
        { key: 'debit', label: L(lang, 'Debit', 'مدين'), type: 'money' },
        { key: 'credit', label: L(lang, 'Credit', 'دائن'), type: 'money' },
      ],
      rows,
      checks: [{ label: L(lang, 'Debits equal credits', 'المدين يساوي الدائن'), ok: td === tc }],
    };
  }

  private async incomeStatement(tx: Tx, from: string, to: string, tz: string, lang: Lang): Promise<ReportData> {
    const start = await this.dayStart(tx, from, tz);
    const end = await this.dayStart(tx, to, tz, 1);
    const accounts = await this.ledger.accountBalances(tx, end, start);
    const rev = accounts.filter((a) => a.type === 'REVENUE');
    const exp = accounts.filter((a) => a.type === 'EXPENSE');
    const totalRev = rev.reduce((s, a) => s + a.balance, 0);
    const totalExp = exp.reduce((s, a) => s + a.balance, 0);
    const rows: ReportRow[] = [
      { style: 'section', line: L(lang, 'Revenue', 'الإيرادات') },
      ...rev.map((a) => ({ code: a.code, line: accName(a, lang), amount: a.balance })),
      { style: 'subtotal', line: L(lang, 'Total revenue', 'إجمالي الإيرادات'), amount: totalRev },
      { style: 'section', line: L(lang, 'Expenses', 'المصروفات') },
      ...exp.map((a) => ({ code: a.code, line: accName(a, lang), amount: a.balance })),
      { style: 'subtotal', line: L(lang, 'Total expenses', 'إجمالي المصروفات'), amount: totalExp },
      { style: 'total', line: L(lang, 'Net profit', 'صافي الربح'), amount: totalRev - totalExp },
    ];
    return {
      kind: 'income_statement',
      title: L(lang, 'Profit and loss', 'الأرباح والخسائر'),
      period: range(from, to, lang),
      columns: [
        { key: 'code', label: L(lang, 'Code', 'الكود'), type: 'text' },
        { key: 'line', label: L(lang, 'Line', 'البند'), type: 'text' },
        { key: 'amount', label: L(lang, 'Amount', 'المبلغ'), type: 'money' },
      ],
      rows,
      checks: [],
    };
  }

  private async balanceSheet(tx: Tx, asOf: string, tz: string, lang: Lang): Promise<ReportData> {
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
      { style: 'section', line: L(lang, 'Assets', 'الأصول') },
      ...assets.map((a) => ({ code: a.code, line: accName(a, lang), amount: a.balance })),
      { style: 'subtotal', line: L(lang, 'Total assets', 'إجمالي الأصول'), amount: totalAssets },
      { style: 'section', line: L(lang, 'Liabilities', 'الخصوم') },
      ...liabilities.map((a) => ({ code: a.code, line: accName(a, lang), amount: a.balance })),
      { style: 'subtotal', line: L(lang, 'Total liabilities', 'إجمالي الخصوم'), amount: totalLiab },
      { style: 'section', line: L(lang, 'Equity', 'حقوق الملكية') },
      ...equity.map((a) => ({ code: a.code, line: accName(a, lang), amount: a.balance })),
      { code: '', line: L(lang, 'Retained earnings (revenue less expenses to date)', 'الأرباح المحتجزة (الإيرادات ناقص المصروفات حتى تاريخه)'), amount: retained },
      { style: 'subtotal', line: L(lang, 'Total equity', 'إجمالي حقوق الملكية'), amount: totalEquity },
      { style: 'total', line: L(lang, 'Total liabilities and equity', 'إجمالي الخصوم وحقوق الملكية'), amount: totalLiab + totalEquity },
    ];
    return {
      kind: 'balance_sheet',
      title: L(lang, 'Balance sheet', 'الميزانية العمومية'),
      period: `${L(lang, 'As of', 'حتى')} ${asOf}`,
      columns: [
        { key: 'code', label: L(lang, 'Code', 'الكود'), type: 'text' },
        { key: 'line', label: L(lang, 'Line', 'البند'), type: 'text' },
        { key: 'amount', label: L(lang, 'Amount', 'المبلغ'), type: 'money' },
      ],
      rows,
      checks: [{ label: L(lang, 'Assets equal liabilities plus equity', 'الأصول تساوي الخصوم مع حقوق الملكية'), ok: totalAssets === totalLiab + totalEquity }],
    };
  }

  private async cashFlow(tx: Tx, from: string, to: string, tz: string, lang: Lang): Promise<ReportData> {
    const start = await this.dayStart(tx, from, tz);
    const end = await this.dayStart(tx, to, tz, 1);
    const cashAccounts = [ACC.BANK, ACC.CASH_WITH_DRIVERS, ACC.FAWRY_RECEIVABLE];
    const names = await tx.ledgerAccount.findMany({ where: { code: { in: cashAccounts } } });
    const rows: ReportRow[] = [];
    let ok = true;
    for (const code of cashAccounts) {
      const acc = names.find((n) => n.code === code);
      const name = acc ? accName(acc, lang) : code;
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
      rows.push({ line: L(lang, 'Opening balance', 'الرصيد الافتتاحي'), inflow: null, outflow: null, amount: opening });
      let net = 0;
      for (const m of moves) {
        const i = Number(m.inflow);
        const o = Number(m.outflow);
        net += i - o;
        rows.push({ line: lang === 'ar' ? JOURNAL_TYPE_AR[m.type] ?? m.type : humanType(m.type), inflow: i, outflow: o, amount: i - o });
      }
      rows.push({ style: 'subtotal', line: L(lang, 'Closing balance', 'الرصيد الختامي'), inflow: null, outflow: null, amount: closing });
      ok = ok && opening + net === closing;
    }
    return {
      kind: 'cash_flow',
      title: L(lang, 'Cash flow', 'التدفقات النقدية'),
      period: range(from, to, lang),
      columns: [
        { key: 'line', label: L(lang, 'Line', 'البند'), type: 'text' },
        { key: 'inflow', label: L(lang, 'In', 'وارد'), type: 'money' },
        { key: 'outflow', label: L(lang, 'Out', 'صادر'), type: 'money' },
        { key: 'amount', label: L(lang, 'Net / balance', 'الصافي / الرصيد'), type: 'money' },
      ],
      rows,
      checks: [{ label: L(lang, 'Opening plus movements equals closing', 'الرصيد الافتتاحي مع الحركة يساوي الختامي'), ok }],
    };
  }

  private async dailyCod(tx: Tx, from: string, to: string, tz: string, lang: Lang): Promise<ReportData> {
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
    rows.push({ style: 'total', day: L(lang, 'Total', 'الإجمالي'), ...totals, withDrivers });
    return {
      kind: 'daily_cod',
      title: L(lang, 'Daily COD', 'التحصيل اليومي'),
      period: range(from, to, lang),
      columns: [
        { key: 'day', label: L(lang, 'Day', 'اليوم'), type: 'text' },
        { key: 'delivered', label: L(lang, 'COD orders delivered', 'طلبات تحصيل مسلّمة'), type: 'int' },
        { key: 'collected', label: L(lang, 'COD collected', 'المبلغ المحصل'), type: 'money' },
        { key: 'settled', label: L(lang, 'Settled to merchants', 'تمت تسويته للتجار'), type: 'money' },
        { key: 'deposited', label: L(lang, 'Handed in by drivers', 'سلّمه المناديب'), type: 'money' },
        { key: 'withDrivers', label: L(lang, 'Still with drivers', 'متبقٍ مع المناديب'), type: 'money' },
      ],
      rows,
      checks: [],
    };
  }

  private async merchantProfitability(tx: Tx, from: string, to: string, tz: string, lang: Lang): Promise<ReportData> {
    const start = await this.dayStart(tx, from, tz);
    const end = await this.dayStart(tx, to, tz, 1);
    const data = await tx.$queryRaw<
      { code: string; name: string; name_ar: string; created: bigint; delivered: bigint; failed: bigint; cod: bigint; revenue: bigint; vat: bigint; compensation: bigint }[]
    >`
      SELECT m.code, m.name_en AS name, m.name_ar AS name_ar,
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
      return { merchant: `${lang === 'ar' ? d.name_ar : d.name} (${d.code})`, ...r, contribution };
    });
    rows.push({ style: 'total', merchant: L(lang, 'Total', 'الإجمالي'), ...totals });
    return {
      kind: 'merchant_profitability',
      title: L(lang, 'Merchant profitability', 'ربحية التجار'),
      period: range(from, to, lang),
      columns: [
        { key: 'merchant', label: L(lang, 'Merchant', 'التاجر'), type: 'text' },
        { key: 'created', label: L(lang, 'Orders created', 'طلبات منشأة'), type: 'int' },
        { key: 'delivered', label: L(lang, 'Delivered', 'تم التوصيل'), type: 'int' },
        { key: 'failed', label: L(lang, 'Failed', 'فشل'), type: 'int' },
        { key: 'cod', label: L(lang, 'COD handled', 'التحصيل'), type: 'money' },
        { key: 'revenue', label: L(lang, 'Revenue', 'الإيراد'), type: 'money' },
        { key: 'vat', label: L(lang, 'VAT', 'الضريبة'), type: 'money' },
        { key: 'compensation', label: L(lang, 'Compensation', 'التعويضات'), type: 'money' },
        { key: 'contribution', label: L(lang, 'Contribution', 'صافي المساهمة'), type: 'money' },
      ],
      rows,
      checks: [],
    };
  }
}

export function humanType(t: string) {
  return t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' ');
}
