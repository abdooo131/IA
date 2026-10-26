import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { openToken, sealToken, verifyBodyHmac, verifyQueryHmac } from '../src/shopify/security';
import { moneyToPiastres } from '../src/shopify/shopify-admin';
import { ShopifyJobsService } from '../src/shopify/shopify-jobs.service';
import { type GeocodeResult, Geocoder } from '../src/coverage/geocoding';
import { FakeShopify } from './fake-shopify';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const SECRET = 'test-shopify-secret';
process.env.SHOPIFY_API_KEY = 'test-client-id';
process.env.SHOPIFY_API_SECRET = SECRET;

const DEMO = 'demo-password-1';
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');
const EARLY_CAIRO = new Date('2026-01-14T06:00:00Z'); // 08:00, stores open at 10:00
const SHOP = 'shiplynow-test.myshopify.com';
const NEW_CAIRO = { latitude: 30.03, longitude: 31.47 };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

const sign = (params: Record<string, string>) => {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHmac('sha256', SECRET).update(message).digest('hex');
};

/** Places a few known checkout addresses; counts calls so the cache can be checked. */
class FakeGeocoder extends Geocoder {
  calls = 0;
  async geocode(address: string): Promise<GeocodeResult | null> {
    this.calls++;
    if (address.includes('boom')) throw new Error('provider down');
    if (address.includes('Fifth Settlement'))
      return { ...NEW_CAIRO, formattedAddress: 'Fifth Settlement, New Cairo' };
    if (address.includes('Alexandria'))
      return { latitude: 31.2, longitude: 29.92, formattedAddress: 'Alexandria' };
    return null;
  }
}

describe('shopify security helpers', () => {
  it('checks body and query signatures and keeps tokens encrypted', () => {
    const body = Buffer.from('{"kind":"FULFILLMENT_REQUEST"}');
    const good = createHmac('sha256', SECRET).update(body).digest('base64');
    expect(verifyBodyHmac(body, good, SECRET)).toBe(true);
    expect(verifyBodyHmac(Buffer.from('{"kind":"x"}'), good, SECRET)).toBe(false);
    expect(verifyBodyHmac(body, undefined, SECRET)).toBe(false);
    const q = { shop: SHOP, code: 'c', timestamp: '1' };
    expect(verifyQueryHmac({ ...q, hmac: sign(q) }, SECRET)).toBe(true);
    expect(verifyQueryHmac({ ...q, hmac: sign({ ...q, code: 'd' }) }, SECRET)).toBe(false);
    const sealed = sealToken('shpat_abc', SECRET);
    expect(sealed).not.toContain('shpat_abc');
    expect(openToken(sealed, SECRET)).toBe('shpat_abc');
    expect(() => openToken(sealed, 'other-secret')).toThrow();
    expect(moneyToPiastres('1249.5')).toBe(124950);
    expect(moneyToPiastres('30.00')).toBe(3000);
    expect(moneyToPiastres('0.005')).toBe(0);
  });
});

describe('shopify app', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jobs: ShopifyJobsService;
  let fake: FakeShopify;
  let stores: Map<string, string>;
  let merchantId: string;
  const clock = new FixedClock(NOON_CAIRO);
  const geocoder = new FakeGeocoder();

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };

  beforeAll(async () => {
    fake = new FakeShopify();
    ({ app, prisma } = await createTestApp({ clock, shopify: fake, geocoder }));
    jobs = app.get(ShopifyJobsService);
  });
  afterAll(async () => {
    await app.close();
  });

  /** Links the demo merchant, runs the OAuth install and waits for the background setup. */
  async function install() {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    await admin
      .post('/admin/shopify/link')
      .send({ merchantId, shopDomain: 'shiplynow-test' })
      .expect(201);
    const browser = request.agent(app.getHttpServer());
    const start = await browser.get(`/shopify/install?shop=${SHOP}`).expect(302);
    const authorize = new URL(start.headers.location!);
    expect(authorize.host).toBe(SHOP);
    expect(authorize.searchParams.get('client_id')).toBe('test-client-id');
    const state = authorize.searchParams.get('state')!;
    const params = { code: 'good-code', shop: SHOP, state, timestamp: '1700000000' };
    const back = await browser
      .get('/shopify/callback')
      .query({ ...params, hmac: sign(params) })
      .expect(302);
    expect(back.headers.location).toContain('/shopify/installed?shop=');
    for (let i = 0; i < 50; i++) {
      const linked = await prisma.sku.count({
        where: { merchantId, shopifyVariantId: { not: null } },
      });
      const ready = await prisma.shopifyShop.count({ where: { carrierServiceId: { not: null } } });
      const addressed = await prisma.shopifyLocation.count({
        where: { addressSyncedAt: { not: null } },
      });
      if (addressed === 3 && linked >= 2 && ready === 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return {
      admin,
      shop: await prisma.shopifyShop.findUniqueOrThrow({ where: { shopDomain: SHOP } }),
    };
  }

  const locationOf = async (code: string) =>
    (await prisma.shopifyLocation.findFirstOrThrow({ where: { darkStore: { code } } })).locationId;

  beforeEach(async () => {
    clock.set(NOON_CAIRO);
    ({ stores } = await resetAndSeed(prisma));
    merchantId = (await prisma.merchant.findFirstOrThrow()).id;
    fake.services = [];
    fake.variants = [];
    fake.fulfillmentOrders = [];
    fake.fulfillments = [];
    fake.inventory.clear();
    fake.idempotencyKeys = [];
    fake.carrierServices = [];
    fake.locationAddresses.clear();
    fake.addVariant('EC-001', '325.00');
    fake.addVariant('EC-019', '99.00');
    fake.addVariant(null);
  });

  it('installs with a verified OAuth flow, registers a location per store and links products', async () => {
    const { shop } = await install();
    expect(shop.status).toBe('active');
    expect(shop.accessTokenEnc).not.toContain('shpat');
    expect(fake.services.map((s) => s.name).sort()).toEqual([
      'Shiply Now Maadi',
      'Shiply Now New Cairo',
      'Shiply Now Zamalek',
    ]);
    const location = await prisma.shopifyLocation.findFirstOrThrow({
      where: { darkStoreId: stores.get('NCR') },
    });
    expect(fake.services.find((s) => s.locationId === location.locationId)!.callbackUrl).toBe(
      `http://localhost:3000/api/shopify/fs/${location.id}`,
    );
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    expect(sku.shopifyVariantId).toBe(fake.variants[0]!.id);
    expect(sku.shopifyInventoryItemId).toBe(fake.variants[0]!.inventoryItemId);

    // A tampered callback is refused.
    const params = { code: 'good-code', shop: SHOP, state: 'x', timestamp: '1' };
    const bad = await request(app.getHttpServer())
      .get('/shopify/callback')
      .query({ ...params, hmac: sign({ ...params, code: 'other' }) })
      .expect(302);
    expect(bad.headers.location).toContain('error=invalid_request');
  });

  it('accepts a fulfillment request, short ships missing units and reports the journey back', async () => {
    const { shop } = await install();
    const ncr = await locationOf('NCR');
    const [ec001, ec019] = fake.variants;
    const level = await prisma.stockLevel.findFirstOrThrow({
      where: { darkStoreId: stores.get('NCR'), sku: { sku: 'EC-019' } },
    });
    const fo = fake.addRequest({
      name: '#1001',
      locationId: ncr,
      lines: [
        { id: 'li-1', sku: 'EC-001', variantId: ec001!.id, quantity: 2, price: '325.00' },
        {
          id: 'li-2',
          sku: 'EC-019',
          variantId: ec019!.id,
          quantity: level.onHand + 3,
          price: '99.00',
        },
      ],
      outstanding: String((2 * 325 + (level.onHand + 3) * 99 + 45).toFixed(2)),
      shipping: '45.00',
      address: {
        name: 'Sara Ali',
        phone: '01012345678',
        address1: 'Villa 12, South 90th',
        city: 'New Cairo',
        ...NEW_CAIRO,
      },
    });

    // Shopify's notification is signed; a wrong signature is refused.
    const location = await prisma.shopifyLocation.findFirstOrThrow({ where: { locationId: ncr } });
    const body = JSON.stringify({ kind: 'FULFILLMENT_REQUEST' });
    await request(app.getHttpServer())
      .post(`/shopify/fs/${location.id}/fulfillment_order_notification`)
      .set('content-type', 'application/json')
      .set('x-shopify-hmac-sha256', 'wrong')
      .send(body)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/shopify/fs/${location.id}/fulfillment_order_notification`)
      .set('content-type', 'application/json')
      .set('x-shopify-hmac-sha256', createHmac('sha256', SECRET).update(body).digest('base64'))
      .send(body)
      .expect(200);
    await jobs.runShop(shop);

    const order = await prisma.order.findFirstOrThrow({
      where: { shopifyFulfillmentOrderId: fo.id },
      include: { items: true },
    });
    expect(order).toMatchObject({
      source: 'shopify',
      status: 'new',
      paymentMethod: 'cod',
      deliveryFeePiastres: 4500,
    });
    expect(order.customerPhone).toBe('+201012345678');
    expect(order.items.find((i) => i.cancelledQty > 0)?.cancelledQty).toBe(3);
    // COD is Shopify's outstanding total minus the units we could not supply.
    expect(order.codAmountPiastres).toBe(2 * 32500 + level.onHand * 9900 + 4500);
    expect(fake.fulfillmentOrders[0]!.assignment).toBe('FULFILLMENT_ACCEPTED');
    // The missing units were taken off the Shopify order by an order edit.
    await jobs.runShop(shop);
    expect(fake.orderQuantities.get('li-2')).toBe(level.onHand);

    // Store and rider: the fulfillment and the delivered event go back to Shopify.
    const staff = await agent('staff.newcairo@shiplynow.local');
    const base = `/stores/${stores.get('NCR')}/orders/${order.id}`;
    await staff.post(`${base}/accept`).expect(201);
    for (const item of order.items)
      await staff
        .post(`${base}/pick`)
        .send({
          skuId: item.skuId,
          quantity: item.quantity - item.cancelledQty,
          idempotencyKey: randomUUID(),
        })
        .expect(201);
    const photo = await staff
      .post('/photos?kind=pack')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    await staff.post(`${base}/pack`).send({ photoId: photo.body.id }).expect(201);
    await staff.post(`${base}/handover`).send({ badgeCode: 'RDR-0001' }).expect(201);
    await jobs.runShop(shop);
    expect(fake.fulfillments).toHaveLength(1);
    expect(fake.fulfillments[0]!.tracking).toBe(order.number);

    const rider = await agent('rider.newcairo@shiplynow.local');
    const deliveries = await rider.get('/rider/deliveries').expect(200);
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    await rider
      .post(`/rider/deliveries/${deliveries.body[0].id}/complete`)
      .send({ otp: fresh.deliveryOtp, codCollectedPiastres: fresh.codAmountPiastres })
      .expect(201);
    await jobs.runShop(shop);
    expect(fake.fulfillments[0]!.events).toEqual(['DELIVERED']);
    expect(await prisma.shopifyOutbox.count({ where: { doneAt: null } })).toBe(0);
  });

  it('queues an order that arrives while the store is closed', async () => {
    const { shop } = await install();
    clock.set(EARLY_CAIRO);
    const ec001 = fake.variants[0]!;
    fake.addRequest({
      name: '#1002',
      locationId: await locationOf('NCR'),
      lines: [{ id: 'li-3', sku: 'EC-001', variantId: ec001.id, quantity: 1, price: '325.00' }],
      outstanding: '0.00',
      shipping: '0.00',
      address: {
        name: 'Early Bird',
        phone: '01112223344',
        address1: 'Street 1',
        city: 'New Cairo',
        ...NEW_CAIRO,
      },
    });
    await jobs.runShop(shop);
    const order = await prisma.order.findFirstOrThrow({
      where: { source: 'shopify' },
      include: { events: true },
    });
    expect(order.paymentMethod).toBe('prepaid');
    expect(order.slaStartsAt?.toISOString()).toBe('2026-01-14T08:00:00.000Z');
    expect(order.slaDueAt?.toISOString()).toBe('2026-01-14T09:00:00.000Z');
    expect(order.events.map((e) => e.type)).toContain('queued_until_open');
    // The accept clock starts at opening, so the order is not late overnight.
    const staff = await agent('staff.newcairo@shiplynow.local');
    const queue = await staff.get(`/stores/${stores.get('NCR')}/orders`).expect(200);
    expect(queue.body[0].stage).toMatchObject({
      stage: 'accept',
      dueAt: '2026-01-14T08:02:00.000Z',
    });
  });

  it('refuses unknown products and addresses outside the zones, so the merchant ships them', async () => {
    const { shop } = await install();
    const ncr = await locationOf('NCR');
    const ec001 = fake.variants[0]!;
    const unknown = fake.addRequest({
      name: '#1003',
      locationId: ncr,
      lines: [
        {
          id: 'li-4',
          sku: 'NOT-OURS',
          variantId: 'gid://shopify/ProductVariant/1',
          quantity: 1,
          price: '10.00',
        },
      ],
      outstanding: '10.00',
      shipping: '0.00',
      address: { name: 'A', phone: '01012345678', address1: 'x', city: 'New Cairo', ...NEW_CAIRO },
    });
    const far = fake.addRequest({
      name: '#1004',
      locationId: ncr,
      lines: [{ id: 'li-5', sku: 'EC-001', variantId: ec001.id, quantity: 1, price: '325.00' }],
      outstanding: '325.00',
      shipping: '0.00',
      address: {
        name: 'B',
        phone: '01012345678',
        address1: 'x',
        city: 'Alexandria',
        latitude: 31.2,
        longitude: 29.92,
      },
    });
    await jobs.runShop(shop);
    expect(fake.fulfillmentOrders.find((f) => f.id === unknown.id)!.rejected?.reason).toBe(
      'INVALID_SKU',
    );
    expect(fake.fulfillmentOrders.find((f) => f.id === far.id)!.rejected?.reason).toBe(
      'UNDELIVERABLE_DESTINATION',
    );
    expect(await prisma.order.count({ where: { source: 'shopify' } })).toBe(0);
    expect(await prisma.alert.count({ where: { type: 'shopify_rejected' } })).toBe(1);
  });

  it('cancels when the merchant cancels before the rider leaves', async () => {
    const { shop } = await install();
    const fo = fake.addRequest({
      name: '#1005',
      locationId: await locationOf('NCR'),
      lines: [
        {
          id: 'li-6',
          sku: 'EC-001',
          variantId: fake.variants[0]!.id,
          quantity: 1,
          price: '325.00',
        },
      ],
      outstanding: '325.00',
      shipping: '0.00',
      address: { name: 'C', phone: '01012345678', address1: 'x', city: 'New Cairo', ...NEW_CAIRO },
    });
    await jobs.runShop(shop);
    fake.fulfillmentOrders[0]!.assignment = 'CANCELLATION_REQUESTED';
    await jobs.runShop(shop);
    const order = await prisma.order.findFirstOrThrow({
      where: { shopifyFulfillmentOrderId: fo.id },
    });
    expect(order.status).toBe('cancelled');
    expect(fake.fulfillmentOrders[0]!.assignment).toBe('CLOSED');
  });

  it('pushes available stock to each location and answers fetch_stock', async () => {
    const { shop } = await install();
    await jobs.runShop(shop);
    const ncr = await prisma.shopifyLocation.findFirstOrThrow({
      where: { darkStoreId: stores.get('NCR') },
    });
    const level = await prisma.stockLevel.findFirstOrThrow({
      where: { darkStoreId: stores.get('NCR'), sku: { sku: 'EC-001' } },
    });
    const key = `${fake.variants[0]!.inventoryItemId}|${ncr.locationId}`;
    expect(fake.inventory.get(key)).toBe(level.onHand - level.reserved);

    // A manual order reserves two units; the next run tells Shopify within the same cycle.
    const merchant = await agent('merchant@evechantelle.example');
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    await merchant
      .post('/merchant/orders')
      .send({
        customerName: 'Walk In',
        customerPhone: '01012345678',
        addressText: 'Villa 1',
        ...NEW_CAIRO,
        paymentMethod: 'cod',
        deliveryFeePiastres: 0,
        items: [{ skuId: sku.id, quantity: 2 }],
      })
      .expect(201);
    await jobs.runShop(shop);
    expect(fake.inventory.get(key)).toBe(level.onHand - level.reserved - 2);
    expect(fake.idempotencyKeys.every((k) => k.length > 8)).toBe(true);

    const stock = await request(app.getHttpServer())
      .get(`/shopify/fs/${ncr.id}/fetch_stock.json?shop=${SHOP}&sku=EC-001`)
      .expect(200);
    expect(stock.body).toEqual({ 'EC-001': level.onHand - level.reserved - 2 });
  });

  it('marks the shop uninstalled on the signed app/uninstalled webhook', async () => {
    await install();
    const body = JSON.stringify({ id: 1 });
    await request(app.getHttpServer())
      .post('/shopify/webhooks')
      .set('content-type', 'application/json')
      .set('x-shopify-topic', 'app/uninstalled')
      .set('x-shopify-shop-domain', SHOP)
      .set('x-shopify-hmac-sha256', createHmac('sha256', SECRET).update(body).digest('base64'))
      .send(body)
      .expect(200);
    const shop = await prisma.shopifyShop.findUniqueOrThrow({ where: { shopDomain: SHOP } });
    expect(shop).toMatchObject({ status: 'uninstalled', accessTokenEnc: null });
  });

  // ─── checkout rates ──────────────────────────────────────────────────────────

  /** Sends a checkout rate request the way Shopify does: raw JSON signed with the app secret. */
  const askRates = (shopId: string, rate: Record<string, unknown>, secret = SECRET) => {
    const body = JSON.stringify({ rate: { currency: 'EGP', locale: 'en', ...rate } });
    return request(app.getHttpServer())
      .post(`/shopify/rates/${shopId}`)
      .set('content-type', 'application/json')
      .set('x-shopify-hmac-sha256', createHmac('sha256', secret).update(body).digest('base64'))
      .send(body);
  };
  const origin = (code: string) => ({
    country: 'EG',
    city: 'Cairo',
    address1: 'Store street',
    address2: `Shiply Now ${code}`,
  });
  const home = (address1 = 'Street 9, Fifth Settlement') => ({
    country: 'EG',
    province: 'Cairo',
    city: 'New Cairo',
    address1,
    address2: '',
    postal_code: '11835',
  });

  it('sets up checkout: dark store addresses on each location and one rate service', async () => {
    const { shop } = await install();
    expect(fake.carrierServices).toEqual([
      expect.objectContaining({
        name: 'Shiply Now 60 minutes',
        callbackUrl: `http://localhost:3000/api/shopify/rates/${shop.id}`,
      }),
    ]);
    expect(shop.carrierServiceId).toBe(fake.carrierServices[0]!.id);
    expect(fake.locationAddresses.get(await locationOf('NCR'))).toMatchObject({
      name: 'Shiply Now New Cairo',
      address1: 'South 90th Street, Fifth Settlement, New Cairo',
      address2: 'Shiply Now NCR',
      countryCode: 'EG',
      provinceCode: 'C',
    });
  });

  it('offers the 60 minute rate only when the store, zone, hours and stock all allow it', async () => {
    const { shop, admin } = await install();
    const [ec001] = fake.variants;
    const item = (quantity: number, extra: Record<string, unknown> = {}) => ({
      sku: 'EC-001',
      variant_id: Number(ec001!.id.split('/').pop()),
      quantity,
      requires_shipping: true,
      ...extra,
    });
    const ask = (rate: Record<string, unknown>) =>
      askRates(shop.id, { origin: origin('NCR'), destination: home(), items: [item(1)], ...rate });

    // Shopify must sign the request.
    await askRates(shop.id, { origin: origin('NCR') }, 'wrong-secret').expect(401);
    // The merchant has not set a price yet, so nothing is offered.
    expect((await ask({}).expect(200)).body).toEqual({ rates: [] });

    // Only the merchant sets the price; admin can see it but not change it.
    const merchant = await agent('merchant@evechantelle.example');
    await merchant.put('/merchant/delivery').send({ expressPricePiastres: 4500 }).expect(200);
    await admin.put('/merchant/delivery').send({ expressPricePiastres: 1 }).expect(403);
    expect((await merchant.get('/merchant/delivery').expect(200)).body).toEqual({
      expressPricePiastres: 4500,
      shopify: { status: 'active', checkoutRateReady: true },
    });
    const overview = await admin.get('/admin/shopify').expect(200);
    expect(overview.body.shops[0].expressPricePiastres).toBe(4500);

    geocoder.calls = 0;
    const offered = await ask({}).expect(200);
    expect(offered.body.rates).toEqual([
      {
        service_name: 'Delivery in 60 minutes',
        service_code: 'SN60:NCR',
        total_price: '4500',
        description: 'Arrives within 60 minutes from Shiply Now',
        currency: 'EGP',
      },
    ]);
    const arabic = await ask({ locale: 'ar' }).expect(200);
    expect(arabic.body.rates[0].service_name).toBe('توصيل خلال 60 دقيقة');
    // The address was placed once; later checkouts use the cache.
    expect(geocoder.calls).toBe(1);

    const level = await prisma.stockLevel.findFirstOrThrow({
      where: { darkStoreId: stores.get('NCR'), sku: { sku: 'EC-001' } },
    });
    const available = level.onHand - level.reserved;
    const none = async (rate: Record<string, unknown>) =>
      expect((await ask(rate).expect(200)).body.rates).toEqual([]);
    await none({ items: [item(available + 1)] }); // not enough stock
    await none({ items: [item(1), item(available)] }); // the same product twice adds up
    await none({ items: [{ sku: 'NOT-OURS', quantity: 1 }] }); // unknown product
    await none({ origin: origin('MAA') }); // Shopify planned Maadi, the address is New Cairo's
    await none({ origin: { ...origin('NCR'), address2: 'Warehouse' } }); // merchant's own place
    await none({ destination: home('Corniche, Alexandria') }); // outside every zone
    await none({ destination: home('somewhere unknown') }); // address not found
    await none({ destination: { ...home(), country: 'SA' } });
    await none({ currency: 'USD' });
    // Items that do not ship (gift cards) do not block the rate.
    expect(
      (await ask({ items: [item(1), { sku: 'GIFT', quantity: 1, requires_shipping: false }] })).body
        .rates,
    ).toHaveLength(1);

    // Closed stores offer nothing.
    clock.set(EARLY_CAIRO);
    await none({});
    clock.set(NOON_CAIRO);

    // When the address cannot be placed now, Shopify should retry soon, not cache "no rate".
    await ask({ destination: home('boom street') }).expect(503);

    const logged = await prisma.shopifyLog.findMany({
      where: { shopId: shop.id, kind: 'checkout_rate' },
      select: { message: true },
    });
    expect(new Set(logged.map((l) => l.message))).toEqual(
      new Set([
        'no_price',
        'offered',
        'out_of_stock',
        'unknown_product',
        'outside_zone',
        'unknown_origin',
        'address_not_found',
        'outside_egypt',
        'currency',
        'store_closed',
      ]),
    );
  });

  it('hands next day orders back to the merchant once checkout rates are on', async () => {
    const { shop } = await install();
    const ec001 = fake.variants[0]!;
    const fo = fake.addRequest({
      name: '#1010',
      locationId: await locationOf('NCR'),
      lines: [{ id: 'li-10', sku: 'EC-001', variantId: ec001.id, quantity: 1, price: '325.00' }],
      outstanding: '325.00',
      shipping: '30.00',
      shippingCode: 'Standard',
      address: { name: 'C', phone: '01012345678', address1: 'x', city: 'New Cairo', ...NEW_CAIRO },
    });
    await jobs.runShop(shop);
    expect(fake.fulfillmentOrders.find((f) => f.id === fo.id)!.rejected).toEqual({
      reason: 'OTHER',
      message: 'Not a 60 minute order; ship it normally',
    });
    expect(await prisma.order.count({ where: { shopifyFulfillmentOrderId: fo.id } })).toBe(0);
  });
});
