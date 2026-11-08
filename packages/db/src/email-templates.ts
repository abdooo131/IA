import type { EmailLanguage } from '@shiplynow/shared';

// Simple bilingual emails to merchants in the brand v2 colours: a Navy band with the mark,
// a Cream ground, Navy text, Shiply Blue buttons and one Lime strip. Tables and inline styles
// only, because email programs ignore most CSS. Links and the logo use %BASE_URL%, replaced
// with the web address (WEB_ORIGIN) when the email is sent.

export const BASE_URL = '%BASE_URL%';

const NAVY = '#082341';
const BLUE = '#0046FC';
const CREAM = '#FAF1E8';
const LIME = '#CFF905';
const MUTED = '#4A5A70';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Piastres as "1,234.50", never through a float. */
export function egpText(piastres: number) {
  const sign = piastres < 0 ? '-' : '';
  const abs = Math.abs(piastres);
  const pounds = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${pounds}.${String(abs % 100).padStart(2, '0')}`;
}

/** In Arabic the number is isolated left to right, so a minus sign stays in front of it. */
const money = (lang: EmailLanguage, piastres: number) =>
  lang === 'ar' ? `\u2066${egpText(piastres)}\u2069 ج.م` : `EGP ${egpText(piastres)}`;

const cairoDate = (lang: EmailLanguage, at: Date) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(at);

const T = {
  en: {
    hello: (name: string) => `Hello ${name},`,
    footer:
      'You receive this email because you sell with Shiply Now. You can choose which emails you get in Shiply, Wallet.',
    team: 'The Shiply Now team',
    open: 'Open in Shiply',
    statementSubject: (from: string, to: string) => `Your Shiply Now statement, ${from} to ${to}`,
    statementIntro: (from: string, to: string) =>
      `Here is your statement from ${from} to ${to}. Every line is in the attached file.`,
    opening: 'Balance at the start',
    closing: 'Balance at the end',
    attached: 'The full statement is attached (CSV, opens in Excel).',
    payoutSubject: (number: string) => `Payout ${number} is on its way`,
    payoutIntro: (amount: string) => `We sent you ${amount} by bank transfer.`,
    amount: 'Amount',
    reference: 'Bank reference',
    paidOn: 'Paid on',
    payout: 'Payout',
    invoiceSubject: (label: string, month: string) => `Tax invoice ${label} for ${month}`,
    invoiceIntro: (month: string) => `Your tax invoice for our fees in ${month} is ready.`,
    invoice: 'Invoice',
    net: 'Fees before VAT',
    vat: 'VAT',
    total: 'Total',
    viewInvoices: 'See and print your invoices',
    kinds: {
      cod_collected: 'Cash collected for you',
      shipping_fee: 'Shipping fees',
      product_handling: 'Per product fees',
      packaging_charge: 'Packaging charges',
      order_fee: 'Order fees',
      cod_fee: 'Cash on delivery fees',
      failed_fee: 'Failed delivery fees',
      receiving_fee: 'Receiving fees',
      storage_fee: 'Storage fees',
      return_fee: 'Return fees',
      merchant_payout: 'Payouts',
      merchant_receipt: 'Payments from you',
      damage_compensation: 'Damage compensation',
      credit_note: 'Credit notes',
      adjustment: 'Adjustments',
      'parcels.delivered': 'Next day parcels delivered (cash less fees)',
      'parcels.returned': 'Next day parcels returned (fees)',
      'parcels.lost_compensation': 'Lost parcel compensation',
      'parcels.lost_found': 'Lost parcel found (compensation taken back)',
      'parcels.claim_compensation': 'Claim compensation',
      'parcels.packaging_sold': 'Packaging bought',
    } as Record<string, string>,
  },
  ar: {
    hello: (name: string) => `مرحبا ${name}،`,
    footer:
      'تصلك هذه الرسالة لأنك تبيع مع شيبلي ناو. يمكنك اختيار الرسائل التي تصلك من شيبلي، المحفظة.',
    team: 'فريق شيبلي ناو',
    open: 'افتح في شيبلي',
    statementSubject: (from: string, to: string) => `كشف حسابك في شيبلي ناو من ${from} إلى ${to}`,
    statementIntro: (from: string, to: string) =>
      `هذا كشف حسابك من ${from} إلى ${to}. كل الحركات في الملف المرفق.`,
    opening: 'الرصيد في البداية',
    closing: 'الرصيد في النهاية',
    attached: 'الكشف الكامل مرفق (ملف CSV يفتح في إكسل).',
    payoutSubject: (number: string) => `الدفعة ${number} في الطريق إليك`,
    payoutIntro: (amount: string) => `أرسلنا لك ${amount} بتحويل بنكي.`,
    amount: 'المبلغ',
    reference: 'مرجع البنك',
    paidOn: 'تاريخ الدفع',
    payout: 'الدفعة',
    invoiceSubject: (label: string, month: string) => `الفاتورة الضريبية ${label} عن ${month}`,
    invoiceIntro: (month: string) => `فاتورتك الضريبية عن رسومنا في ${month} جاهزة.`,
    invoice: 'الفاتورة',
    net: 'الرسوم قبل الضريبة',
    vat: 'ضريبة القيمة المضافة',
    total: 'الإجمالي',
    viewInvoices: 'اعرض فواتيرك واطبعها',
    kinds: {
      cod_collected: 'نقدية محصلة لك',
      shipping_fee: 'رسوم الشحن',
      product_handling: 'رسوم المنتجات بسعر القطعة',
      packaging_charge: 'رسوم التغليف',
      order_fee: 'رسوم الطلبات',
      cod_fee: 'رسوم الدفع عند الاستلام',
      failed_fee: 'رسوم التوصيل الفاشل',
      receiving_fee: 'رسوم الاستلام',
      storage_fee: 'رسوم التخزين',
      return_fee: 'رسوم الإرجاع',
      merchant_payout: 'الدفعات',
      merchant_receipt: 'مدفوعات منك',
      damage_compensation: 'تعويض التلف',
      credit_note: 'إشعارات دائنة',
      adjustment: 'تسويات',
      'parcels.delivered': 'شحنات اليوم التالي المسلّمة (التحصيل ناقص الرسوم)',
      'parcels.returned': 'شحنات اليوم التالي المرتجعة (الرسوم)',
      'parcels.lost_compensation': 'تعويض شحنة مفقودة',
      'parcels.lost_found': 'العثور على شحنة مفقودة (استرداد التعويض)',
      'parcels.claim_compensation': 'تعويض مطالبة',
      'parcels.packaging_sold': 'شراء مواد تغليف',
    } as Record<string, string>,
  },
} as const;

function layout(lang: EmailLanguage, title: string, body: string) {
  const t = T[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  const font =
    lang === 'ar'
      ? "'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif"
      : "'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif";
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;font-family:${font};color:${NAVY};text-align:${align};" dir="${dir}">
<tr><td style="background:${NAVY};padding:20px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding:0 0 0 0;"><img src="${BASE_URL}/brand/app-icon-192.png" width="36" height="36" alt="" style="display:block;border-radius:8px;"></td>
<td style="padding:0 12px;color:#FFFFFF;font-size:20px;font-weight:800;">Shiply Now</td>
</tr></table>
</td></tr>
<tr><td style="background:${LIME};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.6;">
${body}
<p style="margin:24px 0 0 0;">${escapeHtml(t.team)}</p>
</td></tr>
<tr><td style="padding:16px 24px;background:${CREAM};color:${MUTED};font-size:12px;line-height:1.5;">${escapeHtml(t.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Numbers marked left to right (money in Arabic) also get a left to right span for mail programs. */
const ltrNumbers = (html: string) =>
  html.replace(
    /\u2066([^\u2069]*)\u2069/g,
    '<span dir="ltr" style="unicode-bidi:isolate">$1</span>',
  );

const p = (text: string) => `<p style="margin:0 0 12px 0;">${escapeHtml(text)}</p>`;

function rows(lang: EmailLanguage, list: [string, string][]) {
  const end = lang === 'ar' ? 'left' : 'right';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px 0;border-collapse:collapse;">
${list
  .map(
    ([k, v], i) =>
      `<tr><td style="padding:8px 0;border-top:${i ? '1px solid #E5E7EB' : '0'};color:${MUTED};">${escapeHtml(k)}</td><td style="padding:8px 0;border-top:${i ? '1px solid #E5E7EB' : '0'};text-align:${end};font-weight:700;">${ltrNumbers(escapeHtml(v))}</td></tr>`,
  )
  .join('\n')}
</table>`;
}

function button(href: string, label: string) {
  return `<p style="margin:16px 0;"><a href="${href}" style="display:inline-block;background:${BLUE};color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px;">${escapeHtml(label)}</a></p>`;
}

const textRows = (list: [string, string][]) => list.map(([k, v]) => `${k}: ${v}`).join('\n');

export function statementEmail(input: {
  lang: EmailLanguage;
  merchantName: string;
  from: Date;
  to: Date;
  openingPiastres: number;
  closingPiastres: number;
  byKind: Record<string, number>;
}): RenderedEmail {
  const { lang } = input;
  const t = T[lang];
  const from = cairoDate(lang, input.from);
  const to = cairoDate(lang, new Date(input.to.getTime() - 1));
  const list: [string, string][] = [
    [t.opening, money(lang, input.openingPiastres)],
    ...Object.entries(input.byKind).map(
      ([kind, amount]) =>
        [t.kinds[kind] ?? kind.replace(/_/g, ' '), money(lang, amount)] as [string, string],
    ),
    [t.closing, money(lang, input.closingPiastres)],
  ];
  const subject = t.statementSubject(from, to);
  return {
    subject,
    html: layout(
      lang,
      subject,
      `${p(t.hello(input.merchantName))}${p(t.statementIntro(from, to))}${rows(lang, list)}${p(t.attached)}${button(`${BASE_URL}/merchant/wallet`, t.open)}`,
    ),
    text: `${t.hello(input.merchantName)}\n\n${t.statementIntro(from, to)}\n\n${textRows(list)}\n\n${t.attached}\n${BASE_URL}/merchant/wallet\n\n${t.team}`,
  };
}

export function payoutPaidEmail(input: {
  lang: EmailLanguage;
  merchantName: string;
  number: string;
  amountPiastres: number;
  reference: string;
  paidAt: Date;
}): RenderedEmail {
  const { lang } = input;
  const t = T[lang];
  const amount = money(lang, input.amountPiastres);
  const list: [string, string][] = [
    [t.payout, input.number],
    [t.amount, amount],
    [t.reference, input.reference],
    [t.paidOn, cairoDate(lang, input.paidAt)],
  ];
  const subject = t.payoutSubject(input.number);
  return {
    subject,
    html: layout(
      lang,
      subject,
      `${p(t.hello(input.merchantName))}${p(t.payoutIntro(amount))}${rows(lang, list)}${button(`${BASE_URL}/merchant/wallet`, t.open)}`,
    ),
    text: `${t.hello(input.merchantName)}\n\n${t.payoutIntro(amount)}\n\n${textRows(list)}\n\n${BASE_URL}/merchant/wallet\n\n${t.team}`,
  };
}

export function invoiceEmail(input: {
  lang: EmailLanguage;
  merchantName: string;
  label: string;
  month: string;
  netPiastres: number;
  vatPiastres: number;
  totalPiastres: number;
}): RenderedEmail {
  const { lang } = input;
  const t = T[lang];
  const month = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${input.month}-15T00:00:00Z`));
  const list: [string, string][] = [
    [t.invoice, input.label],
    [t.net, money(lang, input.netPiastres)],
    [t.vat, money(lang, input.vatPiastres)],
    [t.total, money(lang, input.totalPiastres)],
  ];
  const subject = t.invoiceSubject(input.label, month);
  return {
    subject,
    html: layout(
      lang,
      subject,
      `${p(t.hello(input.merchantName))}${p(t.invoiceIntro(month))}${rows(lang, list)}${button(`${BASE_URL}/merchant/invoices`, t.viewInvoices)}`,
    ),
    text: `${t.hello(input.merchantName)}\n\n${t.invoiceIntro(month)}\n\n${textRows(list)}\n\n${t.viewInvoices}: ${BASE_URL}/merchant/invoices\n\n${t.team}`,
  };
}
