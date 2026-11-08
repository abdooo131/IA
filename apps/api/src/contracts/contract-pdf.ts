import type { ContractPrint } from '@shiplynow/db';
import {
  ALL_INCLUSIVE_ZERO_KEYS,
  CONTRACT_PRICE_KEYS,
  failedDeliveryRule,
  CONTRACT_PRICES,
  type ContractPriceKey,
  type ContractTier,
  tierValue,
} from '@shiplynow/shared';
import { BRAND, type PdfLang, PdfWriter } from '../common/pdf';

// The printed merchant contract (merchant contracts v2), in English or Arabic: our company and
// the merchant, every price beside the standard one, the volume tiers, payment terms, service
// promises, dates, special terms and signature boxes. The words of both languages live here.

const TEXT = {
  en: {
    title: 'Merchant service contract',
    version: 'Version',
    effective: 'In force from',
    notActive: 'Draft, not in force',
    parties: 'The parties',
    us: 'Service provider',
    merchant: 'Merchant',
    taxNo: 'Tax registration number',
    prices: 'Prices',
    fee: 'Fee',
    standard: 'Standard price',
    agreed: 'Agreed price',
    asStandard: 'Standard',
    vat: 'VAT on our fees',
    vatNote: 'Added to every fee at the rate in force',
    packagingNote: 'Packaging (bags, boxes, labels) is ours unless a packaging charge is set.',
    allInclusive:
      'All inclusive: the shipping fee covers the services whose price is 0 in this contract.',
    failed: 'Failed delivery',
    failedFixed: (v: string) => `${v} per failed attempt (a fixed fee)`,
    failedPercent: (p: string) =>
      `${p} of what the shipment would have cost: shipping fee, per product prices of its units and the order fee (fixed and share of products); never the cash on delivery fee`,
    zonePrices: '60 minute shipping fee by delivery zone',
    zonePricesNote:
      'A delivered order in one of these zones pays this shipping fee instead of the shipping fee above.',
    parcelPrices: 'Next day prices by route zone',
    parcelPricesNote:
      'The price of one parcel from your pickup city to the delivery city, by route zone and size. Other routes and sizes pay the list price less any agreed discount.',
    zone: 'Zone',
    size: 'Size',
    price: 'Price',
    productPrices: 'Price per product',
    productPricesNote:
      'Charged per delivered unit of each product below, on top of the other fees; units cancelled before delivery are not charged and products not listed are not charged this fee. Volume tiers do not apply.',
    productPricesAnnex: 'Annex: price per product',
    productPricesSee: (n: number) => `${n} products, listed in the annex at the end.`,
    sku: 'SKU',
    product: 'Product',
    unitPrice: 'Price per unit',
    tiers: 'Volume tiers',
    tiersRule:
      'Orders a month counts the delivered orders of the Cairo calendar month. The order that reaches a band and every later order of the month pay the band’s prices; earlier orders are never charged again. Unit fees and failed deliveries use the band of the next delivered order at the time of the charge. A price left empty in a band is the agreed price.',
    from: 'From order',
    noTiers: 'No volume tiers: the agreed prices apply to every order.',
    payment: 'Payment terms',
    schedule: 'Payout schedule',
    minimumPayout: 'Minimum payout',
    bank: 'Bank account for payouts',
    noBank: 'Not given yet',
    minimumFee: 'Monthly minimum fee',
    minimumFeeNote: 'fees of a month are topped up to it, before VAT',
    deposit: 'Security deposit',
    creditLimit: 'Credit limit',
    none: 'None',
    promises: 'Service promises',
    promise: 'Delivery promise',
    minutes: 'minutes',
    attempts: 'Delivery attempts included',
    stores: 'Dark stores',
    allStores: 'Every dark store whose zone covers the customer',
    areas: 'Areas covered',
    dates: 'Dates',
    start: 'Start',
    end: 'End',
    openEnded: 'No end date',
    notice: 'Notice to end',
    days: 'days',
    noticeBy: 'last day to give notice',
    terms: 'Special terms',
    noTerms: 'None.',
    signatures: 'Signatures',
    forUs: 'For the service provider',
    forMerchant: 'For the merchant',
    name: 'Name',
    role: 'Title',
    signature: 'Signature',
    date: 'Date',
    page: (p: number, n: number) => `page ${p} of ${n}`,
    egp: (v: string) => `${v} EGP`,
    perShipment: 'per delivered shipment',
    perOrder: 'per delivered order',
    ofProducts: 'of the products value',
    ofCash: 'of the cash collected',
    perFailed: 'per failed delivery',
    perUnit: 'per unit',
    perUnitMonth: 'per unit a month, charged daily',
    schedules: {
      daily: 'Daily',
      twice_weekly: 'Twice a week (Sunday and Wednesday)',
      weekly: 'Weekly (Sunday)',
    },
    keepsOwn: 'The merchant’s own choice',
    fees: {
      shippingFeePiastres: 'Shipping fee',
      packagingChargePiastres: 'Packaging charge',
      orderFixedPiastres: 'Order fee, fixed',
      orderPercentBp: 'Order fee, share of products',
      codPercentBp: 'Cash on delivery fee',
      failedDeliveryPiastres: 'Failed delivery fee',
      receivingPerUnitPiastres: 'Receiving',
      storagePerUnitMonthPiastres: 'Storage',
      returnPerUnitPiastres: 'Return to merchant',
    } satisfies Record<ContractPriceKey, string>,
  },
  ar: {
    title: 'عقد خدمة تاجر',
    version: 'الإصدار',
    effective: 'ساري من',
    notActive: 'مسودة غير سارية',
    parties: 'الطرفان',
    us: 'مقدم الخدمة',
    merchant: 'التاجر',
    taxNo: 'رقم التسجيل الضريبي',
    prices: 'الأسعار',
    fee: 'الرسم',
    standard: 'السعر القياسي',
    agreed: 'السعر المتفق عليه',
    asStandard: 'القياسي',
    vat: 'ضريبة القيمة المضافة على رسومنا',
    vatNote: 'تضاف إلى كل رسم بالنسبة السارية',
    packagingNote: 'التغليف من الأكياس والكراتين والملصقات علينا ما لم تحدد رسوم تغليف.',
    allInclusive: 'شامل: رسوم الشحن تغطي الخدمات التي سعرها صفر في هذا العقد.',
    failed: 'التوصيل الفاشل',
    failedFixed: (v: string) => `${v} لكل محاولة فاشلة، رسم ثابت`,
    failedPercent: (p: string) =>
      `${p} مما كانت ستتكلفه الشحنة: رسوم الشحن وأسعار منتجاتها ورسم الطلب الثابت والنسبة من المنتجات، ولا يدخل رسم الدفع عند الاستلام`,
    zonePrices: 'رسوم الشحن خلال 60 دقيقة حسب منطقة التوصيل',
    zonePricesNote:
      'الطلب الذي يسلم في إحدى هذه المناطق يدفع رسوم الشحن هذه بدلا من رسوم الشحن أعلاه.',
    parcelPrices: 'أسعار اليوم التالي حسب منطقة المسار',
    parcelPricesNote:
      'سعر الشحنة الواحدة من مدينة الاستلام إلى مدينة التوصيل حسب منطقة المسار والحجم. المسارات والأحجام الأخرى بسعر القائمة بعد أي خصم متفق عليه.',
    zone: 'المنطقة',
    size: 'الحجم',
    price: 'السعر',
    productPrices: 'السعر لكل منتج',
    productPricesNote:
      'يحسب لكل قطعة مسلمة من المنتجات التالية فوق الرسوم الأخرى، ولا تحسب القطع الملغاة قبل التسليم، والمنتجات غير المذكورة لا يحسب عليها هذا الرسم، ولا تسري عليه شرائح الحجم.',
    productPricesAnnex: 'ملحق: السعر لكل منتج',
    productPricesSee: (n: number) => `${n} منتج، مذكورة في الملحق في آخر العقد.`,
    sku: 'رمز المنتج',
    product: 'المنتج',
    unitPrice: 'السعر للقطعة',
    tiers: 'شرائح الحجم',
    tiersRule:
      'عدد الطلبات في الشهر هو الطلبات المسلمة في الشهر الميلادي بتوقيت القاهرة. الطلب الذي يبلغ الشريحة وكل طلب بعده في الشهر يدفع أسعار الشريحة ولا تعاد محاسبة الطلبات السابقة. رسوم الوحدات والتوصيل الفاشل تتبع شريحة الطلب المسلم التالي وقت الرسم. السعر الفارغ في الشريحة هو السعر المتفق عليه.',
    from: 'من الطلب',
    noTiers: 'لا توجد شرائح حجم والأسعار المتفق عليها تسري على كل طلب.',
    payment: 'شروط الدفع',
    schedule: 'مواعيد التحويل',
    minimumPayout: 'الحد الأدنى للتحويل',
    bank: 'الحساب البنكي للتحويلات',
    noBank: 'لم يحدد بعد',
    minimumFee: 'الحد الأدنى الشهري للرسوم',
    minimumFeeNote: 'تستكمل رسوم الشهر إليه قبل الضريبة',
    deposit: 'التأمين',
    creditLimit: 'حد الائتمان',
    none: 'لا يوجد',
    promises: 'التزامات الخدمة',
    promise: 'مدة التوصيل الموعودة',
    minutes: 'دقيقة',
    attempts: 'محاولات التوصيل المشمولة',
    stores: 'المخازن',
    allStores: 'كل مخزن تغطي منطقته العميل',
    areas: 'المناطق المغطاة',
    dates: 'التواريخ',
    start: 'البداية',
    end: 'النهاية',
    openEnded: 'بدون تاريخ انتهاء',
    notice: 'مدة الإخطار بالإنهاء',
    days: 'يوم',
    noticeBy: 'آخر يوم للإخطار',
    terms: 'شروط خاصة',
    noTerms: 'لا يوجد.',
    signatures: 'التوقيعات',
    forUs: 'عن مقدم الخدمة',
    forMerchant: 'عن التاجر',
    name: 'الاسم',
    role: 'الصفة',
    signature: 'التوقيع',
    date: 'التاريخ',
    page: (p: number, n: number) => `صفحة ${p} من ${n}`,
    egp: (v: string) => `${v} ج.م`,
    perShipment: 'لكل شحنة مسلمة',
    perOrder: 'لكل طلب مسلم',
    ofProducts: 'من قيمة المنتجات',
    ofCash: 'من النقد المحصل',
    perFailed: 'لكل توصيل فاشل',
    perUnit: 'لكل وحدة',
    perUnitMonth: 'لكل وحدة شهريا وتحسب يوميا',
    schedules: {
      daily: 'يوميا',
      twice_weekly: 'مرتين أسبوعيا يومي الأحد والأربعاء',
      weekly: 'أسبوعيا يوم الأحد',
    },
    keepsOwn: 'اختيار التاجر',
    fees: {
      shippingFeePiastres: 'رسوم الشحن',
      packagingChargePiastres: 'رسوم التغليف',
      orderFixedPiastres: 'رسم الطلب الثابت',
      orderPercentBp: 'رسم الطلب نسبة من المنتجات',
      codPercentBp: 'رسم الدفع عند الاستلام',
      failedDeliveryPiastres: 'رسم التوصيل الفاشل',
      receivingPerUnitPiastres: 'الاستلام',
      storagePerUnitMonthPiastres: 'التخزين',
      returnPerUnitPiastres: 'الإرجاع للتاجر',
    } satisfies Record<ContractPriceKey, string>,
  },
};
export type ContractPdfText = (typeof TEXT)['en'];

/** Piastres as pounds, without floats: 123456 is "1,234.56". */
export function money(piastres: number) {
  const abs = Math.abs(Math.trunc(piastres));
  const pounds = Math.floor(abs / 100).toLocaleString('en-US');
  return `${piastres < 0 ? '-' : ''}${pounds}.${String(abs % 100).padStart(2, '0')}`;
}
/** Basis points as a percentage: 250 is "2.50%". */
export function percent(bp: number) {
  return `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, '0')}%`;
}
/** A Cairo day as day first: 2026-12-01 is 01/12/2026. */
const dayFirst = (day: string) => day.split('-').reverse().join('/');

/** A price in words of its unit, for example "25.00 EGP per delivered order". */
export function priceText(t: ContractPdfText, key: ContractPriceKey, value: number) {
  const def = CONTRACT_PRICES[key];
  const amount = def.unit === 'bp' ? percent(value) : t.egp(money(value));
  const per: Record<ContractPriceKey, string> = {
    shippingFeePiastres: t.perShipment,
    packagingChargePiastres: t.perOrder,
    orderFixedPiastres: t.perOrder,
    orderPercentBp: t.ofProducts,
    codPercentBp: t.ofCash,
    failedDeliveryPiastres: t.perFailed,
    receivingPerUnitPiastres: t.perUnit,
    storagePerUnitMonthPiastres: t.perUnitMonth,
    returnPerUnitPiastres: t.perUnit,
  };
  return `${amount} ${per[key]}`;
}

/** A note after a value: in brackets in English, after a comma in Arabic (no mixed brackets). */
const aside = (lang: PdfLang, value: string, note: string) =>
  lang === 'ar' ? `${value}، ${note}` : `${value} (${note})`;

const tierCell = (t: ContractPdfText, tier: ContractTier, key: ContractPriceKey) => {
  const v = tierValue(tier, key);
  if (v === null) return '-';
  return CONTRACT_PRICES[key].unit === 'bp' ? percent(v) : money(v);
};

/** The contract as a PDF in one language. */
export async function renderContractPdf(print: ContractPrint, lang: PdfLang): Promise<Buffer> {
  const t = TEXT[lang];
  const v = print.version;
  const w = new PdfWriter(lang, { title: `${v.label} ${print.merchant.name}` });
  const doc = w.doc;

  // Header: a Navy band with the name of the document and its number.
  doc.rect(0, 0, doc.page.width, 92).fill(BRAND.navy);
  doc.rect(0, 92, doc.page.width, 4).fill(BRAND.lime);
  w.line('Shiply Now', { x: w.margin, y: 22, width: w.width }, { size: 11, color: '#FFFFFF' });
  w.line(
    t.title,
    { x: w.margin, y: 40, width: w.width },
    { size: 20, bold: true, color: '#FFFFFF' },
  );
  w.line(
    `${v.label}`,
    { x: w.margin, y: 24, width: w.width },
    { size: 11, bold: true, color: BRAND.lime, align: 'end' },
  );
  w.y = 112;
  w.line(
    v.effectiveFrom && v.status !== 'draft'
      ? `${t.effective} ${dayFirst(v.effectiveFrom)}`
      : t.notActive,
    { x: w.margin, y: w.y, width: w.width },
    { size: 10, color: BRAND.muted },
  );
  w.y += w.lineHeight(10) + 4;

  // The parties.
  w.heading(t.parties);
  const merchantName = print.merchant.legalName || print.merchant.name;
  const merchantAddress = [
    print.merchant.taxBuildingNumber,
    print.merchant.taxStreet,
    print.merchant.taxRegionCity,
    print.merchant.taxGovernorate,
  ]
    .filter(Boolean)
    .join(', ');
  const ourName =
    (lang === 'ar' ? print.company.legalNameAr : print.company.legalNameEn) ||
    print.company.legalNameEn ||
    print.company.legalNameAr ||
    'Shiply Now';
  w.row(
    [
      { text: t.us, width: 0.5, bold: true, color: BRAND.blue },
      { text: t.merchant, width: 0.5, bold: true, color: BRAND.blue },
    ],
    { rule: false },
  );
  w.row(
    [
      {
        text: [
          ourName,
          print.company.taxRegistrationNumber
            ? `${t.taxNo}: ${print.company.taxRegistrationNumber}`
            : '',
          print.company.address,
        ]
          .filter(Boolean)
          .join('\n'),
        width: 0.5,
      },
      {
        text: [
          merchantName,
          print.merchant.legalName && print.merchant.legalName !== print.merchant.name
            ? print.merchant.name
            : '',
          print.merchant.taxRegistrationNumber
            ? `${t.taxNo}: ${print.merchant.taxRegistrationNumber}`
            : '',
          merchantAddress,
          [print.merchant.contactEmail, print.merchant.contactPhone].filter(Boolean).join(' · '),
        ]
          .filter(Boolean)
          .join('\n'),
        width: 0.5,
      },
    ],
    { rule: false },
  );

  // Prices beside the standard ones.
  w.heading(t.prices);
  w.row(
    [
      { text: t.fee, width: 0.34, bold: true },
      { text: t.standard, width: 0.31, bold: true },
      { text: t.agreed, width: 0.35, bold: true },
    ],
    { fill: BRAND.soft },
  );
  for (const k of CONTRACT_PRICE_KEYS) {
    const own = v.prices[k];
    w.row([
      { text: t.fees[k], width: 0.34 },
      { text: priceText(t, k, print.standard[k]), width: 0.31, color: BRAND.muted },
      {
        text:
          own === null
            ? `${t.asStandard}: ${priceText(t, k, print.standard[k])}`
            : priceText(t, k, own),
        width: 0.35,
        bold: own !== null,
      },
    ]);
  }
  const failed = failedDeliveryRule(
    {
      failedDeliveryPiastres: v.prices.failedDeliveryPiastres,
      failedDeliveryPercentBp: v.failedDeliveryPercentBp,
    },
    null,
    {
      failedDeliveryPiastres:
        v.prices.failedDeliveryPiastres ?? print.standard.failedDeliveryPiastres,
      shippingFeePiastres: v.prices.shippingFeePiastres ?? print.standard.shippingFeePiastres,
    },
    print.standardFailedPercentBp,
  );
  w.row([
    { text: t.failed, width: 0.34 },
    { text: '', width: 0.31 },
    {
      text:
        failed.mode === 'fixed'
          ? t.failedFixed(t.egp(money(failed.piastres)))
          : t.failedPercent(percent(failed.bp)),
      width: 0.35,
      bold: v.prices.failedDeliveryPiastres !== null || v.failedDeliveryPercentBp !== null,
    },
  ]);
  w.row([
    { text: t.vat, width: 0.34 },
    { text: percent(print.vatBp), width: 0.31, color: BRAND.muted },
    { text: t.vatNote, width: 0.35 },
  ]);
  w.y += 4;
  const allInclusive =
    (v.prices.shippingFeePiastres ?? 0) > 0 &&
    ALL_INCLUSIVE_ZERO_KEYS.some((k) => v.prices[k] === 0);
  w.paragraph([allInclusive ? t.allInclusive : '', t.packagingNote].filter(Boolean).join(' '), {
    size: 8.5,
    color: BRAND.muted,
  });

  // Per product prices: the first few here, the full table in the annex.
  if (v.productPrices.length) {
    w.heading(t.productPrices);
    w.paragraph(t.productPricesNote, { size: 8.5, color: BRAND.muted });
    if (v.productPrices.length > PRODUCTS_INLINE)
      w.paragraph(t.productPricesSee(v.productPrices.length));
    else productTable(w, t, lang, v.productPrices);
  }

  // Every price of the deal is in the contract (owner, 2026-11-08): 60 minute by delivery zone,
  // next day by route zone and size.
  if (v.zonePrices?.length) {
    w.heading(t.zonePrices);
    w.paragraph(t.zonePricesNote, { size: 8.5, color: BRAND.muted });
    w.row(
      [
        { text: t.zone, width: 0.7, bold: true },
        { text: t.price, width: 0.3, bold: true },
      ],
      { fill: BRAND.soft, size: 8.5 },
    );
    for (const z of v.zonePrices)
      w.row(
        [
          { text: `${z.code} · ${lang === 'ar' ? z.nameAr : z.nameEn}`, width: 0.7 },
          { text: t.egp(money(z.pricePiastres)), width: 0.3 },
        ],
        { size: 9 },
      );
  }
  if (v.parcels.prices.length) {
    w.heading(t.parcelPrices);
    w.paragraph(t.parcelPricesNote, { size: 8.5, color: BRAND.muted });
    w.row(
      [
        { text: t.zone, width: 0.4, bold: true },
        { text: t.size, width: 0.3, bold: true },
        { text: t.price, width: 0.3, bold: true },
      ],
      { fill: BRAND.soft, size: 8.5 },
    );
    for (const p of v.parcels.prices)
      w.row(
        [
          { text: p.zoneCode, width: 0.4 },
          { text: p.size, width: 0.3 },
          { text: t.egp(money(p.pricePiastres)), width: 0.3 },
        ],
        { size: 9 },
      );
  }

  // Volume tiers: one row per band, a column for each fee any band sets.
  w.heading(t.tiers);
  if (!v.tiers.length) w.paragraph(t.noTiers, { color: BRAND.muted });
  else {
    const used = CONTRACT_PRICE_KEYS.filter((k) => v.tiers.some((x) => tierValue(x, k) !== null));
    const first = 0.16;
    const share = (1 - first) / used.length;
    w.row(
      [
        { text: t.from, width: first, bold: true },
        ...used.map((k) => ({ text: t.fees[k], width: share, bold: true })),
      ],
      { fill: BRAND.soft, size: 8.5 },
    );
    for (const tier of v.tiers)
      w.row(
        [
          { text: `${tier.fromOrder}+`, width: first, bold: true },
          ...used.map((k) => ({ text: tierCell(t, tier, k), width: share })),
        ],
        { size: 9 },
      );
    w.y += 4;
    w.paragraph(t.tiersRule, { size: 8.5, color: BRAND.muted });
  }

  // Payment terms.
  w.heading(t.payment);
  const bank = print.merchant.bank;
  const bankText =
    bank.iban || bank.bankAccountNumber
      ? [bank.bankName, bank.beneficiaryName, bank.iban ?? bank.bankAccountNumber]
          .filter(Boolean)
          .join(' · ')
      : t.noBank;
  const amountOr = (p: number | null) => (p === null ? t.none : t.egp(money(p)));
  w.pairs([
    [t.schedule, v.payoutSchedule ? t.schedules[v.payoutSchedule] : t.keepsOwn],
    [
      t.minimumPayout,
      t.egp(money(v.minimumPayoutPiastres ?? print.standardTerms.minimumPayoutPiastres)),
    ],
    [t.bank, bankText],
    [
      t.minimumFee,
      v.minimumMonthlyFeePiastres
        ? aside(lang, t.egp(money(v.minimumMonthlyFeePiastres)), t.minimumFeeNote)
        : t.none,
    ],
    [t.deposit, amountOr(v.securityDepositPiastres)],
    [t.creditLimit, amountOr(v.creditLimitPiastres)],
  ]);

  // Service promises.
  w.heading(t.promises);
  w.pairs([
    [t.promise, `${v.promiseMinutes ?? print.standardTerms.promiseMinutes} ${t.minutes}`],
    [t.attempts, String(v.deliveryAttempts ?? print.standardTerms.deliveryAttempts)],
    [
      t.stores,
      print.stores.length
        ? print.stores.map((s) => `${lang === 'ar' ? s.nameAr : s.nameEn} (${s.code})`).join('، ')
        : t.allStores,
    ],
    ...(v.coverageNote ? ([[t.areas, v.coverageNote]] as [string, string][]) : []),
  ]);

  // Dates.
  w.heading(t.dates);
  w.pairs([
    [t.start, dayFirst(v.startDate)],
    [t.end, v.endDate ? dayFirst(v.endDate) : t.openEnded],
    [
      t.notice,
      v.noticeBy
        ? aside(lang, `${v.noticeDays} ${t.days}`, `${t.noticeBy} ${dayFirst(v.noticeBy)}`)
        : `${v.noticeDays} ${t.days}`,
    ],
  ]);

  // Special terms.
  w.heading(t.terms);
  w.paragraph(v.terms || t.noTerms);

  // Signature boxes.
  w.heading(t.signatures);
  w.ensure(150);
  const gap = 16;
  const boxW = (w.width - gap) / 2;
  const top = w.y + 4;
  for (const [i, label] of [t.forUs, t.forMerchant].entries()) {
    const x = w.rtl ? w.margin + w.width - (i + 1) * boxW - i * gap : w.margin + i * (boxW + gap);
    doc.roundedRect(x, top, boxW, 132, 6).lineWidth(0.8).strokeColor(BRAND.line).stroke();
    w.line(label, { x: x + 10, y: top + 8, width: boxW - 20 }, { size: 10, bold: true });
    for (const [j, field] of [t.name, t.role, t.signature, t.date].entries()) {
      const ly = top + 36 + j * 23;
      w.line(field, { x: x + 10, y: ly, width: boxW - 20 }, { size: 9, color: BRAND.muted });
      doc
        .moveTo(x + 10, ly + 16)
        .lineTo(x + boxW - 10, ly + 16)
        .lineWidth(0.5)
        .strokeColor(BRAND.line)
        .stroke();
    }
  }
  w.y = top + 140;

  // Annex: every per product price when there are too many for the prices section.
  if (v.productPrices.length > PRODUCTS_INLINE) {
    w.doc.addPage();
    w.y = w.margin;
    w.heading(t.productPricesAnnex);
    productTable(w, t, lang, v.productPrices);
  }

  w.footer((p, n) => `${v.label} · ${print.merchant.name} · ${t.page(p, n)}`);
  return w.end();
}

/** Products listed in the prices section; more go to the annex at the end. */
const PRODUCTS_INLINE = 15;

function productTable(
  w: PdfWriter,
  t: ContractPdfText,
  lang: PdfLang,
  rows: ContractPrint['version']['productPrices'],
) {
  w.row(
    [
      { text: t.sku, width: 0.25, bold: true },
      { text: t.product, width: 0.5, bold: true },
      { text: t.unitPrice, width: 0.25, bold: true },
    ],
    { fill: BRAND.soft, size: 8.5 },
  );
  for (const r of rows)
    w.row(
      [
        { text: r.sku, width: 0.25 },
        { text: lang === 'ar' ? r.titleAr || r.titleEn : r.titleEn, width: 0.5 },
        { text: t.egp(money(r.pricePiastres)), width: 0.25 },
      ],
      { size: 9 },
    );
}
