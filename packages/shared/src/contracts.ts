import { z } from 'zod';
import { attachmentIdsField } from './attachments';
import { PAYOUT_SCHEDULES } from './finance';
import { isCalendarDay } from './hours';
import type { SettingKey } from './settings';

// Cheques register, merchant contracts (versions holding every price, tier, payment term and
// promise of a merchant's deal), the contract calculator and the what if of profitability.

const id = z.string().min(1).max(64);
const key = z.string().min(8).max(100);
const piastres = z.number().int().min(1).max(1_000_000_000);
const day = z.string().refine(isCalendarDay, 'invalid_day');
const money = z.number().int().min(0).max(1_000_000_000);
const bp = z.number().int().min(0).max(10_000);

// ─── cheques ─────────────────────────────────────────────────────────────────────

export const CHEQUE_DIRECTIONS = ['received', 'issued'] as const;
export type ChequeDirectionName = (typeof CHEQUE_DIRECTIONS)[number];
/** What a received cheque pays: the merchant's balance, a security deposit, a supplier
 * paying back, other income. */
export const RECEIVED_PURPOSES = ['merchant', 'deposit', 'supplier', 'other_income'] as const;
/** What an issued cheque pays: a supplier bill, a merchant payout, a deposit paid back. */
export const ISSUED_PURPOSES = ['bill', 'payout', 'deposit_refund'] as const;
export const CHEQUE_PURPOSES = [...RECEIVED_PURPOSES, ...ISSUED_PURPOSES] as const;
export type ChequePurposeName = (typeof CHEQUE_PURPOSES)[number];
export const CHEQUE_STATUSES = [
  'awaiting_approval',
  'received',
  'issued',
  'deposited',
  'cleared',
  'bounced',
  'cancelled',
] as const;
export type ChequeStatusName = (typeof CHEQUE_STATUSES)[number];
/** Statuses of a cheque still waiting for its money (shown on the due list). */
export const CHEQUE_OPEN_STATUSES = ['received', 'deposited', 'issued'] as const;

/** Register number, for example CHQ-000012 */
export const chequeLabel = (n: number) => `CHQ-${String(n).padStart(6, '0')}`;

export const chequeSchema = z
  .object({
    attachmentIds: attachmentIdsField,
    direction: z.enum(CHEQUE_DIRECTIONS),
    purpose: z.enum(CHEQUE_PURPOSES),
    /** The number printed on the cheque */
    chequeNumber: z.string().trim().min(1).max(40),
    /** Received: the bank the cheque is drawn on (issued cheques take our bank's name) */
    bankName: z.string().trim().min(2).max(80).optional(),
    /** Who wrote it or who it is for; defaults to the merchant or supplier */
    partyName: z.string().trim().min(2).max(120).optional(),
    /** The cheque's amount; for a bill, how much of the bill it settles (withholding tax
     * included: the cheque is for that amount less the tax kept back) */
    amountPiastres: piastres.optional(),
    issueDate: day,
    dueDate: day,
    merchantId: id.optional(),
    supplierId: id.optional(),
    billId: id.optional(),
    payoutId: id.optional(),
    incomeAccountId: id.optional(),
    /** Issued: the bank the cheque is drawn on (ours) */
    bankAccountId: id.optional(),
    note: z.string().trim().max(300).optional(),
    receiptPhotoId: id.optional(),
    idempotencyKey: key,
  })
  .refine((v) => v.dueDate >= v.issueDate, { message: 'due_before_issue', path: ['dueDate'] })
  .refine(
    (v) =>
      v.direction === 'received'
        ? (RECEIVED_PURPOSES as readonly string[]).includes(v.purpose)
        : (ISSUED_PURPOSES as readonly string[]).includes(v.purpose),
    { message: 'purpose_direction', path: ['purpose'] },
  );
export type ChequeBody = z.infer<typeof chequeSchema>;

export const chequeDepositSchema = z.object({ bankAccountId: id.optional(), day: day.optional() });
export const chequeClearSchema = z.object({ bankAccountId: id.optional(), day: day.optional() });
export const chequeBounceSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  day: day.optional(),
});
export const chequeCancelSchema = z.object({ note: z.string().trim().min(3).max(300) });

// ─── merchant contracts ──────────────────────────────────────────────────────────
//
// Merchant contracts v2: one contract per merchant (CTR-000001, gapless) made of versions
// (1, 2, 3...). A version holds the whole deal: the price of every fee (empty means the
// standard price, the global fee setting), volume tiers on every fee, payment terms, service
// promises, dates and notes. A version is a draft until it is activated with an effective
// from day (today or later); charges then use the version in force on the day of the event.

/** Contract numbers are shown as CTR-000001. */
export const contractLabel = (n: number) => `CTR-${String(n).padStart(6, '0')}`;
/** A version of a contract, for example CTR-000001 v2. */
export const contractVersionLabel = (n: number, version: number) =>
  `${contractLabel(n)} v${version}`;

export const CONTRACT_VERSION_STATUSES = ['draft', 'active', 'superseded'] as const;
export type ContractVersionStatus = (typeof CONTRACT_VERSION_STATUSES)[number];

/**
 * Every fee the system charges a merchant, with the setting that holds its standard price,
 * the name of its column on a volume tier, how it is typed (money or basis points), what it
 * is charged on (each order, or each unit) and the ledger entry kind it books.
 * The shipping fee is charged once per delivered order (often all inclusive: the other fees
 * then set to 0). Packaging stays our own cost unless a packaging charge is set (per delivered
 * order). Per product prices (a table on the version) and the failed delivery share are apart.
 */
export const CONTRACT_PRICES = {
  shippingFeePiastres: {
    setting: 'fee.shipping_fee_piastres',
    tierKey: 'shippingFeePiastres',
    unit: 'money',
    basis: 'order',
    kind: 'shipping_fee',
  },
  orderFixedPiastres: {
    setting: 'fee.order_fixed_piastres',
    tierKey: 'fixedFeePiastres',
    unit: 'money',
    basis: 'order',
    kind: 'order_fee',
  },
  orderPercentBp: {
    setting: 'fee.order_percent_bp',
    tierKey: 'percentBp',
    unit: 'bp',
    basis: 'order',
    kind: 'order_fee',
  },
  codPercentBp: {
    setting: 'fee.cod_percent_bp',
    tierKey: 'codPercentBp',
    unit: 'bp',
    basis: 'order',
    kind: 'cod_fee',
  },
  failedDeliveryPiastres: {
    setting: 'fee.failed_delivery_piastres',
    tierKey: 'failedDeliveryPiastres',
    unit: 'money',
    basis: 'order',
    kind: 'failed_fee',
  },
  receivingPerUnitPiastres: {
    setting: 'fee.receiving_per_unit_piastres',
    tierKey: 'receivingPerUnitPiastres',
    unit: 'money',
    basis: 'unit',
    kind: 'receiving_fee',
  },
  storagePerUnitMonthPiastres: {
    setting: 'fee.storage_per_unit_month_piastres',
    tierKey: 'storagePerUnitMonthPiastres',
    unit: 'money',
    basis: 'unit',
    kind: 'storage_fee',
  },
  returnPerUnitPiastres: {
    setting: 'fee.return_per_unit_piastres',
    tierKey: 'returnPerUnitPiastres',
    unit: 'money',
    basis: 'unit',
    kind: 'return_fee',
  },
  packagingChargePiastres: {
    setting: 'fee.packaging_charge_piastres',
    tierKey: 'packagingChargePiastres',
    unit: 'money',
    basis: 'order',
    kind: 'packaging_charge',
  },
} as const satisfies Record<
  string,
  {
    setting: SettingKey;
    tierKey: string;
    unit: 'money' | 'bp';
    basis: 'order' | 'unit';
    kind: string;
  }
>;
export type ContractPriceKey = keyof typeof CONTRACT_PRICES;
export const CONTRACT_PRICE_KEYS = Object.keys(CONTRACT_PRICES) as ContractPriceKey[];
/** The resolved price of every fee. */
export type ContractPrices = Record<ContractPriceKey, number>;
/** A version's own prices: null is the standard price. */
export type ContractPriceValues = Record<ContractPriceKey, number | null>;
export type ContractTierKey = (typeof CONTRACT_PRICES)[ContractPriceKey]['tierKey'];

/**
 * From the nth delivered order of the Cairo month, the values set here replace the version's
 * price (null keeps it). The order that crosses into a band and every later one pay the band's
 * price; earlier orders are never charged again. Charges that are not a delivered order
 * (failed delivery, receiving, storage, return) use the band the next delivered order of the
 * month would fall in at the moment of the charge.
 */
export interface ContractTier {
  /** From the nth delivered order of the Cairo month (1 is the first) */
  fromOrder: number;
  shippingFeePiastres: number | null;
  /** Order fee, fixed part */
  fixedFeePiastres: number | null;
  /** Order fee, share of the products value */
  percentBp: number | null;
  codPercentBp: number | null;
  failedDeliveryPiastres: number | null;
  receivingPerUnitPiastres: number | null;
  storagePerUnitMonthPiastres: number | null;
  returnPerUnitPiastres: number | null;
  packagingChargePiastres: number | null;
}
export const CONTRACT_TIER_KEYS = CONTRACT_PRICE_KEYS.map((k) => CONTRACT_PRICES[k].tierKey);

/** A tier with only the values given (the others empty). */
export function makeTier(fromOrder: number, values: Partial<Omit<ContractTier, 'fromOrder'>>) {
  const tier = { fromOrder } as ContractTier;
  for (const k of CONTRACT_TIER_KEYS) tier[k] = values[k] ?? null;
  return tier;
}

/** The value a tier sets for a price (null when the tier leaves it to the version). */
export function tierValue(tier: ContractTier | null | undefined, key: ContractPriceKey) {
  return tier ? (tier[CONTRACT_PRICES[key].tierKey] ?? null) : null;
}

const tierMoney = money.nullable().default(null);
const tierBp = bp.nullable().default(null);
export const contractTierSchema = z
  .object({
    fromOrder: z.number().int().min(1).max(1_000_000),
    shippingFeePiastres: tierMoney,
    fixedFeePiastres: tierMoney,
    percentBp: tierBp,
    codPercentBp: tierBp,
    failedDeliveryPiastres: tierMoney,
    receivingPerUnitPiastres: tierMoney,
    storagePerUnitMonthPiastres: tierMoney,
    returnPerUnitPiastres: tierMoney,
    packagingChargePiastres: tierMoney,
  })
  .refine((t) => CONTRACT_TIER_KEYS.some((k) => t[k] !== null), { message: 'tier_empty' });

/**
 * The band an order falls in: the tier with the highest "from order" not above the order's
 * place in the month. Before the first band (or with no bands) there is none.
 */
export function tierFor<T extends { fromOrder: number }>(tiers: readonly T[], nth: number) {
  let best: T | null = null;
  for (const t of tiers)
    if (t.fromOrder <= nth && (!best || t.fromOrder > best.fromOrder)) best = t;
  return best;
}

/**
 * The price of every fee: the band's value, else the version's own price, else the standard
 * price (the global setting), field by field.
 */
export function resolvePrices(
  version: Partial<ContractPriceValues> | null | undefined,
  tier: ContractTier | null | undefined,
  standard: ContractPrices,
): ContractPrices {
  const out = {} as ContractPrices;
  for (const k of CONTRACT_PRICE_KEYS) out[k] = tierValue(tier, k) ?? version?.[k] ?? standard[k];
  return out;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);

const priceFields = {
  shippingFeePiastres: money.nullable().default(null),
  orderFixedPiastres: money.nullable(),
  orderPercentBp: bp.nullable(),
  codPercentBp: bp.nullable(),
  failedDeliveryPiastres: money.nullable(),
  receivingPerUnitPiastres: money.nullable(),
  storagePerUnitMonthPiastres: money.nullable(),
  returnPerUnitPiastres: money.nullable(),
  packagingChargePiastres: money.nullable().default(null),
} satisfies Record<ContractPriceKey, z.ZodTypeAny>;

// ─── per product prices, failed deliveries, the all inclusive preset ────────────

/**
 * One product's price on a version: charged per delivered unit of that product (units
 * cancelled before delivery are not). Products without a price charge nothing for this fee.
 * Volume tiers do not apply to per product prices.
 */
export const contractProductPriceSchema = z.object({
  skuId: id,
  pricePiastres: money,
});
export type ContractProductPrice = z.infer<typeof contractProductPriceSchema>;
/** At most this many product prices on one version. */
export const CONTRACT_PRODUCT_PRICES_MAX = 5000;

/** One row of a product prices file: sku, price_egp (other columns are ignored). */
export const contractProductPriceRowSchema = z.object({
  sku: z
    .string({ required_error: 'sku_required', invalid_type_error: 'sku_required' })
    .trim()
    .min(1, 'sku_required')
    .max(64),
  price_egp: z
    .union([z.string(), z.number()], { errorMap: () => ({ message: 'invalid_price' }) })
    .transform((value, ctx) => {
      const piastres = egpTextToPiastres(String(value));
      if (piastres === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_price' });
        return z.NEVER;
      }
      return piastres;
    }),
});
export const contractProductPricesCheckSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(CONTRACT_PRODUCT_PRICES_MAX),
});

/**
 * Pounds typed by a person ("149.5", "1,200") as integer piastres, without floats. null when
 * not a price (negative, more than two decimals, not a number, above 1,000,000 EGP).
 */
export function egpTextToPiastres(text: string): number | null {
  const t = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, fraction = ''] = t.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** The per product prices charged for a shipment: each delivered unit at its product's price. */
export function productHandlingCharge(
  lines: readonly { skuId: string; units: number }[],
  prices: ReadonlyMap<string, number> | Record<string, number>,
) {
  const priceOf = (skuId: string) =>
    prices instanceof Map ? prices.get(skuId) : (prices as Record<string, number>)[skuId];
  let total = 0;
  for (const l of lines) {
    const price = priceOf(l.skuId);
    if (price !== undefined && l.units > 0) total += l.units * price;
  }
  return total;
}

/**
 * The fees the all inclusive preset sets to an explicit 0 (empty would be the standard price):
 * the shipping fee then covers them. Failed deliveries cost 100% of the shipment.
 */
export const ALL_INCLUSIVE_ZERO_KEYS = [
  'orderFixedPiastres',
  'orderPercentBp',
  'codPercentBp',
  'receivingPerUnitPiastres',
  'storagePerUnitMonthPiastres',
  'returnPerUnitPiastres',
  'packagingChargePiastres',
] as const satisfies readonly ContractPriceKey[];

/** The prices of the all inclusive preset: the shipping fee given, the others 0. */
export function allInclusivePrices(shippingFeePiastres: number | null) {
  const out: Partial<ContractPriceValues> & { failedDeliveryPercentBp: number } = {
    shippingFeePiastres,
    failedDeliveryPiastres: null,
    failedDeliveryPercentBp: 10_000,
  };
  for (const k of ALL_INCLUSIVE_ZERO_KEYS) out[k] = 0;
  return out;
}

/**
 * The charges of one shipment that a failed attempt is measured on: the shipping fee, the per
 * product prices of its units and the order fee (fixed plus the share of the products value).
 * Never the COD fee (no cash was collected) nor the packaging charge.
 */
export function shipmentCharges(
  prices: Pick<ContractPrices, 'shippingFeePiastres' | 'orderFixedPiastres' | 'orderPercentBp'>,
  input: { productsPiastres: number; productHandlingPiastres: number },
) {
  return (
    prices.shippingFeePiastres +
    input.productHandlingPiastres +
    prices.orderFixedPiastres +
    bpShare(input.productsPiastres, prices.orderPercentBp)
  );
}

export type FailedDeliveryRule =
  { mode: 'fixed'; piastres: number } | { mode: 'percent'; bp: number };

/**
 * What a failed attempt costs, in this order: a fixed failed delivery fee set by the version
 * or its band (0 included) is used as it is; else the version's share of the shipment charges;
 * else, when a shipping fee applies (above 0), fee.failed_delivery_percent_bp (100%) of them;
 * else the standard fixed fee (as before shipping fees existed).
 */
export function failedDeliveryRule(
  version: {
    failedDeliveryPiastres?: number | null;
    failedDeliveryPercentBp?: number | null;
  } | null,
  tier: ContractTier | null | undefined,
  resolved: Pick<ContractPrices, 'failedDeliveryPiastres' | 'shippingFeePiastres'>,
  standardPercentBp: number,
): FailedDeliveryRule {
  const fixed = tierValue(tier, 'failedDeliveryPiastres') ?? version?.failedDeliveryPiastres;
  if (fixed !== null && fixed !== undefined) return { mode: 'fixed', piastres: fixed };
  const percent = version?.failedDeliveryPercentBp;
  if (percent !== null && percent !== undefined) return { mode: 'percent', bp: percent };
  if (resolved.shippingFeePiastres > 0) return { mode: 'percent', bp: standardPercentBp };
  return { mode: 'fixed', piastres: resolved.failedDeliveryPiastres };
}

/** The failed delivery charge of a shipment under a rule. */
export function failedDeliveryCharge(rule: FailedDeliveryRule, shipmentPiastres: number) {
  return rule.mode === 'fixed' ? rule.piastres : bpShare(shipmentPiastres, rule.bp);
}

/** A contract version as merchants manage writes it (a new draft, or a draft changed). */
export const contractVersionSchema = z
  .object({
    ...priceFields,
    /** A failed attempt costs this share of the shipment charges (null: see failedDeliveryRule) */
    failedDeliveryPercentBp: bp.nullable().default(null),
    /** Price per delivered unit of each product (products left out: nothing) */
    productPrices: z.array(contractProductPriceSchema).max(CONTRACT_PRODUCT_PRICES_MAX).default([]),
    tiers: z.array(contractTierSchema).max(20),
    // Payment terms
    /** The agreed payout schedule (null: the merchant's own choice stays) */
    payoutSchedule: z.enum(PAYOUT_SCHEDULES).nullable(),
    /** Payouts wait until we owe at least this (null: payout.minimum_piastres) */
    minimumPayoutPiastres: money.nullable(),
    minimumMonthlyFeePiastres: money.nullable(),
    securityDepositPiastres: money.nullable(),
    creditLimitPiastres: money.nullable(),
    // Service promises
    /** Informative: the delivery time promised (null: sla.promise_minutes) */
    promiseMinutes: z.number().int().min(10).max(1440).nullable(),
    /** Delivery attempts included (null: delivery.max_attempts of the store) */
    deliveryAttempts: z.number().int().min(1).max(10).nullable(),
    /** Informative: the stores agreed (empty: every store that covers the customer) */
    storeIds: z.array(id).max(50).default([]),
    /** Informative: areas covered, in words */
    coverageNote: optionalText(500),
    /** Special terms, shown to the merchant and printed on the contract */
    terms: optionalText(4000),
    /** For the team only, never shown to the merchant */
    internalNote: optionalText(4000),
    // Dates
    startDate: day,
    endDate: day.nullable(),
    noticeDays: z.number().int().min(0).max(3650),
    /** The day it is meant to take effect (chosen again when it is activated) */
    effectiveFrom: day.nullable().default(null),
  })
  .refine((c) => c.endDate === null || c.endDate >= c.startDate, {
    message: 'end_before_start',
    path: ['endDate'],
  })
  .refine((c) => new Set(c.tiers.map((t) => t.fromOrder)).size === c.tiers.length, {
    message: 'tier_twice',
    path: ['tiers'],
  })
  .refine((c) => new Set(c.productPrices.map((p) => p.skuId)).size === c.productPrices.length, {
    message: 'product_twice',
    path: ['productPrices'],
  });
export type ContractVersionBody = z.infer<typeof contractVersionSchema>;
export type ContractVersionInput = z.input<typeof contractVersionSchema>;

export const contractDraftSchema = contractVersionSchema.and(
  z.object({ idempotencyKey: key.optional() }),
);

/** Activating a draft: the Cairo day it takes effect (today or later). */
export const contractActivateSchema = z.object({ effectiveFrom: day });
export type ContractActivateBody = z.infer<typeof contractActivateSchema>;

/** Signed contract files: PDF, JPG or PNG up to 5 MB each. */
export const CONTRACT_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const CONTRACT_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const contractFileNameSchema = z.string().trim().min(1).max(120);

// ─── the contract calculator ─────────────────────────────────────────────────────

/** What the calculator needs from a version: its own prices, tiers and minimum. */
export interface ContractCalcTerms extends ContractPriceValues {
  tiers: readonly ContractTier[];
  minimumMonthlyFeePiastres: number | null;
  /** null: the failed delivery rule falls back (see failedDeliveryRule) */
  failedDeliveryPercentBp?: number | null;
}

/**
 * What one delivered shipment costs the merchant at the band of its place in the month: the
 * shipping fee, the per product prices of its units, the order fee (fixed plus a share of the
 * products value), the COD fee on the cash collected (0 when prepaid) and the packaging charge,
 * plus VAT on each. Also what the same shipment would cost if the attempt failed.
 */
export function orderCharge(
  terms: ContractCalcTerms,
  standard: ContractPrices,
  vatBp: number,
  input: {
    productsPiastres: number;
    cashPiastres: number;
    /** The per product prices of its units (productHandlingCharge) */
    productHandlingPiastres?: number;
    nth?: number;
    /** fee.failed_delivery_percent_bp (100% when left out) */
    standardFailedPercentBp?: number;
  },
) {
  const tier = tierFor(terms.tiers, input.nth ?? 1);
  const p = resolvePrices(terms, tier, standard);
  const productHandling = input.productHandlingPiastres ?? 0;
  const shipping = p.shippingFeePiastres;
  const orderFee = p.orderFixedPiastres + bpShare(input.productsPiastres, p.orderPercentBp);
  const codFee = bpShare(input.cashPiastres, p.codPercentBp);
  const packaging = p.packagingChargePiastres;
  const parts = [shipping, productHandling, orderFee, codFee, packaging];
  const fees = parts.reduce((a, b) => a + b, 0);
  // VAT is worked out on each fee as it is booked (one ledger entry per kind).
  const vat = parts.reduce((a, b) => a + bpShare(b, vatBp), 0);
  const rule = failedDeliveryRule(terms, tier, p, input.standardFailedPercentBp ?? 10_000);
  const failed = failedDeliveryCharge(
    rule,
    shipmentCharges(p, {
      productsPiastres: input.productsPiastres,
      productHandlingPiastres: productHandling,
    }),
  );
  return {
    tierFrom: tier?.fromOrder ?? null,
    shippingFeePiastres: shipping,
    productHandlingPiastres: productHandling,
    orderFeePiastres: orderFee,
    codFeePiastres: codFee,
    packagingChargePiastres: packaging,
    feesPiastres: fees,
    vatPiastres: vat,
    totalPiastres: fees + vat,
    failedRule: rule,
    failedPiastres: failed,
    failedTotalPiastres: failed + bpShare(failed, vatBp),
  };
}

/**
 * About what a month costs: the orders spread evenly over the days, every order paid cash at
 * the average value (with the per product prices of the example shipment), the units in stock
 * all month. Per order fees go band by band; storage is charged day by day at the band reached
 * so far; the minimum tops the fees up. Per product prices take no tiers.
 */
export function monthEstimate(
  terms: ContractCalcTerms,
  standard: ContractPrices,
  vatBp: number,
  input: {
    orders: number;
    averageOrderPiastres: number;
    unitsStored: number;
    days?: number;
    /** Per product prices of an average order */
    productHandlingPerOrderPiastres?: number;
    /** Paid cash on delivery (true when left out) */
    cash?: boolean;
  },
) {
  const orders = Math.max(0, Math.floor(input.orders));
  const average = Math.max(0, input.averageOrderPiastres);
  const cash = input.cash === false ? 0 : average;
  const days = input.days ?? 30;
  // The fees change only where a band starts: walk the bands, not every order.
  const starts = [
    1,
    ...terms.tiers.map((t) => t.fromOrder).filter((n) => n > 1 && n <= orders),
  ].sort((a, b) => a - b);
  let shippingFees = 0;
  let orderFees = 0;
  let codFees = 0;
  let packagingCharges = 0;
  for (const [i, from] of starts.entries()) {
    const to = i + 1 < starts.length ? starts[i + 1]! - 1 : orders;
    const count = Math.max(0, to - from + 1);
    const p = resolvePrices(terms, tierFor(terms.tiers, from), standard);
    shippingFees += count * p.shippingFeePiastres;
    orderFees += count * (p.orderFixedPiastres + bpShare(average, p.orderPercentBp));
    codFees += count * bpShare(cash, p.codPercentBp);
    packagingCharges += count * p.packagingChargePiastres;
  }
  const productHandling = orders * Math.max(0, input.productHandlingPerOrderPiastres ?? 0);
  let storage = 0;
  const units = Math.max(0, Math.floor(input.unitsStored));
  if (units > 0)
    for (let d = 1; d <= days; d++) {
      const soFar = Math.floor((orders * d) / days);
      const p = resolvePrices(terms, tierFor(terms.tiers, soFar + 1), standard);
      storage += Math.floor((units * p.storagePerUnitMonthPiastres + Math.floor(days / 2)) / days);
    }
  const beforeMinimum =
    shippingFees + productHandling + orderFees + codFees + packagingCharges + storage;
  const minimumTopUp = terms.minimumMonthlyFeePiastres
    ? Math.max(0, terms.minimumMonthlyFeePiastres - beforeMinimum)
    : 0;
  const fees = beforeMinimum + minimumTopUp;
  const vat = bpShare(fees, vatBp);
  return {
    orders,
    shippingFeesPiastres: shippingFees,
    productHandlingPiastres: productHandling,
    orderFeesPiastres: orderFees,
    codFeesPiastres: codFees,
    packagingChargesPiastres: packagingCharges,
    storagePiastres: storage,
    minimumTopUpPiastres: minimumTopUp,
    feesPiastres: fees,
    vatPiastres: vat,
    totalPiastres: fees + vat,
    perOrderPiastres: orders > 0 ? Math.round((fees + vat) / orders) : null,
  };
}

/** A security deposit received (in) or paid back (out), by bank or through the wallet. */
export const depositSchema = z.object({
  attachmentIds: attachmentIdsField,
  direction: z.enum(['in', 'out']),
  /** bank: money moves through our bank; wallet: taken from or added to the merchant's balance */
  via: z.enum(['bank', 'wallet']),
  amountPiastres: piastres,
  bankAccountId: id.optional(),
  reference: z.string().trim().min(2).max(100),
  day: day.optional(),
  receiptPhotoId: id.optional(),
  idempotencyKey: key,
});
export type DepositBody = z.infer<typeof depositSchema>;

// ─── what if ────────────────────────────────────────────────────────────────────

/** A share in basis points of an amount, rounded half up, in whole piastres. */
export function bpShare(amount: number, basisPoints: number) {
  return Math.floor((amount * basisPoints + 5_000) / 10_000);
}

/** One merchant's month, as the what if calculator needs it. */
export interface WhatIfBase {
  deliveredOrders: number;
  /** Products value of the delivered orders */
  productsPiastres: number;
  /** Cash collected on them */
  codCashPiastres: number;
  /** Fees booked in the month by kind (before VAT), the minimum top up included */
  feesByKind: Record<string, number>;
  /** Every cost counted for the merchant in the month */
  costsPiastres: number;
  /**
   * Each delivered order's products value and cash: fees are booked per order, each share
   * rounded on its own, so the what if rounds the same way (the sum of the rounded shares).
   */
  orders?: { productsPiastres: number; codCashPiastres: number }[];
  /**
   * The values in force the month was booked at: a fee whose values are left as they are
   * stays exactly as booked (tiers, versions changed in the month and rounding included).
   */
  current?: WhatIfParams;
}

export interface WhatIfParams {
  /** Shipping fee per delivered order (0 when left out) */
  shippingFeePiastres?: number;
  orderFixedPiastres: number;
  orderPercentBp: number;
  codPercentBp: number;
  /** null: no monthly minimum */
  minimumPiastres: number | null;
}

/** Fees that change with the what if values; every other fee stays as it was booked. */
const VARIABLE_FEES = new Set(['shipping_fee', 'order_fee', 'cod_fee', 'minimum_fee']);

/**
 * The same month again with other fee values: shipping, order and COD fees are worked out
 * afresh on the month's orders, products value and cash (shares rounded per order, as they
 * are booked), the other fees (per product prices, packaging, unit fees) stay, and the
 * minimum tops the total up. A fee whose values equal the ones in force stays as booked, so
 * the what if at today's prices shows exactly the booked fees. Costs do not change.
 */
export function whatIf(base: WhatIfBase, p: WhatIfParams) {
  const c = base.current;
  const booked = (kind: string) => base.feesByKind[kind] ?? 0;
  // A share worked out per order (as booked), or on the month's total without the orders.
  const perOrder = (pick: 'productsPiastres' | 'codCashPiastres', bp: number) =>
    base.orders
      ? base.orders.reduce((s, o) => s + bpShare(o[pick], bp), 0)
      : bpShare(pick === 'productsPiastres' ? base.productsPiastres : base.codCashPiastres, bp);
  const sameShipping = !!c && (c.shippingFeePiastres ?? 0) === (p.shippingFeePiastres ?? 0);
  const sameOrder =
    !!c && c.orderFixedPiastres === p.orderFixedPiastres && c.orderPercentBp === p.orderPercentBp;
  const sameCod = !!c && c.codPercentBp === p.codPercentBp;
  const shippingFee = sameShipping
    ? booked('shipping_fee')
    : base.deliveredOrders * (p.shippingFeePiastres ?? 0);
  const orderFee = sameOrder
    ? booked('order_fee')
    : base.deliveredOrders * p.orderFixedPiastres + perOrder('productsPiastres', p.orderPercentBp);
  const codFee = sameCod ? booked('cod_fee') : perOrder('codCashPiastres', p.codPercentBp);
  const otherFees = Object.entries(base.feesByKind)
    .filter(([kind]) => !VARIABLE_FEES.has(kind))
    .reduce((s, [, v]) => s + v, 0);
  const beforeMinimum = shippingFee + orderFee + codFee + otherFees;
  const unchanged =
    !!c &&
    sameShipping &&
    sameOrder &&
    sameCod &&
    (c.minimumPiastres ?? null) === p.minimumPiastres;
  const minimumTopUp =
    unchanged && 'minimum_fee' in base.feesByKind
      ? booked('minimum_fee')
      : p.minimumPiastres
        ? Math.max(0, p.minimumPiastres - beforeMinimum)
        : 0;
  const fees = beforeMinimum + minimumTopUp;
  const margin = fees - base.costsPiastres;
  return {
    shippingFeePiastres: shippingFee,
    orderFeePiastres: orderFee,
    codFeePiastres: codFee,
    otherFeesPiastres: otherFees,
    minimumTopUpPiastres: minimumTopUp,
    feesPiastres: fees,
    marginPiastres: margin,
    marginPerOrderPiastres:
      base.deliveredOrders > 0 ? Math.round(margin / base.deliveredOrders) : null,
  };
}
