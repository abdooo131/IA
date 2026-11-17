import type { payablesAging, receivablesAging } from '@shiplynow/db';
import { AGING_BANDS, type AgingBuckets } from '@shiplynow/shared';
import { BRAND, type PdfLang, PdfWriter } from '../common/pdf';
import { egpText } from './report-pdf';

// The aging reports printed (who owes us, what we owe suppliers), in English or Arabic: one row
// per party with its amount in each age band, then the totals. The words of both languages
// live here; the method is the one the page explains.

type Receivables = Awaited<ReturnType<typeof receivablesAging>>;
type Payables = Awaited<ReturnType<typeof payablesAging>>;

const TEXT = {
  en: {
    receivables: 'Who owes us, by age',
    payables: 'What we owe suppliers, by age',
    asOf: (day: string) => `As of ${day} (Cairo days)`,
    store: 'Store',
    search: 'Search',
    merchants: 'Merchants who owe us',
    cheques: 'Cheques waiting to be collected',
    suppliers: 'Suppliers',
    party: 'Name',
    total: 'Total',
    grand: 'Everything',
    none: 'Nothing here.',
    bands: {
      current: 'Not yet due',
      d1_30: '1-30',
      d31_60: '31-60',
      d61_90: '61-90',
      over_90: 'Over 90',
    } as Record<string, string>,
    receivablesMethod:
      'Merchants have no due dates: each fee or charge counts from the day it was booked, and the cash we collected for them and their payments pay the oldest amounts first. Cheques count from the day they may be cashed.',
    payablesMethod:
      'Each bill counts from its due day, with what was still unpaid at the end of the chosen day.',
    footer: (title: string, page: number, pages: number) =>
      `Shiply Now · ${title} · page ${page} of ${pages}`,
  },
  ar: {
    receivables: 'المستحق لنا حسب العمر',
    payables: 'المستحق للموردين حسب العمر',
    asOf: (day: string) => `في يوم ${day} (بتوقيت القاهرة)`,
    store: 'المخزن',
    search: 'البحث',
    merchants: 'تجار عليهم مستحقات لنا',
    cheques: 'شيكات تحت التحصيل',
    suppliers: 'الموردون',
    party: 'الاسم',
    total: 'الإجمالي',
    grand: 'الكل',
    none: 'لا شيء هنا.',
    bands: {
      current: 'لم يستحق بعد',
      d1_30: '1-30',
      d31_60: '31-60',
      d61_90: '61-90',
      over_90: 'أكثر من 90',
    } as Record<string, string>,
    receivablesMethod:
      'التجار ليس لهم تواريخ استحقاق: كل رسم أو مصروف يُحسب من يوم تسجيله، والنقدية التي حصّلناها لهم ومدفوعاتهم تسدد الأقدم أولًا. الشيكات تُحسب من يوم صرفها.',
    payablesMethod: 'كل فاتورة تُحسب من يوم استحقاقها، بالمتبقي منها في نهاية اليوم المختار.',
    footer: (title: string, page: number, pages: number) =>
      `شيبلي ناو · ${title} · صفحة ${page} من ${pages}`,
  },
};

const WIDTHS = [0.28, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12];

function table(
  pdf: PdfWriter,
  T: (typeof TEXT)[PdfLang],
  rows: { name: string; buckets: AgingBuckets; total: number }[],
  total: { buckets: AgingBuckets; total: number },
  totalLabel = T.total,
) {
  pdf.row(
    [T.party, ...AGING_BANDS.map((b) => T.bands[b]!), T.total].map((h, i) => ({
      text: h,
      width: WIDTHS[i]!,
      bold: true,
      color: BRAND.muted,
      align: i === 0 ? ('start' as const) : ('end' as const),
    })),
    { size: 8.5 },
  );
  if (rows.length === 0 && totalLabel === T.total) pdf.paragraph(T.none, { color: BRAND.muted });
  const line = (name: string, b: AgingBuckets, sum: number, bold = false, fill?: string) =>
    pdf.row(
      [
        { text: name, width: WIDTHS[0]!, bold },
        ...[...AGING_BANDS.map((k) => b[k]), sum].map((v, i) => ({
          text: egpText(v),
          width: WIDTHS[i + 1]!,
          align: 'end' as const,
          bold,
        })),
      ],
      { fill, size: 9 },
    );
  for (const r of rows) line(r.name, r.buckets, r.total);
  line(totalLabel, total.buckets, total.total, true, BRAND.soft);
}

function header(pdf: PdfWriter, title: string, lines: string[]) {
  pdf.paragraph(title, { size: 18, bold: true, color: BRAND.navy });
  for (const l of lines) pdf.paragraph(l, { color: BRAND.muted });
  pdf.y += 6;
}

export async function receivablesAgingPdf(report: Receivables, lang: PdfLang, q?: string) {
  const T = TEXT[lang];
  const pdf = new PdfWriter(lang, { title: T.receivables });
  header(pdf, T.receivables, [
    T.asOf(report.asOf),
    ...(q ? [`${T.search}: ${q}`] : []),
    T.receivablesMethod,
  ]);
  pdf.heading(T.merchants);
  table(
    pdf,
    T,
    report.merchants.map((m) => ({ name: m.name, buckets: m.buckets, total: m.balancePiastres })),
    report.merchantTotal,
  );
  if (report.cheques.length) {
    pdf.heading(T.cheques);
    table(
      pdf,
      T,
      report.cheques.map((c) => {
        const buckets = Object.fromEntries(
          AGING_BANDS.map((b) => [b, b === c.band ? c.amountPiastres : 0]),
        ) as AgingBuckets;
        return { name: `${c.label} ${c.partyName}`, buckets, total: c.amountPiastres };
      }),
      report.chequeTotal,
    );
    pdf.y += 8;
    table(pdf, T, [], report.total, T.grand);
  }
  pdf.footer((page, pages) => T.footer(T.receivables, page, pages));
  return pdf.end();
}

export async function payablesAgingPdf(
  report: Payables,
  lang: PdfLang,
  names: { store?: string | null; q?: string },
) {
  const T = TEXT[lang];
  const pdf = new PdfWriter(lang, { title: T.payables });
  header(pdf, T.payables, [
    T.asOf(report.asOf),
    ...(names.store ? [`${T.store}: ${names.store}`] : []),
    ...(names.q ? [`${T.search}: ${names.q}`] : []),
    T.payablesMethod,
  ]);
  pdf.heading(T.suppliers);
  table(
    pdf,
    T,
    report.suppliers.map((s) => ({ name: s.name, buckets: s.buckets, total: s.total })),
    report.total,
  );
  pdf.footer((page, pages) => T.footer(T.payables, page, pages));
  return pdf.end();
}
