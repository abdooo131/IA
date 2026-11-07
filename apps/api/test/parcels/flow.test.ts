// The company flow end to end, through the real API and a real database:
// merchant → first mile courier → sorting facility (inbound team → sorting team → outbound team)
// → line haul → last mile hub → courier → consumer, and returns the other way.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createNetworkApp } from './setup-db';

process.env.SHIPLY_JOBS = 'off';

let app: INestApplication;
type Agent = ReturnType<typeof request.agent>;

const as: Record<string, any> = {};
const hubs: Record<string, string> = {};
const users: Record<string, string> = {};

async function login(email: string, password = 'demo123456'): Promise<Agent> {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/auth/login').send({ email: email, password }).expect(200);
  return agent;
}

async function ok<T = any>(req: request.Test, status = 200): Promise<T> {
  const res = await req;
  if (res.status !== status)
    throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as T;
}

const show = (id: string) => ok(as.admin!.get(`/parcels/admin/shipments/${id}`));

/** Sorting puts parcels on the lane for `to`; outbound scans each into a bag, seals, loads a truck, departs. */
async function dispatch(facility: 'OBR' | 'ALXSF', to: string, codes: string[]) {
  const f = hubs[facility];
  const t = facility.toLowerCase();
  for (const code of codes) {
    const r = await ok(as[`sorting.${t}`]!.post(`/parcels/hubs/${f}/sort`).send({ code }));
    expect(r.lane).toBe(to);
    const notYet = await as[`sorting.${t}`]!.post(`/parcels/hubs/${f}/outbound/bag`).send({ code });
    expect(notYet.status).toBe(403); // bagging is the outbound team's scan
  }
  let bag: any;
  for (const code of codes) {
    const r = await ok(as[`outbound.${t}`]!.post(`/parcels/hubs/${f}/outbound/bag`).send({ code }));
    expect(r.next.hubCode).toBe(to);
    bag = r.bag;
  }
  await ok(as[`outbound.${t}`]!.post(`/parcels/hubs/${f}/bags/${bag.id}/seal`));
  const trip = await ok(
    as[`outbound.${t}`]!.post(`/parcels/hubs/${f}/trips`).send({
      destinationHubId: hubs[to],
      vehicle: 'Truck 7',
    }),
    201,
  );
  await ok(
    as[`outbound.${t}`]!.post(`/parcels/hubs/${f}/trips/${trip.id}/load`).send({ code: bag.code }),
  );
  await ok(as[`outbound.${t}`]!.post(`/parcels/hubs/${f}/trips/${trip.id}/depart`));
  return bag.code as string;
}

/** The receiving side opens the bag and scans every parcel in it. */
async function receive(agent: Agent, hub: string, bag: string, codes: string[]) {
  const opened = await ok(agent.post(`/parcels/hubs/${hubs[hub]}/receive-bag`).send({ code: bag }));
  expect(opened.expected).toBe(codes.length);
  for (const code of codes)
    await ok(agent.post(`/parcels/hubs/${hubs[hub]}/inbound`).send({ code }));
}

/** A last mile hub scans returns straight into the bag for its facility and sends it (no teams there). */
async function sendBack(hub: string, staff: Agent, codes: string[]) {
  let bag: any;
  for (const code of codes)
    bag = (await ok(staff.post(`/parcels/hubs/${hubs[hub]}/outbound/bag`).send({ code }))).bag;
  await ok(staff.post(`/parcels/hubs/${hubs[hub]}/bags/${bag.id}/seal`));
  const trip = await ok(
    staff.post(`/parcels/hubs/${hubs[hub]}/trips`).send({ destinationHubId: bag.destinationHubId }),
    201,
  );
  await ok(staff.post(`/parcels/hubs/${hubs[hub]}/trips/${trip.id}/load`).send({ code: bag.code }));
  await ok(staff.post(`/parcels/hubs/${hubs[hub]}/trips/${trip.id}/depart`));
  return bag.code as string;
}

beforeAll(async () => {
  app = await createNetworkApp();
  as.admin = await login('admin@shiply.local', 'admin12345');
  as.merchant = await login('merchant@evechantelle.example');
  for (const f of ['obr', 'alxsf']) {
    as[`staff.${f}`] = await login(`staff.${f}@shiply.local`);
    for (const team of ['inbound', 'sorting', 'outbound'])
      as[`${team}.${f}`] = await login(`${team}.${f}@shiply.local`);
    as[`courier.${f}`] = await login(`courier.${f}@shiply.local`);
  }
  as.giz = await login('staff.giz@shiply.local');
  as.alx = await login('staff.alx@shiply.local');
  as.courierGiz = await login('courier.giz@shiply.local');
  as.courierAlx = await login('courier.alx@shiply.local');
  for (const h of await ok(as.admin.get('/parcels/admin/hubs'))) hubs[h.code] = h.id;
  for (const u of await ok(as.admin.get('/parcels/admin/users'))) users[u.email] = u.id;
});

afterAll(async () => {
  await app?.close();
});

describe('company flow', () => {
  const p: Record<string, any> = {};

  it('the network is built from map distance', async () => {
    const all = await ok(as.admin.get('/parcels/admin/hubs'));
    const parent = (code: string) =>
      all.find((h: any) => h.id === all.find((x: any) => x.code === code).parentId)?.code;
    expect(parent('GIZ')).toBe('OBR');
    expect(parent('DLT')).toBe('OBR');
    expect(parent('ALX')).toBe('ALXSF');
    expect(parent('DMN')).toBe('ALXSF');
    const me = await ok(as.merchant.get('/parcels/merchant/profile'));
    expect(me.homeHub.code).toBe('OBR'); // Heliopolis merchant → nearest facility
  });

  it('a new merchant gets the nearest sorting facility automatically', async () => {
    const m = await ok(
      as.admin.post('/parcels/admin/merchants').send({
        code: 'DAM',
        name: 'Damanhour Shop',
        phone: '01112345678',
        pickupAddress: '3 Station St, Damanhour',
        governorateCode: 'EG-BH',
      }),
      201,
    );
    expect(m.homeHubId).toBe(hubs.ALXSF);
  });

  it('merchant creates parcels', async () => {
    const locs = await ok(as.merchant.get('/parcels/reference/locations'));
    const dokki = locs
      .find((g: any) => g.code === 'EG-GZ')
      .areas.find((a: any) => a.nameEn === 'Dokki');
    const base = {
      customerName: 'Mona Ali',
      customerPhone: '01012345678',
      address: '5 Tahrir St, Dokki',
      governorateCode: 'EG-GZ',
      areaId: dokki.id,
    };
    p.giza = await ok(
      as.merchant.post('/parcels/merchant/shipments').send({ ...base, codAmount: 50000 }),
      201,
    );
    p.refused = await ok(
      as.merchant
        .post('/parcels/merchant/shipments')
        .send({ ...base, customerName: 'Omar Said', codAmount: 30000 }),
      201,
    );
    p.alex = await ok(
      as.merchant.post('/parcels/merchant/shipments').send({
        customerName: 'Hana',
        customerPhone: '01112345678',
        address: '9 Sea Rd, Smouha',
        governorateCode: 'EG-ALX',
        codAmount: 20000,
      }),
      201,
    );
    p.dropoff = await ok(
      as.merchant
        .post('/parcels/merchant/shipments')
        .send({ ...base, customerName: 'Karim', codAmount: 10000 }),
      201,
    );
    const s = await show(p.giza.id);
    expect(s.hubCodes[s.originHubId]).toBe('OBR');
    expect(s.hubCodes[s.destinationHubId]).toBe('GIZ');
  });

  it('pickups go to the merchant facility, never to a last mile hub', async () => {
    const r = await as.giz
      .post(`/parcels/hubs/${hubs.GIZ}/inbound`)
      .send({ code: p.dropoff.trackingNumber });
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('Obour Sorting Center');
  });

  it('first mile: pickup is assigned at the facility and collected', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
    const pickup = await ok(
      as.merchant.post('/parcels/merchant/pickups').send({ date: today }),
      201,
    );
    expect(pickup.hubId).toBe(hubs.OBR);
    await ok(
      as['staff.obr']!.post(`/parcels/hubs/${hubs.OBR}/pickups/${pickup.id}/assign`).send({
        courierId: users['courier.obr@shiply.local'],
      }),
    );
    for (const x of [p.giza, p.refused, p.alex])
      await ok(
        as['courier.obr']!.post(`/parcels/courier/pickups/${pickup.id}/collect`).send({
          code: x.trackingNumber,
        }),
      );
    await ok(as['courier.obr']!.post(`/parcels/courier/pickups/${pickup.id}/finish`));
  });

  it('each team works only its own station', async () => {
    const wrong = await as['sorting.obr']!.post(`/parcels/hubs/${hubs.OBR}/inbound`).send({
      code: p.giza.trackingNumber,
    });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toBe('wrong_team');
    const early = await as['sorting.obr']!.post(`/parcels/hubs/${hubs.OBR}/sort`).send({
      code: p.giza.trackingNumber,
    });
    expect(early.status).toBe(409); // inbound has not received it yet
  });

  it('inbound team receives everything and the system says where each goes', async () => {
    const expected: [typeof p.giza, string][] = [
      [p.giza, 'GIZ'],
      [p.refused, 'GIZ'],
      [p.alex, 'ALXSF'],
      [p.dropoff, 'GIZ'],
    ];
    for (const [x, next] of expected) {
      const r = await ok(
        as['inbound.obr']!.post(`/parcels/hubs/${hubs.OBR}/inbound`).send({
          code: x.trackingNumber,
        }),
      );
      expect(r.status).toBe('AT_INBOUND');
      expect(r.next).toMatchObject({ kind: 'SEND', hubCode: next });
    }
    const hand = await ok(as['inbound.obr']!.get(`/parcels/hubs/${hubs.OBR}/on-hand`));
    expect(hand.groups.find((g: any) => g.key === 'inbound').rows).toHaveLength(4);
    const check = await ok(as['staff.obr']!.get(`/parcels/hubs/${hubs.OBR}/handover-check`));
    expect(check.stages.find((st: any) => st.key === 'notSorted').rows).toHaveLength(4);
    expect((await ok(as.merchant.get('/parcels/merchant/pickups')))[0].status).toBe('RECEIVED');
  });

  it('sorting → outbound → line haul to the last mile hub and to the other facility', async () => {
    await dispatch('OBR', 'GIZ', [
      p.giza.trackingNumber,
      p.refused.trackingNumber,
      p.dropoff.trackingNumber,
    ]);
    const alexBag = await dispatch('OBR', 'ALXSF', [p.alex.trackingNumber]);
    expect((await show(p.giza.id)).status).toBe('IN_TRANSIT');

    // Alexandria facility: inbound opens the bag and scans the parcel, sorting and outbound send it on
    await receive(as['inbound.alxsf']!, 'ALXSF', alexBag, [p.alex.trackingNumber]);
    expect((await show(p.alex.id)).status).toBe('AT_INBOUND');
    const toSmouha = await dispatch('ALXSF', 'ALX', [p.alex.trackingNumber]);
    await receive(as.alx, 'ALX', toSmouha, [p.alex.trackingNumber]);
    expect((await show(p.alex.id)).next.kind).toBe('DELIVER');
  });

  it('last mile: deliver with exact cash, a refusal goes on hold, run closes with cash', async () => {
    const bags = await ok(as.giz.get(`/parcels/hubs/${hubs.GIZ}/bags`));
    const gizBag = bags.find((b: any) => b.status === 'IN_TRANSIT').code;
    // one parcel never gets scanned at Dokki: closing the bag marks it lost
    await ok(as.giz.post(`/parcels/hubs/${hubs.GIZ}/receive-bag`).send({ code: gizBag }));
    for (const x of [p.giza, p.refused])
      await ok(as.giz.post(`/parcels/hubs/${hubs.GIZ}/inbound`).send({ code: x.trackingNumber }));
    const gap = await ok(as.giz.get(`/parcels/hubs/${hubs.GIZ}/handover-check`));
    expect(
      gap.stages.find((st: any) => st.key === 'notScanned').rows.map((r: any) => r.trackingNumber),
    ).toEqual([p.dropoff.trackingNumber]);
    const opened = await ok(as.giz.get(`/parcels/hubs/${hubs.GIZ}/arrivals`));
    const checked = await ok(as.giz.post(`/parcels/hubs/${hubs.GIZ}/bags/${opened[0].id}/check`));
    expect(checked.missing).toEqual([p.dropoff.trackingNumber]);
    const lost = await show(p.dropoff.id);
    expect(lost.status).toBe('LOST');
    expect(lost.events.at(-1).note).toContain(gizBag);
    expect(
      (await ok(as.giz.get(`/parcels/hubs/${hubs.GIZ}/handover-check`))).lost[0].trackingNumber,
    ).toBe(p.dropoff.trackingNumber);
    // found later on a shelf: one scan brings it back
    expect(
      (
        await ok(
          as.giz.post(`/parcels/hubs/${hubs.GIZ}/inbound`).send({ code: p.dropoff.trackingNumber }),
        )
      ).status,
    ).toBe('AT_HUB');
    const run = await ok(
      as.giz
        .post(`/parcels/hubs/${hubs.GIZ}/runs`)
        .send({ courierId: users['courier.giz@shiply.local'] }),
      201,
    );
    for (const x of [p.giza, p.refused])
      await ok(
        as.giz
          .post(`/parcels/hubs/${hubs.GIZ}/runs/${run.id}/add`)
          .send({ code: x.trackingNumber }),
      );
    await ok(as.giz.post(`/parcels/hubs/${hubs.GIZ}/runs/${run.id}/start`));
    const mine = await ok(as.courierGiz.get('/parcels/courier/run'));
    const stop = (id: string) => mine.items.find((i: any) => i.shipment.id === id).id;
    expect(
      (
        await as.courierGiz
          .post(`/parcels/courier/stops/${stop(p.giza.id)}/deliver`)
          .send({ codCollected: 40000 })
      ).status,
    ).toBe(422);
    await ok(
      as.courierGiz
        .post(`/parcels/courier/stops/${stop(p.giza.id)}/deliver`)
        .send({ codCollected: 50000 }),
    );
    await ok(
      as.courierGiz
        .post(`/parcels/courier/stops/${stop(p.refused.id)}/fail`)
        .send({ reason: 'REFUSED' }),
    );
    expect(
      (
        await as.giz
          .post(`/parcels/hubs/${hubs.GIZ}/runs/${run.id}/close`)
          .send({ cashReceived: 50000 })
      ).status,
    ).toBe(409);
    expect(
      (
        await ok(
          as.giz.post(`/parcels/hubs/${hubs.GIZ}/inbound`).send({ code: p.refused.trackingNumber }),
        )
      ).status,
    ).toBe('ON_HOLD');
    expect(
      (
        await ok(
          as.giz
            .post(`/parcels/hubs/${hubs.GIZ}/runs/${run.id}/close`)
            .send({ cashReceived: 50000 }),
        )
      ).difference,
    ).toBe(0);
    expect((await show(p.giza.id)).status).toBe('DELIVERED');
  });

  it('a return goes back through the facility and is handed to the merchant from the return shelf', async () => {
    await ok(
      as.merchant
        .post(`/parcels/merchant/shipments/${p.refused.id}/decision`)
        .send({ decision: 'RETURN' }),
    );
    expect((await show(p.refused.id)).next).toMatchObject({ kind: 'SEND', hubCode: 'OBR' });
    const bag = await sendBack('GIZ', as.giz, [p.refused.trackingNumber]);
    await receive(as['inbound.obr']!, 'OBR', bag, [p.refused.trackingNumber]);
    const shelf = await ok(
      as['sorting.obr']!.post(`/parcels/hubs/${hubs.OBR}/sort`).send({
        code: p.refused.trackingNumber,
      }),
    );
    expect(shelf.next.kind).toBe('RETURN_TO_MERCHANT');
    expect(shelf.lane).toBeNull();
    expect(shelf.message).toContain('Eve Chantelle');
    const run = await ok(
      as['staff.obr']!.post(`/parcels/hubs/${hubs.OBR}/runs`).send({
        courierId: users['courier.obr@shiply.local'],
      }),
      201,
    );
    expect(
      (
        await ok(
          as['staff.obr']!.post(`/parcels/hubs/${hubs.OBR}/runs/${run.id}/add`).send({
            code: p.refused.trackingNumber,
          }),
        )
      ).direction,
    ).toBe('RETURN');
    await ok(as['staff.obr']!.post(`/parcels/hubs/${hubs.OBR}/runs/${run.id}/start`));
    const mine = await ok(as['courier.obr']!.get('/parcels/courier/run'));
    await ok(
      as['courier.obr']!.post(`/parcels/courier/stops/${mine.items[0].id}/deliver`).send({
        codCollected: 0,
        recipient: 'Store',
      }),
    );
    await ok(
      as['staff.obr']!.post(`/parcels/hubs/${hubs.OBR}/runs/${run.id}/close`).send({
        cashReceived: 0,
      }),
    );
    const done = await show(p.refused.id);
    expect(done.status).toBe('RETURNED');
    expect(done.returnFee).toBe(3600); // 60% of shipping
  });

  it('statement and payout', async () => {
    const st = await ok(as.merchant.get('/parcels/merchant/statement'));
    expect(st.balance).toBe(50000 - 6000 - (6000 + 3600));
    const merchantId = (await ok(as.merchant.get('/parcels/auth/me'))).merchantId;
    // Payouts are made once for both companies in Accounting (Shiply Now's payouts).
    const tb = await ok(as.admin.get('/parcels/finance/reports/trial-balance'));
    expect(tb.balanced).toBe(true);
    const merchants = await ok(as.admin.get('/parcels/finance/wallets/MERCHANT'));
    expect(merchants.find((m: any) => m.id === merchantId)).toBeDefined(); // owed until Accounting pays out
  });

  it('public tracking shows the journey without personal data', async () => {
    const t = await ok(request(app.getHttpServer()).get(`/parcels/track/${p.giza.trackingNumber}`));
    expect(t.events.map((e: any) => e.text)).toEqual(
      expect.arrayContaining(['Received at our sorting facility', 'Sorted', 'Delivered']),
    );
    expect(JSON.stringify(t)).not.toContain('Tahrir');
  });

  it('history cannot be edited', async () => {
    const { PrismaService } = await import('../../src/prisma/prisma.service');
    const db = app.get(PrismaService);
    await expect(db.$executeRawUnsafe(`UPDATE shipment_events SET note = 'x'`)).rejects.toThrow(
      /append/i,
    );
  });
});

describe('failed attempts', () => {
  it('reattempts, then returns after the maximum', async () => {
    const s = await ok(
      as.merchant.post('/parcels/merchant/shipments').send({
        customerName: 'Hany',
        customerPhone: '01212345678',
        address: '9 Street, Dokki',
        governorateCode: 'EG-GZ',
        codAmount: 10000,
      }),
      201,
    );
    await ok(
      as['inbound.obr']!.post(`/parcels/hubs/${hubs.OBR}/inbound`).send({ code: s.trackingNumber }),
    );
    const bag = await dispatch('OBR', 'GIZ', [s.trackingNumber]);
    await receive(as.giz, 'GIZ', bag, [s.trackingNumber]);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const run = await ok(
        as.giz
          .post(`/parcels/hubs/${hubs.GIZ}/runs`)
          .send({ courierId: users['courier.giz@shiply.local'] }),
        201,
      );
      await ok(
        as.giz
          .post(`/parcels/hubs/${hubs.GIZ}/runs/${run.id}/add`)
          .send({ code: s.trackingNumber }),
      );
      await ok(as.giz.post(`/parcels/hubs/${hubs.GIZ}/runs/${run.id}/start`));
      const mine = await ok(as.courierGiz.get('/parcels/courier/run'));
      await ok(
        as.courierGiz
          .post(`/parcels/courier/stops/${mine.items[0].id}/fail`)
          .send({ reason: 'NO_ANSWER' }),
      );
      const back = await ok(
        as.giz.post(`/parcels/hubs/${hubs.GIZ}/inbound`).send({ code: s.trackingNumber }),
      );
      await ok(
        as.giz.post(`/parcels/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 0 }),
      );
      if (attempt < 3) expect(back.next.kind).toBe('DELIVER');
      else expect(back.next).toMatchObject({ kind: 'SEND', hubCode: 'OBR' });
    }
  });
});
