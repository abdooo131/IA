import {
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
  vatBp: number;
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
  'price' | 'tiers' | 'money' | 'promise' | 'attempts' | 'notice' | 'dates';

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

/** The calculator: one cash order and an estimated month, at the version's prices. */
export function calculate(
  v: Pick<ContractVersion, 'prices' | 'tiers' | 'minimumMonthlyFeePiastres'> | null,
  standard: ContractPrices,
  vatBp: number,
  input: { orderPiastres: number; orders: number; unitsStored: number },
) {
  const terms = {
    ...(v?.prices ??
      (Object.fromEntries(CONTRACT_PRICE_KEYS.map((k) => [k, null])) as ContractPriceValues)),
    tiers: v?.tiers ?? [],
    minimumMonthlyFeePiastres: v?.minimumMonthlyFeePiastres ?? null,
  };
  return {
    order: orderCharge(terms, standard, vatBp, {
      productsPiastres: input.orderPiastres,
      cashPiastres: input.orderPiastres,
    }),
    month: monthEstimate(terms, standard, vatBp, {
      orders: input.orders,
      averageOrderPiastres: input.orderPiastres,
      unitsStored: input.unitsStored,
    }),
  };
}
