// The company flow end to end, through the real API and a real database:
// merchant → first mile courier → sorting facility (inbound team → sorting team → outbound team)
// → line haul → last mile hub → courier → consumer, and returns the other way.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestDatabase, dropTestDatabase, TEST_DB } from './setup-db';

process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';

let app: INestApplication;
type Agent = ReturnType<typeof request.agent>;
const as: Record<string, Agent> = {};
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

const show = (id: string) => ok(as.admin!.get(`/admin/shipments/${id}`));

/** Sorting team bags parcels for `to`, seals; outbound accepts, loads a trip, departs; returns the bag code. */
async function dispatch(facility: 'OBR' | 'ALXSF', to: string, codes: string[]) {
  const f = hubs[facility];
  const t = facility.toLowerCase();
  let bag: any;
  for (const code of codes) {
    const r = await ok(as[`sorting.${t}`]!.post(`/hubs/${f}/sort`).send({ code }));
    expect(r.next.hubCode).toBe(to);
    bag = r.bag;
  }
  await ok(as[`sorting.${t}`]!.post(`/hubs/${f}/bags/${bag.id}/seal`));
  const trip = await ok(as[`outbound.${t}`]!.post(`/hubs/${f}/trips`).send({ destinationHubId: hubs[to], vehicle: 'Truck 7' }), 201);
  const early = await as[`outbound.${t}`]!.post(`/hubs/${f}/trips/${trip.id}/load`).send({ code: bag.code });
  expect(early.status).toBe(409); // must be accepted from sorting first
  const acc = await ok(as[`outbound.${t}`]!.post(`/hubs/${f}/outbound/accept`).send({ code: bag.code }));
  expect(acc.parcels).toBe(codes.length);
  await ok(as[`outbound.${t}`]!.post(`/hubs/${f}/trips/${trip.id}/load`).send({ code: bag.code }));
  await ok(as[`outbound.${t}`]!.post(`/hubs/${f}/trips/${trip.id}/depart`));
  return bag.code as string;
}

/** A last mile hub bags returns for its facility and sends them (no teams there). */
async function sendBack(hub: string, staff: Agent, codes: string[]) {
  let bag: any;
  for (const code of codes) bag = (await ok(staff.post(`/hubs/${hubs[hub]}/sort`).send({ code }))).bag;
  await ok(staff.post(`/hubs/${hubs[hub]}/bags/${bag.id}/seal`));
  const trip = await ok(staff.post(`/hubs/${hubs[hub]}/trips`).send({ destinationHubId: bag.destinationHubId }), 201);
  await ok(staff.post(`/hubs/${hubs[hub]}/trips/${trip.id}/load`).send({ code: bag.code }));
  await ok(staff.post(`/hubs/${hubs[hub]}/trips/${trip.id}/depart`));
  return bag.code as string;
}

beforeAll(async () => {
  await createTestDatabase();
  const { createApp } = await import('../src/main');
  app = await createApp();
  await app.init();
  as.admin = await login('admin@shiply.local', 'admin12345');
  as.merchant = await login('merchant@evechantelle.example');
  for (const f of ['obr', 'alxsf']) {
    as[`staff.${f}`] = await login(`staff.${f}@shiply.local`);
    for (const team of ['inbound', 'sorting', 'outbound']) as[`${team}.${f}`] = await login(`${team}.${f}@shiply.local`);
    as[`courier.${f}`] = await login(`courier.${f}@shiply.local`);
  }
  as.giz = await login('staff.giz@shiply.local');
  as.alx = await login('staff.alx@shiply.local');
  as.courierGiz = await login('courier.giz@shiply.local');
  as.courierAlx = await login('courier.alx@shiply.local');
  for (const h of await ok(as.admin.get('/admin/hubs'))) hubs[h.code] = h.id;
  for (const u of await ok(as.admin.get('/admin/users'))) users[u.email] = u.id;
});

afterAll(async () => {
  await app?.close();
  await dropTestDatabase();
});

describe('company flow', () => {
  const p: Record<string, { id: string; trackingNumber: string }> = {};

  it('the network is built from map distance', async () => {
    const all = await ok(as.admin.get('/admin/hubs'));
    const parent = (code: string) => all.find((h: any) => h.id === all.find((x: any) => x.code === code).parentId)?.code;
    expect(parent('GIZ')).toBe('OBR');
    expect(parent('DLT')).toBe('OBR');
    expect(parent('ALX')).toBe('ALXSF');
    expect(parent('DMN')).toBe('ALXSF');
    const me = await ok(as.merchant.get('/merchant/profile'));
    expect(me.homeHub.code).toBe('OBR'); // Heliopolis merchant → nearest facility
  });

  it('a new merchant gets the nearest sorting facility automatically', async () => {
    const m = await ok(as.admin.post('/admin/merchants').send({ code: 'DAM', name: 'Damanhour Shop', phone: '01112345678', pickupAddress: '3 Station St, Damanhour', governorateCode: 'BEH' }), 201);
    expect(m.homeHubId).toBe(hubs.ALXSF);
  });

  it('merchant creates parcels', async () => {
    const locs = await ok(as.merchant.get('/reference/locations'));
    const dokki = locs.find((g: any) => g.code === 'GIZ').areas.find((a: any) => a.nameEn === 'Dokki');
    const base = { customerName: 'Mona Ali', customerPhone: '01012345678', address: '5 Tahrir St, Dokki', governorateCode: 'GIZ', areaId: dokki.id };
    p.giza = await ok(as.merchant.post('/merchant/shipments').send({ ...base, codAmount: 50000 }), 201);
    p.refused = await ok(as.merchant.post('/merchant/shipments').send({ ...base, customerName: 'Omar Said', codAmount: 30000 }), 201);
    p.alex = await ok(as.merchant.post('/merchant/shipments').send({ customerName: 'Hana', customerPhone: '01112345678', address: '9 Sea Rd, Smouha', governorateCode: 'ALX', codAmount: 20000 }), 201);
    p.dropoff = await ok(as.merchant.post('/merchant/shipments').send({ ...base, customerName: 'Karim', codAmount: 10000 }), 201);
    const s = await show(p.giza.id);
    expect(s.hubCodes[s.originHubId]).toBe('OBR');
    expect(s.hubCodes[s.destinationHubId]).toBe('GIZ');
  });

  it('pickups go to the merchant facility, never to a last mile hub', async () => {
    const r = await as.giz.post(`/hubs/${hubs.GIZ}/inbound`).send({ code: p.dropoff.trackingNumber });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('Obour Sorting Center');
  });

  it('first mile: pickup is assigned at the facility and collected', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
    const pickup = await ok(as.merchant.post('/merchant/pickups').send({ date: today }), 201);
    expect(pickup.hubId).toBe(hubs.OBR);
    await ok(as['staff.obr']!.post(`/hubs/${hubs.OBR}/pickups/${pickup.id}/assign`).send({ courierId: users['courier.obr@shiply.local'] }));
    for (const x of [p.giza, p.refused, p.alex]) await ok(as['courier.obr']!.post(`/courier/pickups/${pickup.id}/collect`).send({ code: x.trackingNumber }));
    await ok(as['courier.obr']!.post(`/courier/pickups/${pickup.id}/finish`));
  });

  it('each team works only its own station', async () => {
    const wrong = await as['sorting.obr']!.post(`/hubs/${hubs.OBR}/inbound`).send({ code: p.giza.trackingNumber });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toBe('wrong_team');
    const early = await as['sorting.obr']!.post(`/hubs/${hubs.OBR}/sort`).send({ code: p.giza.trackingNumber });
    expect(early.status).toBe(409); // inbound has not received it yet
  });

  it('inbound team receives everything and the system says where each goes', async () => {
    const expected: [typeof p.giza, string][] = [[p.giza, 'GIZ'], [p.refused, 'GIZ'], [p.alex, 'ALXSF'], [p.dropoff, 'GIZ']];
    for (const [x, next] of expected) {
      const r = await ok(as['inbound.obr']!.post(`/hubs/${hubs.OBR}/inbound`).send({ code: x.trackingNumber }));
      expect(r.status).toBe('AT_INBOUND');
      expect(r.next).toMatchObject({ kind: 'SEND', hubCode: next });
    }
    const hand = await ok(as['inbound.obr']!.get(`/hubs/${hubs.OBR}/on-hand`));
    expect(hand.groups.find((g: any) => g.key === 'inbound').rows).toHaveLength(4);
    expect((await ok(as.merchant.get('/merchant/pickups')))[0].status).toBe('RECEIVED');
  });

  it('sorting → outbound → line haul to the last mile hub and to the other facility', async () => {
    await dispatch('OBR', 'GIZ', [p.giza.trackingNumber, p.refused.trackingNumber, p.dropoff.trackingNumber]);
    const alexBag = await dispatch('OBR', 'ALXSF', [p.alex.trackingNumber]);
    expect((await show(p.giza.id)).status).toBe('IN_TRANSIT');

    // Alexandria facility: inbound receives the bag, sorting and outbound send it on to Smouha
    const rec = await ok(as['inbound.alxsf']!.post(`/hubs/${hubs.ALXSF}/receive-bag`).send({ code: alexBag }));
    expect(rec.parcels).toBe(1);
    expect((await show(p.alex.id)).status).toBe('AT_INBOUND');
    const toSmouha = await dispatch('ALXSF', 'ALX', [p.alex.trackingNumber]);
    await ok(as.alx.post(`/hubs/${hubs.ALX}/receive-bag`).send({ code: toSmouha }));
    expect((await show(p.alex.id)).next.kind).toBe('DELIVER');
  });

  it('last mile: deliver with exact cash, a refusal goes on hold, run closes with cash', async () => {
    const bags = await ok(as.giz.get(`/hubs/${hubs.GIZ}/bags`));
    await ok(as.giz.post(`/hubs/${hubs.GIZ}/receive-bag`).send({ code: bags.find((b: any) => b.status === 'IN_TRANSIT').code }));
    const run = await ok(as.giz.post(`/hubs/${hubs.GIZ}/runs`).send({ courierId: users['courier.giz@shiply.local'] }), 201);
    for (const x of [p.giza, p.refused]) await ok(as.giz.post(`/hubs/${hubs.GIZ}/runs/${run.id}/add`).send({ code: x.trackingNumber }));
    await ok(as.giz.post(`/hubs/${hubs.GIZ}/runs/${run.id}/start`));
    const mine = await ok(as.courierGiz.get('/courier/run'));
    const stop = (id: string) => mine.items.find((i: any) => i.shipment.id === id).id;
    expect((await as.courierGiz.post(`/courier/stops/${stop(p.giza.id)}/deliver`).send({ codCollected: 40000 })).status).toBe(422);
    await ok(as.courierGiz.post(`/courier/stops/${stop(p.giza.id)}/deliver`).send({ codCollected: 50000 }));
    await ok(as.courierGiz.post(`/courier/stops/${stop(p.refused.id)}/fail`).send({ reason: 'REFUSED' }));
    expect((await as.giz.post(`/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 50000 })).status).toBe(409);
    expect((await ok(as.giz.post(`/hubs/${hubs.GIZ}/inbound`).send({ code: p.refused.trackingNumber }))).status).toBe('ON_HOLD');
    expect((await ok(as.giz.post(`/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 50000 }))).difference).toBe(0);
    expect((await show(p.giza.id)).status).toBe('DELIVERED');
  });

  it('a return goes back through the facility and is handed to the merchant from the return shelf', async () => {
    await ok(as.merchant.post(`/merchant/shipments/${p.refused.id}/decision`).send({ decision: 'RETURN' }));
    expect((await show(p.refused.id)).next).toMatchObject({ kind: 'SEND', hubCode: 'OBR' });
    const bag = await sendBack('GIZ', as.giz, [p.refused.trackingNumber]);
    const rec = await ok(as['inbound.obr']!.post(`/hubs/${hubs.OBR}/receive-bag`).send({ code: bag }));
    expect(rec.parcels).toBe(1);
    const shelf = await ok(as['sorting.obr']!.post(`/hubs/${hubs.OBR}/sort`).send({ code: p.refused.trackingNumber }));
    expect(shelf.next.kind).toBe('RETURN_TO_MERCHANT');
    expect(shelf.message).toContain('Eve Chantelle');
    const run = await ok(as['staff.obr']!.post(`/hubs/${hubs.OBR}/runs`).send({ courierId: users['courier.obr@shiply.local'] }), 201);
    expect((await ok(as['staff.obr']!.post(`/hubs/${hubs.OBR}/runs/${run.id}/add`).send({ code: p.refused.trackingNumber }))).direction).toBe('RETURN');
    await ok(as['staff.obr']!.post(`/hubs/${hubs.OBR}/runs/${run.id}/start`));
    const mine = await ok(as['courier.obr']!.get('/courier/run'));
    await ok(as['courier.obr']!.post(`/courier/stops/${mine.items[0].id}/deliver`).send({ codCollected: 0, recipient: 'Store' }));
    await ok(as['staff.obr']!.post(`/hubs/${hubs.OBR}/runs/${run.id}/close`).send({ cashReceived: 0 }));
    const done = await show(p.refused.id);
    expect(done.status).toBe('RETURNED');
    expect(done.returnFee).toBe(3000);
  });

  it('statement and payout', async () => {
    const st = await ok(as.merchant.get('/merchant/statement'));
    expect(st.balance).toBe(50000 - 6000 - (6000 + 3000));
    const merchantId = (await ok(as.merchant.get('/auth/me'))).merchantId;
    expect((await ok(as.admin.post(`/admin/merchants/${merchantId}/payouts`).send({ reference: 'TX1' }), 201)).amount).toBe(35000);
  });

  it('public tracking shows the journey without personal data', async () => {
    const t = await ok(request(app.getHttpServer()).get(`/track/${p.giza.trackingNumber}`));
    expect(t.events.map((e: any) => e.text)).toEqual(expect.arrayContaining(['Received at our sorting facility', 'Sorted', 'Delivered']));
    expect(JSON.stringify(t)).not.toContain('Tahrir');
  });

  it('history cannot be edited', async () => {
    const { PrismaClient } = await import('@shiply/db');
    const db = new PrismaClient({ datasourceUrl: TEST_DB });
    await expect(db.$executeRawUnsafe(`UPDATE shipment_events SET note = 'x'`)).rejects.toThrow(/append only/);
    await db.$disconnect();
  });
});

describe('failed attempts', () => {
  it('reattempts, then returns after the maximum', async () => {
    const s = await ok(as.merchant.post('/merchant/shipments').send({ customerName: 'Hany', customerPhone: '01212345678', address: '9 Street, Dokki', governorateCode: 'GIZ', codAmount: 10000 }), 201);
    await ok(as['inbound.obr']!.post(`/hubs/${hubs.OBR}/inbound`).send({ code: s.trackingNumber }));
    const bag = await dispatch('OBR', 'GIZ', [s.trackingNumber]);
    await ok(as.giz.post(`/hubs/${hubs.GIZ}/receive-bag`).send({ code: bag }));
    for (let attempt = 1; attempt <= 3; attempt++) {
      const run = await ok(as.giz.post(`/hubs/${hubs.GIZ}/runs`).send({ courierId: users['courier.giz@shiply.local'] }), 201);
      await ok(as.giz.post(`/hubs/${hubs.GIZ}/runs/${run.id}/add`).send({ code: s.trackingNumber }));
      await ok(as.giz.post(`/hubs/${hubs.GIZ}/runs/${run.id}/start`));
      const mine = await ok(as.courierGiz.get('/courier/run'));
      await ok(as.courierGiz.post(`/courier/stops/${mine.items[0].id}/fail`).send({ reason: 'NO_ANSWER' }));
      const back = await ok(as.giz.post(`/hubs/${hubs.GIZ}/inbound`).send({ code: s.trackingNumber }));
      await ok(as.giz.post(`/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 0 }));
      if (attempt < 3) expect(back.next.kind).toBe('DELIVER');
      else expect(back.next).toMatchObject({ kind: 'SEND', hubCode: 'OBR' });
    }
  });
});
