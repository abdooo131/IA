import {
  ALL_INCLUSIVE_ZERO_KEYS,
  CONTRACT_PRICE_KEYS,
  CONTRACT_PRICES,
  type ContractPriceKey,
  type ContractPrices,
  type ContractPriceValues,
  type ContractTier,
  makeTier,
  monthEstimate,
  orderCharge,
  type PayoutScheduleName,
  productHandlingCharge,
  tierValue,
} from '@shiplynow/shared';
import { bpText, egpInput, parseCount, parsePercentBp } from './sales-part2';
import { parseEgp } from './money';

// Merchant contracts v2 on the web: what the API answers, the edit form's rules (text typed
// by a person to piastres and basis points, never floats), the tier table and the calculator.

export type VersionDisplayStatus = 'draft' | 'in_force' | 'scheduled' | 'superseded' | 'ended';

export interface ContractVersion {
  id: string;
  version: number;
  label: string;
  status: 'draft' | 'active' | 'superseded';
  displayStatus: VersionDisplayStatus;
  effectiveFrom: string | null;
  prices: ContractPriceValues;
  /** A failed attempt's share of the shipment charges (null: the fixed fee, see the rule) */
  failedDeliveryPercentBp: number | null;
  /** Price per delivered unit of each product, by SKU */
  productPrices: ContractProductPriceRow[];
  tiers: ContractTier[];
  payoutSchedule: PayoutScheduleName | null;
  minimumPayoutPiastres: number | null;
  minimumMonthlyFeePiastres: number | null;
  securityDepositPiastres: number | null;
  creditLimitPiastres: number | null;
  promiseMinutes: number | null;
  deliveryAttempts: number | null;
  storeIds: string[];
  coverageNote: string | null;
  terms: string | null;
  internalNote: string | null;
  startDate: string;
  endDate: string | null;
  noticeDays: number;
  noticeBy: string | null;
  source: string | null;
  createdAt: string;
  createdBy: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
}

export interface ContractProductPriceRow {
  skuId: string;
  sku: string;
  titleEn: string;
  titleAr: string;
  pricePiastres: number;
}

/** One of the merchant's products, for per product prices and the calculator. */
export interface MerchantProduct {
  id: string;
  sku: string;
  titleEn: string;
  titleAr: string;
  pricePiastres: number;
  isActive: boolean;
}

export interface StoreRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface ContractView {
  merchant: {
    id: string;
    name: string;
    legalName: string | null;
    taxRegistrationNumber: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    payoutSchedule: PayoutScheduleName;
    bank: {
      bankName: string | null;
      bankAccountNumber: string | null;
      iban: string | null;
      beneficiaryName: string | null;
    };
  };
  contract: { id: string; number: number; label: string } | null;
  current: ContractVersion | null;
  scheduled: ContractVersion[];
  draft: ContractVersion | null;
  versions: ContractVersion[];
  files: {
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    versionId: string | null;
    version: number | null;
    uploadedBy: string | null;
    createdAt: string;
  }[];
  standard: ContractPrices;
  /** fee.failed_delivery_percent_bp: the failed share for contracts with a shipping fee */
  standardFailedPercentBp: number;
  vatBp: number;
  products: MerchantProduct[];
  standardTerms: {
    minimumPayoutPiastres: number;
    deliveryAttempts: number;
    promiseMinutes: number;
  };
  stores: StoreRef[];
  deliveredThisMonth: number;
  nextOrderTier: ContractTier | null;
  depositHeldPiastres: number;
  owedPiastres: number | null;
  overCreditLimit: boolean;
  scheduleDiffers: boolean;
}

/** The version a page shows: the one in force, else the next one agreed, else the draft. */
export function shownVersion(view: ContractView, versionId?: string | null) {
  if (versionId) return view.versions.find((v) => v.id === versionId) ?? null;
  return view.current ?? view.scheduled[0] ?? null;
}

export const isPercent = (k: ContractPriceKey) => CONTRACT_PRICES[k].unit === 'bp';

/** A price as the form shows it: pounds for money, percent for shares, empty for standard. */
export function priceInput(k: ContractPriceKey, value: number | null) {
  if (value === null) return '';
  return isPercent(k) ? bpText(value) : egpInput(value);
}

/** A price typed in the form: null when empty (standard), NaN when not valid. */
export function parsePrice(k: ContractPriceKey, text: string): number | null {
  if (!text.trim()) return null;
  const v = isPercent(k) ? parsePercentBp(text) : parseEgp(text);
  return v ?? Number.NaN;
}

export interface TierRow {
  fromOrder: string;
  values: Record<ContractPriceKey, string>;
}

const emptyValues = () =>
  Object.fromEntries(CONTRACT_PRICE_KEYS.map((k) => [k, ''])) as Record<ContractPriceKey, string>;

export function tierRowsFrom(tiers: readonly ContractTier[]): TierRow[] {
  return tiers.map((t) => ({
    fromOrder: String(t.fromOrder),
    values: Object.fromEntries(
      CONTRACT_PRICE_KEYS.map((k) => [k, priceInput(k, tierValue(t, k))]),
    ) as Record<ContractPriceKey, string>,
  }));
}

export function newTierRow(rows: readonly TierRow[]): TierRow {
  const last = rows.length ? Number(rows[rows.length - 1]!.fromOrder) || 0 : 0;
  return { fromOrder: String(last ? last + 100 : 101), values: emptyValues() };
}

/**
 * The tier rows typed in the form, checked: each band needs its first order (1 or more, once)
 * and at least one price. Empty rows are skipped. null when something is wrong.
 */
export function parseTierRows(rows: readonly TierRow[]): ContractTier[] | null {
  const out: ContractTier[] = [];
  for (const r of rows) {
    const any = CONTRACT_PRICE_KEYS.some((k) => r.values[k].trim());
    if (!r.fromOrder.trim() && !any) continue;
    const from = parseCount(r.fromOrder);
    if (from === null || Number.isNaN(from) || from < 1 || !any) return null;
    const values: Partial<Record<string, number | null>> = {};
    for (const k of CONTRACT_PRICE_KEYS) {
      const v = parsePrice(k, r.values[k]);
      if (Number.isNaN(v)) return null;
      values[CONTRACT_PRICES[k].tierKey] = v;
    }
    out.push(makeTier(from, values));
  }
  if (new Set(out.map((t) => t.fromOrder)).size !== out.length) return null;
  return out.sort((a, b) => a.fromOrder - b.fromOrder);
}

/** The fees any band sets, in the order of the price list (the tier table's columns). */
export function tierColumns(tiers: readonly ContractTier[]) {
  return CONTRACT_PRICE_KEYS.filter((k) => tiers.some((t) => tierValue(t, k) !== null));
}

export interface ContractForm {
  prices: Record<ContractPriceKey, string>;
  /** Failed delivery as a share of the shipment charges, in percent (empty: not set) */
  failedPercent: string;
  /** Price per unit of each product, in pounds, by product id (empty or absent: none) */
  productPrices: Record<string, string>;
  tiers: TierRow[];
  payoutSchedule: '' | PayoutScheduleName;
  minimumPayout: string;
  minimumMonthlyFee: string;
  securityDeposit: string;
  creditLimit: string;
  promiseMinutes: string;
  deliveryAttempts: string;
  storeIds: string[];
  coverageNote: string;
  terms: string;
  internalNote: string;
  startDate: string;
  endDate: string;
  noticeDays: string;
  effectiveFrom: string;
}

const moneyText = (p: number | null) => (p === null ? '' : egpInput(p));
const countText = (n: number | null) => (n === null ? '' : String(n));

/** The form filled from a version (a new draft starts from the one in force), or empty. */
export function formFrom(v: ContractVersion | null, today: string): ContractForm {
  return {
    prices: Object.fromEntries(
      CONTRACT_PRICE_KEYS.map((k) => [k, priceInput(k, v?.prices[k] ?? null)]),
    ) as Record<ContractPriceKey, string>,
    failedPercent:
      v?.failedDeliveryPercentBp === null || v?.failedDeliveryPercentBp === undefined
        ? ''
        : bpText(v.failedDeliveryPercentBp),
    productPrices: Object.fromEntries(
      (v?.productPrices ?? []).map((p) => [p.skuId, egpInput(p.pricePiastres)]),
    ),
    tiers: tierRowsFrom(v?.tiers ?? []),
    payoutSchedule: v?.payoutSchedule ?? '',
    minimumPayout: moneyText(v?.minimumPayoutPiastres ?? null),
    minimumMonthlyFee: moneyText(v?.minimumMonthlyFeePiastres ?? null),
    securityDeposit: moneyText(v?.securityDepositPiastres ?? null),
    creditLimit: moneyText(v?.creditLimitPiastres ?? null),
    promiseMinutes: countText(v?.promiseMinutes ?? null),
    deliveryAttempts: countText(v?.deliveryAttempts ?? null),
    storeIds: v?.storeIds ?? [],
    coverageNote: v?.coverageNote ?? '',
    terms: v?.terms ?? '',
    internalNote: v?.internalNote ?? '',
    startDate: v?.startDate ?? today,
    endDate: v?.endDate ?? '',
    noticeDays: String(v?.noticeDays ?? 30),
    effectiveFrom: v?.status === 'draft' ? (v.effectiveFrom ?? today) : today,
  };
}

export type ContractFormError =
  | 'price'
  | 'failedPercent'
  | 'productPrice'
  | 'tiers'
  | 'money'
  | 'promise'
  | 'attempts'
  | 'notice'
  | 'dates';

/**
 * The all inclusive preset: the shipping fee typed (or kept), every other merchant charge an
 * explicit 0 (never empty, which would be the standard price), the fixed failed delivery fee
 * cleared and failed deliveries at 100% of the shipment. Product prices stay as they are.
 */
export function applyAllInclusive(form: ContractForm, shipping?: string): ContractForm {
  const prices = { ...form.prices };
  for (const k of ALL_INCLUSIVE_ZERO_KEYS) prices[k] = '0';
  if (shipping !== undefined) prices.shippingFeePiastres = shipping;
  prices.failedDeliveryPiastres = '';
  return { ...form, prices, failedPercent: '100' };
}

/** Whether a version is all inclusive: a shipping fee and at least one other charge at 0. */
export function isAllInclusive(prices: ContractPriceValues) {
  return (
    (prices.shippingFeePiastres ?? 0) > 0 && ALL_INCLUSIVE_ZERO_KEYS.some((k) => prices[k] === 0)
  );
}

/** The product prices typed: piastres by product id, empty ones left out; null if one is wrong. */
export function parseProductPrices(
  entries: Record<string, string>,
): { skuId: string; pricePiastres: number }[] | null {
  const out: { skuId: string; pricePiastres: number }[] = [];
  for (const [skuId, text] of Object.entries(entries)) {
    if (!text.trim()) continue;
    const v = parseEgp(text);
    if (v === null) return null;
    out.push({ skuId, pricePiastres: v });
  }
  return out;
}

/** The same price for every product chosen (bulk set); an empty price clears them. */
export function setPrices(
  entries: Record<string, string>,
  skuIds: readonly string[],
  price: string,
): Record<string, string> {
  const out = { ...entries };
  for (const id of skuIds) {
    if (price.trim()) out[id] = price.trim();
    else delete out[id];
  }
  return out;
}

/** Products matching a search (SKU or either title), active first, at most `limit`. */
export function searchProducts(products: readonly MerchantProduct[], query: string, limit = 50) {
  const q = query.trim().toLowerCase();
  const found = q
    ? products.filter(
        (p) =>
          p.sku.toLowerCase().includes(q) ||
          p.titleEn.toLowerCase().includes(q) ||
          p.titleAr.includes(query.trim()),
      )
    : [...products];
  return {
    total: found.length,
    rows: found.sort((a, b) => Number(b.isActive) - Number(a.isActive)).slice(0, limit),
  };
}

/** The API body from the form, or the first thing to fix. */
export function bodyFrom(
  form: ContractForm,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: ContractFormError } {
  const prices = {} as Record<ContractPriceKey, number | null>;
  for (const k of CONTRACT_PRICE_KEYS) {
    const v = parsePrice(k, form.prices[k]);
    if (Number.isNaN(v)) return { ok: false, error: 'price' };
    prices[k] = v;
  }
  let failedPercent: number | null = null;
  if (form.failedPercent.trim()) {
    const bp = parsePercentBp(form.failedPercent);
    if (bp === null) return { ok: false, error: 'failedPercent' };
    failedPercent = bp;
  }
  const productPrices = parseProductPrices(form.productPrices);
  if (!productPrices) return { ok: false, error: 'productPrice' };
  const tiers = parseTierRows(form.tiers);
  if (!tiers) return { ok: false, error: 'tiers' };
  const money = (text: string) => (text.trim() ? (parseEgp(text) ?? Number.NaN) : null);
  const amounts = [
    money(form.minimumPayout),
    money(form.minimumMonthlyFee),
    money(form.securityDeposit),
    money(form.creditLimit),
  ];
  if (amounts.some((a) => Number.isNaN(a))) return { ok: false, error: 'money' };
  const promise = parseCount(form.promiseMinutes);
  if (promise !== null && (Number.isNaN(promise) || promise < 10 || promise > 1440))
    return { ok: false, error: 'promise' };
  const attempts = parseCount(form.deliveryAttempts);
  if (attempts !== null && (Number.isNaN(attempts) || attempts < 1 || attempts > 10))
    return { ok: false, error: 'attempts' };
  const notice = parseCount(form.noticeDays);
  if (notice === null || Number.isNaN(notice) || notice > 3650)
    return { ok: false, error: 'notice' };
  if (!form.startDate || (form.endDate && form.endDate < form.startDate))
    return { ok: false, error: 'dates' };
  return {
    ok: true,
    body: {
      ...prices,
      failedDeliveryPercentBp: failedPercent,
      productPrices,
      tiers,
      payoutSchedule: form.payoutSchedule || null,
      minimumPayoutPiastres: amounts[0],
      minimumMonthlyFeePiastres: amounts[1],
      securityDepositPiastres: amounts[2],
      creditLimitPiastres: amounts[3],
      promiseMinutes: promise,
      deliveryAttempts: attempts,
      storeIds: form.storeIds,
      coverageNote: form.coverageNote.trim() || null,
      terms: form.terms.trim() || null,
      internalNote: form.internalNote.trim() || null,
      startDate: form.startDate,
      endDate: form.endDate || null,
      noticeDays: notice,
      effectiveFrom: form.effectiveFrom || null,
    },
  };
}

/** What the calculator reads of a version (a saved one, or the form being typed). */
export type CalcVersion = Pick<
  ContractVersion,
  'prices' | 'tiers' | 'minimumMonthlyFeePiastres' | 'failedDeliveryPercentBp'
> & { productPrices: Pick<ContractProductPriceRow, 'skuId' | 'pricePiastres'>[] };

/** The products of the example shipment: quantity of each product chosen. */
export interface ExampleLine {
  skuId: string;
  quantity: number;
}

/** The products value of an example shipment at the products' own prices. */
export function linesValue(lines: readonly ExampleLine[], products: readonly MerchantProduct[]) {
  const byId = new Map(products.map((p) => [p.id, p.pricePiastres]));
  return lines.reduce((s, l) => s + (byId.get(l.skuId) ?? 0) * Math.max(0, l.quantity), 0);
}

/**
 * The calculator: one example shipment (its products and quantities, paid cash or prepaid, its
 * value) with what a failed attempt would cost, and an estimated month of such shipments.
 */
export function calculate(
  v: CalcVersion | null,
  standard: ContractPrices,
  vatBp: number,
  input: {
    orderPiastres: number;
    orders: number;
    unitsStored: number;
    lines?: readonly ExampleLine[];
    cash?: boolean;
    standardFailedPercentBp?: number;
  },
) {
  const terms = {
    ...(v?.prices ??
      (Object.fromEntries(CONTRACT_PRICE_KEYS.map((k) => [k, null])) as ContractPriceValues)),
    tiers: v?.tiers ?? [],
    minimumMonthlyFeePiastres: v?.minimumMonthlyFeePiastres ?? null,
    failedDeliveryPercentBp: v?.failedDeliveryPercentBp ?? null,
  };
  const prices = new Map((v?.productPrices ?? []).map((p) => [p.skuId, p.pricePiastres]));
  const handling = productHandlingCharge(
    (input.lines ?? []).map((l) => ({ skuId: l.skuId, units: l.quantity })),
    prices,
  );
  const cash = input.cash !== false;
  return {
    order: orderCharge(terms, standard, vatBp, {
      productsPiastres: input.orderPiastres,
      cashPiastres: cash ? input.orderPiastres : 0,
      productHandlingPiastres: handling,
      standardFailedPercentBp: input.standardFailedPercentBp,
    }),
    month: monthEstimate(terms, standard, vatBp, {
      orders: input.orders,
      averageOrderPiastres: input.orderPiastres,
      unitsStored: input.unitsStored,
      productHandlingPerOrderPiastres: handling,
      cash,
    }),
  };
}
