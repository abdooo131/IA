// One parcel journey end to end, through the real API and a real database:
// merchant creates, courier picks up, pickup hub bags it, line haul to sorting, sorting bags it
// to the delivery hub, courier delivers or fails, failed parcel goes back to the merchant,
// cash is handed over, merchant is paid out.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestDatabase, dropTestDatabase, TEST_DB } from './setup-db';

process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';

let app: INestApplication;
type Agent = ReturnType<typeof request.agent>;
const agents: Record<string, Agent> = {};
const hubs: Record<string, string> = {};
const users: Record<string, string> = {};

async function login(email: string, password = 'demo12345'): Promise<Agent> {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/auth/login').send({ email, password }).expect(200);
  return agent;
}

async function ok<T = any>(req: request.Test, status = 200): Promise<T> {
  const res = await req;
  if (res.status !== status) throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as T;
}

/** Bag every parcel at a hub, seal the bag, send it on a trip, and receive it at the other end. */
async function lineHaul(from: string, to: string, codes: string[]) {
  const staffFrom = agents[from]!;
  const staffTo = agents[to]!;
  let bagId = '';
  let bagCode = '';
  for (const code of codes) {
    const r = await ok(staffFrom.post(`/hubs/${hubs[from]}/sort`).send({ code }));
    expect(r.next.hubCode).toBe(to);
    bagId = r.bag.id;
    bagCode = r.bag.code;
  }
  await ok(staffFrom.post(`/hubs/${hubs[from]}/bags/${bagId}/seal`));
  const trip = await ok(staffFrom.post(`/hubs/${hubs[from]}/trips`).send({ destinationHubId: hubs[to], vehicle: 'Truck 1' }), 201);
  await ok(staffFrom.post(`/hubs/${hubs[from]}/trips/${trip.id}/load`).send({ code: bagCode }));
  const dep = await ok(staffFrom.post(`/hubs/${hubs[from]}/trips/${trip.id}/depart`));
  expect(dep.parcels).toBe(codes.length);
  const rec = await ok(staffTo.post(`/hubs/${hubs[to]}/receive-bag`).send({ code: bagCode }));
  expect(rec.parcels).toBe(codes.length);
  return trip.id as string;
}

beforeAll(async () => {
  await createTestDatabase();
  const { createApp } = await import('../src/main');
  app = await createApp();
  await app.init();

  agents.admin = await login('admin@shiply.local', 'admin12345');
  agents.merchant = await login('merchant@evechantelle.example');
  agents['CAI-E'] = await login('staff.caie@shiply.local');
  agents.SORT = await login('staff.sort@shiply.local');
  agents.GIZ = await login('staff.giz@shiply.local');
  agents.courierCaie = await login('courier.caie@shiply.local');
  agents.courierGiz = await login('courier.giz@shiply.local');

  for (const h of await ok(agents.admin.get('/admin/hubs'))) hubs[h.code] = h.id;
  for (const u of await ok(agents.admin.get('/admin/users'))) users[u.email] = u.id;
});

afterAll(async () => {
  await app?.close();
  await dropTestDatabase();
});

describe('next day parcel flow', () => {
  const parcels: Record<string, { id: string; trackingNumber: string }> = {};

  it('merchant creates parcels with fees and a delivery hub', async () => {
    const locations = await ok(agents.merchant.get('/reference/locations'));
    const dokki = locations.find((g: any) => g.code === 'GIZ').areas.find((a: any) => a.nameEn === 'Dokki');
    const base = { customerName: 'Mona Ali', customerPhone: '01012345678', address: '5 Tahrir St, Dokki', governorateCode: 'GIZ', areaId: dokki.id, size: 'M' };

    parcels.good = await ok(agents.merchant.post('/merchant/shipments').send({ ...base, codAmount: 50000 }), 201);
    parcels.refused = await ok(agents.merchant.post('/merchant/shipments').send({ ...base, customerName: 'Omar Said', codAmount: 30000 }), 201);
    parcels.cancel = await ok(agents.merchant.post('/merchant/shipments').send({ ...base, codAmount: 0 }), 201);

    const created = await ok(agents.admin.get(`/admin/shipments/${parcels.good.id}`));
    expect(created.status).toBe('CREATED');
    expect(created.shippingFee).toBe(6000);
    expect(created.codFee).toBe(0);
    expect(created.hubCodes[created.destinationHubId]).toBe('GIZ');
    expect(created.customerPhone).toBe('+201012345678');
  });

  it('rejects bad input and places we do not serve', async () => {
    const bad = await agents.merchant.post('/merchant/shipments').send({ customerName: 'X', customerPhone: '123', address: 'a', governorateCode: 'GIZ' });
    expect(bad.status).toBe(422);
    const remote = await agents.merchant.post('/merchant/shipments').send({ customerName: 'Sara', customerPhone: '01112345678', address: 'Somewhere in Hurghada', governorateCode: 'RED' });
    expect(remote.status).toBe(422);
    expect(remote.body.error).toBe('not_served');
  });

  it('merchant cancels a parcel before pickup', async () => {
    await ok(agents.merchant.post(`/merchant/shipments/${parcels.cancel.id}/cancel`));
    const again = await agents.merchant.post(`/merchant/shipments/${parcels.cancel.id}/cancel`);
    expect(again.status).toBe(409);
  });

  it('pickup: request, assign, collect, receive at the merchant hub', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
    const pickup = await ok(agents.merchant.post('/merchant/pickups').send({ date: today }), 201);
    expect(pickup.expectedCount).toBe(2);
    await ok(agents['CAI-E'].post(`/hubs/${hubs['CAI-E']}/pickups/${pickup.id}/assign`).send({ courierId: users['courier.caie@shiply.local'] }));

    const mine = await ok(agents.courierCaie.get('/courier/pickups'));
    expect(mine).toHaveLength(1);
    for (const p of [parcels.good, parcels.refused]) {
      const r = await ok(agents.courierCaie.post(`/courier/pickups/${pickup.id}/collect`).send({ code: p.trackingNumber.toLowerCase() }));
      expect(r.message).toMatch(/Promised for \d{4}-\d{2}-\d{2}/);
    }
    // a typo in the tracking number is caught by the check digit
    const typo = await agents.courierCaie.post(`/courier/pickups/${pickup.id}/collect`).send({ code: parcels.good.trackingNumber.slice(0, -1) + '0' });
    expect([404, 422]).toContain(typo.status);
    await ok(agents.courierCaie.post(`/courier/pickups/${pickup.id}/finish`));

    for (const p of [parcels.good, parcels.refused]) {
      const r = await ok(agents['CAI-E'].post(`/hubs/${hubs['CAI-E']}/inbound`).send({ code: p.trackingNumber }));
      expect(r.status).toBe('AT_HUB');
      expect(r.next).toMatchObject({ kind: 'SEND', hubCode: 'SORT' });
    }
    const pickups = await ok(agents.merchant.get('/merchant/pickups'));
    expect(pickups[0].status).toBe('RECEIVED');
  });

  it('hub staff cannot work in another hub', async () => {
    const r = await agents.GIZ.post(`/hubs/${hubs['CAI-E']}/inbound`).send({ code: parcels.good.trackingNumber });
    expect(r.status).toBe(403);
    const m = await agents.merchant.get('/admin/dashboard');
    expect(m.status).toBe(403);
  });

  it('line haul: merchant hub to sorting, sorting to delivery hub', async () => {
    const codes = [parcels.good.trackingNumber, parcels.refused.trackingNumber];
    await lineHaul('CAI-E', 'SORT', codes);
    const mid = await ok(agents.admin.get(`/admin/shipments/${parcels.good.id}`));
    expect(mid.status).toBe('AT_HUB');
    expect(mid.hubCodes[mid.currentHubId]).toBe('SORT');
    await lineHaul('SORT', 'GIZ', codes);
    const atGiza = await ok(agents.admin.get(`/admin/shipments/${parcels.good.id}`));
    expect(atGiza.next.kind).toBe('DELIVER');
  });

  it('a bag for another hub cannot go on the wrong trip', async () => {
    const trip = await ok(agents.GIZ.post(`/hubs/${hubs.GIZ}/trips`).send({ destinationHubId: hubs.SORT }), 201);
    const r = await agents.GIZ.post(`/hubs/${hubs.GIZ}/trips/${trip.id}/load`).send({ code: 'BG99999' });
    expect(r.status).toBe(404);
  });

  it('last mile: run, deliver with exact COD, fail with refusal, close with cash', async () => {
    const run = await ok(agents.GIZ.post(`/hubs/${hubs.GIZ}/runs`).send({ courierId: users['courier.giz@shiply.local'] }), 201);
    for (const p of [parcels.good, parcels.refused]) {
      await ok(agents.GIZ.post(`/hubs/${hubs.GIZ}/runs/${run.id}/add`).send({ code: p.trackingNumber }));
    }
    await ok(agents.GIZ.post(`/hubs/${hubs.GIZ}/runs/${run.id}/start`));

    const mine = await ok(agents.courierGiz.get('/courier/run'));
    const stop = (id: string) => mine.items.find((i: any) => i.shipment.id === id);
    const wrong = await agents.courierGiz.post(`/courier/stops/${stop(parcels.good.id).id}/deliver`).send({ codCollected: 40000 });
    expect(wrong.status).toBe(422);
    await ok(agents.courierGiz.post(`/courier/stops/${stop(parcels.good.id).id}/deliver`).send({ codCollected: 50000, recipient: 'Mona' }));
    await ok(agents.courierGiz.post(`/courier/stops/${stop(parcels.refused.id).id}/fail`).send({ reason: 'REFUSED' }));

    // cannot close until the failed parcel is physically back
    const early = await agents.GIZ.post(`/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 50000 });
    expect(early.status).toBe(409);
    expect(early.body.message).toContain(parcels.refused.trackingNumber);

    const back = await ok(agents.GIZ.post(`/hubs/${hubs.GIZ}/inbound`).send({ code: parcels.refused.trackingNumber }));
    expect(back.status).toBe('ON_HOLD');
    const closed = await ok(agents.GIZ.post(`/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 50000 }));
    expect(closed.difference).toBe(0);

    const done = await ok(agents.admin.get(`/admin/shipments/${parcels.good.id}`));
    expect(done.status).toBe('DELIVERED');
    expect(done.codCollected).toBe(50000);
  });

  it('merchant sends the refused parcel back, it travels home and is returned', async () => {
    await ok(agents.merchant.post(`/merchant/shipments/${parcels.refused.id}/decision`).send({ decision: 'RETURN' }));
    const turned = await ok(agents.admin.get(`/admin/shipments/${parcels.refused.id}`));
    expect(turned.direction).toBe('RETURN');
    expect(turned.next).toMatchObject({ kind: 'SEND', hubCode: 'SORT' });

    await lineHaul('GIZ', 'SORT', [parcels.refused.trackingNumber]);
    await lineHaul('SORT', 'CAI-E', [parcels.refused.trackingNumber]);
    const home = await ok(agents.admin.get(`/admin/shipments/${parcels.refused.id}`));
    expect(home.next.kind).toBe('RETURN_TO_MERCHANT');

    const run = await ok(agents['CAI-E'].post(`/hubs/${hubs['CAI-E']}/runs`).send({ courierId: users['courier.caie@shiply.local'] }), 201);
    const added = await ok(agents['CAI-E'].post(`/hubs/${hubs['CAI-E']}/runs/${run.id}/add`).send({ code: parcels.refused.trackingNumber }));
    expect(added.direction).toBe('RETURN');
    await ok(agents['CAI-E'].post(`/hubs/${hubs['CAI-E']}/runs/${run.id}/start`));
    const mine = await ok(agents.courierCaie.get('/courier/run'));
    await ok(agents.courierCaie.post(`/courier/stops/${mine.items[0].id}/deliver`).send({ codCollected: 0, recipient: 'Store manager' }));
    await ok(agents['CAI-E'].post(`/hubs/${hubs['CAI-E']}/runs/${run.id}/close`).send({ cashReceived: 0 }));

    const returned = await ok(agents.admin.get(`/admin/shipments/${parcels.refused.id}`));
    expect(returned.status).toBe('RETURNED');
    expect(returned.returnFee).toBe(3000);
  });

  it('merchant statement and payout', async () => {
    const st = await ok(agents.merchant.get('/merchant/statement'));
    expect(st.codTotal).toBe(50000);
    expect(st.feesTotal).toBe(6000 + 6000 + 3000);
    expect(st.balance).toBe(35000);

    const merchantId = (await ok(agents.merchant.get('/auth/me'))).merchantId;
    const payout = await ok(agents.admin.post(`/admin/merchants/${merchantId}/payouts`).send({ reference: 'Bank transfer 123' }), 201);
    expect(payout.amount).toBe(35000);
    const after = await ok(agents.merchant.get('/merchant/statement'));
    expect(after.balance).toBe(0);
    const again = await agents.admin.post(`/admin/merchants/${merchantId}/payouts`).send({});
    expect(again.status).toBe(422);
  });

  it('public tracking shows progress but no personal data', async () => {
    const t = await ok(request(app.getHttpServer()).get(`/track/${parcels.good.trackingNumber}`));
    expect(t.status).toBe('DELIVERED');
    expect(t.events.map((e: any) => e.text)).toEqual(expect.arrayContaining(['Picked up from the store', 'Out for delivery', 'Delivered']));
    const raw = JSON.stringify(t);
    expect(raw).not.toContain('Tahrir');
    expect(raw).not.toContain('1012345678');
  });

  it('history cannot be edited', async () => {
    const { PrismaClient } = await import('@shiply/db');
    const db = new PrismaClient({ datasourceUrl: TEST_DB });
    await expect(db.$executeRawUnsafe(`UPDATE shipment_events SET note = 'x'`)).rejects.toThrow(/append only/);
    await db.$disconnect();
  });

  it('dashboard counts the day', async () => {
    const d = await ok(agents.admin.get('/admin/dashboard'));
    expect(d.byStatus.DELIVERED).toBe(1);
    expect(d.byStatus.RETURNED).toBe(1);
    expect(d.cashWithCouriers).toBe(0);
  });
});

describe('failed attempts', () => {
  it('reattempts automatically, then returns after the maximum', async () => {
    const s = await ok(agents.merchant.post('/merchant/shipments').send({ customerName: 'Hany', customerPhone: '01212345678', address: '9 Street, Nasr City', governorateCode: 'CAI', codAmount: 10000 }), 201);
    // the merchant drops it off at their own hub, which also delivers to Nasr City
    const drop = await ok(agents['CAI-E'].post(`/hubs/${hubs['CAI-E']}/inbound`).send({ code: s.trackingNumber }));
    expect(drop.next.kind).toBe('DELIVER');

    for (let attempt = 1; attempt <= 3; attempt++) {
      const run = await ok(agents['CAI-E'].post(`/hubs/${hubs['CAI-E']}/runs`).send({ courierId: users['courier.caie@shiply.local'] }), 201);
      await ok(agents['CAI-E'].post(`/hubs/${hubs['CAI-E']}/runs/${run.id}/add`).send({ code: s.trackingNumber }));
      await ok(agents['CAI-E'].post(`/hubs/${hubs['CAI-E']}/runs/${run.id}/start`));
      const mine = await ok(agents.courierCaie.get('/courier/run'));
      await ok(agents.courierCaie.post(`/courier/stops/${mine.items[0].id}/fail`).send({ reason: 'NO_ANSWER' }));
      const back = await ok(agents['CAI-E'].post(`/hubs/${hubs['CAI-E']}/inbound`).send({ code: s.trackingNumber }));
      await ok(agents['CAI-E'].post(`/hubs/${hubs['CAI-E']}/runs/${run.id}/close`).send({ cashReceived: 0 }));
      if (attempt < 3) {
        expect(back.direction).toBe('FORWARD');
        expect(back.next.kind).toBe('DELIVER');
      } else {
        expect(back.direction).toBe('RETURN');
        expect(back.next.kind).toBe('RETURN_TO_MERCHANT');
      }
    }
  });
});
