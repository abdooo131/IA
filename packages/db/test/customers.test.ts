import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createOrder } from '../src/orders';
import {
  customerProfile,
  customersOverview,
  ingestOrders,
  linkDeliveryCustomers,
  listCustomers,
  redactShopCustomer,
  redactShopCustomers,
  resolveCustomer,
} from '../src/shopdata';
import { receive } from '../src/stock';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
});

afterAll(() => prisma.$disconnect());

/** A Shopify order of `merchantId` for the buyer with this phone, as an export row. */
const shopifyOrder = (id: number, phone: string | null, total: string, when: Date, extra = {}) => ({
  id: `gid://shopify/Order/${id}`,
  name: `#${id}`,
  createdAt: when.toISOString(),
  test: false,
  totalPriceSet: { shopMoney: { amount: total } },
  shippingAddress: { name: 'Mona Adel', phone, province: 'Giza', city: 'Dokki' },
  ...extra,
});

describe('one customer across every merchant', () => {
  it('matches every Egyptian phone format and fills in what was missing', async () => {
    const a = await resolveCustomer(prisma, { email: 'Mona@Example.com', seenAt: ago(10) });
    const b = await resolveCustomer(prisma, {
      phone: '0100 123 4567',
      email: 'mona@example.com',
      name: 'Mona',
      seenAt: ago(5),
    });
    const c = await resolveCustomer(prisma, {
      phone: '+20 100 123 4567',
      name: 'Mona Adel',
      city: 'Dokki',
      seenAt: ago(1),
    });
    expect(b).toBe(a);
    expect(c).toBe(a);
    // Older facts never overwrite newer ones, but they move the first sighting back.
    await resolveCustomer(prisma, { phone: '00201001234567', name: 'M.', seenAt: ago(30) });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: a! } });
    expect(row).toMatchObject({
      phone: '+201001234567',
      email: 'mona@example.com',
      name: 'Mona Adel',
      city: 'Dokki',
    });
    expect(row.firstSeenAt < ago(29)).toBe(true);
    expect(await prisma.customer.count()).toBe(1);
  });

  it('makes no profile without a valid mobile or email', async () => {
    expect(await resolveCustomer(prisma, { phone: '12345', seenAt: new Date() })).toBeNull();
    expect(await resolveCustomer(prisma, { email: 'not an email', seenAt: new Date() })).toBeNull();
    expect(await prisma.customer.count()).toBe(0);
  });

  it('joins two merchants and our own deliveries into one profile', async () => {
    const other = await prisma.merchant.create({ data: { name: 'Second Shop' } });
    const shopA = { id: 'shop-a', merchantId: f.merchant.id };
    const shopB = { id: 'shop-b', merchantId: other.id };
    await ingestOrders(prisma, shopA, [
      shopifyOrder(1, '01001234567', '500.00', ago(100)),
      shopifyOrder(2, '01001234567', '300.00', ago(40)),
    ]);
    await ingestOrders(prisma, shopB, [
      shopifyOrder(3, '+201001234567', '200.00', ago(20)),
      // A cancelled order is counted apart, never in spend.
      shopifyOrder(4, '+201001234567', '999.00', ago(15), { cancelledAt: ago(15).toISOString() }),
      // Someone else, and an order with no contact at all.
      shopifyOrder(5, '01119998877', '50.00', ago(2)),
      shopifyOrder(6, null, '70.00', ago(2)),
    ]);
    // Our own manual delivery for the same person, and one with a foreign number.
    await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 5 });
    const base = {
      merchantId: f.merchant.id,
      darkStoreId: f.store.id,
      source: 'manual' as const,
      addressText: '5 Tahrir St, Dokki',
      latitude: 30.04,
      longitude: 31.21,
      paymentMethod: 'cod' as const,
      deliveryFeePiastres: 0,
      items: [{ skuId: f.sku.id, quantity: 1 }],
    };
    await createOrder(prisma, { ...base, customerName: 'Mona A.', customerPhone: '01001234567' });
    await createOrder(prisma, { ...base, customerName: 'Visitor', customerPhone: '+447700900123' });

    expect(await linkDeliveryCustomers(prisma)).toMatchObject({ looked: 1, linked: 1 });
    // Running again finds nothing new.
    expect(await linkDeliveryCustomers(prisma)).toMatchObject({ looked: 0, linked: 0 });
    expect(await prisma.customer.count()).toBe(2);

    const mona = await prisma.customer.findUniqueOrThrow({ where: { phone: '+201001234567' } });
    const profile = (await customerProfile(prisma, mona.id))!;
    expect(profile.totals).toMatchObject({ orders: 4, cancelled: 1, merchants: 2 });
    // 500 + 300 + 200 from Shopify, plus our delivery order's products.
    expect(profile.totals.spendPiastres).toBe(100_000 + f.sku.pricePiastres);
    expect(profile.merchants.map((m) => m.name).sort()).toEqual(['Merchant', 'Second Shop']);
    expect(profile.deliveries).toMatchObject({ orders: 1 });
    expect(profile.recentOrders).toHaveLength(5);
    expect(profile.segment).toBe('loyal');

    const list = await listCustomers(prisma, { q: '0100 123' });
    expect(list.customers.map((c) => c.id)).toEqual([mona.id]);
    expect((await listCustomers(prisma, { merchantId: other.id })).customers).toHaveLength(2);
    expect((await listCustomers(prisma, { segment: 'new' })).customers).toHaveLength(1);

    const overview = await customersOverview(prisma);
    expect(overview).toMatchObject({ customers: 2, buyers: 2, multiMerchantPct: 50 });
    expect(overview.sharedShoppers[0]).toMatchObject({ customers: 1 });
  });

  it('forgets a buyer of one shop but keeps the person other merchants know', async () => {
    const other = await prisma.merchant.create({ data: { name: 'Second Shop' } });
    await ingestOrders(prisma, { id: 'shop-a', merchantId: f.merchant.id }, [
      shopifyOrder(1, '01001234567', '100.00', ago(3), { email: 'mona@example.com' }),
    ]);
    await ingestOrders(prisma, { id: 'shop-b', merchantId: other.id }, [
      shopifyOrder(2, '01001234567', '100.00', ago(2)),
    ]);
    const first = await redactShopCustomer(prisma, 'shop-a', null, ['gid://shopify/Order/1']);
    expect(first).toMatchObject({ orders: 1, customersRemoved: 0 });
    expect(await prisma.customer.count()).toBe(1);
    const scrubbed = await prisma.shopOrder.findUniqueOrThrow({
      where: { shopifyId: 'gid://shopify/Order/1' },
    });
    expect(scrubbed.customerId).toBeNull();
    expect(scrubbed.raw).not.toHaveProperty('email');
    // The second shop closes: now nobody knows the person, so the profile goes too.
    expect(await redactShopCustomers(prisma, 'shop-b')).toMatchObject({
      orders: 1,
      customersRemoved: 1,
    });
    expect(await prisma.customer.count()).toBe(0);
  });

  it('names segments from the settings', async () => {
    const id = (await resolveCustomer(prisma, { phone: '01001234567', seenAt: ago(400) }))!;
    await ingestOrders(prisma, { id: 'shop-a', merchantId: f.merchant.id }, [
      shopifyOrder(1, '01001234567', '100.00', ago(400)),
    ]);
    expect((await customerProfile(prisma, id))!.segment).toBe('lost');
    await prisma.setting.create({
      data: { key: 'customer.lost_days', scope: 'global', value: 1000 },
    });
    expect((await customerProfile(prisma, id))!.segment).toBe('at_risk');
    expect(await customerProfile(prisma, 'missing')).toBeNull();
  });
});
