import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  openToken,
  sealToken,
  verifyBodyHmac,
  verifyProxySignature,
  verifyQueryHmac,
} from '../src/shopify/security';
import { moneyToPiastres } from '../src/shopify/shopify-admin';
import { ShopDataService } from '../src/shopify/shop-data.service';
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
    // A missing app secret must never turn into "anything goes".
    const empty = createHmac('sha256', '').update(body).digest('base64');
    expect(verifyBodyHmac(body, empty, '')).toBe(false);
    const emptyQuery = createHmac('sha256', '')
      .update('code=c&shop=' + SHOP)
      .digest('hex');
    expect(verifyQueryHmac({ code: 'c', shop: SHOP, hmac: emptyQuery }, '')).toBe(false);
    expect(verifyProxySignature({ shop: SHOP, signature: 'x' }, '')).toBe(false);
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
      if (addressed === 3 && linked >= 2 && ready === 1 && fake.webhooks.length === 6) break;
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
    fake.webhooks = [];
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

    // The shop's own webhooks point at this deployment, once each.
    const hooks = 'http://localhost:3000/api/shopify/webhooks';
    expect(fake.webhooks.map((w) => `${w.topic} ${w.uri}`).sort()).toEqual(
      [
        'APP_UNINSTALLED',
        'ORDERS_CREATE',
        'ORDERS_UPDATED',
        'PRODUCTS_CREATE',
        'PRODUCTS_DELETE',
        'PRODUCTS_UPDATE',
      ].map((t) => `${t} ${hooks}`),
    );
    // Running it again changes nothing; a moved address is updated in place.
    const admin = await agent('admin@test.eg', 'admin-password-1');
    await admin.post(`/admin/shopify/${shop.id}/register-locations`).expect(201);
    expect(fake.webhooks).toHaveLength(6);
    fake.webhooks[0]!.uri = 'https://old-tunnel.trycloudflare.com/api/shopify/webhooks';
    await admin.post(`/admin/shopify/${shop.id}/register-locations`).expect(201);
    expect(fake.webhooks.map((w) => w.uri)).toEqual(Array(6).fill(hooks));

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
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fake.fulfillments[0]!.trackingUrl).toBe(
      `http://localhost:3000/t/${fresh.trackingToken}`,
    );

    // The customer follows the rider on the tracking page.
    const rider = await agent('rider.newcairo@shiplynow.local');
    await rider.post('/rider/location').send({ lat: 30.02, lng: 31.47 }).expect(201);
    const onRoad = await request(app.getHttpServer())
      .get(`/track/${fresh.trackingToken}`)
      .expect(200);
    expect(onRoad.body).toMatchObject({
      status: 'out_for_delivery',
      deliveryCode: fresh.deliveryOtp,
      riderPosition: { lat: 30.02, lng: 31.47 },
    });
    const deliveries = await rider.get('/rider/deliveries').expect(200);
    await rider
      .post(`/rider/deliveries/${deliveries.body[0].id}/complete`)
      .send({ otp: fresh.deliveryOtp, codCollectedPiastres: fresh.codAmountPiastres })
      .expect(201);
    await jobs.runShop(shop);
    expect(fake.fulfillments[0]!.events).toEqual(['DELIVERED']);
    expect(await prisma.shopifyOutbox.count({ where: { doneAt: null } })).toBe(0);

    const customer = request(app.getHttpServer());
    await customer.post(`/track/${fresh.trackingToken}/rating`).send({ stars: 9 }).expect(400);
    await customer
      .post(`/track/${fresh.trackingToken}/rating`)
      .send({ stars: 5, comment: 'Fast' })
      .expect(201);
    await customer.post(`/track/${fresh.trackingToken}/rating`).send({ stars: 4 }).expect(409);
    const done = await customer.get(`/track/${fresh.trackingToken}`).expect(200);
    expect(done.body).toMatchObject({ deliveryCode: null, rating: { stars: 5 }, canRate: false });
    await customer.get('/track/not-a-real-token-at-all').expect(404);
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

  it('takes over its own locations left in the shop by an earlier install', async () => {
    // The shop still has our three services from a laptop test, pointing at a dead address.
    for (const name of ['Shiply Now Maadi', 'Shiply Now New Cairo', 'Shiply Now Zamalek'])
      fake.services.push({
        id: `gid://shopify/FulfillmentService/old-${name.length}${name.at(-1)}`,
        name,
        callbackUrl: 'https://old-tunnel.trycloudflare.com/api/shopify/fs/x',
        locationId: `gid://shopify/Location/old-${name}`,
      });
    await install();
    expect(fake.services).toHaveLength(3);
    const rows = await prisma.shopifyLocation.findMany();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const service = fake.services.find((s) => s.locationId === row.locationId)!;
      expect(service.callbackUrl).toBe(`http://localhost:3000/api/shopify/fs/${row.id}`);
    }
  });

  it('starts clean when admin links the merchant to a different store', async () => {
    const { admin, shop } = await install();
    expect(await prisma.shopifyLocation.count({ where: { shopId: shop.id } })).toBe(3);
    // Linking the same store again changes nothing.
    await admin
      .post('/admin/shopify/link')
      .send({ merchantId, shopDomain: 'shiplynow-test' })
      .expect(201);
    expect((await prisma.shopifyShop.findUniqueOrThrow({ where: { id: shop.id } })).status).toBe(
      'active',
    );

    await admin
      .post('/admin/shopify/link')
      .send({ merchantId, shopDomain: 'shiplynow-adv' })
      .expect(201);
    const moved = await prisma.shopifyShop.findUniqueOrThrow({ where: { id: shop.id } });
    expect(moved).toMatchObject({
      shopDomain: 'shiplynow-adv.myshopify.com',
      status: 'pending',
      accessTokenEnc: null,
      carrierServiceId: null,
    });
    expect(await prisma.shopifyLocation.count({ where: { shopId: shop.id } })).toBe(0);
    expect(await prisma.sku.count({ where: { merchantId, shopifyVariantId: { not: null } } })).toBe(
      0,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'shopify.link', entityId: shop.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.before).toMatchObject({ shopDomain: SHOP, status: 'active' });
  });

  it('disconnects a store: removes our locations and rate service there, then the link', async () => {
    const { admin, shop } = await install();
    await admin.post(`/admin/shopify/${shop.id}/carrier-service`).expect(201);
    expect(fake.services).toHaveLength(3);
    expect(fake.carrierServices).toHaveLength(1);

    const res = await admin.post(`/admin/shopify/${shop.id}/disconnect`).expect(201);
    expect(res.body).toEqual({ disconnected: true, notRemovedInShopify: 0 });
    expect(fake.services).toHaveLength(0);
    expect(fake.carrierServices).toHaveLength(0);
    expect(await prisma.shopifyShop.count()).toBe(0);
    expect(await prisma.shopifyLocation.count()).toBe(0);
    expect(await prisma.sku.count({ where: { merchantId, shopifyVariantId: { not: null } } })).toBe(
      0,
    );
    expect(await prisma.auditLog.count({ where: { action: 'shopify.disconnect' } })).toBe(1);
    await admin.post(`/admin/shopify/${shop.id}/disconnect`).expect(404);

    // The merchant can now be linked to another store.
    await admin
      .post('/admin/shopify/link')
      .send({ merchantId, shopDomain: 'shiplynow-adv' })
      .expect(201);
  });

  it('collects the whole store: products, stock per location and orders, then insights', async () => {
    const { admin, shop } = await install();
    const P = 'gid://shopify/Product/9001';
    const V = 'gid://shopify/ProductVariant/9101';
    const I = 'gid://shopify/InventoryItem/9201';
    const ours = await locationOf('NCR');
    fake.store.products = [
      {
        id: P,
        title: 'Rose Serum',
        status: 'ACTIVE',
        vendor: 'Eve',
        productType: 'Serum',
        tags: ['face'],
        createdAt: '2025-01-05T10:00:00Z',
        category: {
          id: 'gid://shopify/TaxonomyCategory/hb',
          fullName: 'Health & Beauty > Personal Care > Cosmetics',
        },
        mediaCount: { count: 3 },
        totalInventory: 12,
      },
      {
        id: V,
        __parentId: P,
        title: '30 ml',
        sku: 'EC-016',
        barcode: '622000',
        price: '325.50',
        compareAtPrice: '400.00',
        inventoryItem: {
          id: I,
          unitCost: { amount: '120.00' },
          measurement: { weight: { value: 0.2, unit: 'KILOGRAMS' } },
        },
      },
      {
        id: 'gid://shopify/Product/9002',
        title: 'Old Cream',
        status: 'DRAFT',
        productType: 'Cream',
        tags: [],
        totalInventory: 0,
      },
    ];
    fake.store.inventory = [
      { id: I, sku: 'EC-016' },
      {
        id: 'gid://shopify/InventoryLevel/1',
        __parentId: I,
        location: { id: 'gid://shopify/Location/warehouse', name: 'Merchant warehouse' },
        quantities: [
          { name: 'available', quantity: 10 },
          { name: 'on_hand', quantity: 11 },
        ],
      },
      {
        id: 'gid://shopify/InventoryLevel/2',
        __parentId: I,
        location: { id: ours, name: 'Shiply Now New Cairo' },
        quantities: [{ name: 'available', quantity: 2 }],
      },
    ];
    const O = 'gid://shopify/Order/7001';
    fake.store.orders = [
      {
        id: O,
        name: '#1001',
        createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        currencyCode: 'EGP',
        sourceName: 'web',
        test: false,
        subtotalLineItemsQuantity: 2,
        subtotalPriceSet: { shopMoney: { amount: '651.00' } },
        totalDiscountsSet: { shopMoney: { amount: '0.00' } },
        totalPriceSet: { shopMoney: { amount: '701.00' } },
        totalRefundedSet: { shopMoney: { amount: '0.00' } },
        email: 'Mona@Example.com',
        phone: null,
        customer: { id: 'gid://shopify/Customer/501', firstName: 'Mona', lastName: 'Adel' },
        shippingAddress: {
          name: 'Mona Adel',
          phone: '0100 123 4567',
          address1: '12 Street 90',
          province: 'Cairo',
          city: 'New Cairo',
          countryCodeV2: 'EG',
        },
      },
      {
        id: 'gid://shopify/LineItem/1',
        __parentId: O,
        name: 'Rose Serum - 30 ml',
        sku: 'EC-016',
        quantity: 2,
        currentQuantity: 2,
        originalUnitPriceSet: { shopMoney: { amount: '325.50' } },
        totalDiscountSet: { shopMoney: { amount: '0.00' } },
        product: { id: P },
        variant: { id: V },
      },
    ];
    fake.store.customers = [
      {
        id: 'gid://shopify/Customer/501',
        firstName: 'Mona',
        lastName: 'Adel',
        numberOfOrders: '1',
        amountSpent: { amount: '701.00' },
        defaultEmailAddress: { emailAddress: 'mona@example.com', marketingState: 'SUBSCRIBED' },
        defaultPhoneNumber: { phoneNumber: '+201001234567', marketingState: 'NOT_SUBSCRIBED' },
        defaultAddress: { province: 'Cairo', city: 'New Cairo', address1: '12 Street 90' },
        createdAt: '2025-02-01T10:00:00Z',
        updatedAt: '2025-02-01T10:00:00Z',
        tags: ['vip'],
      },
    ];
    fake.denyAddresses = true;
    const data = app.get(ShopDataService);
    const run = async () => {
      for (let i = 0; i < 20; i++) await data.tick(shop);
    };
    await run();

    const kinds = await prisma.shopDataSync.findMany({ orderBy: { startedAt: 'asc' } });
    expect(kinds.map((k) => `${k.kind}:${k.status}:${k.limited ?? ''}`)).toEqual([
      'products:done:',
      'inventory:done:',
      'orders:failed:',
      'orders:failed:contact',
      // Buyer details and addresses refused: orders are collected without them...
      'orders:done:addresses',
      // ...and customer records wait for tomorrow.
      'customers:done:denied',
    ]);
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.shopVariant.findUniqueOrThrow({ where: { shopifyId: V } })).toMatchObject({
      pricePiastres: 32550,
      compareAtPiastres: 40000,
      costPiastres: 12000,
      weightGrams: 200,
    });
    expect(await prisma.shopProduct.findUniqueOrThrow({ where: { shopifyId: P } })).toMatchObject({
      categoryTop: 'Health & Beauty',
      status: 'ACTIVE',
    });
    const levels = await prisma.shopInventoryLevel.findMany({ orderBy: { available: 'desc' } });
    expect(levels.map((l) => [l.available, l.ours])).toEqual([
      [10, false],
      [2, true],
    ]);
    expect(
      (await prisma.shopifyShop.findUniqueOrThrow({ where: { id: shop.id } })).profile,
    ).toMatchObject({
      shop: { name: 'Test Shop' },
    });

    // Nothing is due again until tomorrow, and a rerun does not double anything.
    expect(await data.tick(shop)).toBeNull();
    await data.refreshAll(shop.id);
    fake.denyAddresses = false;
    await run();
    expect(await prisma.shopOrder.count()).toBe(1);
    expect(await prisma.shopOrderLine.count()).toBe(1);
    expect((await prisma.shopOrder.findFirstOrThrow()).province).toBe('Cairo');

    // With protected customer data allowed, the order and the customer record are one person.
    const person = await prisma.customer.findFirstOrThrow({ include: { shopCustomers: true } });
    expect(await prisma.customer.count()).toBe(1);
    expect(person).toMatchObject({
      phone: '+201001234567',
      email: 'mona@example.com',
      name: 'Mona Adel',
      governorate: 'Cairo',
      city: 'New Cairo',
    });
    expect(person.shopCustomers[0]).toMatchObject({
      emailMarketing: 'SUBSCRIBED',
      ordersCount: 1,
      amountSpentPiastres: 70100,
    });
    expect((await prisma.shopOrder.findFirstOrThrow()).customerId).toBe(person.id);

    // A new order arrives by webhook and is saved at once.
    const O2 = 'gid://shopify/Order/7002';
    fake.store.orders.push(
      {
        id: O2,
        name: '#1002',
        createdAt: new Date().toISOString(),
        currencyCode: 'EGP',
        test: false,
        totalPriceSet: { shopMoney: { amount: '325.50' } },
        subtotalLineItemsQuantity: 1,
      },
      {
        id: 'gid://shopify/LineItem/2',
        __parentId: O2,
        name: 'Rose Serum - 30 ml',
        quantity: 1,
        currentQuantity: 1,
        originalUnitPriceSet: { shopMoney: { amount: '325.50' } },
        product: { id: P },
        variant: { id: V },
      },
    );
    const body = JSON.stringify({ id: 7002, admin_graphql_api_id: O2 });
    await request(app.getHttpServer())
      .post('/shopify/webhooks')
      .set('content-type', 'application/json')
      .set('x-shopify-topic', 'orders/create')
      .set('x-shopify-shop-domain', SHOP)
      .set('x-shopify-hmac-sha256', createHmac('sha256', SECRET).update(body).digest('base64'))
      .send(body)
      .expect(200);
    expect(await prisma.shopOrder.count()).toBe(2);

    const insights = (await admin.get(`/admin/data/merchants/${merchantId}`).expect(200)).body;
    expect(insights.catalogue).toMatchObject({ products: 2, active: 1, draft: 1, variants: 1 });
    expect(insights.stock).toMatchObject({ ownWarehouses: 10, inOurStores: 2, warehouses: 1 });
    expect(insights.sales).toMatchObject({ orders: 2, units: 3, revenuePiastres: 70100 + 32550 });
    expect(insights.topProducts[0]).toMatchObject({ title: 'Rose Serum', units90: 3 });
    expect(insights.regions[0]).toMatchObject({ province: 'Cairo' });
    const market = (await admin.get('/admin/data/market').expect(200)).body;
    expect(market.categories[0]).toMatchObject({ category: 'Health & Beauty', merchants: 1 });
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get('/admin/data/market').expect(403);

    // The customer base: found by any phone format, profile opened and the view audited.
    const found = (await admin.get('/admin/customers?q=01001234567').expect(200)).body;
    expect(found.customers).toHaveLength(1);
    expect(found.customers[0]).toMatchObject({ orders: 1, spendPiastres: 70100, merchants: 1 });
    const profile = (await admin.get(`/admin/customers/${found.customers[0].id}`).expect(200)).body;
    expect(profile.categories[0]).toMatchObject({ category: 'Health & Beauty', units: 2 });
    expect(profile.merchants[0]).toMatchObject({ orders: 1 });
    expect(profile.segment).toBe('new');
    expect(
      await prisma.auditLog.count({
        where: { action: 'customer.view', entityId: found.customers[0].id },
      }),
    ).toBe(1);
    const overview = (await admin.get('/admin/customers/overview').expect(200)).body;
    expect(overview).toMatchObject({ customers: 1, buyers: 1, withPhone: 1, withEmail: 1 });
    await staff.get('/admin/customers').expect(403);
    await staff.get(`/admin/customers/${found.customers[0].id}`).expect(403);
    await admin.get('/admin/customers/nobody').expect(404);

    // Shopify's customers/redact forgets the buyer: record, order contact details and person.
    const redact = JSON.stringify({ customer: { id: 501 }, orders_to_redact: [7001] });
    await request(app.getHttpServer())
      .post('/shopify/webhooks')
      .set('content-type', 'application/json')
      .set('x-shopify-topic', 'customers/redact')
      .set('x-shopify-shop-domain', SHOP)
      .set('x-shopify-hmac-sha256', createHmac('sha256', SECRET).update(redact).digest('base64'))
      .send(redact)
      .expect(200);
    expect(await prisma.shopCustomer.count()).toBe(0);
    expect(await prisma.customer.count()).toBe(0);
    const kept = await prisma.shopOrder.findUniqueOrThrow({ where: { shopifyId: O } });
    expect(kept).toMatchObject({ customerId: null, totalPiastres: 70100, province: 'Cairo' });
    expect(kept.raw).not.toHaveProperty('email');
    expect(kept.raw).not.toHaveProperty('shippingAddress');
  });

  it('shows missing permissions, retries customers after a reconnect and takes customer webhooks', async () => {
    const { admin, shop } = await install();
    const list = (await admin.get('/admin/shopify').expect(200)).body;
    expect(list.shops[0].missingScopes).toContain('read_customers');
    // write_inventory includes read_inventory, so that one is not reported missing.
    expect(list.shops[0].missingScopes).not.toContain('read_inventory');

    const data = app.get(ShopDataService);
    const now = new Date();
    // Customers were refused an hour ago, before the store gave the new permission.
    await prisma.shopDataSync.createMany({
      data: (['products', 'inventory', 'orders'] as const)
        .map((kind) => ({ shopId: shop.id, kind, status: 'done', startedAt: now }))
        .concat({
          shopId: shop.id,
          kind: 'customers',
          status: 'done',
          limited: 'denied',
          error: 'ACCESS_DENIED',
          startedAt: new Date(now.getTime() - 3600_000),
        } as never),
    });
    // Connected two hours ago, refused an hour ago: nothing to do until tomorrow.
    const before = await prisma.shopifyShop.update({
      where: { id: shop.id },
      data: { installedAt: new Date(now.getTime() - 7200_000) },
    });
    expect(await data.tick(before, now)).toBeNull();
    await prisma.shopifyShop.update({
      where: { id: shop.id },
      data: { installedAt: now, scopes: 'read_products,read_customers' },
    });
    const fresh = await prisma.shopifyShop.findUniqueOrThrow({ where: { id: shop.id } });
    expect(await data.tick(fresh, now)).toMatchObject({ started: 'customers' });
    // The refused run read nothing, so the new run takes the whole customer list.
    const started = await prisma.shopDataSync.findFirstOrThrow({
      where: { kind: 'customers', status: 'running' },
    });
    expect(started.since).toBeNull();
    expect(fake.bulk.at(-1)!.query).not.toContain('updated_at:>');

    fake.store.customers = [
      {
        id: 'gid://shopify/Customer/777',
        firstName: 'Nour',
        lastName: 'Samir',
        defaultPhoneNumber: { phoneNumber: '+201155566677', marketingState: 'SUBSCRIBED' },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ];
    const body = JSON.stringify({ id: 777, admin_graphql_api_id: 'gid://shopify/Customer/777' });
    await request(app.getHttpServer())
      .post('/shopify/webhooks')
      .set('content-type', 'application/json')
      .set('x-shopify-topic', 'customers/create')
      .set('x-shopify-shop-domain', SHOP)
      .set('x-shopify-hmac-sha256', createHmac('sha256', SECRET).update(body).digest('base64'))
      .send(body)
      .expect(200);
    expect(
      await prisma.customer.findUniqueOrThrow({ where: { phone: '+201155566677' } }),
    ).toMatchObject({ name: 'Nour Samir' });
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

  it('links, adds and reprices products from the signed product webhooks', async () => {
    await install();
    const webhook = (topic: string, payload: unknown, secret = SECRET) => {
      const body = JSON.stringify(payload);
      return request(app.getHttpServer())
        .post('/shopify/webhooks')
        .set('content-type', 'application/json')
        .set('x-shopify-topic', topic)
        .set('x-shopify-shop-domain', SHOP)
        .set('x-shopify-hmac-sha256', createHmac('sha256', secret).update(body).digest('base64'))
        .send(body);
    };
    const product = (price: string) => ({
      id: 777,
      admin_graphql_api_id: 'gid://shopify/Product/777',
      title: 'Oud Candle',
      status: 'active',
      variants: [
        {
          id: 8801,
          admin_graphql_api_id: 'gid://shopify/ProductVariant/8801',
          sku: 'EC-NEW-1',
          barcode: '6221000099991',
          price,
          title: 'Default Title',
          inventory_item_id: 5501,
        },
        { id: 8802, sku: 'EC-001', price: '330.00', title: 'Large', inventory_item_id: 5502 },
        { id: 8803, sku: '', price: '1.00', title: 'No SKU', inventory_item_id: 5503 },
      ],
    });

    await webhook('products/create', product('250.00'), 'wrong-secret').expect(401);
    await webhook('products/create', product('250.00')).expect(200);
    const added = await prisma.sku.findFirstOrThrow({ where: { merchantId, sku: 'EC-NEW-1' } });
    expect(added).toMatchObject({
      titleEn: 'Oud Candle',
      barcode: '6221000099991',
      pricePiastres: 25000,
      shopifyVariantId: 'gid://shopify/ProductVariant/8801',
      shopifyInventoryItemId: 'gid://shopify/InventoryItem/5501',
    });
    const existing = await prisma.sku.findFirstOrThrow({ where: { merchantId, sku: 'EC-001' } });
    expect(existing).toMatchObject({
      shopifyVariantId: 'gid://shopify/ProductVariant/8802',
      pricePiastres: 33000,
    });

    // Shopify may deliver the same webhook twice; nothing changes the second time.
    const count = await prisma.sku.count();
    const audits = await prisma.auditLog.count({ where: { action: 'shopify.product_sync' } });
    await webhook('products/create', product('250.00')).expect(200);
    expect(await prisma.sku.count()).toBe(count);
    expect(await prisma.auditLog.count({ where: { action: 'shopify.product_sync' } })).toBe(audits);

    await webhook('products/update', product('199.50')).expect(200);
    expect(
      (await prisma.sku.findFirstOrThrow({ where: { merchantId, sku: 'EC-NEW-1' } })).pricePiastres,
    ).toBe(19950);

    // Deleted in Shopify: our products stay, without the link.
    await webhook('products/delete', { id: 777 }).expect(200);
    const after = await prisma.sku.findMany({
      where: { merchantId, sku: { in: ['EC-NEW-1', 'EC-001'] } },
    });
    expect(after.map((s) => s.shopifyVariantId)).toEqual([null, null]);
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
