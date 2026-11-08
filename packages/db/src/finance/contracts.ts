import type { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  cairoDayStart,
  CONTRACT_FILE_MAX_BYTES,
  CONTRACT_FILE_TYPES,
  CONTRACT_PRICE_KEYS,
  CONTRACT_PRICES,
  CONTRACT_TIER_KEYS,
  contractLabel,
  type ContractPrices,
  type ContractPriceValues,
  type ContractTier,
  contractProductPriceRowSchema,
  type ContractVersionBody,
  contractVersionLabel,
  type DepositBody,
  egpText,
  failedDeliveryRule,
  type PayoutScheduleName,
  resolvePrices,
  tierFor,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { looksLike } from '../hr-documents';
import { getSetting } from '../settings';
import { addMonths } from './assets';
import { eventTime } from './books';
import { submitMovement } from './controls';
import { balanceOf, post, share } from './ledger';
import { bankAccount, merchantOwed } from './operations';
import { accrueStorage, lastClosedDay } from './postings';

type Tx = Prisma.TransactionClient;

// Merchant contracts v2 (CLAUDE.md "Merchant contracts v2"): one contract per merchant
// (CTR-000001, gapless) made of versions. A version holds every price (empty: the standard
// price, the global fee setting), volume tiers on every fee, payment terms, service promises,
// dates and notes. Merchants manage writes a draft and activates it with an effective from
// day (today or later, never before the last activation, never in closed books). Every charge
// reads the version in force on the day of its event, field by field:
//
// - Volume tiers: a delivered order's fees follow the band of its place among the merchant's
//   delivered orders of the Cairo month (this one included). The order that crosses into a
//   band pays the band's price and so does every later one; earlier orders are never charged
//   again. Other charges (failed delivery, receiving, storage, return) use the band the next
//   delivered order would fall in at the moment of the charge. Tiers count only between the
//   version's start and end dates; its prices hold from its effective day until a later
//   version takes effect (an ended contract keeps its prices until it is replaced).
// - Monthly minimum: once a month is over, fees booked for it (before VAT) are topped up to
//   the minimum of each day's version, shared out by the days between start and end.
// - Payout minimum: a payout waits until we owe at least the minimum.
// - Delivery attempts: the merchant's orders get the version's attempts, else the store's.
// - Security deposit: held in the merchant's 2600 deposit wallet, received and paid back by
//   bank, by cheque or through the merchant's balance.
// - Credit limit: while the merchant owes us more than the limit, new shipments are refused
//   (merchant_over_credit_limit) and admin is alerted once a day.

const negate = (value: number) => 0 - value;
const dayText = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);
const monthStart = (month: string) => cairoDayStart(`${month}-01`);

const versionInclude = {
  tiers: { orderBy: { fromOrder: 'asc' } },
  parcelPrices: { orderBy: [{ zoneCode: 'asc' }, { size: 'asc' }] },
  contract: { select: { number: true, merchantId: true } },
  createdBy: { select: { name: true } },
  activatedBy: { select: { name: true } },
} as const satisfies Prisma.MerchantContractVersionInclude;
type VersionRow = Prisma.MerchantContractVersionGetPayload<{ include: typeof versionInclude }>;

/** A version with its product prices, for the screens and the printed contract. */
const versionFullInclude = {
  ...versionInclude,
  products: {
    include: { sku: { select: { sku: true, titleEn: true, titleAr: true } } },
    orderBy: { sku: { sku: 'asc' } },
  },
} as const satisfies Prisma.MerchantContractVersionInclude;
type VersionFullRow = Prisma.MerchantContractVersionGetPayload<{
  include: typeof versionFullInclude;
}>;

/** Whether a version's contract dates cover a Cairo day (tiers and the minimum count then). */
const covers = (v: { startDate: Date; endDate: Date | null }, day: string) =>
  dayText(v.startDate) <= day && (!v.endDate || dayText(v.endDate) >= day);

/** The standard price of every fee: the global fee settings. */
export async function standardPrices(db: Db): Promise<ContractPrices> {
  const out = {} as ContractPrices;
  for (const k of CONTRACT_PRICE_KEYS) out[k] = await getSetting(db, CONTRACT_PRICES[k].setting);
  return out;
}

/** fee.failed_delivery_percent_bp: the failed share for contracts with a shipping fee. */
export function standardFailedPercent(db: Db) {
  return getSetting(db, 'fee.failed_delivery_percent_bp');
}

/**
 * The per product prices of a version for some products (every product when none are named).
 * Products without a price are left out: they charge nothing for this fee.
 */
export async function productPricesFor(
  db: Db,
  versionId: string | null,
  skuIds?: readonly string[],
): Promise<Map<string, number>> {
  if (!versionId) return new Map();
  const rows = await db.merchantContractVersionProduct.findMany({
    where: { versionId, ...(skuIds && { skuId: { in: [...skuIds] } }) },
    select: { skuId: true, pricePiastres: true },
  });
  return new Map(rows.map((r) => [r.skuId, r.pricePiastres]));
}

/** A version's own prices (null: standard). */
function pricesOf(v: Pick<VersionRow, keyof ContractPriceValues>): ContractPriceValues {
  const out = {} as ContractPriceValues;
  for (const k of CONTRACT_PRICE_KEYS) out[k] = v[k];
  return out;
}

function tiersOf(rows: readonly ContractTier[]): ContractTier[] {
  return rows.map((t) => {
    const tier = { fromOrder: t.fromOrder } as ContractTier;
    for (const k of CONTRACT_TIER_KEYS) tier[k] = t[k];
    return tier;
  });
}

/**
 * The version in force for a merchant on a Cairo day: the activated version with the latest
 * effective day not after it (a later version number wins a tie). null: none, standard prices.
 */
export function versionInForce(db: Db, merchantId: string, day: string) {
  return db.merchantContractVersion.findFirst({
    where: {
      contract: { merchantId },
      status: { in: ['active', 'superseded'] },
      effectiveFrom: { lte: dateOf(day) },
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    include: versionInclude,
  });
}

/** Delivered orders of the merchant in the Cairo month of a moment, up to that moment. */
function deliveredInMonth(db: Db, merchantId: string, at: Date, exceptOrderId?: string) {
  return db.order.count({
    where: {
      merchantId,
      status: 'delivered',
      deliveredAt: { gte: monthStart(cairoDay(at).slice(0, 7)), lte: at },
      ...(exceptOrderId && { id: { not: exceptOrderId } }),
    },
  });
}

/**
 * The price of every fee for a merchant at a moment: the version in force that Cairo day,
 * its band (for a delivered order, the order's place in the month; for anything else, the
 * place the next delivered order would take), field by field down to the standard price.
 * For a delivered order the merchant is locked so two deliveries at once count in turn.
 */
export async function contractPricesAt(
  db: Db,
  input: { merchantId: string; at: Date; orderId?: string; standard?: ContractPrices },
) {
  const day = cairoDay(input.at);
  return pricesForDay(db, {
    merchantId: input.merchantId,
    day,
    standard: input.standard,
    nth: async () => {
      if (input.orderId)
        await db.$queryRaw`SELECT id FROM merchants WHERE id = ${input.merchantId} FOR UPDATE`;
      return (await deliveredInMonth(db, input.merchantId, input.at, input.orderId)) + 1;
    },
  });
}

/**
 * The prices of a Cairo day for the nth delivered order of its month (the place is only
 * worked out when the version in force has tiers and its dates cover the day).
 */
export async function pricesForDay(
  db: Db,
  input: {
    merchantId: string;
    day: string;
    nth: number | (() => Promise<number>);
    standard?: ContractPrices;
  },
) {
  const standard = input.standard ?? (await standardPrices(db));
  const version = await versionInForce(db, input.merchantId, input.day);
  let tier: ContractTier | null = null;
  let nth: number | null = null;
  if (version && version.tiers.length && covers(version, input.day)) {
    nth = typeof input.nth === 'number' ? input.nth : await input.nth();
    tier = tierFor(version.tiers, nth);
  }
  const prices = resolvePrices(version, tier, standard);
  return {
    prices,
    /** What a failed attempt costs: a fixed fee, or a share of the shipment charges */
    failed: failedDeliveryRule(version, tier, prices, await standardFailedPercent(db)),
    versionId: version?.id ?? null,
    contract: version ? contractVersionLabel(version.contract.number, version.version) : null,
    tierFrom: tier?.fromOrder ?? null,
    nth,
  };
}

/** Payouts wait until we owe the merchant at least this (the contract's, else the setting). */
export async function payoutMinimumFor(db: Db, merchantId: string, day: string) {
  const v = await versionInForce(db, merchantId, day);
  return v?.minimumPayoutPiastres ?? (await getSetting(db, 'finance.payout_minimum_piastres'));
}

/** Delivery attempts a merchant's order gets: the contract's, else the store's setting. */
export async function deliveryAttemptsFor(
  db: Db,
  input: { merchantId: string; darkStoreId: string; at: Date },
) {
  const v = await versionInForce(db, input.merchantId, cairoDay(input.at));
  return v?.deliveryAttempts ?? (await getSetting(db, 'delivery.max_attempts', input.darkStoreId));
}

// ─── the contract as people read it ──────────────────────────────────────────────

export type VersionDisplayStatus = 'draft' | 'in_force' | 'scheduled' | 'superseded' | 'ended';

/** One version as the screens and the printed contract show it. */
function versionView(
  v: VersionRow & { products?: VersionFullRow['products'] },
  inForceId: string | null,
  today: string,
) {
  const effective = v.effectiveFrom ? dayText(v.effectiveFrom) : null;
  const display: VersionDisplayStatus =
    v.status === 'draft'
      ? 'draft'
      : v.id === inForceId
        ? v.endDate && dayText(v.endDate) < today
          ? 'ended'
          : 'in_force'
        : effective && effective > today
          ? 'scheduled'
          : 'superseded';
  return {
    id: v.id,
    version: v.version,
    label: contractVersionLabel(v.contract.number, v.version),
    status: v.status,
    displayStatus: display,
    effectiveFrom: effective,
    prices: pricesOf(v),
    failedDeliveryPercentBp: v.failedDeliveryPercentBp,
    /** Price per delivered unit of each product, by SKU */
    productPrices: (v.products ?? []).map((p) => ({
      skuId: p.skuId,
      sku: p.sku.sku,
      titleEn: p.sku.titleEn,
      titleAr: p.sku.titleAr,
      pricePiastres: p.pricePiastres,
    })),
    tiers: tiersOf(v.tiers),
    /** Next day parcels (Shiply): null keeps the network's volume tier and settings */
    parcels: {
      discountBp: v.parcelDiscountBp,
      codFeeBp: v.parcelCodFeeBp,
      returnFeeBp: v.parcelReturnFeeBp,
      prices: v.parcelPrices.map((p) => ({
        zoneCode: p.zoneCode,
        size: p.size,
        pricePiastres: p.pricePiastres,
      })),
    },
    payoutSchedule: v.payoutSchedule as PayoutScheduleName | null,
    minimumPayoutPiastres: v.minimumPayoutPiastres,
    minimumMonthlyFeePiastres: v.minimumMonthlyFeePiastres,
    securityDepositPiastres: v.securityDepositPiastres,
    creditLimitPiastres: v.creditLimitPiastres,
    promiseMinutes: v.promiseMinutes,
    deliveryAttempts: v.deliveryAttempts,
    storeIds: v.storeIds,
    coverageNote: v.coverageNote,
    terms: v.terms,
    internalNote: v.internalNote,
    startDate: dayText(v.startDate),
    endDate: v.endDate ? dayText(v.endDate) : null,
    noticeDays: v.noticeDays,
    /** The last day to give notice to end it on its end date */
    noticeBy: v.endDate ? addDays(dayText(v.endDate), negate(v.noticeDays)) : null,
    source: v.source,
    createdAt: v.createdAt,
    createdBy: v.createdBy?.name ?? null,
    activatedAt: v.activatedAt,
    activatedBy: v.activatedBy?.name ?? null,
  };
}
export type ContractVersionView = ReturnType<typeof versionView>;

/** The security deposit we hold for a merchant. */
export async function depositHeld(db: Db, merchantId: string) {
  return negate(await balanceOf(db, { type: 'merchant_deposit', merchantId }));
}

/**
 * A merchant's contract: the version in force today, one waiting to take effect, the draft,
 * every version, the signed files, the standard prices beside them, and where the month and
 * the merchant's balance stand.
 */
export async function getContract(db: Db, merchantId: string, now: Date = new Date()) {
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: {
      id: true,
      name: true,
      legalName: true,
      taxRegistrationNumber: true,
      contactEmail: true,
      contactPhone: true,
      payoutSchedule: true,
      bankName: true,
      bankAccountNumber: true,
      iban: true,
      beneficiaryName: true,
    },
  });
  if (!merchant) throw new DomainError('merchant_not_found', 404);
  const today = cairoDay(now);
  const contract = await db.merchantContract.findUnique({
    where: { merchantId },
    include: {
      versions: { include: versionFullInclude, orderBy: { version: 'desc' } },
      files: {
        select: {
          id: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          versionId: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
          version: { select: { version: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  const inForce = await versionInForce(db, merchantId, today);
  const views = (contract?.versions ?? []).map((v) => versionView(v, inForce?.id ?? null, today));
  const current = views.find((v) => v.id === inForce?.id) ?? null;
  const scheduled = views.filter((v) => v.displayStatus === 'scheduled');
  const delivered = await deliveredInMonth(db, merchantId, now);
  const owed = await merchantOwed(db, merchantId);
  const tier =
    inForce && covers(inForce, today) ? tierFor(tiersOf(inForce.tiers), delivered + 1) : null;
  const stores = await db.darkStore.findMany({
    where: { kind: 'dark_store' },
    select: { id: true, code: true, nameEn: true, nameAr: true },
    orderBy: { code: 'asc' },
  });
  const creditLimit = inForce?.creditLimitPiastres ?? null;
  return {
    merchant: {
      id: merchant.id,
      name: merchant.name,
      legalName: merchant.legalName,
      taxRegistrationNumber: merchant.taxRegistrationNumber,
      contactEmail: merchant.contactEmail,
      contactPhone: merchant.contactPhone,
      payoutSchedule: merchant.payoutSchedule as PayoutScheduleName,
      bank: {
        bankName: merchant.bankName,
        bankAccountNumber: merchant.bankAccountNumber,
        iban: merchant.iban,
        beneficiaryName: merchant.beneficiaryName,
      },
    },
    contract: contract
      ? { id: contract.id, number: contract.number, label: contractLabel(contract.number) }
      : null,
    current,
    /** Activated versions that take effect later (the latest is the next one) */
    scheduled: scheduled.sort((a, b) => (a.effectiveFrom! < b.effectiveFrom! ? -1 : 1)),
    draft: views.find((v) => v.status === 'draft') ?? null,
    versions: views,
    files: (contract?.files ?? []).map((f) => ({
      id: f.id,
      fileName: f.fileName,
      contentType: f.contentType,
      sizeBytes: f.sizeBytes,
      versionId: f.versionId,
      version: f.version?.version ?? null,
      uploadedBy: f.uploadedBy?.name ?? null,
      createdAt: f.createdAt,
    })),
    standard: await standardPrices(db),
    /** A failed attempt's share of the shipment charges, for contracts with a shipping fee */
    standardFailedPercentBp: await standardFailedPercent(db),
    vatBp: await getSetting(db, 'fee.vat_bp'),
    /** The merchant's products, for per product prices and the calculator */
    products: await db.sku.findMany({
      where: { merchantId },
      select: {
        id: true,
        sku: true,
        titleEn: true,
        titleAr: true,
        pricePiastres: true,
        isActive: true,
      },
      orderBy: { sku: 'asc' },
      take: 5000,
    }),
    /** Shiply's price zones with their list prices, for the next day terms */
    parcelZones: await db.pricingZone.findMany({
      select: {
        code: true,
        name: true,
        priceS: true,
        priceM: true,
        priceL: true,
        priceXL: true,
        priceXXL: true,
        priceBulky: true,
      },
      orderBy: { code: 'asc' },
    }),
    standardTerms: {
      minimumPayoutPiastres: await getSetting(db, 'finance.payout_minimum_piastres'),
      deliveryAttempts: await getSetting(db, 'delivery.max_attempts'),
      promiseMinutes: await getSetting(db, 'sla.promise_minutes'),
    },
    stores,
    deliveredThisMonth: delivered,
    /** The band the next delivered order falls in */
    nextOrderTier: tier,
    depositHeldPiastres: await depositHeld(db, merchantId),
    owedPiastres: owed,
    overCreditLimit: creditLimit != null && owed < negate(creditLimit),
    /** The merchant chose another payout schedule than the one agreed */
    scheduleDiffers:
      current?.payoutSchedule != null && current.payoutSchedule !== merchant.payoutSchedule,
  };
}
export type ContractOverview = Awaited<ReturnType<typeof getContract>>;

/** The same view without what stays with Shiply (internal notes, drafts, who did what). */
export function merchantContractView(view: ContractOverview) {
  const strip = <T extends ContractVersionView | null>(v: T): T =>
    (v ? { ...v, internalNote: null, createdBy: null, activatedBy: null } : v) as T;
  return {
    ...view,
    current: strip(view.current),
    scheduled: view.scheduled.map(strip),
    draft: null,
    versions: view.versions.filter((v) => v.status !== 'draft').map(strip),
    files: [],
    owedPiastres: null,
  };
}

/** One version (or the one in force today) with what the printed contract needs. */
export async function contractForPrint(
  db: Db,
  input: { merchantId: string; versionId?: string | null; now?: Date; merchantCopy?: boolean },
) {
  const view = await getContract(db, input.merchantId, input.now);
  const version = input.versionId
    ? view.versions.find((v) => v.id === input.versionId)
    : (view.current ?? view.scheduled[0]);
  if (!version || !view.contract) throw new DomainError('contract_version_not_found', 404);
  if (input.merchantCopy && version.status === 'draft')
    throw new DomainError('contract_version_not_found', 404);
  const company = await db.companyProfile.upsert({
    where: { id: 'company' },
    create: {},
    update: {},
  });
  const merchant = await db.merchant.findUniqueOrThrow({
    where: { id: input.merchantId },
    select: {
      name: true,
      legalName: true,
      taxRegistrationNumber: true,
      taxGovernorate: true,
      taxRegionCity: true,
      taxStreet: true,
      taxBuildingNumber: true,
      contactEmail: true,
      contactPhone: true,
    },
  });
  return {
    contract: view.contract,
    version: input.merchantCopy ? { ...version, internalNote: null } : version,
    merchant: { ...merchant, bank: view.merchant.bank },
    company: {
      legalNameEn: company.legalNameEn,
      legalNameAr: company.legalNameAr,
      taxRegistrationNumber: company.taxRegistrationNumber,
      address: [company.buildingNumber, company.street, company.regionCity, company.governorate]
        .filter(Boolean)
        .join(', '),
    },
    standard: view.standard,
    standardFailedPercentBp: view.standardFailedPercentBp,
    standardTerms: view.standardTerms,
    vatBp: view.vatBp,
    stores: view.stores.filter((s) => version.storeIds.includes(s.id)),
  };
}
export type ContractPrint = Awaited<ReturnType<typeof contractForPrint>>;

// ─── writing versions ────────────────────────────────────────────────────────────

/** The columns of a version from what merchants manage typed. */
function versionData(body: ContractVersionBody) {
  const prices = {} as ContractPriceValues;
  for (const k of CONTRACT_PRICE_KEYS) prices[k] = body[k] ?? null;
  return {
    ...prices,
    failedDeliveryPercentBp: body.failedDeliveryPercentBp ?? null,
    parcelDiscountBp: body.parcelDiscountBp ?? null,
    parcelCodFeeBp: body.parcelCodFeeBp ?? null,
    parcelReturnFeeBp: body.parcelReturnFeeBp ?? null,
    payoutSchedule: body.payoutSchedule,
    minimumPayoutPiastres: body.minimumPayoutPiastres,
    minimumMonthlyFeePiastres: body.minimumMonthlyFeePiastres,
    securityDepositPiastres: body.securityDepositPiastres,
    creditLimitPiastres: body.creditLimitPiastres,
    promiseMinutes: body.promiseMinutes,
    deliveryAttempts: body.deliveryAttempts,
    storeIds: [...new Set(body.storeIds)],
    coverageNote: body.coverageNote ?? null,
    terms: body.terms ?? null,
    internalNote: body.internalNote ?? null,
    startDate: dateOf(body.startDate),
    endDate: body.endDate ? dateOf(body.endDate) : null,
    noticeDays: body.noticeDays,
    effectiveFrom: body.effectiveFrom ? dateOf(body.effectiveFrom) : null,
  };
}

/** A version's terms in one flat object, for the audit log's before and after. */
function auditTerms(v: ContractVersionView) {
  const tiers = v.tiers
    .map(
      (t) =>
        `${t.fromOrder}+: ${CONTRACT_TIER_KEYS.filter((k) => t[k] !== null)
          .map((k) => `${k}=${t[k]}`)
          .join(' ')}`,
    )
    .join('; ');
  return {
    version: v.label,
    effectiveFrom: v.effectiveFrom,
    ...v.prices,
    failedDeliveryPercentBp: v.failedDeliveryPercentBp,
    productPrices: v.productPrices.map((p) => `${p.sku}=${p.pricePiastres}`).join('; '),
    parcels: `discount=${v.parcels.discountBp} cod=${v.parcels.codFeeBp} return=${v.parcels.returnFeeBp} ${v.parcels.prices
      .map((p) => `${p.zoneCode}/${p.size}=${p.pricePiastres}`)
      .join('; ')}`,
    tiers,
    payoutSchedule: v.payoutSchedule,
    minimumPayout: v.minimumPayoutPiastres,
    minimum: v.minimumMonthlyFeePiastres,
    deposit: v.securityDepositPiastres,
    creditLimit: v.creditLimitPiastres,
    promiseMinutes: v.promiseMinutes,
    deliveryAttempts: v.deliveryAttempts,
    storeIds: v.storeIds.join(','),
    startDate: v.startDate,
    endDate: v.endDate,
    noticeDays: v.noticeDays,
    terms: v.terms,
  };
}

async function loadVersion(db: Db, merchantId: string, versionId: string) {
  const v = await db.merchantContractVersion.findUnique({
    where: { id: versionId },
    include: versionFullInclude,
  });
  if (!v || v.contract.merchantId !== merchantId)
    throw new DomainError('contract_version_not_found', 404);
  return v;
}

/** Product prices only for the merchant's own products. */
async function checkProducts(tx: Tx, merchantId: string, body: ContractVersionBody) {
  const rows = body.productPrices ?? [];
  const ids = [...new Set(rows.map((p) => p.skuId))];
  if (!ids.length) return [];
  const found = await tx.sku.count({ where: { id: { in: ids }, merchantId } });
  if (found !== ids.length) throw new DomainError('product_not_found', 400);
  return rows.map((p) => ({ skuId: p.skuId, pricePiastres: p.pricePiastres }));
}

/** Next day prices only for zones the network has. */
async function checkParcelPrices(tx: Tx, body: ContractVersionBody) {
  const rows = body.parcelPrices ?? [];
  const zones = [...new Set(rows.map((p) => p.zoneCode))];
  if (!zones.length) return [];
  const found = await tx.pricingZone.count({ where: { code: { in: zones } } });
  if (found !== zones.length) throw new DomainError('zone_not_found', 400);
  return rows.map((p) => ({ zoneCode: p.zoneCode, size: p.size, pricePiastres: p.pricePiastres }));
}

/**
 * A merchant's next day terms on a Cairo day (Shiply): the version in force, field by field;
 * null keeps the network's standard (volume tier, cash collection and return fee settings).
 */
export async function parcelTermsAt(db: Db, merchantId: string, day: string) {
  const v = await versionInForce(db, merchantId, day);
  const on = v && covers(v, day) ? v : null;
  return {
    version: on ? contractVersionLabel(on.contract.number, on.version) : null,
    discountBp: on?.parcelDiscountBp ?? null,
    codFeeBp: on?.parcelCodFeeBp ?? null,
    returnFeeBp: on?.parcelReturnFeeBp ?? null,
    /** The fixed price of a zone and size, or null for the list price */
    priceOf(zoneCode: string, size: string) {
      return (
        on?.parcelPrices.find((p) => p.zoneCode === zoneCode && p.size === size)?.pricePiastres ??
        null
      );
    },
  };
}

async function lockMerchant(tx: Tx, merchantId: string) {
  await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
  const merchant = await tx.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new DomainError('merchant_not_found', 404);
  return merchant;
}

/**
 * A new draft version (merchants manage). The merchant's contract is opened (CTR-, gapless)
 * with its first draft. One draft at a time; an idempotency key makes a repeat return it.
 */
export function createContractDraft(
  db: Db,
  input: {
    merchantId: string;
    body: ContractVersionBody;
    actorUserId: string;
    idempotencyKey?: string;
    source?: string | null;
  },
) {
  return inTransaction(db, async (tx) => {
    if (input.idempotencyKey) {
      const seen = await tx.merchantContractVersion.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { contract: true },
      });
      if (seen) {
        if (seen.contract.merchantId !== input.merchantId)
          throw new DomainError('idempotency_key_reused');
        return seen;
      }
    }
    await lockMerchant(tx, input.merchantId);
    let contract = await tx.merchantContract.findUnique({
      where: { merchantId: input.merchantId },
    });
    if (!contract) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('number:merchant_contracts'))`;
      const [{ max }] = (await tx.$queryRaw<{ max: number | null }[]>`
        SELECT MAX("number") AS max FROM merchant_contracts`) as [{ max: number | null }];
      contract = await tx.merchantContract.create({
        data: {
          merchantId: input.merchantId,
          number: (max ?? 0) + 1,
          createdById: input.actorUserId,
        },
      });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'merchant.contract_create',
        entityType: 'merchant_contract',
        entityId: input.merchantId,
        after: { contract: contractLabel(contract.number) },
      });
    }
    const draft = await tx.merchantContractVersion.findFirst({
      where: { contractId: contract.id, status: 'draft' },
    });
    if (draft) throw new DomainError('contract_draft_exists', 409, { versionId: draft.id });
    const products = await checkProducts(tx, input.merchantId, input.body);
    const last = await tx.merchantContractVersion.aggregate({
      where: { contractId: contract.id },
      _max: { version: true },
    });
    const created = await tx.merchantContractVersion.create({
      data: {
        contractId: contract.id,
        version: (last._max.version ?? 0) + 1,
        status: 'draft',
        ...versionData(input.body),
        source: input.source ?? null,
        createdById: input.actorUserId,
        idempotencyKey: input.idempotencyKey ?? null,
        tiers: { create: tiersOf(input.body.tiers) },
        products: { create: products },
        parcelPrices: { create: await checkParcelPrices(tx, input.body) },
      },
      include: versionFullInclude,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant.contract_draft',
      entityType: 'merchant_contract',
      entityId: input.merchantId,
      after: auditTerms(versionView(created, null, cairoDay(new Date()))),
    });
    return created;
  });
}

/** Changes a draft (merchants manage). Activated versions never change. */
export function updateContractDraft(
  db: Db,
  input: { merchantId: string; versionId: string; body: ContractVersionBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    await lockMerchant(tx, input.merchantId);
    const before = await loadVersion(tx, input.merchantId, input.versionId);
    if (before.status !== 'draft') throw new DomainError('contract_version_not_draft');
    const products = await checkProducts(tx, input.merchantId, input.body);
    await tx.merchantContractVersionTier.deleteMany({ where: { versionId: before.id } });
    await tx.merchantContractVersionProduct.deleteMany({ where: { versionId: before.id } });
    await tx.merchantContractVersionParcelPrice.deleteMany({ where: { versionId: before.id } });
    const after = await tx.merchantContractVersion.update({
      where: { id: before.id },
      data: {
        ...versionData(input.body),
        tiers: { create: tiersOf(input.body.tiers) },
        products: { create: products },
        parcelPrices: { create: await checkParcelPrices(tx, input.body) },
      },
      include: versionFullInclude,
    });
    const today = cairoDay(new Date());
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant.contract_draft_update',
      entityType: 'merchant_contract',
      entityId: input.merchantId,
      before: auditTerms(versionView(before, null, today)),
      after: auditTerms(versionView(after, null, today)),
    });
    return after;
  });
}

/** Throws a draft away (merchants manage). */
export function deleteContractDraft(
  db: Db,
  input: { merchantId: string; versionId: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    await lockMerchant(tx, input.merchantId);
    const v = await loadVersion(tx, input.merchantId, input.versionId);
    if (v.status !== 'draft') throw new DomainError('contract_version_not_draft');
    await tx.merchantContractFile.updateMany({
      where: { versionId: v.id },
      data: { versionId: null },
    });
    await tx.merchantContractVersion.delete({ where: { id: v.id } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant.contract_draft_delete',
      entityType: 'merchant_contract',
      entityId: input.merchantId,
      before: auditTerms(versionView(v, null, cairoDay(new Date()))),
    });
    return { deleted: true };
  });
}

/** Sets the agreed payout schedule on the merchant (audited), once per version. */
async function applySchedule(
  tx: Tx,
  v: { id: string; payoutSchedule: PayoutScheduleName | null; label: string },
  merchantId: string,
  actorUserId: string | null,
  now: Date,
) {
  if (!v.payoutSchedule) return;
  const merchant = await tx.merchant.findUniqueOrThrow({ where: { id: merchantId } });
  await tx.merchantContractVersion.update({
    where: { id: v.id },
    data: { scheduleAppliedAt: now },
  });
  if (merchant.payoutSchedule === v.payoutSchedule) return;
  await tx.merchant.update({
    where: { id: merchantId },
    data: { payoutSchedule: v.payoutSchedule },
  });
  await recordAudit(tx, {
    actorUserId,
    action: 'finance.payout_schedule',
    entityType: 'merchant',
    entityId: merchantId,
    before: { payoutSchedule: merchant.payoutSchedule },
    after: { payoutSchedule: v.payoutSchedule, contract: v.label },
  });
}

/**
 * Activates a draft from a Cairo day: today or later, never before the last activated
 * version's day, never inside closed books. The version before it is superseded. Taking effect
 * today sets the agreed payout schedule at once; a later day leaves it to the daily job.
 */
export function activateContractVersion(
  db: Db,
  input: {
    merchantId: string;
    versionId: string;
    effectiveFrom: string;
    actorUserId: string;
    now?: Date;
    /** The migration and tests only: allow a day before today */
    allowPast?: boolean;
  },
) {
  const now = input.now ?? new Date();
  const today = cairoDay(now);
  return inTransaction(db, async (tx) => {
    await lockMerchant(tx, input.merchantId);
    const v = await loadVersion(tx, input.merchantId, input.versionId);
    if (v.status !== 'draft') throw new DomainError('contract_version_not_draft');
    if (!input.allowPast && input.effectiveFrom < today)
      throw new DomainError('effective_before_today', 400);
    const last = await tx.merchantContractVersion.findFirst({
      where: { contractId: v.contractId, status: { in: ['active', 'superseded'] } },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    if (last?.effectiveFrom && input.effectiveFrom < dayText(last.effectiveFrom))
      throw new DomainError('effective_before_last_version', 409, {
        lastEffectiveFrom: dayText(last.effectiveFrom),
      });
    const lock = await tx.booksLock.findUnique({ where: { id: 'books' } });
    if (lock && cairoDayStart(input.effectiveFrom) < lock.lockedBefore)
      throw new DomainError('books_closed');
    if (v.endDate && dayText(v.endDate) < input.effectiveFrom)
      throw new DomainError('effective_after_end', 400);
    const inForceNow = await versionInForce(tx, input.merchantId, today);
    const inForceBefore = inForceNow
      ? await loadVersion(tx, input.merchantId, inForceNow.id)
      : null;
    const activated = await tx.merchantContractVersion.update({
      where: { id: v.id },
      data: {
        status: 'active',
        effectiveFrom: dateOf(input.effectiveFrom),
        activatedById: input.actorUserId,
        activatedAt: now,
      },
      include: versionFullInclude,
    });
    await tx.merchantContractVersion.updateMany({
      where: { contractId: v.contractId, status: 'active', id: { not: v.id } },
      data: { status: 'superseded', supersededAt: now },
    });
    const view = versionView(activated, null, today);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant.contract_activate',
      entityType: 'merchant_contract',
      entityId: input.merchantId,
      before: inForceBefore ? auditTerms(versionView(inForceBefore, null, today)) : null,
      after: auditTerms(view),
    });
    if (input.effectiveFrom <= today)
      await applySchedule(tx, view, input.merchantId, input.actorUserId, now);
    return activated;
  });
}

/**
 * Sets the agreed payout schedule of every version that took effect since (daily job). Each
 * version does it once; the merchant may change it afterwards (the contract flags it).
 */
export async function applyContractSchedules(db: Db, now: Date = new Date()) {
  const today = cairoDay(now);
  const waiting = await db.merchantContractVersion.findMany({
    where: {
      status: 'active',
      scheduleAppliedAt: null,
      payoutSchedule: { not: null },
      effectiveFrom: { lte: dateOf(today) },
    },
    include: versionInclude,
  });
  let applied = 0;
  for (const v of waiting)
    await inTransaction(db, async (tx) => {
      const inForce = await versionInForce(tx, v.contract.merchantId, today);
      if (inForce?.id !== v.id) return;
      await applySchedule(tx, versionView(v, v.id, today), v.contract.merchantId, null, now);
      applied++;
    });
  return { applied };
}

// ─── per product prices from a file ─────────────────────────────────────────────

export interface ProductPriceCheck {
  rows: {
    skuId: string;
    sku: string;
    titleEn: string;
    titleAr: string;
    pricePiastres: number;
  }[];
  errors: { row: number; sku?: string; error: string }[];
}

/**
 * Checks a product prices file (sku, price_egp) against the merchant's products: every row
 * must name one of the merchant's SKUs once with a price in pounds (two decimals at most,
 * turned into piastres without floats). All or nothing: with any error no row is returned,
 * every error is listed (row 2 is the first after the header). Nothing is saved here; the
 * editor puts the prices into the draft, which is saved as usual.
 */
export async function checkProductPriceRows(
  db: Db,
  merchantId: string,
  raw: readonly Record<string, unknown>[],
): Promise<ProductPriceCheck> {
  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new DomainError('merchant_not_found', 404);
  const products = await db.sku.findMany({
    where: { merchantId },
    select: { id: true, sku: true, titleEn: true, titleAr: true },
  });
  const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
  const errors: ProductPriceCheck['errors'] = [];
  const rows: ProductPriceCheck['rows'] = [];
  const seen = new Set<string>();
  raw.forEach((input, index) => {
    const row = index + 2;
    // A SKU written to our files as '-ABC (so Excel never runs it) reads back as -ABC.
    const r =
      typeof input.sku === 'string'
        ? { ...input, sku: input.sku.trim().replace(/^'(?=[=+\-@])/, '') }
        : input;
    const parsed = contractProductPriceRowSchema.safeParse(r);
    const skuText = typeof r.sku === 'string' ? r.sku.trim() : undefined;
    if (!parsed.success) {
      errors.push({ row, sku: skuText, error: parsed.error.issues[0]?.message ?? 'invalid_row' });
      return;
    }
    const key = parsed.data.sku.toLowerCase();
    const product = bySku.get(key);
    if (!product) return void errors.push({ row, sku: parsed.data.sku, error: 'unknown_sku' });
    if (seen.has(key))
      return void errors.push({ row, sku: parsed.data.sku, error: 'duplicate_sku_in_file' });
    seen.add(key);
    rows.push({
      skuId: product.id,
      sku: product.sku,
      titleEn: product.titleEn,
      titleAr: product.titleAr,
      pricePiastres: parsed.data.price_egp,
    });
  });
  return errors.length ? { rows: [], errors } : { rows, errors };
}

/** A version's product prices, by SKU, for the file people download (sku, price_egp...). */
export async function versionProductPrices(db: Db, merchantId: string, versionId: string) {
  const v = await loadVersion(db, merchantId, versionId);
  return {
    label: contractVersionLabel(v.contract.number, v.version),
    rows: v.products.map((p) => ({
      sku: p.sku.sku,
      titleEn: p.sku.titleEn,
      titleAr: p.sku.titleAr,
      pricePiastres: p.pricePiastres,
    })),
  };
}

// ─── signed files ────────────────────────────────────────────────────────────────

/** Attaches a signed contract file (PDF, JPG or PNG, at most 5 MB); audited. */
export async function addContractFile(
  db: Db,
  input: {
    merchantId: string;
    versionId?: string | null;
    fileName: string;
    contentType: string;
    data: Buffer;
    actorUserId: string;
  },
) {
  if (!(CONTRACT_FILE_TYPES as readonly string[]).includes(input.contentType))
    throw new DomainError('file_type_not_allowed', 400);
  if (!input.data.length || input.data.length > CONTRACT_FILE_MAX_BYTES)
    throw new DomainError('file_too_large', 400);
  if (!looksLike(input.contentType, input.data))
    throw new DomainError('file_type_not_allowed', 400);
  return inTransaction(db, async (tx) => {
    const contract = await tx.merchantContract.findUnique({
      where: { merchantId: input.merchantId },
    });
    if (!contract) throw new DomainError('contract_not_found', 404);
    if (input.versionId) await loadVersion(tx, input.merchantId, input.versionId);
    const file = await tx.merchantContractFile.create({
      data: {
        contractId: contract.id,
        versionId: input.versionId ?? null,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.data.length,
        data: new Uint8Array(input.data),
        uploadedById: input.actorUserId,
      },
      select: { id: true, fileName: true, sizeBytes: true },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant.contract_file_add',
      entityType: 'merchant_contract',
      entityId: input.merchantId,
      after: { file: file.fileName, bytes: file.sizeBytes, versionId: input.versionId ?? null },
    });
    return file;
  });
}

export async function getContractFile(db: Db, merchantId: string, fileId: string) {
  const file = await db.merchantContractFile.findUnique({
    where: { id: fileId },
    include: { contract: { select: { merchantId: true } } },
  });
  if (!file || file.contract.merchantId !== merchantId)
    throw new DomainError('contract_file_not_found', 404);
  return file;
}

/** Removes a file attached by mistake (merchants manage); audited. */
export function deleteContractFile(
  db: Db,
  input: { merchantId: string; fileId: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const file = await getContractFile(tx, input.merchantId, input.fileId);
    await tx.merchantContractFile.delete({ where: { id: file.id } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant.contract_file_delete',
      entityType: 'merchant_contract',
      entityId: input.merchantId,
      before: { file: file.fileName, bytes: file.sizeBytes },
    });
    return { deleted: true };
  });
}

/** Every merchant contract with the version in force, what we hold and owe, for Accounting. */
export async function listContracts(db: Db, now: Date = new Date()) {
  const rows = await db.merchantContract.findMany({
    include: { merchant: { select: { id: true, name: true } } },
    orderBy: { merchant: { name: 'asc' } },
  });
  const today = cairoDay(now);
  const result = [];
  for (const c of rows) {
    const v = await versionInForce(db, c.merchantId, today);
    const draft = await db.merchantContractVersion.count({
      where: { contractId: c.id, status: 'draft' },
    });
    const owed = await merchantOwed(db, c.merchantId);
    const limit = v?.creditLimitPiastres ?? null;
    result.push({
      merchant: c.merchant,
      contract: contractLabel(c.number),
      version: v ? contractVersionLabel(c.number, v.version) : null,
      effectiveFrom: v?.effectiveFrom ? dayText(v.effectiveFrom) : null,
      startDate: v ? dayText(v.startDate) : null,
      endDate: v?.endDate ? dayText(v.endDate) : null,
      noticeBy: v?.endDate ? addDays(dayText(v.endDate), negate(v.noticeDays)) : null,
      inForce: !!v && covers(v, today),
      hasDraft: draft > 0,
      tiers: v?.tiers.length ?? 0,
      ownPrices: v ? CONTRACT_PRICE_KEYS.filter((k) => v[k] !== null).length : 0,
      shippingFeePiastres: v?.shippingFeePiastres ?? null,
      productPrices: v
        ? await db.merchantContractVersionProduct.count({ where: { versionId: v.id } })
        : 0,

      minimumMonthlyFeePiastres: v?.minimumMonthlyFeePiastres ?? null,
      securityDepositPiastres: v?.securityDepositPiastres ?? null,
      depositHeldPiastres: await depositHeld(db, c.merchantId),
      creditLimitPiastres: limit,
      owedPiastres: owed,
      overCreditLimit: limit != null && owed < negate(limit),
    });
  }
  return result;
}

// ─── monthly minimum ─────────────────────────────────────────────────────────────

/**
 * A merchant's minimum for a month: each day counts the minimum of the version in force that
 * day when its dates cover it, shared out by the days of the month.
 */
export async function minimumForMonth(db: Db, merchantId: string, month: string) {
  const first = `${month}-01`;
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  const daysInMonth = Number(last.slice(8, 10));
  let sum = 0;
  let days = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const v = await versionInForce(db, merchantId, d);
    if (!v || !v.minimumMonthlyFeePiastres || !covers(v, d)) continue;
    sum += v.minimumMonthlyFeePiastres;
    days++;
  }
  return { minimum: days ? Math.round(sum / daysInMonth) : 0, days, daysInMonth };
}

/**
 * Tops up last month's fees to the contract's minimum, once per merchant and month. Each day
 * counts the minimum of the version in force that day when its dates cover it (a minimum is
 * shared out by days); fees counted are every fee booked to the merchant for the month (before
 * VAT). A month inside closed books is skipped. On the first day after the month, the last
 * day's storage is charged first.
 */
export async function chargeMinimumFees(db: Db, now: Date = new Date()) {
  const today = cairoDay(now);
  const month = addMonths(today.slice(0, 7), -1);
  const last = addDays(`${today.slice(0, 7)}-01`, -1);
  if (lastClosedDay(now) === last) await accrueStorage(db, last);
  const from = monthStart(month);
  const to = cairoDayStart(addDays(last, 1));
  const contracts = await db.merchantContract.findMany({
    where: {
      versions: {
        some: {
          status: { in: ['active', 'superseded'] },
          minimumMonthlyFeePiastres: { gt: 0 },
          effectiveFrom: { lte: dateOf(last) },
        },
      },
    },
  });
  let charged = 0;
  for (const c of contracts) {
    const { minimum, days, daysInMonth } = await minimumForMonth(db, c.merchantId, month);
    if (days === 0) continue;
    const fees = await feesBooked(db, c.merchantId, from, to);
    const topUp = minimum - fees;
    if (topUp <= 0) continue;
    const key = `minimum_fee:${c.merchantId}:${month}`;
    if (await db.ledgerEntry.findUnique({ where: { idempotencyKey: key } })) continue;
    const lock = await db.booksLock.findUnique({ where: { id: 'books' } });
    const at = new Date(to.getTime() - 1);
    if (lock && at < lock.lockedBefore) continue;
    const vat = share(topUp, await getSetting(db, 'fee.vat_bp'));
    await post(db, {
      kind: 'minimum_fee',
      idempotencyKey: key,
      occurredAt: at,
      memo: `Minimum ${month}`,
      merchantId: c.merchantId,
      data: { month, minimumPiastres: minimum, feesPiastres: fees, days, daysInMonth },
      lines: [
        { account: { type: 'merchant', merchantId: c.merchantId }, amount: topUp + vat },
        { account: { type: 'revenue' }, amount: negate(topUp) },
        { account: { type: 'vat_payable' }, amount: negate(vat) },
      ],
    });
    charged++;
  }
  return { month, charged };
}

/** Fees (fee income, before VAT) booked to a merchant between two moments, minimum excluded. */
async function feesBooked(db: Db, merchantId: string, from: Date, to: Date) {
  const rows = await db.$queryRaw<{ fees: bigint | null }[]>`
    SELECT -SUM(l.amount_piastres) AS fees FROM ledger_lines l
      JOIN ledger_accounts a ON a.id = l.account_id
      JOIN ledger_entries e ON e.id = l.entry_id
    WHERE a.type = 'revenue' AND l.merchant_id = ${merchantId}
      AND l.occurred_at >= ${from} AND l.occurred_at < ${to} AND e.kind <> 'minimum_fee'`;
  return Number(rows[0]?.fees ?? 0);
}

// ─── credit limit ────────────────────────────────────────────────────────────────

/**
 * Refuses new shipments while the merchant owes us more than the contract's credit limit,
 * raising one alert a day. Call it before the shipment's own transaction so the alert stays.
 */
export async function assertWithinCreditLimit(db: Db, merchantId: string, now: Date = new Date()) {
  const version = await versionInForce(db, merchantId, cairoDay(now));
  const limit = version?.creditLimitPiastres ?? null;
  if (limit == null) return;
  const owed = await merchantOwed(db, merchantId);
  if (owed >= negate(limit)) return;
  const merchant = await db.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { name: true },
  });
  await db.alert.createMany({
    data: [
      {
        type: 'merchant_over_credit_limit',
        key: `credit_limit:${merchantId}:${cairoDay(now)}`,
        merchantId,
        data: {
          name: merchant.name,
          owes: egpText(negate(owed)),
          limit: egpText(limit),
        },
      },
    ],
    skipDuplicates: true,
  });
  throw new DomainError('merchant_over_credit_limit', 409, {
    owesPiastres: negate(owed),
    limitPiastres: limit,
  });
}

// ─── security deposit ────────────────────────────────────────────────────────────

export interface DepositInput {
  merchantId: string;
  direction: 'in' | 'out';
  via: 'bank' | 'wallet';
  amountPiastres: number;
  bankAccountId?: string;
  reference: string;
  day?: string;
  actorUserId: string;
  idempotencyKey: string;
}

/**
 * A security deposit received or paid back. By bank, the money comes in or leaves our bank;
 * through the wallet it is taken from (or added to) what we owe the merchant. Never more is
 * paid back than we hold, nor taken from a wallet that does not hold it.
 */
export function recordDeposit(db: Db, input: DepositInput) {
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const key = `deposit:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${input.merchantId} FOR UPDATE`;
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const amount = input.amountPiastres;
    const deposit = { type: 'merchant_deposit' as const, merchantId: merchant.id };
    const wallet = { type: 'merchant' as const, merchantId: merchant.id };
    const other = input.via === 'bank' ? await bankAccount(tx, input.bankAccountId) : wallet;
    if (input.direction === 'out') {
      if (amount > (await depositHeld(tx, merchant.id))) throw new DomainError('more_than_deposit');
      if (input.via === 'bank' && amount > (await balanceOf(tx, other)))
        throw new DomainError('not_enough_money');
    } else if (input.via === 'wallet' && amount > (await merchantOwed(tx, merchant.id)))
      throw new DomainError('more_than_owed');
    const entry = (await post(tx, {
      kind: input.direction === 'in' ? 'deposit_received' : 'deposit_refunded',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.reference,
      merchantId: merchant.id,
      data: { via: input.via, reference: input.reference },
      lines:
        input.direction === 'in'
          ? [
              { account: other, amount },
              { account: deposit, amount: negate(amount) },
            ]
          : [
              { account: deposit, amount },
              { account: other, amount: negate(amount) },
            ],
    }))!;
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: input.direction === 'in' ? 'finance.deposit_in' : 'finance.deposit_out',
      entityType: 'merchant',
      entityId: merchant.id,
      after: { amount, via: input.via, reference: input.reference, entry: entry.number },
    });
    return entry;
  });
}

/**
 * Deposit received or paid back through the second person rule: money in (and any change to
 * the merchant's balance) always waits while finance.approve_money_in is on; a refund by bank
 * waits from the approval limit.
 */
export function submitDeposit(
  db: Db,
  input: DepositBody & { merchantId: string; actorUserId: string },
) {
  const { actorUserId, receiptPhotoId, ...rest } = input;
  return submitMovement(
    db,
    { kind: input.direction === 'in' ? 'deposit_in' : 'deposit_out', input: rest },
    actorUserId,
    receiptPhotoId,
  );
}
