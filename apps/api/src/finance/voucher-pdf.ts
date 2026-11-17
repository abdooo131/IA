import type { DocDescriptor } from '@shiplynow/shared';
import { BRAND, type PdfLang, PdfWriter } from '../common/pdf';
import { egpText } from './report-pdf';

// A journal voucher printed on A4, in English or Arabic: our company, the voucher number, day,
// kind and description, the lines (account, store, merchant or rider, debit, credit) with their
// totals, who prepared and who approved it, and boxes to sign. The words live here.

const TEXT = {
  en: {
    title: 'Journal voucher',
    number: 'Voucher number',
    day: 'Date',
    kind: 'Type',
    memo: 'Description',
    reference: 'Reference',
    source: 'Posted for',
    order: 'Order',
    taxNumber: 'Tax registration number',
    account: 'Account',
    details: 'Store, merchant or rider',
    debit: 'Debit',
    credit: 'Credit',
    total: 'Total',
    amounts: 'Amounts in EGP',
    preparedBy: 'Prepared by',
    approvedBy: 'Approved by',
    checkedBy: 'Checked by',
    signature: 'Signature',
    footer: (n: string, page: number, pages: number) =>
      `Shiply Now · ${n} · page ${page} of ${pages}`,
  },
  ar: {
    title: 'قيد يومية',
    number: 'رقم القيد',
    day: 'التاريخ',
    kind: 'النوع',
    memo: 'البيان',
    reference: 'المرجع',
    source: 'سُجّل من أجل',
    order: 'الطلب',
    taxNumber: 'رقم التسجيل الضريبي',
    account: 'الحساب',
    details: 'المتجر أو التاجر أو المندوب',
    debit: 'مدين',
    credit: 'دائن',
    total: 'الإجمالي',
    amounts: 'المبالغ بالجنيه المصري',
    preparedBy: 'أعدّه',
    approvedBy: 'اعتمده',
    checkedBy: 'راجعه',
    signature: 'التوقيع',
    footer: (n: string, page: number, pages: number) =>
      `شيبلي ناو · ${n} · صفحة ${page} من ${pages}`,
  },
};

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dayFirst = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/** The voucher of one journal entry (its document descriptor) as a PDF. */
export async function journalVoucherPdf(
  doc: DocDescriptor,
  lang: PdfLang,
  kindLabel: string | null,
): Promise<Buffer> {
  const T = TEXT[lang];
  const pdf = new PdfWriter(lang, { title: `${T.title} ${doc.number}` });
  const field = (k: string) => doc.fields.find((f) => f.key === k)?.value ?? null;
  const company =
    text(
      lang === 'ar' ? doc.data.companyNameAr || doc.data.companyNameEn : doc.data.companyNameEn,
    ) || 'Shiply Now';

  pdf.line(company, { x: pdf.margin, y: pdf.y, width: pdf.width }, { size: 15, bold: true });
  pdf.y += pdf.lineHeight(15);
  if (doc.data.companyTaxNumber)
    pdf.line(
      `${T.taxNumber}: ${text(doc.data.companyTaxNumber)}`,
      { x: pdf.margin, y: pdf.y, width: pdf.width },
      { size: 9, color: BRAND.muted },
    );
  pdf.y += pdf.lineHeight(9) + 4;
  pdf.heading(`${T.title} ${doc.number}`);

  const pairs: [string, string][] = [
    [T.number, doc.number],
    [T.day, dayFirst(text(field('day')))],
    [T.kind, kindLabel || text(field('kind'))],
  ];
  if (field('memo')) pairs.push([T.memo, text(field('memo'))]);
  if (field('reference')) pairs.push([T.reference, text(field('reference'))]);
  if (field('source')) pairs.push([T.source, text(field('source'))]);
  if (field('order')) pairs.push([T.order, text(field('order'))]);
  pdf.pairs(pairs, 0.3);
  pdf.y += 10;

  const widths = [0.38, 0.26, 0.18, 0.18];
  pdf.row(
    [T.account, T.details, T.debit, T.credit].map((h, i) => ({
      text: h,
      width: widths[i]!,
      bold: true,
      color: BRAND.muted,
      align: i < 2 ? ('start' as const) : ('end' as const),
    })),
    { size: 8.5, fill: BRAND.soft },
  );
  let debit = 0;
  let credit = 0;
  for (const r of doc.lines?.rows ?? []) {
    const d = Number(r.debit) || 0;
    const c = Number(r.credit) || 0;
    debit += d;
    credit += c;
    pdf.row([
      { text: text(lang === 'ar' && r.accountAr ? r.accountAr : r.account), width: widths[0]! },
      {
        text: [r.store, r.merchant, r.rider].filter(Boolean).map(text).join(' · '),
        width: widths[1]!,
      },
      { text: d ? egpText(d) : '', width: widths[2]!, align: 'end' },
      { text: c ? egpText(c) : '', width: widths[3]!, align: 'end' },
    ]);
  }
  pdf.row(
    [
      { text: T.total, width: widths[0]! + widths[1]!, bold: true },
      { text: egpText(debit), width: widths[2]!, align: 'end', bold: true },
      { text: egpText(credit), width: widths[3]!, align: 'end', bold: true },
    ],
    { fill: BRAND.soft },
  );
  pdf.y += 4;
  pdf.line(
    T.amounts,
    { x: pdf.margin, y: pdf.y, width: pdf.width },
    { size: 8, color: BRAND.muted },
  );
  pdf.y += 40;

  // Signature boxes: prepared, checked, approved.
  pdf.ensure(110);
  const boxes: [string, string][] = [
    [T.preparedBy, text(doc.data.madeBy)],
    [T.checkedBy, ''],
    [T.approvedBy, text(doc.data.approvedBy)],
  ];
  const gap = 12;
  const w = (pdf.width - gap * 2) / 3;
  boxes.forEach(([label, name], i) => {
    const x = pdf.rtl ? pdf.margin + pdf.width - (i + 1) * w - i * gap : pdf.margin + i * (w + gap);
    pdf.doc.rect(x, pdf.y, w, 86).lineWidth(0.8).strokeColor(BRAND.line).stroke();
    pdf.line(label, { x: x + 8, y: pdf.y + 8, width: w - 16 }, { size: 9, bold: true });
    if (name) pdf.line(name, { x: x + 8, y: pdf.y + 26, width: w - 16 }, { size: 9.5 });
    pdf.line(
      T.signature,
      { x: x + 8, y: pdf.y + 66, width: w - 16 },
      { size: 8, color: BRAND.muted },
    );
  });
  pdf.y += 96;
  pdf.footer((page, pages) => T.footer(doc.number, page, pages));
  return pdf.end();
}
