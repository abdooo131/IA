import {
  addDays,
  allInclusivePrices,
  cairoDay,
  cairoDayStart,
  contractVersionSchema,
  JOB_ROLE_TEMPLATES,
  type ContractVersionInput,
  makeTier,
} from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { changeSetting, createUser } from '../src/admin-ops';
import { writeAccess } from '../src/access';
import { createDeal, crmActor } from '../src/crm';
import {
  acceptProposal,
  confirmProposal,
  createProposal,
  sendProposal,
} from '../src/crm-proposals';
import {
  activateContractVersion,
  addMonths,
  checkProductPriceRows,
  contractForPrint,
  createContractDraft,
  ensureDefaultAccounts,
  etaReadiness,
  getContract,
  getInvoice,
  listInvoices,
  merchantProfitability,
  merchantStatement,
  prepareInvoices,
  updateCompanyProfile,
  updateContractDraft,
} from '../src/finance';
import { getOrderMoney } from '../src/order-extras';
import {
  acceptOrder,
  completeDelivery,
  createOrder,
  failDelivery,
  handToRider,
  markItemMissing,
  packOrder,
  pickOrderItem,
} from '../src/orders';
import { savePhoto } from '../src/photos';
import { receive } from '../src/stock';
import { createFixture, prisma, resetDatabase } from './helpers';

// Contract pricing (CLAUDE.md "Merchant contracts v2", contract pricing): the shipping fee per
// delivered order, per product prices, the packaging charge, the failed delivery share of the
// shipment charges, VAT on top, and the new fee kinds on invoices, statements and profit.

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let riderUserId: string;
let n = 0;
const key = () => `px-${++n}-${Math.random()}`;
const today = () => cairoDay(new Date());
const set = (k: Parameters<typeof changeSetting>[1]['key'], value: number) =>
  changeSetting(prisma, { key: k, scope: 'global', value, actorUserId: admin });

const EMPTY = {
  orderFixedPiastres: null,
  orderPercentBp: null,
  codPercentBp: null,
  failedDeliveryPiastres: null,
  receivingPerUnitPiastres: null,
  storagePerUnitMonthPiastres: null,
  returnPerUnitPiastres: null,
  payoutSchedule: null,
  minimumPayoutPiastres: null,
  promiseMinutes: null,
  deliveryAttempts: null,
  minimumMonthlyFeePiastres: null,
  securityDepositPiastres: null,
  creditLimitPiastres: null,
  noticeDays: 30,
  endDate: null,
  tiers: [],
};
const body = (over: Partial<ContractVersionInput> = {}) =>
  contractVersionSchema.parse({ ...EMPTY, startDate: addDays(today(), -90), ...over });

async function version(over: Partial<ContractVersionInput> = {}) {
  const draft = await createContractDraft(prisma, {
    merchantId: f.merchant.id,
    body: body(over),
    actorUserId: admin,
  });
  return activateContractVersion(prisma, {
    merchantId: f.merchant.id,
    versionId: draft.id,
    effectiveFrom: addDays(today(), -90),
    actorUserId: admin,
    allowPast: true,
  });
}

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  riderUserId = (
    await createUser(prisma, {
      email: 'r@t.eg',
      name: 'Rider',
      role: 'rider',
      password: 'long-password-1',
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
      actorUserId: admin,
    })
  ).id;
  await ensureDefaultAccounts(prisma);
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 50 });
  await receive(prisma, { skuId: f.sku2.id, binId: f.shelfA.id, quantity: 50 });
  for (const [k, v] of [
    ['fee.order_fixed_piastres', 2_000],
    ['fee.order_percent_bp', 100],
    ['fee.cod_percent_bp', 100],
    ['fee.failed_delivery_piastres', 1_500],
    ['fee.receiving_per_unit_piastres', 50],
    ['fee.storage_per_unit_month_piastres', 300],
    ['fee.return_per_unit_piastres', 200],
  ] as const)
    await set(k, v);
});

afterAll(() => prisma.$disconnect());

/**
 * One cash order up to the rider (SKU-1 and SKU-2, 10 EGP each). `missing` units of SKU-1 are
 * marked missing at pick (cancelled before delivery). Delivered unless `fail` is given.
 */
async function order(
  input: { qty1?: number; qty2?: number; missing?: number; fail?: boolean; zoneId?: string } = {},
) {
  const qty1 = input.qty1 ?? 1;
  const qty2 = input.qty2 ?? 0;
  const items = [{ skuId: f.sku.id, quantity: qty1 }];
  if (qty2) items.push({ skuId: f.sku2.id, quantity: qty2 });
  const created = await createOrder(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    source: 'manual',
    customerName: 'Customer',
    customerPhone: '01012345678',
    addressText: 'Somewhere in Cairo',
    paymentMethod: 'cod',
    deliveryFeePiastres: 0,
    items,
    actorUserId: admin,
  });
  if (input.zoneId)
    await prisma.order.update({ where: { id: created.id }, data: { zoneId: input.zoneId } });
  const ids = { orderId: created.id, darkStoreId: f.store.id, actorUserId: admin };
  await acceptOrder(prisma, ids);
  const missing = input.missing ?? 0;
  await pickOrderItem(prisma, {
    ...ids,
    skuId: f.sku.id,
    quantity: qty1 - missing,
    idempotencyKey: key(),
  });
  if (missing)
    await markItemMissing(prisma, {
      ...ids,
      skuId: f.sku.id,
      quantity: missing,
      idempotencyKey: key(),
    });
  if (qty2)
    await pickOrderItem(prisma, {
      ...ids,
      skuId: f.sku2.id,
      quantity: qty2,
      idempotencyKey: key(),
    });
  const photo = await savePhoto(prisma, {
    kind: 'pack',
    contentType: 'image/jpeg',
    data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    actorUserId: admin,
  });
  await packOrder(prisma, { ...ids, photoId: photo.id });
  await handToRider(prisma, { ...ids, badgeCode: 'RDR-1' });
  const full = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
  const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId: created.id } });
  if (input.fail)
    await failDelivery(prisma, {
      deliveryId: delivery.id,
      riderUserId,
      reason: 'other',
      note: 'Customer away',
    });
  else
    await completeDelivery(prisma, {
      deliveryId: delivery.id,
      riderUserId,
      otp: full.deliveryOtp,
      codCollectedPiastres: full.codAmountPiastres,
    });
  return full;
}

/** Fee income (before VAT) of each entry of a kind, oldest first. */
const fees = async (kind: string) =>
  (
    await prisma.ledgerEntry.findMany({
      where: { kind },
      orderBy: { number: 'asc' },
      include: { lines: { include: { account: true } } },
    })
  ).map((e) => -e.lines.find((l) => l.account.type === 'revenue')!.amountPiastres);

/** VAT of each entry of a kind, oldest first. */
const vats = async (kind: string) =>
  (
    await prisma.ledgerEntry.findMany({
      where: { kind },
      orderBy: { number: 'asc' },
      include: { lines: { include: { account: true } } },
    })
  ).map((e) => -(e.lines.find((l) => l.account.type === 'vat_payable')?.amountPiastres ?? 0));

describe('shipping fee', () => {
  it('is charged once per delivered order, with tiers like the other fees', async () => {
    await version({
      ...allInclusivePrices(12_000),
      tiers: [makeTier(3, { shippingFeePiastres: 10_000 })],
    });
    await order({ qty1: 2 });
    await order();
    await order();
    // The 3rd delivered order crosses into the band; earlier ones are never charged again.
    expect(await fees('shipping_fee')).toEqual([12_000, 12_000, 10_000]);
    // All inclusive: every other fee is an explicit 0, so nothing else is booked.
    for (const kind of ['order_fee', 'cod_fee', 'packaging_charge', 'product_handling'])
      expect(await fees(kind)).toEqual([]);
  });

  it("is the delivery zone's price when the contract has one (owner, 2026-11-08)", async () => {
    const zone = await prisma.zone.create({
      data: {
        darkStoreId: f.store.id,
        code: 'ZN1',
        nameEn: 'Zone one',
        nameAr: 'المنطقة الأولى',
        governorateId: 1,
      },
    });
    await version({
      shippingFeePiastres: 1_000,
      zonePrices: [{ zoneId: zone.id, pricePiastres: 2_500 }],
    });
    await order({ zoneId: zone.id });
    await order();
    // In the priced zone the zone's price; elsewhere the version's shipping fee.
    expect(await fees('shipping_fee')).toEqual([2_500, 1_000]);
  });

  it('tells an explicit 0 from empty (the standard price)', async () => {
    await set('fee.shipping_fee_piastres', 500);
    await version({ orderFixedPiastres: 0 });
    await order();
    // Empty shipping fee: the standard 5 EGP. Order fee fixed 0 (explicit) + 1% of 10 EGP.
    expect(await fees('shipping_fee')).toEqual([500]);
    expect(await fees('order_fee')).toEqual([10]);
    const draft = await createContractDraft(prisma, {
      merchantId: f.merchant.id,
      body: body({ shippingFeePiastres: 0, orderFixedPiastres: 0 }),
      actorUserId: admin,
    });
    await activateContractVersion(prisma, {
      merchantId: f.merchant.id,
      versionId: draft.id,
      effectiveFrom: today(),
      actorUserId: admin,
    });
    await order();
    expect(await fees('shipping_fee')).toEqual([500]);
  });
});

describe('per product prices', () => {
  it('sums the delivered units only, products without a price charge nothing', async () => {
    await version({
      shippingFeePiastres: 0,
      productPrices: [{ skuId: f.sku.id, pricePiastres: 300 }],
    });
    // 4 units of SKU-1 ordered, 1 missing at pick: 3 delivered at 3 EGP. SKU-2 has no price.
    await order({ qty1: 4, missing: 1, qty2: 2 });
    expect(await fees('product_handling')).toEqual([900]);
    const entry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { kind: 'product_handling' },
    });
    expect(entry.data).toEqual({ lines: [{ skuId: f.sku.id, units: 3, pricePiastres: 300 }] });
  });

  it('are versioned: frozen once active, copied into a new draft by the editor', async () => {
    const v1 = await version({ productPrices: [{ skuId: f.sku.id, pricePiastres: 300 }] });
    await expect(
      prisma.merchantContractVersionProduct.updateMany({
        where: { versionId: v1.id },
        data: { pricePiastres: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.merchantContractVersionProduct.create({
        data: { versionId: v1.id, skuId: f.sku2.id, pricePiastres: 1 },
      }),
    ).rejects.toThrow();
    const view = await getContract(prisma, f.merchant.id);
    expect(view.current?.productPrices).toEqual([
      {
        skuId: f.sku.id,
        sku: 'SKU-1',
        titleEn: expect.any(String),
        titleAr: expect.any(String),
        pricePiastres: 300,
      },
    ]);
    const draft = await createContractDraft(prisma, {
      merchantId: f.merchant.id,
      body: body({
        productPrices: [
          ...view.current!.productPrices.map((p) => ({
            skuId: p.skuId,
            pricePiastres: p.pricePiastres,
          })),
          { skuId: f.sku2.id, pricePiastres: 150 },
        ],
      }),
      actorUserId: admin,
    });
    await updateContractDraft(prisma, {
      merchantId: f.merchant.id,
      versionId: draft.id,
      body: body({ productPrices: [{ skuId: f.sku2.id, pricePiastres: 175 }] }),
      actorUserId: admin,
    });
    const after = await getContract(prisma, f.merchant.id);
    expect(after.draft?.productPrices.map((p) => [p.sku, p.pricePiastres])).toEqual([
      ['SKU-2', 175],
    ]);
    expect(after.current?.productPrices).toHaveLength(1);
    // Only the merchant's own products.
    const other = await prisma.merchant.create({ data: { name: 'Other' } });
    const foreign = await prisma.sku.create({
      data: { merchantId: other.id, sku: 'X-1', titleEn: 'X', titleAr: 'X', pricePiastres: 1 },
    });
    await expect(
      updateContractDraft(prisma, {
        merchantId: f.merchant.id,
        versionId: draft.id,
        body: body({ productPrices: [{ skuId: foreign.id, pricePiastres: 1 }] }),
        actorUserId: admin,
      }),
    ).rejects.toThrow('product_not_found');
    // The printed contract carries the table.
    const print = await contractForPrint(prisma, { merchantId: f.merchant.id });
    expect(print.version.productPrices).toHaveLength(1);
  });

  it('checks a prices file all or nothing, prices in pounds without floats', async () => {
    const good = await checkProductPriceRows(prisma, f.merchant.id, [
      { sku: 'SKU-1', price_egp: '12.5' },
      { sku: 'sku-2', price_egp: '1,200' },
    ]);
    expect(good.errors).toEqual([]);
    expect(good.rows.map((r) => [r.sku, r.pricePiastres])).toEqual([
      ['SKU-1', 1_250],
      ['SKU-2', 120_000],
    ]);
    const bad = await checkProductPriceRows(prisma, f.merchant.id, [
      { sku: 'SKU-1', price_egp: '0.1' },
      { sku: 'SKU-1', price_egp: '2' },
      { sku: 'NOPE', price_egp: '2' },
      { sku: 'SKU-2', price_egp: '1.234' },
      { sku: 'SKU-2', price_egp: '-3' },
    ]);
    expect(bad.rows).toEqual([]);
    expect(bad.errors).toEqual([
      { row: 3, sku: 'SKU-1', error: 'duplicate_sku_in_file' },
      { row: 4, sku: 'NOPE', error: 'unknown_sku' },
      { row: 5, sku: 'SKU-2', error: 'invalid_price' },
      { row: 6, sku: 'SKU-2', error: 'invalid_price' },
    ]);
  });
});

describe('a mix of fees, VAT on top', () => {
  it('charges every fee set, each with VAT at the global rate', async () => {
    await set('fee.vat_bp', 1_400);
    await version({
      shippingFeePiastres: 5_000,
      orderFixedPiastres: 1_000,
      orderPercentBp: 200,
      codPercentBp: 100,
      packagingChargePiastres: 300,
      productPrices: [{ skuId: f.sku.id, pricePiastres: 250 }],
    });
    // 2 units of SKU-1: 20 EGP products, 20 EGP cash.
    const o = await order({ qty1: 2 });
    expect(await fees('shipping_fee')).toEqual([5_000]);
    expect(await fees('product_handling')).toEqual([500]);
    expect(await fees('order_fee')).toEqual([1_040]);
    expect(await fees('cod_fee')).toEqual([20]);
    expect(await fees('packaging_charge')).toEqual([300]);
    expect(await vats('shipping_fee')).toEqual([700]);
    expect(await vats('product_handling')).toEqual([70]);
    expect(await vats('packaging_charge')).toEqual([42]);
    // The order page shows each kind.
    const money = await getOrderMoney(prisma, o.id);
    expect(money.fees.map((x) => [x.kind, x.amountPiastres])).toEqual([
      ['shipping_fee', 5_000],
      ['product_handling', 500],
      ['order_fixed', 1_000],
      ['order_percent', 40],
      ['cod_fee', 20],
      ['packaging_charge', 300],
    ]);
    expect(money.vatPiastres).toBe(700 + 70 + 140 + 6 + 3 + 42);
  });
});

describe('failed deliveries', () => {
  it('cost a share of the shipment charges, never the COD fee; a fixed fee wins', async () => {
    await version({
      ...allInclusivePrices(12_000),
      orderFixedPiastres: 1_000,
      orderPercentBp: 100,
      codPercentBp: 500,
      productPrices: [{ skuId: f.sku.id, pricePiastres: 200 }],
    });
    // 3 units out with the rider: 120 shipping + 6 per product + 10 fixed + 1% of 30 EGP = 136.3.
    await order({ qty1: 3, fail: true });
    expect(await fees('failed_fee')).toEqual([13_630]);
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { kind: 'failed_fee' } });
    expect(entry.data).toMatchObject({
      mode: 'percent',
      percentBp: 10_000,
      shipmentPiastres: 13_630,
    });

    // A share set on the contract (50%), then a fixed fee (field present: used as it is).
    const draft = await createContractDraft(prisma, {
      merchantId: f.merchant.id,
      body: body({ ...allInclusivePrices(12_000), failedDeliveryPercentBp: 5_000 }),
      actorUserId: admin,
    });
    await activateContractVersion(prisma, {
      merchantId: f.merchant.id,
      versionId: draft.id,
      effectiveFrom: today(),
      actorUserId: admin,
    });
    await order({ fail: true });
    expect((await fees('failed_fee')).at(-1)).toBe(6_000);
    const fixed = await createContractDraft(prisma, {
      merchantId: f.merchant.id,
      body: body({
        ...allInclusivePrices(12_000),
        failedDeliveryPiastres: 0,
        failedDeliveryPercentBp: 5_000,
      }),
      actorUserId: admin,
    });
    await activateContractVersion(prisma, {
      merchantId: f.merchant.id,
      versionId: fixed.id,
      effectiveFrom: today(),
      actorUserId: admin,
    });
    await order({ fail: true });
    // Fixed 0: nothing booked for the third failure.
    expect(await fees('failed_fee')).toHaveLength(2);
  });

  it('keeps the fixed fee for contracts without a shipping fee or share', async () => {
    await version({ codPercentBp: 50 });
    await order({ fail: true });
    expect(await fees('failed_fee')).toEqual([1_500]);
    // A share alone (no shipping fee) is used too.
    const draft = await createContractDraft(prisma, {
      merchantId: f.merchant.id,
      body: body({ failedDeliveryPercentBp: 10_000 }),
      actorUserId: admin,
    });
    await activateContractVersion(prisma, {
      merchantId: f.merchant.id,
      versionId: draft.id,
      effectiveFrom: today(),
      actorUserId: admin,
    });
    await order({ fail: true });
    // 20 EGP fixed + 1% of 10 EGP.
    expect((await fees('failed_fee')).at(-1)).toBe(2_010);
  });
});

describe('existing versions', () => {
  it('charge exactly as before: no new kinds, the fixed failed fee', async () => {
    await version({ orderFixedPiastres: 1_800, codPercentBp: 150 });
    await order({ qty1: 2 });
    await order({ fail: true });
    // 18 EGP + 1% of 20 EGP, 1.5% of 20 EGP cash.
    expect(await fees('order_fee')).toEqual([1_820]);
    expect(await fees('cod_fee')).toEqual([30]);
    expect(await fees('failed_fee')).toEqual([1_500]);
    const kinds = await prisma.ledgerEntry.groupBy({ by: ['kind'] });
    for (const k of ['shipping_fee', 'product_handling', 'packaging_charge'])
      expect(kinds.map((x) => x.kind)).not.toContain(k);
  });
});

describe('invoices, statements and profit', () => {
  it('group the new kinds with their item codes', async () => {
    await set('fee.vat_bp', 1_400);
    const lastMonth = addMonths(today().slice(0, 7), -1);
    await version({
      shippingFeePiastres: 12_000,
      packagingChargePiastres: 300,
      productPrices: [{ skuId: f.sku.id, pricePiastres: 200 }],
    });
    // The item codes of the new kinds are needed once a contract uses them.
    const readiness = await etaReadiness(prisma);
    expect(readiness.missingCodes).toEqual(
      expect.arrayContaining(['shipping_fee', 'product_handling', 'packaging_charge']),
    );
    await order({ qty1: 2 });
    // Moved to last month so it can be invoiced.
    const at = new Date(cairoDayStart(`${lastMonth}-10`).getTime() + 3_600_000);
    await prisma.$executeRawUnsafe(`ALTER TABLE ledger_lines DISABLE TRIGGER USER`);
    await prisma.$executeRawUnsafe(`ALTER TABLE ledger_entries DISABLE TRIGGER USER`);
    await prisma.ledgerEntry.updateMany({ data: { occurredAt: at } });
    await prisma.ledgerLine.updateMany({ data: { occurredAt: at } });
    await prisma.$executeRawUnsafe(`ALTER TABLE ledger_entries ENABLE TRIGGER USER`);
    await prisma.$executeRawUnsafe(`ALTER TABLE ledger_lines ENABLE TRIGGER USER`);
    await updateCompanyProfile(prisma, {
      itemCodes: {
        shipping_fee: 'EG-1-SHIP',
        product_handling: 'EG-1-PROD',
        packaging_charge: 'EG-1-PACK',
      },
      actorUserId: admin,
    });
    expect((await etaReadiness(prisma)).missingCodes).not.toContain('shipping_fee');
    await prepareInvoices(prisma, { month: lastMonth, actorUserId: admin });
    const [invoice] = await listInvoices(prisma);
    const full = await getInvoice(prisma, invoice!.id);
    const lines = Object.fromEntries(
      full.lines.map((l) => [l.kind, [l.quantity, l.netPiastres, l.vatPiastres]]),
    );
    expect(lines).toMatchObject({
      shipping_fee: [1, 12_000, 1_680],
      product_handling: [1, 400, 56],
      packaging_charge: [1, 300, 42],
    });
    // The statement and the profit report carry them by kind.
    const statement = await merchantStatement(
      prisma,
      f.merchant.id,
      cairoDayStart(`${lastMonth}-01`),
      cairoDayStart(`${today().slice(0, 7)}-01`),
    );
    expect(statement.byKind).toMatchObject({
      shipping_fee: -13_680,
      product_handling: -456,
      packaging_charge: -342,
    });
    const profit = await merchantProfitability(prisma, { month: lastMonth });
    expect(profit.rows[0]!.feesByKind).toMatchObject({
      shipping_fee: 12_000,
      product_handling: 400,
      packaging_charge: 300,
    });
  });
});

describe('sales proposals', () => {
  it('carry the shipping fee, product prices and failed share into the contract', async () => {
    const user = await prisma.user.create({
      data: { email: 'rep@t.eg', name: 'Rep', role: 'admin', passwordHash: 'x' },
    });
    const profile = await prisma.$transaction((tx) =>
      writeAccess(
        tx,
        user.id,
        { ...JOB_ROLE_TEMPLATES.sales_manager, jobRole: 'sales_manager' },
        [],
      ),
    );
    const actor = crmActor(profile, user.id);
    const deal = await createDeal(
      prisma,
      {
        company: { brandName: 'Brand', source: 'manual' },
        contact: { name: 'Owner', phone: '01012345678', email: 'owner@b.eg' },
        expectedMonthlyOrders: 100,
        idempotencyKey: key(),
      },
      actor,
    );
    // A sign up: the company already is our merchant, with its products.
    const { companyId } = await prisma.crmDeal.findUniqueOrThrow({ where: { id: deal.id } });
    await prisma.crmCompany.update({
      where: { id: companyId },
      data: { merchantId: f.merchant.id },
    });
    await set('sales.max_discount_bp', 10_000);
    const p = await createProposal(
      prisma,
      {
        dealId: deal.id,
        idempotencyKey: key(),
        ...allInclusivePrices(12_000),
        failedDeliveryPercentBp: 10_000,
        productPrices: [
          { skuId: f.sku.id, sku: 'SKU-1', name: 'Product 1', pricePiastres: 200 },
          { skuId: null, sku: 'LATER-9', name: 'Not made yet', pricePiastres: 900 },
        ],
      } as Parameters<typeof createProposal>[1],
      actor,
    );
    expect(p.fees.shippingFeePiastres).toBe(12_000);
    expect(p.productPrices).toHaveLength(2);
    // An all inclusive proposal is checked as a whole: 120 EGP against 20 EGP + 1% + 1.5% a
    // month at the settings is no discount at all.
    expect(p.maxDiscountBp).toBe(0);
    const sent = await sendProposal(prisma, p.id, actor);
    await acceptProposal(prisma, sent.token!, { signerName: 'Signer', signerTitle: 'Owner' });
    const result = await confirmProposal(prisma, p.id, {}, actor);
    expect(result.unmatchedProducts).toEqual([
      { sku: 'LATER-9', name: 'Not made yet', pricePiastres: 900 },
    ]);
    const view = await getContract(prisma, f.merchant.id);
    expect(view.current).toMatchObject({
      prices: expect.objectContaining({ shippingFeePiastres: 12_000, orderFixedPiastres: 0 }),
      failedDeliveryPercentBp: 10_000,
    });
    expect(view.current!.prices.failedDeliveryPiastres).toBeNull();
    expect(view.current!.productPrices.map((x) => [x.sku, x.pricePiastres])).toEqual([
      ['SKU-1', 200],
    ]);
    expect(view.current!.internalNote).toContain('LATER-9');
    const rows = await prisma.crmProposalProduct.findMany({ orderBy: { position: 'asc' } });
    expect(rows.map((r) => r.matchedSkuId)).toEqual([f.sku.id, null]);
  });
});
