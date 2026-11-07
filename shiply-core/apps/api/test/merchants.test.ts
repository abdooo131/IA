// Merchants and customers: agreed prices and volume tiers, exchanges, customer messages,
// sign up with a phone code and approval, team rights, the logo and the customer's actions on
// the tracking page, recurring pickups and analytics.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestDatabase, dropTestDatabase, TEST_DB } from './setup-db';

process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.SHIPLY_JOBS = 'off';

let app: INestApplication;
let prisma: any;
let desk: any;
type Client = ReturnType<typeof request.agent>;
const as: Record<string, Client> = {};
const hubs: Record<string, string> = {};
const users: Record<string, string> = {};
let dokki: any;
let merchantId = '';
const pub = () => request(app.getHttpServer());

async function login(id: string, password = 'demo12345', status = 200): Promise<Client> {
  const c = request.agent(app.getHttpServer());
  const res = await c.post('/auth/login').send({ login: id, password });
  if (res.status !== status) throw new Error(`login ${id}: ${res.status}`);
  return c;
}

async function ok<T = any>(req: request.Test, status = 200): Promise<T> {
  const res = await req;
  if (res.status !== status) throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as T;
}

const parcel = (extra: object = {}) =>
  ok(as.merchant!.post('/merchant/shipments').send({ customerName: 'Mona', customerPhone: '01012345678', address: '5 Tahrir St', governorateCode: 'GIZ', areaId: dokki.id, codAmount: 30000, ...extra }), 201);

beforeAll(async () => {
  await createTestDatabase();
  const { createApp } = await import('../src/main');
  const { PrismaService } = await import('../src/common/prisma.service');
  const { MerchantDeskService } = await import('../src/merchant/desk.service');
  app = await createApp();
  await app.init();
  prisma = app.get(PrismaService);
  desk = app.get(MerchantDeskService);
  as.admin = await login('admin@shiply.local', 'admin12345');
  as.merchant = await login('merchant@evechantelle.example');
  as.giz = await login('staff.giz@shiply.local');
  as.courierGiz = await login('courier.giz@shiply.local');
  for (const h of await ok(as.admin.get('/admin/hubs'))) hubs[h.code] = h.id;
  for (const u of await ok(as.admin.get('/admin/users'))) if (u.email) users[u.email] = u.id;
  merchantId = (await ok(as.merchant.get('/auth/me'))).merchantId;
  const locs = await ok(as.merchant.get('/reference/locations'));
  dokki = locs.find((g: any) => g.code === 'GIZ').areas.find((a: any) => a.nameEn === 'Dokki');
});

afterAll(async () => {
  await app?.close();
  await dropTestDatabase();
});

describe('merchants and customers', () => {
  it('prices: list price, open package fee, exchange surcharge, agreed price, volume tier', async () => {
    const q = (extra = '') => ok(as.merchant!.get(`/merchant/quote?governorateCode=GIZ&areaId=${dokki.id}&size=M${extra}`));
    const base = await q();
    expect(base.basePrice).toBe(6000);
    expect(base.shippingFee).toBe(6000);
    expect(base.vatIncluded).toBe(6000 - Math.round(600000 / 114));
    expect((await q('&allowOpen=true')).shippingFee).toBe(6500);
    expect((await q('&exchange=true')).shippingFee).toBe(9000);

    await ok(as.admin!.put(`/admin/merchants/${merchantId}/prices`).send({ prices: [{ zoneCode: 'GC', size: 'M', price: 4500 }] }));
    const agreed = await q();
    expect(agreed.shippingFee).toBe(4500);
    expect(agreed.agreed).toBe(true);
    const p = await parcel({ size: 'M', allowOpen: true });
    expect(p.shippingFee).toBe(5000);
    expect(p.basePrice).toBe(4500);
    expect(p.openFee).toBe(500);
    await ok(as.admin!.put(`/admin/merchants/${merchantId}/prices`).send({ prices: [{ zoneCode: 'GC', size: 'M', price: null }] }));

    // One parcel last month puts the merchant in a tier that starts at 1.
    await ok(as.admin!.put('/admin/price-tiers').send({ tiers: [{ name: 'Starter', minParcels: 0, discountBp: 0 }, { name: 'Busy', minParcels: 1, discountBp: 1000 }] }));
    const d = new Date();
    d.setUTCDate(10);
    d.setUTCMonth(d.getUTCMonth() - 1);
    await prisma.shipment.update({ where: { id: p.id }, data: { createdAt: d } });
    expect((await q()).shippingFee).toBe(5400);
    const list = await ok(as.merchant!.get('/merchant/prices'));
    expect(list.tier.name).toBe('Busy');
    expect(list.zones.find((z: any) => z.code === 'GC').prices.BULKY.list).toBe(20000);
  });

  it('an exchange delivers the new item and brings the old one back on the same run', async () => {
    const x = await parcel({ exchange: true });
    expect(x.kind).toBe('EXCHANGE');
    expect(x.exchangeFee).toBeGreaterThan(0);
    await prisma.shipment.update({ where: { id: x.id }, data: { status: 'AT_HUB', currentHubId: hubs.GIZ } });
    const run = await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs`).send({ courierId: users['courier.giz@shiply.local'] }), 201);
    await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/add`).send({ code: x.trackingNumber }));
    await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/start`));
    // The customer gets a message when it goes out.
    const out = await ok(as.admin!.get('/admin/messages'));
    expect(out.some((m: any) => m.template === 'OUT_FOR_DELIVERY' && m.shipmentId === x.id && m.status === 'QUEUED')).toBe(true);

    const stop = (await ok(as.courierGiz!.get('/courier/run'))).items[0];
    const r = await ok(as.courierGiz!.post(`/courier/stops/${stop.id}/deliver`).send({ codCollected: 30000 }));
    expect(r.exchangeReturn).toBeDefined();
    expect((await ok(as.admin!.get('/admin/messages'))).some((m: any) => m.template === 'DELIVERED' && m.shipmentId === x.id)).toBe(true);
    // The run cannot close until the old item is scanned in at the hub.
    expect((await as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 30000 })).status).toBe(409);
    const back = await ok(as.giz!.post(`/hubs/${hubs.GIZ}/inbound`).send({ code: r.exchangeReturn }));
    expect(back.message).toContain('Exchange');
    await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 30000 }));
    const ret = await prisma.shipment.findUnique({ where: { trackingNumber: r.exchangeReturn } });
    expect(ret.direction).toBe('RETURN');
    expect(ret.kind).toBe('EXCHANGE_RETURN');
    expect(ret.linkedShipmentId).toBe(x.id);
  });

  it('a business signs up with a phone code and waits for approval', async () => {
    await ok(pub().post('/auth/signup/code').send({ phone: '01155544433' }));
    const msg = await prisma.message.findFirst({ where: { to: '+201155544433', template: 'OTP' }, orderBy: { createdAt: 'desc' } });
    const code = /(\d{6})/.exec(msg.body)![1];
    const form = { phone: '01155544433', businessName: 'Cairo Gifts', contactName: 'Sara Adel', email: 'sara@cairogifts.example', password: 'gifts12345', pickupAddress: '10 Abbas St, Nasr City', governorateCode: 'CAI' };
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await pub().post('/auth/signup').send({ ...form, code: wrong })).status).toBe(422);
    const r = await ok(pub().post('/auth/signup').send({ ...form, code }), 201);
    expect((await pub().post('/auth/signup').send({ ...form, email: 'other@x.example', code })).status).toBe(422); // code used
    await login('sara@cairogifts.example', 'gifts12345', 401); // not approved yet
    expect((await ok(as.admin!.get('/admin/signups'))).some((m: any) => m.id === r.id)).toBe(true);
    await ok(as.admin!.post(`/admin/merchants/${r.id}/signup/approve`));
    const sara = await login('sara@cairogifts.example', 'gifts12345');
    const me = await ok(sara.get('/merchant/profile'));
    expect(me.homeHub.isSorting).toBe(true);
    for (let i = 0; i < 2; i++) await ok(pub().post('/auth/signup/code').send({ phone: '01155544433' }));
    expect((await pub().post('/auth/signup/code').send({ phone: '01155544433' })).status).toBe(429);
  });

  it('team members only work where they have the right', async () => {
    await ok(as.merchant!.post('/merchant/team').send({ name: 'Hany', email: 'hany@evechantelle.example', password: 'hany12345', rights: ['orders'] }), 201);
    const hany = await login('hany@evechantelle.example', 'hany12345');
    await ok(hany.get('/merchant/shipments'));
    expect((await hany.get('/merchant/statement')).status).toBe(403);
    expect((await hany.get('/merchant/invoices')).status).toBe(403);
    expect((await hany.get('/merchant/team')).status).toBe(403);
    expect((await ok(as.merchant!.get('/merchant/team'))).length).toBe(2);
  });

  it('the customer postpones, confirms, cancels and rates on the tracking page; the logo shows', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
    await ok(as.merchant!.put('/merchant/logo').send({ mime: 'image/png', dataBase64: png }));
    const p = await parcel();
    const logo = await pub().get(`/track/${p.trackingNumber}/logo`);
    expect(logo.status).toBe(200);
    expect(logo.headers['content-type']).toContain('image/png');
    expect((await ok(pub().get(`/track/${p.trackingNumber}`))).hasLogo).toBe(true);

    expect((await pub().post(`/track/${p.trackingNumber}/action`).send({ action: 'CONFIRM', phoneLast4: '9999' })).status).toBe(404);
    await ok(pub().post(`/track/${p.trackingNumber}/action`).send({ action: 'CONFIRM', phoneLast4: '5678', note: 'Third floor, ring twice' }));
    const tomorrow = new Date(Date.now() + 26 * 3600e3).toISOString().slice(0, 10);
    await ok(pub().post(`/track/${p.trackingNumber}/action`).send({ action: 'POSTPONE', phoneLast4: '5678', date: tomorrow }));
    // On the shelf until that day: it cannot go out today.
    await prisma.shipment.update({ where: { id: p.id }, data: { status: 'AT_HUB', currentHubId: hubs.GIZ } });
    await prisma.run.updateMany({ where: { courierId: users['courier.giz@shiply.local'] }, data: { status: 'CLOSED' } });
    const run = await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs`).send({ courierId: users['courier.giz@shiply.local'] }), 201);
    const blocked = await as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/add`).send({ code: p.trackingNumber });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('postponed');

    const c = await parcel();
    await ok(pub().post(`/track/${c.trackingNumber}/action`).send({ action: 'CANCEL', phoneLast4: '5678', note: 'Bought it elsewhere' }));
    expect((await ok(as.admin!.get('/admin/alerts'))).some((a: any) => a.kind === 'CUSTOMER_CANCELLED')).toBe(true);

    const delivered = await prisma.shipment.findFirst({ where: { merchantId, status: 'DELIVERED' } });
    await ok(pub().post(`/track/${delivered.trackingNumber}/action`).send({ action: 'RATE', phoneLast4: '5678', rating: 2, note: 'Late' }));
    expect((await pub().post(`/track/${delivered.trackingNumber}/action`).send({ action: 'RATE', phoneLast4: '5678', rating: 5 })).status).toBe(409);
    expect((await ok(as.admin!.get('/admin/alerts'))).some((a: any) => a.kind === 'LOW_RATING')).toBe(true);
  });

  it('recurring pickups are booked on their days, once', async () => {
    await ok(as.merchant!.put('/merchant/recurring-pickup').send({ weekdays: [0, 1, 2, 3, 4, 5, 6], notes: 'Every day at 2pm' }));
    expect(await desk.createRecurringPickups()).toBe(1);
    expect(await desk.createRecurringPickups()).toBe(0);
    expect((await ok(as.merchant!.get('/merchant/pickups'))).some((p: any) => p.notes === 'Every day at 2pm')).toBe(true);
  });

  it('analytics: delivered, rate, cost per order', async () => {
    const a = await ok(as.merchant!.get('/merchant/analytics?days=30'));
    expect(a.delivered).toBeGreaterThanOrEqual(1);
    expect(a.deliveryRate).toBeGreaterThan(0);
    expect(a.averageCost).toBeGreaterThan(0);
    expect(a.series.length).toBeGreaterThan(0);
  });
});
