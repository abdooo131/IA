import { type Db, getPayoutStatement, statementKindLabel } from '@shiplynow/db';
import { cairoDay, type PayoutStatementData, proofNumber, sortKinds } from '@shiplynow/shared';
import type { Response } from 'express';
import { BRAND, type PdfLang, PdfWriter } from '../common/pdf';
import { egpText } from './report-pdf';

// The statement of account of one payout (SOA), printed in English or Arabic from the frozen
// statement: the summary by kind with the VAT inside the fees, every order of the period, the
// other movements and, once there is one, the proof of transfer with the "matches" line.

export interface ProofSummary {
  number: string;
  amountPiastres: number;
  reference: string;
}

const TEXT = {
  en: {
    title: 'Statement of account',
    payout: 'Payout',
    merchant: 'Merchant',
    period: (from: string, to: string) => `From ${from} to the end of ${to} (Cairo days)`,
    frozen: (at: string) => `Frozen on ${at} when the payout was prepared; it never changes.`,
    summary: 'Summary',
    opening: 'Balance at the start',
    vatIncluded: 'VAT included in the fees above',
    closing: 'Balance at the cutoff',
    heldBack: 'Charges booked after the cutoff, held back',
    net: 'Net to transfer',
    orders: 'Orders',
    order: 'Order',
    cod: 'Cash collected',
    fees: 'Fees',
    vat: 'VAT',
    orderNet: 'Net',
    other: 'Other movements',
    day: 'Day',
    type: 'Type',
    reference: 'Reference',
    amount: 'Amount (EGP)',
    none: 'Nothing in this period.',
    proof: 'Proof of transfer',
    proofNumber: 'Proof',
    proofAmount: 'Amount on the bank slip',
    bankReference: 'Bank reference',
    matches: 'Matches: the statement net, the slip amount and the payout amount are equal.',
    differs: 'Does not match: the statement net, the slip amount and the payout amount differ.',
    egp: 'EGP',
    footer: (n: string, page: number, pages: number) =>
      `Shiply Now · ${n} · page ${page} of ${pages}`,
  },
  ar: {
    title: 'كشف حساب',
    payout: 'الدفعة',
    merchant: 'التاجر',
    period: (from: string, to: string) => `من ${from} حتى نهاية ${to} (بتوقيت القاهرة)`,
    frozen: (at: string) => `ثُبّت في ${at} عند تجهيز الدفعة ولا يتغير بعد ذلك.`,
    summary: 'الملخص',
    opening: 'الرصيد في البداية',
    vatIncluded: 'ضريبة القيمة المضافة ضمن الرسوم أعلاه',
    closing: 'الرصيد عند تاريخ القطع',
    heldBack: 'مصاريف سُجلت بعد تاريخ القطع ومحجوزة',
    net: 'الصافي المحوّل',
    orders: 'الطلبات',
    order: 'الطلب',
    cod: 'النقدية المحصلة',
    fees: 'الرسوم',
    vat: 'الضريبة',
    orderNet: 'الصافي',
    other: 'حركات أخرى',
    day: 'اليوم',
    type: 'النوع',
    reference: 'المرجع',
    amount: 'المبلغ (ج.م)',
    none: 'لا شيء في هذه الفترة.',
    proof: 'إثبات التحويل',
    proofNumber: 'الإثبات',
    proofAmount: 'المبلغ في إيصال البنك',
    bankReference: 'مرجع البنك',
    matches: 'مطابق: صافي الكشف ومبلغ الإيصال ومبلغ الدفعة متساوية.',
    differs: 'غير مطابق: صافي الكشف ومبلغ الإيصال ومبلغ الدفعة مختلفة.',
    egp: 'ج.م',
    footer: (n: string, page: number, pages: number) =>
      `شيبلي ناو · ${n} · صفحة ${page} من ${pages}`,
  },
};

export async function payoutStatementPdf(
  s: PayoutStatementData,
  lang: PdfLang,
  proof: ProofSummary | null,
) {
  const T = TEXT[lang];
  const money = (p: number) => `${egpText(p)} ${T.egp}`;
  const pdf = new PdfWriter(lang, { title: `${T.title} ${s.number}` });
  pdf.paragraph(T.title, { size: 18, bold: true, color: BRAND.navy });
  pdf.paragraph(`${s.number} · ${T.payout} ${s.payout.number}`, { bold: true });
  pdf.paragraph(`${T.merchant}: ${s.merchant.name}`);
  pdf.paragraph(T.period(s.fromDay, s.toDay), { color: BRAND.muted });
  pdf.paragraph(T.frozen(cairoDay(new Date(s.frozenAt))), { color: BRAND.muted, size: 9 });
  pdf.y += 6;

  pdf.heading(T.summary);
  pdf.pairs([
    [T.opening, money(s.openingPiastres)],
    ...sortKinds(Object.keys(s.byKind)).map(
      (k) => [statementKindLabel(lang, k), money(s.byKind[k]!)] as [string, string],
    ),
    [T.vatIncluded, money(s.vatPiastres)],
    [T.closing, money(s.closingPiastres)],
    ...(s.heldBackPiastres
      ? ([[T.heldBack, money(0 - s.heldBackPiastres)]] as [string, string][])
      : []),
  ]);
  pdf.row(
    [
      { text: T.net, width: 0.42, bold: true },
      { text: money(s.netPiastres), width: 0.58, bold: true },
    ],
    { fill: BRAND.soft, size: 11 },
  );

  pdf.heading(T.orders);
  const W = [0.24, 0.19, 0.19, 0.19, 0.19];
  pdf.row(
    [T.order, T.cod, T.fees, T.vat, T.orderNet].map((text, i) => ({
      text,
      width: W[i]!,
      bold: true,
      color: BRAND.muted,
      align: i === 0 ? ('start' as const) : ('end' as const),
    })),
    { size: 8.5 },
  );
  if (!s.orders.length) pdf.paragraph(T.none, { color: BRAND.muted });
  for (const o of s.orders) {
    const fees = Object.values(o.fees).reduce((a, b) => a + b, 0);
    pdf.row(
      [o.orderNumber, egpText(o.codPiastres), egpText(fees), egpText(o.vatPiastres), egpText(o.netPiastres)].map(
        (text, i) => ({
          text,
          width: W[i]!,
          align: i === 0 ? ('start' as const) : ('end' as const),
        }),
      ),
      { size: 9 },
    );
  }

  pdf.heading(T.other);
  const V = [0.18, 0.3, 0.3, 0.22];
  pdf.row(
    [T.day, T.type, T.reference, T.amount].map((text, i) => ({
      text,
      width: V[i]!,
      bold: true,
      color: BRAND.muted,
      align: i === 3 ? ('end' as const) : ('start' as const),
    })),
    { size: 8.5 },
  );
  if (!s.other.length) pdf.paragraph(T.none, { color: BRAND.muted });
  for (const l of s.other)
    pdf.row(
      [
        { text: cairoDay(new Date(l.at)), width: V[0]! },
        { text: statementKindLabel(lang, l.kind), width: V[1]! },
        { text: l.orderNumber ?? l.memo ?? '', width: V[2]! },
        { text: egpText(l.amountPiastres), width: V[3]!, align: 'end' as const },
      ],
      { size: 9 },
    );

  if (proof) {
    pdf.heading(T.proof);
    pdf.pairs([
      [T.proofNumber, proof.number],
      [T.proofAmount, money(proof.amountPiastres)],
      [T.bankReference, proof.reference],
    ]);
    const ok = proof.amountPiastres === s.netPiastres;
    pdf.y += 4;
    pdf.paragraph(ok ? T.matches : T.differs, { bold: true, color: ok ? BRAND.blue : '#B42318' });
  }
  pdf.footer((page, pages) => T.footer(s.number, page, pages));
  return pdf.end();
}

/** Sends a statement of account as a PDF download. */
export function sendStatementPdf(res: Response, pdf: Buffer, number: string, lang: PdfLang) {
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${number}-${lang}.pdf"`);
  res.setHeader('cache-control', 'private, no-store');
  res.send(pdf);
}

/** Sends the statement as CSV (UTF-8 with a BOM). */
export function sendStatementCsv(res: Response, csv: string, number: string) {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${number}.csv"`);
  res.setHeader('cache-control', 'private, no-store');
  res.send(csv);
}

/** Sends a proof of transfer file; photos and PDFs open in the browser. */
export function sendProofFile(
  res: Response,
  file: { fileName: string; contentType: string; data: Uint8Array },
) {
  const safe = file.fileName.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100) || 'proof';
  res.setHeader('content-type', file.contentType);
  res.setHeader('content-disposition', `inline; filename="${safe}"`);
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.send(Buffer.from(file.data));
}

/**
 * The printed statement of one payout with its proof of transfer. merchantId limits it to
 * that merchant's payouts, and a merchant sees the proof only once the payout is paid.
 */
export async function statementPdfFor(
  db: Db,
  input: { payoutId: string; lang: PdfLang; merchantId?: string },
) {
  const s = await getPayoutStatement(db, input.payoutId, input.merchantId);
  const proof = await db.payoutProof.findUnique({
    where: { payoutId: input.payoutId },
    select: {
      number: true,
      amountPiastres: true,
      reference: true,
      payout: { select: { status: true } },
    },
  });
  const shown = proof && (!input.merchantId || proof.payout.status === 'paid');
  const pdf = await payoutStatementPdf(
    s,
    input.lang,
    shown
      ? {
          number: proofNumber(proof.number),
          amountPiastres: proof.amountPiastres,
          reference: proof.reference,
        }
      : null,
  );
  return { pdf, number: s.number };
}
