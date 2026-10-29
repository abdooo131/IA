import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createOrder } from '../src/orders';
import { forgetAreaNames, loadBaseAreas } from '../src/geo';
import {
  customerProfile,
  customerRisk,
  customersOverview,
  districtDemand,
  ingestOrders,
  locateCustomers,
  merchantCategoryGaps,
  mergeCustomers,
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
      shopifyOrder(5, '01119998877', '50.00', ago(1)),
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

/** A finished delivery attempt of one of our orders, for the risk score. */
async function attempt(orderId: string, status: 'delivered' | 'failed', reason?: string) {
  const rider =
    (await prisma.rider.findFirst()) ??
    (await prisma.rider.create({
      data: {
        badgeCode: 'RDR-1',
        darkStore: { connect: { id: f.store.id } },
        user: {
          create: {
            email: 'r@t.eg',
            name: 'Rider',
            role: 'rider',
            passwordHash: 'x',
            darkStoreId: f.store.id,
          },
        },
      },
    }));
  await prisma.delivery.create({
    data: {
      orderId,
      riderId: rider.id,
      status,
      failedReason: reason ?? null,
      failedAt: status === 'failed' ? new Date() : null,
      deliveredAt: status === 'delivered' ? new Date() : null,
    },
  });
}

const manualOrder = (phone: string, paymentMethod: 'cod' | 'prepaid' = 'cod') =>
  createOrder(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    source: 'manual',
    customerName: 'Hany',
    customerPhone: phone,
    addressText: '9 Road 233, Degla, Maadi, Cairo',
    latitude: null as unknown as number,
    longitude: null as unknown as number,
    paymentMethod,
    deliveryFeePiastres: 0,
    items: [{ skuId: f.sku.id, quantity: 1 }],
  });

describe('value, risk, places and merging', () => {
  it('scores cash risk and alerts admin once on a new cash order from a risky customer', async () => {
    await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 10 });
    const past = await Promise.all([1, 2, 3].map(() => manualOrder('01112223334')));
    await linkDeliveryCustomers(prisma);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { phone: '+201112223334' } });
    expect((await customerRisk(prisma, customer.id)).level).toBe('unknown');
    await attempt(past[0]!.id, 'failed', 'refused');
    // One refusal is enough for medium even with little history.
    expect((await customerRisk(prisma, customer.id)).level).toBe('medium');
    await attempt(past[1]!.id, 'failed', 'no_answer');
    await attempt(past[2]!.id, 'delivered');
    // 2 failed + 1 refusal over 3 attempts: 100%.
    expect(await customerRisk(prisma, customer.id)).toMatchObject({
      level: 'high',
      attempts: 3,
      failed: 2,
      refused: 1,
      noAnswer: 1,
    });

    const next = await manualOrder('01112223334');
    const prepaid = await manualOrder('01112223334', 'prepaid');
    expect(await linkDeliveryCustomers(prisma)).toMatchObject({ linked: 2, alerted: 1 });
    const alert = await prisma.alert.findFirstOrThrow({ where: { type: 'cod_risk_customer' } });
    expect(alert).toMatchObject({ orderId: next.id, darkStoreId: f.store.id });
    expect(await prisma.alert.count({ where: { orderId: prepaid.id } })).toBe(0);

    const overview = await customersOverview(prisma);
    expect(overview.riskyCustomers[0]).toMatchObject({ id: customer.id, pct: 100 });
  });

  it('places customers in their district and ranks demand outside our zones', async () => {
    await loadBaseAreas(prisma);
    forgetAreaNames();
    await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 5 });
    await manualOrder('01001112223');
    await linkDeliveryCustomers(prisma);
    expect(await locateCustomers(prisma)).toMatchObject({ looked: 1, placed: 1 });
    // Placed once; nothing to do until the customer changes.
    expect(await locateCustomers(prisma)).toMatchObject({ looked: 0 });
    const c = await prisma.customer.findFirstOrThrow({ include: { district: true } });
    expect(c.district?.nameEn).toBe('Maadi');

    const demand = await districtDemand(prisma);
    expect(demand).toMatchObject({ placed: 1, unplaced: 0 });
    expect(demand.districts[0]).toMatchObject({ nameEn: 'Maadi', customers: 1, coveredPct: 0 });
    expect(demand.spendOutsidePiastres).toBe(f.sku.pricePiastres);
  });

  it('merges two profiles of one person and keeps the old phone as an alias', async () => {
    const a = (await resolveCustomer(prisma, {
      phone: '01001234567',
      name: 'Mona',
      seenAt: ago(50),
    }))!;
    const b = (await resolveCustomer(prisma, {
      phone: '01229998887',
      email: 'mona@example.com',
      city: 'Dokki',
      seenAt: ago(5),
    }))!;
    await ingestOrders(prisma, { id: 'shop-a', merchantId: f.merchant.id }, [
      shopifyOrder(9, '01229998887', '80.00', ago(5)),
    ]);
    const admin = await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    });
    await expect(
      mergeCustomers(prisma, { keepId: a, mergeId: a, actorUserId: admin.id }),
    ).rejects.toThrow('same_customer');
    const kept = await mergeCustomers(prisma, { keepId: a, mergeId: b, actorUserId: admin.id });
    expect(kept).toMatchObject({
      phone: '+201001234567',
      email: 'mona@example.com',
      city: 'Dokki',
      name: 'Mona',
    });
    expect(kept.firstSeenAt < ago(49)).toBe(true);
    expect(await prisma.customer.count()).toBe(1);
    expect((await prisma.shopOrder.findFirstOrThrow()).customerId).toBe(a);
    // A new order with the merged phone still lands on the kept profile.
    expect(await resolveCustomer(prisma, { phone: '+201229998887', seenAt: new Date() })).toBe(a);
    expect(await prisma.auditLog.count({ where: { action: 'customer.merge' } })).toBe(1);
  });

  it('forecasts value, flags who should have reordered and reads price level', async () => {
    const other = await prisma.merchant.create({ data: { name: 'Second Shop' } });
    await prisma.shopProduct.createMany({
      data: [
        {
          shopId: 'shop-a',
          merchantId: f.merchant.id,
          shopifyId: 'P1',
          title: 'Serum',
          status: 'ACTIVE',
          categoryTop: 'Beauty',
          raw: {},
        },
        {
          shopId: 'shop-b',
          merchantId: other.id,
          shopifyId: 'P2',
          title: 'Shirt',
          status: 'ACTIVE',
          categoryTop: 'Apparel',
          raw: {},
        },
      ],
    });
    const line = (id: number, order: number, product: string, price: string, qty = 1) => ({
      id: `gid://shopify/LineItem/${id}`,
      __parentId: `gid://shopify/Order/${order}`,
      name: product,
      quantity: qty,
      currentQuantity: qty,
      originalUnitPriceSet: { shopMoney: { amount: price } },
      product: { id: product },
    });
    // Mona buys serum every 10 days, last 40 days ago: she is late. Someone else buys cheap.
    await ingestOrders(prisma, { id: 'shop-a', merchantId: f.merchant.id }, [
      shopifyOrder(1, '01001234567', '300.00', ago(60)),
      line(1, 1, 'P1', '300.00'),
      shopifyOrder(2, '01001234567', '300.00', ago(50)),
      line(2, 2, 'P1', '300.00'),
      shopifyOrder(3, '01001234567', '300.00', ago(40)),
      line(3, 3, 'P1', '300.00'),
      shopifyOrder(4, '01119998877', '100.00', ago(3)),
      line(4, 4, 'P1', '100.00'),
      line(6, 4, 'P1', '100.00'),
      line(7, 4, 'P1', '100.00'),
    ]);
    await ingestOrders(prisma, { id: 'shop-b', merchantId: other.id }, [
      shopifyOrder(5, '01119998877', '50.00', ago(1)),
      line(5, 5, 'P2', '50.00'),
    ]);
    const mona = await prisma.customer.findUniqueOrThrow({ where: { phone: '+201001234567' } });
    const p = (await customerProfile(prisma, mona.id))!;
    expect(p.value).toMatchObject({ due: true, spend90Piastres: 90_000, priceTier: 'premium' });
    // Every 10 days at 300 EGP: about 36.5 orders a year.
    expect(p.value.forecastPiastres).toBe(Math.round((365 / 10) * 30_000));
    const due = await listCustomers(prisma, { due: true });
    expect(due.customers.map((c) => c.id)).toEqual([mona.id]);
    expect(due.customers[0]!.expectedAt).not.toBeNull();
    const overview = await customersOverview(prisma);
    expect(overview.dueToReorder).toBe(1);
    expect(overview.categoryPairs[0]).toMatchObject({ customers: 1 });

    // The second shop's buyer also buys Beauty at merchant A, which the second shop lacks.
    const gaps = await merchantCategoryGaps(prisma, other.id);
    expect(gaps).toMatchObject({ customers: 1, alsoBuyElsewhere: 1 });
    expect(gaps.gaps[0]).toMatchObject({ category: 'Beauty', customers: 1 });
  });
});
