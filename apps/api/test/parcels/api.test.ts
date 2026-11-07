// The merchant API: keys shown once and stored hashed, LIVE parcels through the real flow, TEST
// parcels kept in the sandbox, idempotent creates, bulk with per row errors, signed webhooks that
// retry and give up, refusing addresses inside our network, and the per key rate limit.
import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createNetworkApp } from './setup-db';

process.env.SHIPLY_JOBS = 'off';
process.env.WEBHOOKS_ALLOW_PRIVATE = '1';
process.env.API_RATE_PER_MINUTE = '60';

let app: INestApplication;
let prisma: any;
let sender: any;
let merchant: ReturnType<typeof request.agent>;
let live = '';
let test = '';
let server: Server;
let hookUrl = '';
let answer = 200;
const received: { headers: Record<string, string>; body: string }[] = [];

const api = (key: string) => ({
  get: (path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${key}`),
  post: (path: string, body: unknown = {}) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${key}`).send(body as object),
});
const PARCEL = { customerName: 'Mona Adel', customerPhone: '01012345678', address: '12 Mossadak St, Dokki', governorateCode: 'EG-GZ', codAmount: 35000, merchantRef: 'ORDER-1001' };

async function ok<T = any>(req: request.Test, status = 200): Promise<T> {
  const res = await req;
  if (res.status !== status) throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as T;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers as Record<string, string>, body });
      res.statusCode = answer;
      res.end(answer === 200 ? 'thanks' : 'broken');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/shiply`;

    const { PrismaService } = await import('../../src/parcels/common/prisma.service');
  const { WebhookSender } = await import('../../src/parcels/api/v1.controller');
  app = await createNetworkApp();
  prisma = app.get(PrismaService);
  sender = app.get(WebhookSender);
  merchant = request.agent(app.getHttpServer());
  await ok(merchant.post('/auth/login').send({ email: 'merchant@evechantelle.example', password: 'demo123456' }));
});

afterAll(async () => {
  await app?.close();
  server?.close();
});

describe('merchant API', () => {
  it('keys are shown once, kept as a hash, and stop working when revoked', async () => {
    const l = await ok(merchant.post('/parcels/merchant/developer/keys').send({ name: 'My store', mode: 'LIVE' }), 201);
    const t = await ok(merchant.post('/parcels/merchant/developer/keys').send({ name: 'Testing', mode: 'TEST' }), 201);
    live = l.key;
    test = t.key;
    expect(live).toMatch(/^shp_live_/);
    expect(test).toMatch(/^shp_test_/);
    const list = await ok(merchant.get('/parcels/merchant/developer/keys'));
    expect(list.length).toBe(2);
    expect(JSON.stringify(list)).not.toContain(live);
    expect(list[0].keyHash).toBeUndefined();

    expect((await request(app.getHttpServer()).get('/parcels/v1/me')).status).toBe(401);
    expect((await api('shp_live_nope').get('/parcels/v1/me')).status).toBe(401);
    expect((await ok(api(live).get('/parcels/v1/me'))).mode).toBe('LIVE');
    expect((await ok(request(app.getHttpServer()).get('/parcels/v1/me').set('X-Api-Key', test))).mode).toBe('TEST');

    const spare = await ok(merchant.post('/parcels/merchant/developer/keys').send({ name: 'Old', mode: 'LIVE' }), 201);
    await ok(merchant.post(`/parcels/merchant/developer/keys/${spare.id}/revoke`));
    expect((await api(spare.key).get('/parcels/v1/me')).status).toBe(401);
    // A session cookie does not open the API, and a key does not open the panel.
    expect((await merchant.get('/parcels/v1/me')).status).toBe(401);
    expect((await api(live).get('/parcels/merchant/developer/keys')).status).toBe(401);
  });

  it('webhook addresses inside our network are refused when not allowed', async () => {
    process.env.WEBHOOKS_ALLOW_PRIVATE = '0';
    for (const url of ['http://shop.example/hook', 'https://localhost/hook', 'https://10.0.0.5/hook', 'https://169.254.169.254/latest', 'https://user:pw@shop.example/x', 'not a url']) {
      expect((await merchant.post('/parcels/merchant/developer/webhooks').send({ url, events: ['*'] })).status).toBe(422);
    }
    process.env.WEBHOOKS_ALLOW_PRIVATE = '1';
    const h = await ok(merchant.post('/parcels/merchant/developer/webhooks').send({ url: hookUrl, events: ['*'] }), 201);
    expect(h.secret).toMatch(/^whsec_/);
    const ping = await ok(merchant.post(`/parcels/merchant/developer/webhooks/${h.id}/ping`));
    expect(ping.ok).toBe(true);
    expect(received.at(-1)!.headers['shiply-event']).toBe('ping');
  });

  it('a LIVE parcel is real, created once per idempotency key, and its webhooks are signed', async () => {
    const before = received.length;
    const r1 = await api(live).post('/parcels/v1/shipments', PARCEL).set('Idempotency-Key', 'order-1001');
    expect(r1.status).toBe(201);
    expect(r1.body.trackingNumber).toMatch(/^SHP/);
    expect(r1.body.status).toBe('CREATED');
    expect(r1.body.shippingFee).toBeGreaterThan(0);
    const r2 = await api(live).post('/parcels/v1/shipments', PARCEL).set('Idempotency-Key', 'order-1001');
    expect(r2.status).toBe(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.body.trackingNumber).toBe(r1.body.trackingNumber);
    expect(await prisma.shipment.count({ where: { merchantRef: 'ORDER-1001' } })).toBe(1);

    const bad = await api(live).post('/parcels/v1/shipments', { ...PARCEL, customerPhone: '123' });
    expect(bad.status).toBe(422);

    // The created event waits in the queue, then goes out signed.
    expect(await prisma.webhookDelivery.count({ where: { event: 'shipment.created', status: 'PENDING' } })).toBe(1);
    await sender.run();
    const got = received.slice(before).find((x) => x.headers['shiply-event'] === 'shipment.created')!;
    const body = JSON.parse(got.body);
    expect(body.data.trackingNumber).toBe(r1.body.trackingNumber);
    expect(body.data.merchantRef).toBe('ORDER-1001');
    const secret = (await ok(merchant.get(`/parcels/merchant/developer/webhooks/${(await prisma.webhook.findFirst()).id}/secret`))).secret;
    const [t, v1] = got.headers['shiply-signature']!.split(',').map((p) => p.split('=')[1]!);
    expect(v1).toBe(createHmac('sha256', secret).update(`${t}.${got.body}`).digest('hex'));

    // Reading, listing, the label, and cancelling.
    const one = await ok(api(live).get(`/parcels/v1/shipments/${r1.body.trackingNumber}`));
    expect(one.events[0].status).toBe('CREATED');
    expect((await ok(api(live).get(`/parcels/v1/shipments/${r1.body.trackingNumber}/label`))).barcode).toBe('CODE128');
    const cancelled = await ok(api(live).post(`/parcels/v1/shipments/${r1.body.trackingNumber}/cancel`));
    expect(cancelled.status).toBe('CANCELLED');
    await sender.run();
    const events = received.slice(before).map((x) => x.headers['shiply-event']);
    expect(events).toEqual(expect.arrayContaining(['shipment.created', 'shipment.updated', 'shipment.cancelled']));
    // Another merchant's parcel is not found.
    const nile = await prisma.shipment.findFirst({ where: { merchant: { code: 'NILE' } } });
    if (nile) expect((await api(live).get(`/parcels/v1/shipments/${nile.trackingNumber}`)).status).toBe(404);
  });

  it('bulk creates what it can and says which rows failed; lists page with a cursor', async () => {
    const r = await ok(api(live).post('/parcels/v1/shipments/bulk', { shipments: [{ ...PARCEL, merchantRef: 'B1' }, { ...PARCEL, governorateCode: 'EG-XX', merchantRef: 'B2' }, { ...PARCEL, merchantRef: 'B3' }] }), 201);
    expect(r.created).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.results[1].ok).toBe(false);
    const page1 = await ok(api(live).get('/parcels/v1/shipments?limit=2'));
    expect(page1.data.length).toBe(2);
    expect(page1.next).toBeTruthy();
    const page2 = await ok(api(live).get(`/parcels/v1/shipments?limit=2&after=${page1.next}`));
    expect(page2.data.every((p: any) => p.trackingNumber < page1.next)).toBe(true);
    expect((await ok(api(live).get('/parcels/v1/quote?governorateCode=EG-GZ&size=M'))).shippingFee).toBeGreaterThan(0);
    expect((await ok(api(live).get('/parcels/v1/locations'))).some((g: any) => g.code === 'EG-GZ')).toBe(true);
  });

  it('TEST parcels stay in the sandbox and can be moved on by hand; only test webhooks hear them', async () => {
    await sender.run();
    const shipments = await prisma.shipment.count();
    const p = await ok(api(test).post('/parcels/v1/shipments', PARCEL), 201);
    expect(p.trackingNumber).toMatch(/^TEST/);
    expect(p.sandbox).toBe(true);
    expect(await prisma.shipment.count()).toBe(shipments);
    // The live webhook hears nothing about it.
    expect(await prisma.webhookDelivery.count({ where: { status: 'PENDING' } })).toBe(0);

    await ok(merchant.post('/parcels/merchant/developer/webhooks').send({ url: hookUrl, mode: 'TEST', events: ['shipment.delivered'] }), 201);
    for (const status of ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']) await ok(api(test).post(`/parcels/v1/sandbox/shipments/${p.trackingNumber}/advance`, { status }));
    const after = await ok(api(test).get(`/parcels/v1/shipments/${p.trackingNumber}`));
    expect(after.status).toBe('DELIVERED');
    expect(after.codCollected).toBe(35000);
    expect(after.events.length).toBe(4);
    expect((await api(test).post(`/parcels/v1/sandbox/shipments/${p.trackingNumber}/advance`, { status: 'RETURNED' })).status).toBe(409);
    expect((await api(live).post(`/parcels/v1/sandbox/shipments/${p.trackingNumber}/advance`, { status: 'DELIVERED' })).status).toBe(403);
    const queued = await prisma.webhookDelivery.findMany({ where: { status: 'PENDING' } });
    expect(queued.map((q: any) => q.event)).toEqual(['shipment.delivered']);
    expect(queued[0].payload.mode).toBe('TEST');
    await sender.run();
    // A live key cannot see sandbox parcels, and the other way round.
    expect((await api(live).get(`/parcels/v1/shipments/${p.trackingNumber}`)).status).toBe(404);
  });

  it('a failing endpoint is retried later, then given up; the merchant can send it again', async () => {
    answer = 500;
    await ok(api(test).post('/parcels/v1/shipments', PARCEL), 201);
    const p = (await ok(api(test).get('/parcels/v1/shipments?limit=1'))).data[0];
    await ok(api(test).post(`/parcels/v1/sandbox/shipments/${p.trackingNumber}/advance`, { status: 'DELIVERED' }));
    await sender.run();
    const d = await prisma.webhookDelivery.findFirst({ where: { event: 'shipment.delivered' }, orderBy: { createdAt: 'desc' } });
    expect(d.status).toBe('PENDING');
    expect(d.attempts).toBe(1);
    expect(d.responseCode).toBe(500);
    expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    // Not due yet: nothing is sent.
    expect((await sender.run()).due).toBe(0);
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { attempts: 6, nextAttemptAt: new Date() } });
    await sender.run();
    expect((await prisma.webhookDelivery.findUnique({ where: { id: d.id } })).status).toBe('FAILED');

    answer = 200;
    expect((await ok(merchant.post(`/parcels/merchant/developer/deliveries/${d.id}/retry`))).ok).toBe(true);
    expect((await prisma.webhookDelivery.findUnique({ where: { id: d.id } })).status).toBe('SENT');
    const log = await ok(merchant.get(`/parcels/merchant/developer/webhooks/${d.webhookId}/deliveries`));
    expect(log[0].id).toBe(d.id);
  });

  it('each key has a limit of calls a minute', async () => {
    const k = (await ok(merchant.post('/parcels/merchant/developer/keys').send({ name: 'Busy', mode: 'TEST' }), 201)).key;
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await api(k).get('/parcels/v1/me')).status;
    expect(last).toBe(429);
    const res = await api(k).get('/parcels/v1/me');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});
