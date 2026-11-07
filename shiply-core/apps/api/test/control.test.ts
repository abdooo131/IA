// Control of the floor: lost parcels searched for 2 days with the last holder responsible, the
// merchant compensated and everything reversed when the parcel turns up; quality tickets with a
// waiting period, override and appeal; damage reports; pallets with seals, photos and manifests;
// back haul; the cutoff check; fraud checks.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestDatabase, dropTestDatabase, TEST_DB } from './setup-db';

process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.SHIPLY_JOBS = 'off';

let app: INestApplication;
let prisma: any;
let control: any;
type Client = ReturnType<typeof request.agent>;
const as: Record<string, Client> = {};
const hubs: Record<string, string> = {};
const users: Record<string, string> = {};
const PHOTO = { mime: 'image/jpeg', dataBase64: Buffer.from('photo bytes').toString('base64') };
let dokki: any;
let merchantId = '';

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

async function parcel(cod: number) {
  return ok(as.merchant!.post('/merchant/shipments').send({ customerName: 'Mona', customerPhone: '01012345678', address: '5 Tahrir St', governorateCode: 'GIZ', areaId: dokki.id, codAmount: cod }), 201);
}

/** Puts parcels on the Giza shelf and sends them out on a run; returns the courier's stops. */
async function outForDelivery(list: any[]) {
  await prisma.shipment.updateMany({ where: { id: { in: list.map((p) => p.id) } }, data: { status: 'AT_HUB', currentHubId: hubs.GIZ } });
  const run = await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs`).send({ courierId: users['courier.giz@shiply.local'] }), 201);
  for (const p of list) await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/add`).send({ code: p.trackingNumber }));
  await ok(as.giz!.post(`/hubs/${hubs.GIZ}/runs/${run.id}/start`));
  return { run, stops: (await ok(as.courierGiz!.get('/courier/run'))).items };
}

const wallet = async () => (await ok(as.admin!.get(`/finance/couriers/${users['courier.giz@shiply.local']}`))).wallet;
const merchantBalance = async () => (await ok(as.admin!.get('/finance/wallets/MERCHANT'))).find((m: any) => m.id === merchantId)?.balance ?? 0;
const balanced = async () => expect((await ok(as.admin!.get('/finance/reports/trial-balance'))).balanced).toBe(true);

beforeAll(async () => {
  await createTestDatabase();
  const { createApp } = await import('../src/main');
  const { PrismaService } = await import('../src/common/prisma.service');
  const { ControlService } = await import('../src/control/control.service');
  app = await createApp();
  await app.init();
  prisma = app.get(PrismaService);
  control = app.get(ControlService);
  as.admin = await login('admin@shiply.local', 'admin12345');
  as.merchant = await login('merchant@evechantelle.example');
  as.giz = await login('staff.giz@shiply.local');
  as.courierGiz = await login('courier.giz@shiply.local');
  as.delta = await login('agent@deltariders.example');
  for (const t of ['inbound', 'sorting', 'outbound']) as[t] = await login(`${t}.obr@shiply.local`);
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

describe('control', () => {
  it('a lost parcel is searched for 2 days; the last holder carries it; finding it reverses everything', async () => {
    const p = await parcel(40000);
    const { stops } = await outForDelivery([p]);
    await ok(as.courierGiz!.post(`/courier/stops/${stops[0].id}/fail`).send({ reason: 'NO_ANSWER' }));
    const before = await wallet();
    await ok(as.admin!.post(`/admin/shipments/${p.id}/lost`).send({ note: 'Courier says it was stolen' }));

    const lost = (await ok(as.admin!.get('/control/lost'))).find((x: any) => x.id === p.id);
    expect(lost.searchUntil).not.toBeNull();
    expect(lost.ticket.kind).toBe('MISSING_PARCEL');
    expect(lost.ticket.responsible).toBe('Dokki Hub courier'); // the courier scanned it last
    const ticket = (await ok(as.admin!.get('/control/tickets'))).find((t: any) => t.shipmentId === p.id);
    expect(ticket.penalty).toBe(40000);
    expect(ticket.status).toBe('OPEN');

    // Nothing happens before the search ends.
    expect((await control.tick()).lost).toBe(0);
    expect(await wallet()).toBe(before);

    // The 2 days pass: the merchant is paid, the courier's penalty lands.
    await prisma.shipment.update({ where: { id: p.id }, data: { searchUntil: new Date(Date.now() - 1000) } });
    await prisma.qcTicket.update({ where: { id: ticket.id }, data: { confirmAt: new Date(Date.now() - 1000) } });
    const mBefore = await merchantBalance();
    const r = await control.tick();
    expect(r.lost).toBe(1);
    expect(await merchantBalance()).toBe(mBefore + 40000);
    expect(await wallet()).toBe(before - 40000);
    await balanced();

    // It turns up at the hub: compensation and penalty are both taken back.
    await ok(as.giz!.post(`/hubs/${hubs.GIZ}/inbound`).send({ code: p.trackingNumber }));
    expect(await merchantBalance()).toBe(mBefore);
    expect(await wallet()).toBe(before);
    expect((await ok(as.admin!.get('/control/tickets'))).find((t: any) => t.id === ticket.id).status).toBe('REVERSED');
    await balanced();
  });

  it('found during the search: the ticket closes with no penalty', async () => {
    const p = await parcel(10000);
    await prisma.shipment.update({ where: { id: p.id }, data: { status: 'AT_HUB', currentHubId: hubs.GIZ } });
    await ok(as.admin!.post(`/admin/shipments/${p.id}/lost`).send({ note: 'Not on the shelf' }));
    await ok(as.giz!.post(`/hubs/${hubs.GIZ}/inbound`).send({ code: p.trackingNumber }));
    const t = (await ok(as.admin!.get('/control/tickets'))).find((x: any) => x.shipmentId === p.id);
    expect(t.status).toBe('OVERRIDDEN');
    expect(t.overrideReason).toBe('Parcel found');
  });

  it('quality tickets: override in the waiting time, or the penalty applies and can be appealed', async () => {
    const courierId = users['courier.giz@shiply.local'];
    const a = await ok(as.admin!.post('/control/tickets').send({ kind: 'FAKE_ATTEMPT', courierId, penalty: 5000, description: 'Customer says nobody came' }), 201);
    expect((await ok(as.delta!.get('/agent/alerts'))).some((x: any) => x.kind === 'QC_TICKET')).toBe(true);
    await ok(as.admin!.post(`/control/tickets/${a.id}/override`).send({ reason: 'Customer confirmed the call log' }));
    expect((await as.admin!.post(`/control/tickets/${a.id}/override`).send({ reason: 'Again please' })).status).toBe(409);

    const before = await wallet();
    const b = await ok(as.admin!.post('/control/tickets').send({ kind: 'FAKE_ATTEMPT', courierId, penalty: 5000, description: 'Second complaint today' }), 201);
    await ok(as.admin!.put(`/control/tickets/${b.id}/penalty`).send({ penalty: 3000 }));
    await prisma.qcTicket.update({ where: { id: b.id }, data: { confirmAt: new Date(Date.now() - 1000) } });
    await control.tick();
    expect(await wallet()).toBe(before - 3000);

    expect((await as.courierGiz!.post(`/my/tickets/${b.id}/appeal`).send({ text: 'short' })).status).toBe(422);
    await ok(as.courierGiz!.post(`/my/tickets/${b.id}/appeal`).send({ text: 'I have the call log showing three calls at 2pm' }));
    expect((await ok(as.courierGiz!.get('/my/tickets'))).find((t: any) => t.id === b.id).status).toBe('APPEALED');
    await ok(as.admin!.post(`/control/tickets/${b.id}/decide`).send({ decision: 'REVERSE', note: 'Call log checked' }));
    expect(await wallet()).toBe(before);

    // After the appeal window it is too late.
    const c = await ok(as.admin!.post('/control/tickets').send({ kind: 'LATE_SCAN', courierId, penalty: 1000, description: 'Scanned an hour late' }), 201);
    await prisma.qcTicket.update({ where: { id: c.id }, data: { confirmAt: new Date(Date.now() - 1000) } });
    await control.tick();
    await prisma.qcTicket.update({ where: { id: c.id }, data: { appealUntil: new Date(Date.now() - 1000) } });
    expect((await as.courierGiz!.post(`/my/tickets/${c.id}/appeal`).send({ text: 'I was stuck in traffic for an hour' })).status).toBe(409);
    await balanced();
  });

  it('damage reported at a hub with a photo opens a ticket and an alert', async () => {
    const p = await parcel(20000);
    await prisma.shipment.update({ where: { id: p.id }, data: { status: 'AT_HUB', currentHubId: hubs.GIZ } });
    expect((await as.giz!.post(`/hubs/${hubs.GIZ}/damaged`).send({ code: p.trackingNumber, note: 'Box crushed' })).status).toBe(422);
    const r = await ok(as.giz!.post(`/hubs/${hubs.GIZ}/damaged`).send({ code: p.trackingNumber, note: 'Box crushed', photo: PHOTO }));
    expect(r.ticket).toMatch(/^QC/);
    expect((await ok(as.admin!.get('/control/lost'))).find((x: any) => x.id === p.id).damaged).toBe(true);
    expect((await ok(as.admin!.get('/admin/alerts'))).some((a: any) => a.kind === 'PARCEL_DAMAGED')).toBe(true);
  });

  it('pallets: sealed with a photo, loaded, manifest, checked on arrival; back haul', async () => {
    const list = [await parcel(15000), await parcel(25000)];
    for (const p of list) {
      await ok(as.inbound!.post(`/hubs/${hubs.OBR}/inbound`).send({ code: p.trackingNumber }));
      await ok(as.sorting!.post(`/hubs/${hubs.OBR}/sort`).send({ code: p.trackingNumber }));
    }
    let bag: any;
    for (const p of list) bag = (await ok(as.outbound!.post(`/hubs/${hubs.OBR}/outbound/bag`).send({ code: p.trackingNumber }))).bag;
    const pl = await ok(as.outbound!.post(`/hubs/${hubs.OBR}/pallets`).send({ destinationHubId: hubs.GIZ }), 201);
    expect((await as.outbound!.post(`/hubs/${hubs.OBR}/pallets/${pl.id}/bags`).send({ code: bag.code })).status).toBe(409); // bag not sealed
    await ok(as.outbound!.post(`/hubs/${hubs.OBR}/bags/${bag.id}/seal`));
    await ok(as.outbound!.post(`/hubs/${hubs.OBR}/pallets/${pl.id}/bags`).send({ code: bag.code }));
    expect((await as.sorting!.post(`/hubs/${hubs.OBR}/pallets/${pl.id}/seal`).send({ sealNo: 'S-7781', photo: PHOTO })).status).toBe(403); // outbound team only
    await ok(as.outbound!.post(`/hubs/${hubs.OBR}/pallets/${pl.id}/seal`).send({ sealNo: 'S-7781', photo: PHOTO }));
    const trip = await ok(as.outbound!.post(`/hubs/${hubs.OBR}/trips`).send({ destinationHubId: hubs.GIZ, vehicle: 'Truck 9', driverName: 'Sayed' }), 201);
    await ok(as.outbound!.post(`/hubs/${hubs.OBR}/trips/${trip.id}/load-pallet`).send({ code: pl.code }));
    await ok(as.outbound!.post(`/hubs/${hubs.OBR}/trips/${trip.id}/depart`));
    const m = await ok(as.admin!.get(`/control/trips/${trip.id}/manifest`));
    expect(m.pallets[0].sealNo).toBe('S-7781');
    expect(m.totalParcels).toBe(2);
    expect(m.totalCod).toBe(40000);

    const incoming = (await ok(as.giz!.get(`/hubs/${hubs.GIZ}/pallets`))).find((x: any) => x.id === pl.id);
    expect(incoming.status).toBe('IN_TRANSIT');
    await ok(as.giz!.post(`/hubs/${hubs.GIZ}/pallets/${pl.id}/receive`).send({ condition: 'DAMAGED', note: 'Strap broken', photo: PHOTO }));
    expect((await ok(as.admin!.get('/control/tickets'))).some((t: any) => t.kind === 'PALLET_DAMAGED')).toBe(true);

    const back = await ok(as.giz!.post(`/hubs/${hubs.GIZ}/trips`).send({ destinationHubId: hubs.OBR, backhaulOfId: trip.id }), 201);
    expect(back.vehicle).toBe('Truck 9');
    expect((await as.giz!.post(`/hubs/${hubs.GIZ}/trips`).send({ destinationHubId: hubs.ALX, backhaulOfId: trip.id })).status).toBe(422);
  });

  it('after the cutoff, parcels still in the facility raise an alert', async () => {
    const p = await parcel(5000);
    await ok(as.inbound!.post(`/hubs/${hubs.OBR}/inbound`).send({ code: p.trackingNumber }));
    await ok(as.sorting!.post(`/hubs/${hubs.OBR}/sort`).send({ code: p.trackingNumber }));
    const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
    expect(await control.cutoffCheck(new Date(`${today}T10:00:00+02:00`))).toBe(0); // before cutoff
    expect(await control.cutoffCheck(new Date(`${today}T23:30:00+02:00`))).toBeGreaterThan(0);
    expect((await ok(as.admin!.get('/admin/alerts'))).some((a: any) => a.kind === 'CUTOFF_MISSED' && a.hubId === hubs.OBR)).toBe(true);
  });

  it('three failed attempts within minutes raise a fraud check', async () => {
    const list = [await parcel(1000), await parcel(2000), await parcel(3000)];
    // The earlier penalty froze this courier (negative wallet): finance lets him work, with a reason.
    await ok(as.admin!.post(`/finance/couriers/${users['courier.giz@shiply.local']}/unfreeze`).send({ reason: 'Recharging tonight', hours: 2 }));
    await prisma.run.updateMany({ where: { courierId: users['courier.giz@shiply.local'] }, data: { status: 'CLOSED' } });
    const { stops } = await outForDelivery(list);
    for (const s of stops) await ok(as.courierGiz!.post(`/courier/stops/${s.id}/fail`).send({ reason: 'NOT_AVAILABLE' }));
    await control.fraudChecks(new Date());
    expect((await ok(as.admin!.get('/admin/alerts'))).some((a: any) => a.kind === 'FRAUD_QUICK_FAILS')).toBe(true);
  });
});
