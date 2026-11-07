import { changeOf, type DrillReportResult } from '@shiplynow/shared';
import { BRAND, type PdfLang, PdfWriter } from '../common/pdf';

// The drill down reports printed (Accounting UX phase B): profit and loss, balance sheet and
// trial balance, in English or Arabic, with the comparison columns when one was asked for.
// The figures are the report's own; the words of both languages live here.

const TEXT = {
  en: {
    profit_and_loss: 'Profit and loss',
    balance_sheet: 'Balance sheet',
    trial_balance: 'Trial balance',
    period: (from: string, to: string) => `${from} to ${to}`,
    asOf: (day: string) => `As of ${day}`,
    compared: (from: string, to: string) => `Compared with ${from} to ${to}`,
    comparedAsOf: (day: string) => `Compared with ${day}`,
    store: 'Store',
    merchant: 'Merchant',
    account: 'Account',
    amount: 'Amount',
    debit: 'Debit',
    credit: 'Credit',
    balance: 'Balance',
    compare: 'Compared',
    change: 'Change',
    percent: '%',
    total: 'Total',
    sections: {
      income: 'Income',
      expenses: 'Expenses',
      assets: 'Assets',
      liabilities: 'Liabilities',
      equity: 'Equity',
      asset: 'Assets',
      liability: 'Liabilities',
      revenue: 'Income',
      expense: 'Expenses',
    } as Record<string, string>,
    result: {
      profit: 'Profit (loss)',
      difference: 'Difference (0 when balanced)',
    } as Record<string, string>,
    earnings: 'Profit so far (not yet closed into equity)',
    wallets: (group: string, n: number) => `${group}: ${n} wallets`,
    groups: {
      1300: 'Cash with riders',
      1350: 'Rider dues',
      1500: 'Staff advances',
      2100: 'Merchant balances',
      2200: 'Rider pay owed',
      2500: 'Supplier balances',
      2600: 'Merchant security deposits',
    } as Record<number, string>,
    footer: (title: string, page: number, pages: number) =>
      `Shiply Now · ${title} · page ${page} of ${pages}`,
  },
  ar: {
    profit_and_loss: 'الأرباح والخسائر',
    balance_sheet: 'الميزانية',
    trial_balance: 'ميزان المراجعة',
    period: (from: string, to: string) => `من ${from} إلى ${to}`,
    asOf: (day: string) => `في يوم ${day}`,
    compared: (from: string, to: string) => `مقارنة بالفترة من ${from} إلى ${to}`,
    comparedAsOf: (day: string) => `مقارنة بيوم ${day}`,
    store: 'المخزن',
    merchant: 'التاجر',
    account: 'الحساب',
    amount: 'المبلغ',
    debit: 'مدين',
    credit: 'دائن',
    balance: 'الرصيد',
    compare: 'المقارنة',
    change: 'التغيير',
    percent: '٪',
    total: 'الإجمالي',
    sections: {
      income: 'الإيرادات',
      expenses: 'المصروفات',
      assets: 'الأصول',
      liabilities: 'الخصوم',
      equity: 'حقوق الملكية',
      asset: 'الأصول',
      liability: 'الخصوم',
      revenue: 'الإيرادات',
      expense: 'المصروفات',
    } as Record<string, string>,
    result: {
      profit: 'الربح (الخسارة)',
      difference: 'الفرق (صفر لما تكون متوازنة)',
    } as Record<string, string>,
    earnings: 'الربح لحد دلوقتي (لسه ما اتقفلش في حقوق الملكية)',
    wallets: (group: string, n: number) => `${group}: ${n} محفظة`,
    groups: {
      1300: 'نقدية مع المناديب',
      1350: 'مستحقات على المناديب',
      1500: 'سلف الموظفين',
      2100: 'أرصدة التجار',
      2200: 'أجر المناديب المستحق',
      2500: 'أرصدة الموردين',
      2600: 'تأمينات التجار',
    } as Record<number, string>,
    footer: (title: string, page: number, pages: number) =>
      `شيبلي ناو · ${title} · صفحة ${page} من ${pages}`,
  },
};

/** Piastres as EGP with two decimals and thousands separators (digits stay Latin). */
export function egpText(piastres: number) {
  const sign = piastres < 0 ? '-' : '';
  const abs = Math.abs(piastres);
  const pounds = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${pounds}.${String(abs % 100).padStart(2, '0')}`;
}

export async function reportPdf(
  report: DrillReportResult,
  lang: PdfLang,
  names: { store?: string | null; merchant?: string | null },
): Promise<Buffer> {
  const T = TEXT[lang];
  const title = T[report.report];
  const pdf = new PdfWriter(lang, { title });
  const balanceSheet = report.report === 'balance_sheet';
  const trial = report.report === 'trial_balance';
  const cmp = report.compare;

  pdf.paragraph(title, { size: 18, bold: true, color: BRAND.navy });
  pdf.paragraph(balanceSheet ? T.asOf(report.to) : T.period(report.from, report.to), {
    color: BRAND.muted,
  });
  if (cmp)
    pdf.paragraph(balanceSheet ? T.comparedAsOf(cmp.to) : T.compared(cmp.from, cmp.to), {
      color: BRAND.muted,
    });
  if (names.store) pdf.paragraph(`${T.store}: ${names.store}`, { color: BRAND.muted });
  if (names.merchant) pdf.paragraph(`${T.merchant}: ${names.merchant}`, { color: BRAND.muted });
  pdf.y += 6;

  // Columns: account, (debit, credit,) amount, then compared, change, % when comparing.
  const widths = cmp
    ? trial
      ? [0.3, 0.13, 0.13, 0.14, 0.13, 0.11, 0.06]
      : [0.4, 0.16, 0.16, 0.16, 0.12]
    : trial
      ? [0.46, 0.18, 0.18, 0.18]
      : [0.7, 0.3];
  const header = [
    T.account,
    ...(trial ? [T.debit, T.credit, T.balance] : [T.amount]),
    ...(cmp ? [T.compare, T.change, T.percent] : []),
  ];
  const row = (
    label: string,
    amount: number,
    compare: number | null,
    extra: { debit?: number; credit?: number; bold?: boolean; fill?: string } = {},
  ) => {
    const values = [
      ...(trial
        ? [
            extra.debit !== undefined ? egpText(extra.debit) : '',
            extra.credit !== undefined ? egpText(extra.credit) : '',
          ]
        : []),
      egpText(amount),
      ...(cmp
        ? (() => {
            const c = changeOf(amount, compare ?? 0);
            return [
              egpText(compare ?? 0),
              egpText(c.change),
              c.percent === null ? '–' : `${c.percent}`,
            ];
          })()
        : []),
    ];
    pdf.row(
      [
        { text: label, width: widths[0]!, bold: extra.bold },
        ...values.map((v, i) => ({
          text: v,
          width: widths[i + 1]!,
          align: 'end' as const,
          bold: extra.bold,
        })),
      ],
      { fill: extra.fill },
    );
  };

  for (const section of report.sections) {
    pdf.heading(T.sections[section.key] ?? section.key);
    pdf.row(
      header.map((h, i) => ({
        text: h,
        width: widths[i]!,
        bold: true,
        color: BRAND.muted,
        align: i === 0 ? ('start' as const) : ('end' as const),
      })),
      { size: 8.5 },
    );
    for (const l of section.lines) {
      const name = lang === 'ar' ? l.nameAr || l.nameEn : l.nameEn;
      const label =
        l.code === 'earnings'
          ? T.earnings
          : l.walletGroup !== null
            ? T.wallets(T.groups[l.walletGroup] ?? String(l.walletGroup), l.wallets ?? 0)
            : `${l.code} ${name}`;
      row(label, l.amountPiastres, l.compareAmountPiastres, {
        debit: l.debitPiastres,
        credit: l.creditPiastres,
      });
    }
    row(
      `${T.total} ${T.sections[section.key] ?? ''}`.trim(),
      section.totalPiastres,
      section.compareTotalPiastres,
      { bold: true, fill: BRAND.soft },
    );
  }
  pdf.y += 8;
  row(T.result[report.result.key] ?? report.result.key, report.result.amountPiastres, report.result.compareAmountPiastres, {
    bold: true,
    fill: BRAND.cream,
    ...(report.totals
      ? { debit: report.totals.debitPiastres, credit: report.totals.creditPiastres }
      : {}),
  });
  pdf.footer((page, pages) => T.footer(title, page, pages));
  return pdf.end();
}
