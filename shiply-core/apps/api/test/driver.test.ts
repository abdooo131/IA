// The driver apps: the receiver's code at the door, postponing to a chosen day, FlexShip on a
// refusal, QC checking every failed attempt, returns collected from customers with a photo,
// location pings and the live map, vehicle problems, and pickups booked automatically.
import type { INestApplication } from '@nestjs/common';
import { addDays } from '@shiply/shared';
import request from 'supertest';
import { createTestDatabase, dropTestDatabase, TEST_DB } from './setup-db';

process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.SHIPLY_JOBS = 'off';

let app: INestApplication;
let prisma: any;
let today = '';
type Client = ReturnType<typeof request.agent>;
const as: Record<string, Client> = {};
const hubs: Record<string, string> = {};
const users: Record<string, string> = {};
const PHOTO = { mime: 'image/jpeg', dataBase64: Buffer.from('photo bytes').toString('base64') };
const HERE = { lat: 30.0384, lng: 31.2115 };
let dokki: any;
let merchantId = '';
let courierId = '';

async function login(id: string, password = 'demo12345'): Promise<Client> {
  const c = request.agent(app.getHttpServer());
  const res = await c.post('/auth/login').send({ login: id, password });
  if (res.status !== 200) throw new Error(`login ${id}: ${res.status}`);
  return c;
}

async function ok<T = any>(req: request.Test, status = 200): Promise<T> {
  const res = await req;
  if (res.status !== status) throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as T;
}

async function parcel(cod: number, extra: Record<string, unknown> = {}) {
  return ok(as.merchant!.post('/merchant/shipments').send({ customerName: 'Mona', customerPhone: '01012345678', address: '5 Tahrir St', governorateCode: 'GIZ', areaId: dokki.id, codAmount: cod, ...extra }), 201);
}

/** Puts parcels on the Giza shelf (returns from customers stay where they are) and sends them out. */
async function outForDelivery(list: any[]) {
  const shelf = list.filter((p) => p.kind !== 'CUSTOMER_RETURN').map((p) => p.id);
  await prisma.shipment.updateMany({ where: { id: { in: shelf } }, data: { status: 'AT_HUB', currentHubId: hubs.GIZ } });
  const run = await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs`).send({ courierId }), 201);
  for (const p of list) await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/add`).send({ code: p.trackingNumber }));
  const started = await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/start`));
  const mine = await ok(as.courier!.get('/courier/run'));
  const stop = (p: any) => mine.items.find((i: any) => i.shipmentId === p.id);
  return { run, started, mine, stop };
}

async function codeFor(shipmentId: string) {
  const m = await prisma.message.findFirst({ where: { shipmentId, template: { in: ['DELIVERY_CODE', 'RETURN_CODE'] } }, orderBy: { createdAt: 'desc' } });
  return m.body.match(/هو (\d{4})/)[1] as string;
}

const merchantBalance = async () => (await ok(as.admin!.get('/finance/wallets/MERCHANT'))).find((m: any) => m.id === merchantId)?.balance ?? 0;
const balanced = async () => expect((await ok(as.admin!.get('/finance/reports/trial-balance'))).balanced).toBe(true);

beforeAll(async () => {
  await createTestDatabase({ driver: true });
  const { createApp } = await import('../src/main');
  const { PrismaService } = await import('../src/common/prisma.service');
  const { todayInCairo } = await import('../src/core/shipments.core');
  today = todayInCairo();
  app = await createApp();
  await app.init();
  prisma = app.get(PrismaService);
  as.admin = await login('admin@shiply.local', 'admin12345');
  as.merchant = await login('merchant@evechantelle.example');
  as.giz = await login('staff.giz@shiply.local');
  as.courier = await login('courier.giz@shiply.local');
  for (const h of await ok(as.admin.get('/admin/hubs'))) hubs[h.code] = h.id;
  for (const u of await ok(as.admin.get('/admin/users'))) if (u.email) users[u.email] = u.id;
  courierId = users['courier.giz@shiply.local']!;
  merchantId = (await ok(as.merchant.get('/auth/me'))).merchantId;
  const locs = await ok(as.merchant.get('/reference/locations'));
  dokki = locs.find((g: any) => g.code === 'GIZ').areas.find((a: any) => a.nameEn === 'Dokki');
});

afterAll(async () => {
  await app?.close();
  await dropTestDatabase();
});

describe('driver apps', () => {
  it('the receiver gives the courier the code from their SMS before the hand over', async () => {
    const p = await parcel(25000);
    const { run, started, stop } = await outForDelivery([p]);
    expect(started.codes).toBe(1);
    const s = stop(p);
    expect(s.needsCode).toBe(true);
    const msg = await prisma.message.findFirst({ where: { shipmentId: p.id, template: 'DELIVERY_CODE' } });
    expect(msg.channel).toBe('SMS');
    expect(msg.to).toContain('1012345678');

    const bad = await as.courier!.post(`/courier/stops/${s.id}/deliver`).send({ codCollected: 25000, code: '0000' });
    expect(bad.status).toBe(422);
    expect((await as.courier!.post(`/courier/stops/${s.id}/deliver`).send({ codCollected: 25000 })).body.error).toBe('wrong_code');

    // A second code replaces the first.
    const first = await codeFor(p.id);
    await ok(as.courier!.post(`/courier/stops/${s.id}/send-code`));
    const second = await codeFor(p.id);
    if (first !== second) expect((await as.courier!.post(`/courier/stops/${s.id}/deliver`).send({ codCollected: 25000, code: first })).status).toBe(422);
    await ok(as.courier!.post(`/courier/stops/${s.id}/send-code`));
    expect((await as.courier!.post(`/courier/stops/${s.id}/send-code`)).status).toBe(429);

    await ok(as.courier!.post(`/courier/stops/${s.id}/deliver`).send({ codCollected: 25000, code: await codeFor(p.id), ...HERE }));
    const item = await prisma.runItem.findUnique({ where: { id: s.id } });
    expect(item.codeChecked).toBe(true);
    expect(item.lat).toBeCloseTo(HERE.lat);
    await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 25000 }));
    await balanced();
  });

  it('postponing needs the new day, keeps the attempt count and holds the parcel until then', async () => {
    const p = await parcel(10000);
    const { run, stop } = await outForDelivery([p]);
    const s = stop(p);
    expect((await as.courier!.post(`/courier/stops/${s.id}/fail`).send({ reason: 'POSTPONED' })).status).toBe(422);
    expect((await as.courier!.post(`/courier/stops/${s.id}/fail`).send({ reason: 'POSTPONED', deliverOn: addDays(today, 30) })).status).toBe(422);
    const day = addDays(today, 2);
    await ok(as.courier!.post(`/courier/stops/${s.id}/fail`).send({ reason: 'POSTPONED', deliverOn: day, ...HERE }));
    const after = await prisma.shipment.findUnique({ where: { id: p.id } });
    expect(after.deliverOn).toBe(day);
    expect(after.attempts).toBe(0);
    expect(await prisma.message.count({ where: { shipmentId: p.id, template: 'POSTPONED' } })).toBe(1);

    await ok(as.giz!.post(`/hubs/${hubs.GIZ}/inbound`).send({ code: p.trackingNumber }));
    await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 0 }));
    const next = await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs`).send({ courierId }), 201);
    const r = await as.giz!.post(`/hubs/${hubs.GIZ}/runs/${next.id}/add`).send({ code: p.trackingNumber });
    expect(r.body.error).toBe('postponed');
    await prisma.run.delete({ where: { id: next.id } });
  });

  it('FlexShip: a refusing customer pays the shipping, the merchant gets it, the courier hands it in', async () => {
    const p = await parcel(30000);
    const other = await parcel(30000);
    const { run, stop } = await outForDelivery([p, other]);
    // Not a FlexShip merchant yet.
    expect((await as.courier!.post(`/courier/stops/${stop(p).id}/fail`).send({ reason: 'REFUSED', flexPaid: true })).status).toBe(422);
    await prisma.merchant.update({ where: { id: merchantId }, data: { flexShip: true } });
    const mine = await ok(as.courier!.get('/courier/run'));
    expect(mine.items.find((i: any) => i.shipmentId === p.id).shipment.merchant.flexShip).toBe(true);
    // Only on a refusal.
    expect((await as.courier!.post(`/courier/stops/${stop(other).id}/fail`).send({ reason: 'NO_ANSWER', flexPaid: true })).status).toBe(422);

    const before = await merchantBalance();
    await ok(as.courier!.post(`/courier/stops/${stop(p).id}/fail`).send({ reason: 'REFUSED', flexPaid: true, ...HERE }));
    const item = await prisma.runItem.findUnique({ where: { id: stop(p).id } });
    expect(item.flexPaid).toBe(p.shippingFee);
    expect(item.codCollected).toBe(p.shippingFee);
    expect(await merchantBalance()).toBe(before + p.shippingFee);
    await ok(as.courier!.post(`/courier/stops/${stop(other).id}/fail`).send({ reason: 'NO_ANSWER' }));

    for (const x of [p, other]) await ok(as.giz!.post(`/hubs/${hubs.GIZ}/inbound`).send({ code: x.trackingNumber }));
    const closed = await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: p.shippingFee }));
    expect(closed.expected).toBe(p.shippingFee);
    expect(closed.difference).toBe(0);
    await prisma.merchant.update({ where: { id: merchantId }, data: { flexShip: false } });
    await balanced();
  });

  it('QC checks every failed attempt: genuine closes it, fake opens a ticket with the penalty', async () => {
    const open = await ok(as.admin!.get('/control/attempts'));
    const refused = open.find((a: any) => a.reason === 'REFUSED');
    const noAnswer = open.find((a: any) => a.reason === 'NO_ANSWER');
    expect(refused.flexPaid).toBeGreaterThan(0);
    expect(refused.courier.name).toBeTruthy();
    expect(refused.lat).toBeCloseTo(HERE.lat);
    expect(open.some((a: any) => a.reason === 'POSTPONED')).toBe(true);

    await ok(as.admin!.post(`/control/attempts/${refused.id}/review`).send({ verdict: 'GENUINE' }));
    expect((await as.admin!.post(`/control/attempts/${noAnswer.id}/review`).send({ verdict: 'FAKE' })).status).toBe(422);
    const r = await ok(as.admin!.post(`/control/attempts/${noAnswer.id}/review`).send({ verdict: 'FAKE', note: 'Customer was home all day, nobody called', penalty: 2000 }));
    const t = (await ok(as.admin!.get('/control/tickets'))).find((x: any) => x.code === r.ticket);
    expect(t.kind).toBe('FAKE_ATTEMPT');
    expect(t.penalty).toBe(2000);
    expect(t.courierId).toBe(courierId);
    expect((await as.admin!.post(`/control/attempts/${noAnswer.id}/review`).send({ verdict: 'GENUINE' })).status).toBe(409);

    const left = await ok(as.admin!.get('/control/attempts'));
    expect(left.some((a: any) => a.id === refused.id || a.id === noAnswer.id)).toBe(false);
    expect((await ok(as.admin!.get('/control/attempts?status=done'))).length).toBe(2);
  });

  it('a return from a customer is collected with a photo and travels back like any return', async () => {
    expect((await as.merchant!.post('/merchant/shipments').send({ customerName: 'Mona', customerPhone: '01012345678', address: '5 Tahrir St', governorateCode: 'GIZ', customerReturn: true, codAmount: 100 })).status).toBe(422);
    const back = await parcel(0, { customerReturn: true, description: 'Blue dress, wrong size' });
    const missed = await parcel(0, { customerReturn: true });
    expect(back.kind).toBe('CUSTOMER_RETURN');
    expect(back.status).toBe('CREATED');
    const waiting = await ok(as.giz!.get(`/hubs/${hubs.GIZ}/customer-returns`));
    expect(waiting.map((x: any) => x.id)).toEqual(expect.arrayContaining([back.id, missed.id]));

    const { run, started, stop } = await outForDelivery([back, missed]);
    expect(started.codes).toBe(0); // nothing to hand over, so no code
    expect(await prisma.message.count({ where: { shipmentId: back.id, template: 'RETURN_PICKUP' } })).toBe(1);
    expect((await as.courier!.post(`/courier/stops/${stop(back).id}/deliver`).send({ codCollected: 0 })).body.error).toBe('wrong_kind');
    expect((await as.courier!.post(`/courier/stops/${stop(back).id}/collect-return`).send({})).status).toBe(422);
    await ok(as.courier!.post(`/courier/stops/${stop(back).id}/collect-return`).send({ photo: PHOTO, ...HERE }));
    const got = await prisma.shipment.findUnique({ where: { id: back.id } });
    expect(got.status).toBe('ATTEMPT_FAILED');
    expect(got.direction).toBe('RETURN');
    const photo = await as.admin!.get(`/control/stops/${stop(back).id}/photo`);
    expect(photo.status).toBe(200);

    // The other customer was out: nothing comes back to the hub, it waits for another visit.
    await ok(as.courier!.post(`/courier/stops/${stop(missed).id}/fail`).send({ reason: 'NO_ANSWER' }));
    const m = await prisma.shipment.findUnique({ where: { id: missed.id } });
    expect(m.status).toBe('CREATED');
    expect(m.runId).toBeNull();
    expect(m.attempts).toBe(1);

    const scan = await ok(as.giz!.post(`/hubs/${hubs.GIZ}/inbound`).send({ code: back.trackingNumber }));
    expect(JSON.stringify(scan)).toContain('Customer return received');
    await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 0 }));
    expect((await prisma.shipment.findUnique({ where: { id: back.id } })).status).toBe('AT_HUB');
  });

  it('the phone sends its place; the live map shows the courier, their run and the day trail', async () => {
    expect((await ok(as.courier!.get('/courier/config'))).pingSeconds).toBe(60);
    await ok(as.courier!.post('/courier/ping').send({ ...HERE, accuracy: 12 }));
    expect((await ok(as.courier!.post('/courier/ping').send({ lat: 30.05, lng: 31.22 }))).skipped).toBe(true);
    expect((await as.courier!.post('/courier/ping').send({ lat: 200, lng: 31 })).status).toBe(422);
    const live = await ok(as.admin!.get('/control/couriers/live'));
    const me = live.find((c: any) => c.courierId === courierId);
    expect(me.lat).toBeCloseTo(HERE.lat);
    const trail = await ok(as.admin!.get(`/control/couriers/${courierId}/trail?date=${today}`));
    expect(trail.pings.length).toBe(1);
    expect(trail.stops.some((s: any) => s.lat !== null && s.result === 'DELIVERED')).toBe(true);
    expect(trail.stops.some((s: any) => s.hasPhoto)).toBe(true);
    expect((await as.merchant!.get('/control/couriers/live')).status).toBe(403);
  });

  it('a broken or full vehicle alerts operations, and the agent when the courier has one', async () => {
    const r = await ok(as.courier!.post('/courier/vehicle-problem').send({ reason: 'BREAKDOWN', note: 'Flat tyre on Tahrir St' }));
    expect(r.message).toBeTruthy();
    const alert = await prisma.alert.findFirst({ where: { kind: 'COURIER_VEHICLE_PROBLEM', entityId: courierId } });
    expect(alert.message).toContain('Flat tyre');
    const me = await prisma.user.findUnique({ where: { id: courierId } });
    if (me.agentId) expect(await prisma.vehicleRequest.count({ where: { agentId: me.agentId, reason: 'BREAKDOWN' } })).toBe(1);
  });

  it('a pickup is booked when a merchant creates parcels and has none, and grows with each parcel', async () => {
    await prisma.pickup.updateMany({ where: { merchantId }, data: { status: 'CANCELLED' } });
    await parcel(5000);
    const booked = await prisma.pickup.findMany({ where: { merchantId, status: 'REQUESTED' } });
    expect(booked.length).toBe(1);
    expect(booked[0].auto).toBe(true);
    expect(booked[0].expectedCount).toBe(1);
    await parcel(5000);
    await parcel(0, { customerReturn: true });
    const again = await prisma.pickup.findMany({ where: { merchantId, status: 'REQUESTED' } });
    expect(again.length).toBe(1);
    expect(again[0].expectedCount).toBe(2);
    expect(again[0].date >= today).toBe(true);
  });
});
