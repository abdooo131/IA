import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { forgetAreaNames, loadBaseAreas } from '../src/geo';
import {
  customerProfile,
  customersOverview,
  exportCustomers,
  ingestCustomers,
  ingestOrders,
  isExpressCode,
  listCustomers,
  locateCustomers,
  orderHistoryCoverage,
  paymentMethodOf,
  toPiastres,
} from '../src/shopdata';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let shop: { id: string; merchantId: string };
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  const row = await prisma.shopifyShop.create({
    data: { merchantId: f.merchant.id, shopDomain: 'nile.myshopify.com', status: 'active' },
  });
  shop = { id: row.id, merchantId: f.merchant.id };
});

afterAll(() => prisma.$disconnect());

/** A Shopify customers export row. */
const shopCustomer = (
  id: number,
  phone: string,
  extra: {
    created: Date;
    updated?: Date;
    orders?: number;
    spent?: string;
    email?: string;
  } & Record<string, unknown>,
) => ({
  id: `gid://shopify/Customer/${id}`,
  firstName: 'Mona',
  lastName: `N${id}`,
  createdAt: extra.created.toISOString(),
  updatedAt: (extra.updated ?? extra.created).toISOString(),
  numberOfOrders: String(extra.orders ?? 0),
  amountSpent: { amount: extra.spent ?? '0.00' },
  defaultPhoneNumber: { phoneNumber: phone, marketingState: extra.sms ?? 'NOT_SUBSCRIBED' },
  defaultEmailAddress: extra.email
    ? { emailAddress: extra.email, marketingState: extra.emailState ?? 'NOT_SUBSCRIBED' }
    : null,
  locale: 'ar',
});

/** A Shopify order export row of one customer record. */
const order = (id: number, customer: number | null, total: string, when: Date, extra = {}) => ({
  id: `gid://shopify/Order/${id}`,
  name: `#${id}`,
  createdAt: when.toISOString(),
  test: false,
  totalPriceSet: { shopMoney: { amount: total } },
  customer: customer ? { id: `gid://shopify/Customer/${customer}` } : null,
  ...extra,
});

describe('first seen', () => {
  it('takes the record creation as first seen and its last update as last seen', async () => {
    await ingestCustomers(
      prisma,
      shop,
      [shopCustomer(1, '01001234567', { created: ago(400), updated: ago(1) })],
      toPiastres,
    );
    const c = await prisma.customer.findUniqueOrThrow({ where: { phone: '+201001234567' } });
    expect(Math.round((Date.now() - c.firstSeenAt.getTime()) / DAY)).toBe(400);
    expect(Math.round((Date.now() - c.lastSeenAt.getTime()) / DAY)).toBe(1);
    expect(
      await prisma.shopCustomer.findFirstOrThrow({ where: { customerId: c.id } }),
    ).toMatchObject({ locale: 'ar' });
  });

  it('repairs profiles saved with a late first seen, once and only backwards', async () => {
    await ingestCustomers(
      prisma,
      shop,
      [shopCustomer(1, '01001234567', { created: ago(300), updated: ago(2) })],
      toPiastres,
    );
    const c = await prisma.customer.findUniqueOrThrow({ where: { phone: '+201001234567' } });
    // As the old code saved it: first seen at the record's last update.
    await prisma.customer.update({ where: { id: c.id }, data: { firstSeenAt: ago(2) } });
    const other = await prisma.customer.create({
      data: { phone: '+201112223334', firstSeenAt: ago(9), lastSeenAt: ago(9) },
    });
    const sql = readFileSync(
      path.resolve(
        __dirname,
        '../prisma/migrations/20261210090100_customer_first_seen/migration.sql',
      ),
      'utf8',
    );
    const statements = sql
      .split(';')
      .map((x) => x.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean);
    for (let run = 0; run < 2; run++)
      for (const statement of statements) await prisma.$executeRawUnsafe(statement);
    const fixed = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(Math.round((Date.now() - fixed.firstSeenAt.getTime()) / DAY)).toBe(300);
    // Nothing else knows the other person: left as it was.
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: other.id } })).firstSeenAt,
    ).toEqual(other.firstSeenAt);
    const overview = await customersOverview(prisma);
    expect(overview.newByMonth.reduce((s, m) => s + m.customers, 0)).toBe(2);
  });
});

describe("Shopify's totals while our order history is partial", () => {
  async function setUp() {
    await ingestCustomers(
      prisma,
      shop,
      [
        // Bought 5 times (one in the 60 days we hold), customer for almost a year.
        shopCustomer(1, '01001234567', { created: ago(300), orders: 5, spent: '1000.00' }),
        // Bought 3 times, all before what we hold.
        shopCustomer(2, '01112223334', { created: ago(400), orders: 3, spent: '450.00' }),
        // New since the oldest order we hold: our numbers are complete for them.
        shopCustomer(3, '01223334445', { created: ago(20), orders: 2, spent: '90.00' }),
      ],
      toPiastres,
    );
    await ingestOrders(prisma, shop, [
      order(10, null, '50.00', ago(70)),
      order(11, 1, '200.00', ago(10), { phone: '01001234567' }),
      order(12, 3, '90.00', ago(5), { phone: '01223334445' }),
    ]);
  }

  it('counts at least what Shopify says and marks those numbers', async () => {
    await setUp();
    const byPhone = async (phone: string) => {
      const c = await prisma.customer.findUniqueOrThrow({ where: { phone } });
      return (await customerProfile(prisma, c.id))!;
    };
    const a = await byPhone('+201001234567');
    expect(a.totals).toMatchObject({
      orders: 5,
      spendPiastres: 100_000,
      merchants: 1,
      fromShopifyTotals: true,
    });
    expect(a.segment).toBe('vip');
    expect(a.totals.averageOrderPiastres).toBe(20_000);

    // Nothing held: the last order is before the oldest order we hold (70 days ago).
    const b = await byPhone('+201112223334');
    expect(b.totals).toMatchObject({ orders: 3, spendPiastres: 45_000, fromShopifyTotals: true });
    expect(b.segment).toBe('at_risk');
    expect(Math.round((Date.now() - b.totals.lastOrderAt!.getTime()) / DAY)).toBe(70);

    // Shopify says 2, we hold 1, but the record is newer than our window: ours stand.
    const c = await byPhone('+201223334445');
    expect(c.totals).toMatchObject({ orders: 1, fromShopifyTotals: false });

    const list = await listCustomers(prisma, {});
    expect(list.customers.filter((x) => x.fromShopifyTotals)).toHaveLength(2);
    const overview = await customersOverview(prisma);
    expect(overview).toMatchObject({ buyers: 3, fromShopifyTotals: 2 });
    expect(overview.segments.find((s) => s.segment === 'no_orders')).toBeUndefined();
  });

  it('stops leaning on Shopify once the whole history is in', async () => {
    await setUp();
    expect(await orderHistoryCoverage(prisma)).toEqual([
      expect.objectContaining({
        shopId: shop.id,
        orders: 3,
        allOrdersGranted: false,
        complete: false,
      }),
    ]);
    await prisma.shopifyShop.update({
      where: { id: shop.id },
      data: { scopes: 'read_orders,read_all_orders' },
    });
    await prisma.shopDataSync.create({
      data: { shopId: shop.id, kind: 'orders', status: 'done', allOrders: true },
    });
    const [coverage] = await orderHistoryCoverage(prisma, f.merchant.id);
    expect(coverage).toMatchObject({ allOrdersGranted: true, complete: true });
    expect(Math.round((Date.now() - coverage!.from!.getTime()) / DAY)).toBe(70);
    const c = await prisma.customer.findUniqueOrThrow({ where: { phone: '+201001234567' } });
    expect((await customerProfile(prisma, c.id))!.totals).toMatchObject({
      orders: 1,
      fromShopifyTotals: false,
    });
  });
});

describe('order fields we used to skip', () => {
  it('reads payment, shipping line, discounts, cancel reason, attributes and the point', async () => {
    await ingestOrders(prisma, shop, [
      order(20, null, '300.00', ago(3), {
        phone: '01001234567',
        paymentGatewayNames: ['Cash on Delivery (COD)'],
        shippingLine: { code: 'SN60:MAADI', title: 'Shiply Now 60 minutes' },
        discountCodes: ['RAMADAN10'],
        customAttributes: [
          { key: '_shiplynow_pin', value: '29.9602,31.2569' },
          { key: '_shiplynow_zone', value: 'z1' },
        ],
        shippingAddress: { latitude: 30.05, longitude: 31.23, province: 'Cairo', city: 'Maadi' },
      }),
      order(21, null, '120.00', ago(2), {
        phone: '01001234567',
        paymentGatewayNames: ['shopify_payments'],
        shippingLine: { code: 'Standard', title: 'Next day' },
        cancelReason: 'CUSTOMER',
        cancelledAt: ago(2).toISOString(),
        // A geocode in the sea off Spain is not a delivery point.
        shippingAddress: { latitude: 40.1, longitude: 2.1 },
      }),
    ]);
    const first = await prisma.shopOrder.findUniqueOrThrow({
      where: { shopifyId: 'gid://shopify/Order/20' },
    });
    expect(first).toMatchObject({
      latitude: 29.9602,
      longitude: 31.2569,
      pointSource: 'pin',
      paymentGateways: ['Cash on Delivery (COD)'],
      paymentMethod: 'cod',
      shippingCode: 'SN60:MAADI',
      express: true,
      discountCodes: ['RAMADAN10'],
      customAttributes: { _shiplynow_pin: '29.9602,31.2569', _shiplynow_zone: 'z1' },
    });
    const second = await prisma.shopOrder.findUniqueOrThrow({
      where: { shopifyId: 'gid://shopify/Order/21' },
    });
    expect(second).toMatchObject({
      latitude: null,
      pointSource: null,
      paymentMethod: 'card',
      express: false,
      cancelReason: 'CUSTOMER',
      customAttributes: null,
    });

    const c = await prisma.customer.findUniqueOrThrow({ where: { phone: '+201001234567' } });
    expect(c).toMatchObject({ latitude: 29.9602, longitude: 31.2569 });
    const profile = (await customerProfile(prisma, c.id))!;
    expect(profile.payments).toEqual(
      expect.arrayContaining([
        { method: 'cod', orders: 1 },
        { method: 'card', orders: 1 },
      ]),
    );
    // The cancelled order does not count as a delivery choice.
    expect(profile.delivery).toEqual({ express: 1, standard: 0 });
    expect(profile.recentOrders.find((o) => o.ref === '#20')).toMatchObject({
      express: true,
      payment: 'cod',
    });

    // Placed by the order's point, through the delivery decision.
    await loadBaseAreas(prisma);
    forgetAreaNames();
    await locateCustomers(prisma);
    const placed = await prisma.customer.findUniqueOrThrow({
      where: { id: c.id },
      include: { district: true },
    });
    expect(placed.district?.nameEn).toBe('Maadi');
  });

  it('names how an order was paid and our 60 minute rate', () => {
    expect(paymentMethodOf(['Cash on Delivery (COD)'])).toBe('cod');
    expect(paymentMethodOf(['الدفع عند الاستلام'])).toBe('cod');
    expect(paymentMethodOf(['Paymob', 'gift_card'])).toBe('card');
    expect(paymentMethodOf(['manual'])).toBe('other');
    expect(paymentMethodOf([])).toBeNull();
    expect(isExpressCode('SN60:MAADI')).toBe(true);
    expect(isExpressCode('Standard')).toBe(false);
    expect(isExpressCode(null)).toBe(false);
  });
});

describe('segment export', () => {
  it('lists a segment, and for marketing only the channels people agreed to', async () => {
    await ingestCustomers(
      prisma,
      shop,
      [
        shopCustomer(1, '01001234567', {
          created: ago(10),
          email: 'a@example.com',
          emailState: 'SUBSCRIBED',
          sms: 'NOT_SUBSCRIBED',
        }),
        shopCustomer(2, '01112223334', { created: ago(10), sms: 'SUBSCRIBED' }),
        shopCustomer(3, '01223334445', { created: ago(10), sms: 'UNSUBSCRIBED' }),
      ],
      toPiastres,
    );
    const all = await exportCustomers(prisma, { segment: 'no_orders' });
    expect(all).toHaveLength(3);
    expect(await exportCustomers(prisma, { segment: 'vip' })).toHaveLength(0);

    const marketing = await exportCustomers(prisma, { marketing: true });
    expect(marketing).toHaveLength(2);
    expect(marketing.find((r) => r.email === 'a@example.com')).toMatchObject({
      phone: null,
      emailMarketing: 'SUBSCRIBED',
    });
    expect(marketing.find((r) => r.phone === '+201112223334')).toMatchObject({
      email: null,
      smsMarketing: 'SUBSCRIBED',
    });
  });
});
