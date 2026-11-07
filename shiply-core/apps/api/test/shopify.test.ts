// The Shopify connection, against a local stand in for Shopify: the signed install, orders that
// become parcels (or wait for a fix), duplicates ignored, cancellations, Shopify told when the
// parcel ships and when cash is collected, and the store removed when the app is uninstalled.
import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createTestDatabase, dropTestDatabase, TEST_DB } from './setup-db';

process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.SHIPLY_JOBS = 'off';
process.env.SHOPIFY_API_KEY = 'app-key';
process.env.SHOPIFY_API_SECRET = 'app-secret';
process.env.SHOPIFY_APP_URL = 'https://shiply.test';

const SHOP = 'eve-store.myshopify.com';
let app: INestApplication;
let prisma: any;
let shopify: any;
let core: any;
let merchant: ReturnType<typeof request.agent>;
let fake: Server;
const calls: { path: string; body: any }[] = [];

async function ok<T = any>(req: request.Test, status = 200): Promise<T> {
  const res = await req;
  if (res.status !== status) throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as T;
}

function signedQuery(q: Record<string, string>) {
  const message = Object.keys(q).sort().map((k) => `${k}=${q[k]}`).join('&');
  return { ...q, hmac: createHmac('sha256', 'app-secret').update(message).digest('hex') };
}

function hook(topic: string, body: object, secret = 'app-secret') {
  const raw = JSON.stringify(body);
  return request(app.getHttpServer())
    .post('/integrations/shopify/webhooks')
    .set('content-type', 'application/json')
    .set('x-shopify-topic', topic)
    .set('x-shopify-shop-domain', SHOP)
    .set('x-shopify-hmac-sha256', createHmac('sha256', secret).update(raw).digest('base64'))
    .send(raw);
}

/** An order as the Admin GraphQL API returns it. 6003 ships to Sohag, outside the area we serve. */
function gql(id: string) {
  const sohag = id === '6003';
  return {
    id: `gid://shopify/Order/${id}`, legacyResourceId: id, name: `#S${id}`, note: null, phone: null, currencyCode: 'EGP', displayFinancialStatus: 'PENDING', displayFulfillmentStatus: 'UNFULFILLED',
    cancelledAt: null, paymentGatewayNames: ['Cash on Delivery (COD)'], totalPriceSet: { shopMoney: { amount: '250.00' } }, totalOutstandingSet: { shopMoney: { amount: '250.00' } },
    customer: { firstName: 'Omar', lastName: 'Fathy', phone: null }, billingAddress: null, lineItems: { nodes: [{ title: 'Sneakers', quantity: 1 }] },
    shippingAddress: { name: 'Omar Fathy', phone: '01212345678', address1: '8 Shehab St', address2: null, city: sohag ? 'Sohag' : 'Mohandessin', province: sohag ? 'Sohag' : 'Giza', provinceCode: sohag ? 'SHG' : 'GZ', countryCodeV2: 'EG' },
  };
}

function signedIds(ids: string[], extra: Record<string, string> = {}) {
  const q: Record<string, string> = { shop: SHOP, timestamp: String(Math.floor(Date.now() / 1000)), ...extra };
  const message = [...Object.keys(q).map((k) => [k, q[k]!] as const), ['ids', `[${ids.map((i) => `"${i}"`).join(', ')}]`] as const].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  const hmac = createHmac('sha256', 'app-secret').update(message).digest('hex');
  return [...ids.map((i) => `ids[]=${i}`), ...Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`), `hmac=${hmac}`].join('&');
}

let next = 5000;
function order(extra: Record<string, unknown> = {}) {
  next++;
  return {
    id: next, name: `#${next}`, currency: 'EGP', total_price: '450.00', total_outstanding: '450.00', financial_status: 'pending', payment_gateway_names: ['Cash on Delivery (COD)'],
    note: 'Ring twice', line_items: [{ title: 'Silk dress', quantity: 1 }],
    shipping_address: { name: 'Mona Adel', phone: '01012345678', address1: '12 Mossadak St', city: 'Dokki', province: 'Giza', province_code: 'GZ', country_code: 'EG' },
    ...extra,
  };
}

beforeAll(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      calls.push({ path: req.url ?? '', body });
      res.setHeader('content-type', 'application/json');
      if (req.url?.endsWith('/admin/oauth/access_token')) return res.end(JSON.stringify({ access_token: 'shpat_secret_token', scope: 'read_orders,write_orders' }));
      const q: string = body.query ?? '';
      if (q.includes('nodes(ids')) return res.end(JSON.stringify({ data: { nodes: body.variables.ids.map((gid: string) => gql(gid.split('/').pop()!)) } }));
      if (q.includes('orders(first')) return res.end(JSON.stringify({ data: { orders: { nodes: ['7001', '7002'].map(gql) } } }));
      if (q.includes('webhookSubscriptionCreate')) return res.end(JSON.stringify({ data: { webhookSubscriptionCreate: { userErrors: [] } } }));
      if (q.includes('fulfillmentOrders')) return res.end(JSON.stringify({ data: { order: { fulfillmentOrders: { nodes: [{ id: 'gid://shopify/FulfillmentOrder/77', status: 'OPEN' }] } } } }));
      if (q.includes('fulfillmentCreate')) return res.end(JSON.stringify({ data: { fulfillmentCreate: { fulfillment: { id: 'gid://shopify/Fulfillment/1' }, userErrors: [] } } }));
      if (q.includes('orderMarkAsPaid')) return res.end(JSON.stringify({ data: { orderMarkAsPaid: { userErrors: [] } } }));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  process.env.SHOPIFY_ADMIN_BASE = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  await createTestDatabase();
  const { createApp } = await import('../src/main');
  const { PrismaService } = await import('../src/common/prisma.service');
  const { ShopifyService } = await import('../src/integrations/shopify.service');
  const { ShipmentsCore } = await import('../src/core/shipments.core');
  app = await createApp();
  await app.init();
  prisma = app.get(PrismaService);
  shopify = app.get(ShopifyService);
  core = app.get(ShipmentsCore);
  merchant = request.agent(app.getHttpServer());
  await ok(merchant.post('/auth/login').send({ login: 'merchant@evechantelle.example', password: 'demo12345' }));
});

afterAll(async () => {
  await app?.close();
  await dropTestDatabase();
  fake?.close();
});

describe('shopify', () => {
  it('reads Egyptian provinces however Shopify sends them', async () => {
    const { governorateFor, normalizeShop } = await import('../src/integrations/shopify');
    const govs = await prisma.governorate.findMany({ select: { code: true, nameEn: true, nameAr: true } });
    expect(governorateFor({ province_code: 'GZ' }, govs)).toBe('GIZ');
    expect(governorateFor({ province_code: 'EG-C' }, govs)).toBe('CAI');
    expect(governorateFor({ province: 'Alexandria Governorate' }, govs)).toBe('ALX');
    expect(governorateFor({ province: '6th of October' }, govs)).toBe('GIZ');
    expect(governorateFor({ province: 'Atlantis' }, govs)).toBeNull();
    expect(normalizeShop('https://Eve-Store.myshopify.com/admin')).toBe(SHOP);
    expect(normalizeShop('eve-store')).toBe(SHOP);
    expect(normalizeShop('evil.com')).toBeNull();
  });

  it('installs with Shopify signatures checked, keeps the token encrypted, and listens for orders', async () => {
    expect((await ok(merchant.get('/merchant/shopify'))).configured).toBe(true);
    expect((await merchant.post('/merchant/shopify/install').send({ shop: 'evil.com' })).status).toBe(422);
    const { url } = await ok(merchant.post('/merchant/shopify/install').send({ shop: 'eve-store' }));
    const u = new URL(url);
    expect(u.host).toBe(SHOP);
    expect(u.searchParams.get('redirect_uri')).toBe('https://shiply.test/api/integrations/shopify/callback');
    const state = u.searchParams.get('state')!;

    const forged = await request(app.getHttpServer()).get('/integrations/shopify/callback').query({ code: 'abc', shop: SHOP, state, timestamp: '1', hmac: 'nope' });
    expect(forged.status).toBe(302);
    expect(forged.headers.location).toContain('error=signature');
    const otherShop = await request(app.getHttpServer()).get('/integrations/shopify/callback').query(signedQuery({ code: 'abc', shop: 'other.myshopify.com', state, timestamp: '1' }));
    expect(otherShop.headers.location).toContain('error=mismatch');

    const res = await request(app.getHttpServer()).get('/integrations/shopify/callback').query(signedQuery({ code: 'abc', shop: SHOP, state, timestamp: '1' }));
    expect(res.headers.location).toBe('https://shiply.test/merchant/shopify?connected=1');
    const store = await prisma.shopifyStore.findUnique({ where: { shop: SHOP } });
    expect(store.active).toBe(true);
    expect(store.tokenEnc).not.toContain('shpat_secret_token');
    expect(calls.filter((c) => c.body.query?.includes('webhookSubscriptionCreate')).map((c) => c.body.variables.topic)).toEqual(['ORDERS_CREATE', 'ORDERS_CANCELLED', 'APP_UNINSTALLED']);
    expect(JSON.stringify(await ok(merchant.get('/merchant/shopify')))).not.toContain('tokenEnc');
  });

  it('a new COD order becomes a parcel when automatic parcels are on; the same order twice makes one; forged calls are refused', async () => {
    expect((await prisma.shopifyStore.findUnique({ where: { shop: SHOP } })).autoCreate).toBe(false); // off unless the merchant turns it on
    await ok(merchant.put('/merchant/shopify/settings').send({ autoCreate: true, defaultSize: 'M', pushUpdates: true }));
    const o = order();
    expect((await hook('orders/create', o, 'wrong-secret')).status).toBe(401);
    await ok(hook('orders/create', o));
    await ok(hook('orders/create', o));
    const rows = await prisma.shopifyOrder.findMany({ where: { orderId: String(o.id) } });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('CREATED');
    const s = await prisma.shipment.findUnique({ where: { id: rows[0].shipmentId } });
    expect(s.merchantRef).toBe(o.name);
    expect(s.codAmount).toBe(45000);
    expect(s.governorateCode).toBe('GIZ');
    expect(s.description).toBe('1 x Silk dress');
    // A paid order collects nothing at the door.
    const paid = order({ financial_status: 'paid', payment_gateway_names: ['shopify_payments'] });
    await ok(hook('orders/create', paid));
    const p = await prisma.shopifyOrder.findFirst({ where: { orderId: String(paid.id) } });
    expect((await prisma.shipment.findUnique({ where: { id: p.shipmentId } })).codAmount).toBe(0);
  });

  it('an order missing something waits for the merchant to fix it; one outside Egypt is skipped', async () => {
    const bad = order({ shipping_address: { name: 'Sara', phone: '12345', address1: '3 Nile St', city: 'Somewhere', province: 'Atlantis', country_code: 'EG' } });
    await ok(hook('orders/create', bad));
    const row = await prisma.shopifyOrder.findFirst({ where: { orderId: String(bad.id) } });
    expect(row.status).toBe('FAILED');
    expect(row.error).toContain('not an Egyptian mobile number');
    expect(row.error).toContain('governorate');
    expect((await merchant.post(`/merchant/shopify/orders/${row.id}/create`).send({ customerPhone: '01112345678' })).status).toBe(422);
    const fixed = await ok(merchant.post(`/merchant/shopify/orders/${row.id}/create`).send({ customerPhone: '01112345678', governorateCode: 'CAI' }));
    expect(fixed.status).toBe('CREATED');

    const abroad = order({ shipping_address: { name: 'Ali', phone: '01012345678', address1: '1 Main', city: 'Dubai', country_code: 'AE' } });
    await ok(hook('orders/create', abroad));
    expect((await prisma.shopifyOrder.findFirst({ where: { orderId: String(abroad.id) } })).status).toBe('SKIPPED');

    // With automatic parcels off, new orders wait for one press.
    await ok(merchant.put('/merchant/shopify/settings').send({ autoCreate: false, defaultSize: 'L', pushUpdates: true }));
    const waits = order();
    await ok(hook('orders/create', waits));
    const w = await prisma.shopifyOrder.findFirst({ where: { orderId: String(waits.id) } });
    expect(w.status).toBe('WAITING');
    const made = await ok(merchant.post(`/merchant/shopify/orders/${w.id}/create`).send({}));
    expect((await prisma.shipment.findUnique({ where: { id: made.shipmentId } })).size).toBe('L');
    await ok(merchant.put('/merchant/shopify/settings').send({ autoCreate: true, defaultSize: 'M', pushUpdates: true }));
  });

  it('Shopify hears when the parcel ships and when the cash is collected', async () => {
    const o = order();
    await ok(hook('orders/create', o));
    const row = await prisma.shopifyOrder.findFirst({ where: { orderId: String(o.id) } });
    let s = await prisma.shipment.findUnique({ where: { id: row.shipmentId } });
    await prisma.tx((tx: any) => core.move(tx, s, 'PICKED_UP', {}, { type: 'PICKED_UP' }));
    expect(await prisma.shopifyTask.count({ where: { shipmentId: s.id, kind: 'FULFILL' } })).toBe(1);
    expect((await shopify.runTasks()).done).toBe(1);
    const f = calls.find((c) => c.body.query?.includes('fulfillmentCreate'))!;
    expect(f.body.variables.f.trackingInfo.number).toBe(s.trackingNumber);
    expect(f.body.variables.f.lineItemsByFulfillmentOrder[0].fulfillmentOrderId).toBe('gid://shopify/FulfillmentOrder/77');

    await prisma.shipment.update({ where: { id: s.id }, data: { status: 'OUT_FOR_DELIVERY' } });
    s = await prisma.shipment.findUnique({ where: { id: s.id } });
    await prisma.tx((tx: any) => core.move(tx, s, 'DELIVERED', { codCollected: 45000 }, { type: 'DELIVERED' }));
    expect((await shopify.runTasks()).done).toBe(1);
    expect(calls.find((c) => c.body.query?.includes('orderMarkAsPaid'))!.body.variables.input.id).toBe(`gid://shopify/Order/${o.id}`);
  });

  it('a failing Shopify call is retried later; a cancelled order cancels a parcel not yet picked up', async () => {
    const o = order();
    await ok(hook('orders/create', o));
    const row = await prisma.shopifyOrder.findFirst({ where: { orderId: String(o.id) } });
    await ok(hook('orders/cancelled', { ...o, cancelled_at: new Date().toISOString() }));
    expect((await prisma.shipment.findUnique({ where: { id: row.shipmentId } })).status).toBe('CANCELLED');

    const o2 = order();
    await ok(hook('orders/create', o2));
    const r2 = await prisma.shopifyOrder.findFirst({ where: { orderId: String(o2.id) } });
    const s2 = await prisma.shipment.findUnique({ where: { id: r2.shipmentId } });
    const saved = process.env.SHOPIFY_ADMIN_BASE;
    process.env.SHOPIFY_ADMIN_BASE = 'http://127.0.0.1:1';
    await prisma.tx((tx: any) => core.move(tx, s2, 'PICKED_UP', {}, { type: 'PICKED_UP' }));
    await shopify.runTasks();
    const t = await prisma.shopifyTask.findFirst({ where: { shipmentId: s2.id } });
    expect(t.status).toBe('PENDING');
    expect(t.attempts).toBe(1);
    expect(t.error).toBeTruthy();
    process.env.SHOPIFY_ADMIN_BASE = saved;
    await prisma.shopifyTask.update({ where: { id: t.id }, data: { nextAttemptAt: new Date() } });
    await shopify.runTasks();
    expect((await prisma.shopifyTask.findUnique({ where: { id: t.id } })).status).toBe('DONE');
  });

  it('the merchant ticks orders in Shopify and makes AWBs for just those, with labels to print', async () => {
    await ok(merchant.put('/merchant/shopify/settings').send({ autoCreate: false, defaultSize: 'M', pushUpdates: true }));
    await prisma.governorate.update({ where: { code: 'SHG' }, data: { hubId: null } }); // Sohag is not served
    const bad = await request(app.getHttpServer()).get(`/integrations/shopify/ship?${signedIds(['6001']).replace(/hmac=\w+/, 'hmac=forged')}`);
    expect(bad.headers.location).toContain('error=signature');

    const res = await request(app.getHttpServer()).get(`/integrations/shopify/ship?${signedIds(['6001', '6002', '6003'])}`);
    expect(res.status).toBe(302);
    expect(res.headers.location.split('?')[1]).toContain('token=');
    const token = decodeURIComponent(new URL(res.headers.location).searchParams.get('token')!);
    const view = await ok(request(app.getHttpServer()).get('/integrations/shopify/ship/orders').query({ token }));
    expect(view.merchant).toBe('Eve Chantelle');
    expect(view.orders.length).toBe(3);
    const sohag = view.orders.find((o: any) => o.orderId === '6003');
    expect(sohag.status).toBe('FAILED');
    expect(sohag.error).toContain('do not deliver to Sohag');
    const ready = view.orders.filter((o: any) => o.status === 'WAITING');
    expect(ready.length).toBe(2);
    expect(view.served.some((g: any) => g.code === 'SHG')).toBe(false);

    // Only orders picked in Shopify can be shipped from this page.
    const other = await prisma.shopifyOrder.findFirst({ where: { status: 'CREATED' } });
    expect((await request(app.getHttpServer()).post('/integrations/shopify/ship/create').send({ token, orders: [{ id: other.id }] })).status).toBe(403);
    expect((await request(app.getHttpServer()).post('/integrations/shopify/ship/create').send({ token: 'nonsense-token', orders: [{ id: ready[0].id }] })).status).toBe(401);

    const made = await ok(request(app.getHttpServer()).post('/integrations/shopify/ship/create').send({ token, orders: [...ready.map((o: any) => ({ id: o.id })), { id: sohag.id }] }));
    expect(made.created).toBe(2);
    expect(made.failed).toBe(1);
    expect(made.labels.length).toBe(2);
    expect(made.labels[0].route).toBe('GIZ');
    expect(made.labels[0].routeDetail).toBe('OBR > GIZ');
    expect(made.labels[0].codAmount).toBe(25000);
    // Making them again does not make more parcels.
    const again = await ok(request(app.getHttpServer()).post('/integrations/shopify/ship/create').send({ token, orders: ready.map((o: any) => ({ id: o.id })) }));
    expect(again.labels.map((l: any) => l.trackingNumber).sort()).toEqual(made.labels.map((l: any) => l.trackingNumber).sort());
    expect(await prisma.shipment.count({ where: { merchantRef: { in: ['#S6001', '#S6002'] } } })).toBe(2);
  });

  it('in the Shiply panel the merchant brings in open orders and ticks the ones to ship', async () => {
    const r = await ok(merchant.post('/merchant/shopify/sync'));
    expect(r.found).toBe(2);
    expect(r.added).toBe(2);
    expect((await ok(merchant.post('/merchant/shopify/sync'))).added).toBe(0);
    const rows = await prisma.shopifyOrder.findMany({ where: { orderId: { in: ['7001', '7002'] } } });
    expect(rows.every((x: any) => x.status === 'WAITING')).toBe(true);
    const made = await ok(merchant.post('/merchant/shopify/orders/create').send({ orders: [{ id: rows[0].id, fix: { size: 'L' } }] }));
    expect(made.created).toBe(1);
    expect((await prisma.shipment.findFirst({ where: { merchantRef: rows[0].orderName } })).size).toBe('L');
  });

  it('uninstalling the app stops the store and forgets the token', async () => {
    await ok(hook('app/uninstalled', { id: 1 }));
    const store = await prisma.shopifyStore.findUnique({ where: { shop: SHOP } });
    expect(store.active).toBe(false);
    expect(store.tokenEnc).toBe('');
    const o = order();
    await ok(hook('orders/create', o));
    expect(await prisma.shopifyOrder.count({ where: { orderId: String(o.id) } })).toBe(0);
    await ok(hook('customers/redact', { shop_domain: SHOP }));
  });
});
