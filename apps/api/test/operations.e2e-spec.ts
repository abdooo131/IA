import { INestApplication } from '@nestjs/common';
import { api, createApp, login, sampleOrder } from './helpers';

let app: INestApplication;
let eve: ReturnType<typeof api>;
let ops: ReturnType<typeof api>;
let fin: ReturnType<typeof api>;
let hubs: { id: string; code: string }[];
let drivers: { id: string; fullName: string; type: string }[];
const hub = (code: string) => hubs.find((h) => h.code === code)!.id;
const driver = (name: string) => drivers.find((d) => d.fullName === name)!.id;

beforeAll(async () => {
  app = await createApp();
  eve = api(app, (await login(app, 'owner@evechantelle.com', 'merchant')).accessToken);
  ops = api(app, (await login(app, 'ops@shiply.eg', 'ops')).accessToken);
  fin = api(app, (await login(app, 'finance@shiply.eg', 'ops')).accessToken);
  hubs = (await ops.get('/admin/hubs')).body;
  drivers = (await ops.get('/ops/drivers')).body;
});
afterAll(async () => app.close());

const status = async (id: string) => (await ops.get(`/orders/${id}`)).body.status;

describe('drivers', () => {
  it('creates a delivery driver with a login and validates the phone', async () => {
    const bad = await ops.post('/ops/drivers', { type: 'DELIVERY', fullName: 'Bad Phone', phone: '123' });
    expect(bad.status).toBe(400);
    const r = await ops.post('/ops/drivers', { type: 'DELIVERY', fullName: 'Test Rider', phone: '01099988877', hubId: hub('NASR') });
    expect(r.status).toBe(201);
    const list = (await ops.get('/ops/drivers?type=DELIVERY')).body;
    expect(list.some((d: { fullName: string }) => d.fullName === 'Test Rider')).toBe(true);
    expect((await ops.patch(`/ops/drivers/${r.body.id}`, { status: 'SUSPENDED' })).body.status).toBe('SUSPENDED');
  });

  it('a merchant cannot use operations endpoints', async () => {
    expect((await eve.get('/ops/drivers')).status).toBe(403);
  });
});

describe('full delivery flow from the operations portal', () => {
  let a: { id: string; trackingNumber: string };
  let b: { id: string; trackingNumber: string };

  it('assigns a pickup driver, picks up and receives at the sorting facility by scan', async () => {
    a = (await eve.post('/orders', sampleOrder)).body;
    b = (await eve.post('/orders', { ...sampleOrder, customerPhone: '01155566677' })).body;
    const queue = (await ops.get('/ops/pickups')).body;
    expect(queue.some((s: { orders: { id: string }[] }) => s.orders.some((o) => o.id === a.id))).toBe(true);

    const asg = (await ops.post('/ops/pickups/assign', { ids: [a.id, b.id], driverId: driver('Mahmoud Hassan') })).body;
    expect(asg.ok).toHaveLength(2);
    expect(await status(a.id)).toBe('PENDING_PICKUP');
    const sheet = await ops.get(`/ops/drivers/${driver('Mahmoud Hassan')}/runsheet`);
    expect(sheet.status).toBe(200);
    expect(sheet.headers['content-type']).toBe('application/pdf');

    expect((await ops.post('/ops/pickups/picked-up', { ids: [a.id, b.id] })).body.ok).toHaveLength(2);
    const scan = (await ops.post(`/ops/hubs/${hub('CAI-SF')}/receive`, { code: a.trackingNumber.toLowerCase() })).body;
    expect(scan).toMatchObject({ ok: true, to: 'AT_SORTING_FACILITY' });
    expect((await ops.post(`/ops/hubs/${hub('CAI-SF')}/receive`, { code: b.trackingNumber })).body.ok).toBe(true);
    expect((await ops.post(`/ops/hubs/${hub('CAI-SF')}/receive`, { code: 'SHP0000000000' })).body).toMatchObject({ ok: false, message: 'Unknown tracking number' });
    const inv = (await ops.get(`/ops/hubs/${hub('CAI-SF')}/inventory`)).body;
    expect(inv.orders.some((o: { id: string }) => o.id === a.id)).toBe(true);
  });

  it('moves parcels to the Maadi hub on a transfer manifest and alerts on a missing scan', async () => {
    const t = (await ops.post('/ops/transfers', { originHubId: hub('CAI-SF'), destinationHubId: hub('MAADI') })).body;
    expect((await ops.post(`/ops/transfers/${t.id}/scan-out`, { code: a.trackingNumber })).body.ok).toBe(true);
    expect((await ops.post(`/ops/transfers/${t.id}/scan-out`, { code: b.trackingNumber })).body.ok).toBe(true);
    expect((await ops.post(`/ops/transfers/${t.id}/dispatch`)).status).toBe(201);
    expect(await status(a.id)).toBe('IN_TRANSFER');
    expect((await ops.post(`/ops/transfers/${t.id}/scan-in`, { code: a.trackingNumber })).body).toMatchObject({ ok: true, to: 'AT_LAST_MILE_HUB' });
    const closed = (await ops.post(`/ops/transfers/${t.id}/close`)).body;
    expect(closed.missing).toEqual([b.trackingNumber]);
    const alerts = (await ops.get('/ops/alerts')).body;
    expect(alerts.some((x: { kind: string; entityId: string }) => x.kind === 'MISSING_SCAN_IN' && x.entityId === b.id)).toBe(true);
    // The missing parcel turns up later and is received directly at the hub.
    expect((await ops.post(`/ops/hubs/${hub('MAADI')}/receive`, { code: b.trackingNumber })).body).toMatchObject({ ok: true, to: 'AT_LAST_MILE_HUB' });
  });

  it('assigns a delivery driver, delivers one, fails one with a reason, and the merchant sees it', async () => {
    const karim = driver('Karim Mostafa');
    expect((await ops.post('/ops/deliveries/assign', { ids: [a.id, b.id], driverId: karim })).body.ok).toHaveLength(2);
    const board = (await ops.get(`/ops/deliveries?hubId=${hub('MAADI')}`)).body;
    expect(board.withDrivers.some((o: { id: string }) => o.id === a.id)).toBe(true);
    const sheet = await ops.get(`/ops/drivers/${karim}/runsheet`);
    expect(sheet.status).toBe(200);
    expect((await ops.post('/ops/deliveries/out', { ids: [a.id] })).body.ok).toHaveLength(1);
    expect((await ops.post('/ops/deliveries/delivered', { ids: [a.id] })).body.ok).toHaveLength(1);
    const f = (await ops.post('/ops/deliveries/failed', { ids: [b.id], reason: 'NOT_AT_ADDRESS' })).body;
    expect(f.ok).toHaveLength(1);
    const detail = (await eve.get(`/orders/${b.id}`)).body;
    expect(detail.status).toBe('AWAITING_MERCHANT_ACTION');
    expect(detail.events.at(-1).note).toMatch(/Customer is not at the address/);
    expect((await ops.post('/ops/deliveries/failed', { ids: [a.id], reason: 'NOT_AT_ADDRESS' })).body.failed).toHaveLength(1);
  });

  it('end of day: a short handover is recorded, flagged and stays on the driver', async () => {
    const karim = driver('Karim Mostafa');
    const before = (await fin.get('/ops/cash')).body.drivers.find((d: { id: string }) => d.id === karim);
    expect(before.cashHeld).toBeGreaterThanOrEqual(45000);
    expect(before.pendingOrders.some((o: { id: string }) => o.id === a.id)).toBe(true);
    const h = await fin.post('/ops/cash/handover', { driverId: karim, receivedAmount: before.cashHeld - 2000, note: 'test' });
    expect(h.status).toBe(201);
    expect(h.body).toMatchObject({ status: 'SHORT', difference: -2000 });
    const after = (await fin.get('/ops/cash')).body.drivers.find((d: { id: string }) => d.id === karim);
    expect(after.cashHeld).toBe(0);
    expect(after.shortageOwed).toBe(before.shortageOwed + 2000);
    expect(after.pendingOrders).toHaveLength(0);
    const alerts = (await fin.get('/ops/alerts')).body;
    expect(alerts.some((x: { kind: string; entityId: string }) => x.kind === 'CASH_SHORTAGE' && x.entityId === h.body.id)).toBe(true);
    expect((await fin.post('/ops/cash/shortage-repaid', { driverId: karim, amount: 2000 })).status).toBe(201);
    const tb = (await fin.get('/finance/reports/trial_balance')).body;
    expect(tb.checks[0].ok).toBe(true);
  });

  it('returns: last mile hub → sorting facility → merchant', async () => {
    expect((await ops.post(`/ops/hubs/${hub('MAADI')}/receive`, { code: b.trackingNumber })).body.ok).toBe(true);
    expect((await ops.post('/ops/returns/start', { ids: [b.id] })).body.ok).toHaveLength(1);
    expect((await ops.post(`/ops/hubs/${hub('CAI-SF')}/receive`, { code: b.trackingNumber })).body).toMatchObject({ ok: true, to: 'AT_SORTING_FACILITY' });
    expect((await ops.get('/ops/returns')).body.some((o: { id: string }) => o.id === b.id)).toBe(true);
    expect((await ops.post('/ops/returns/to-merchant', { ids: [b.id], driverId: driver('Mahmoud Hassan') })).body.ok).toHaveLength(1);
    expect((await ops.post('/ops/returns/returned', { ids: [b.id] })).body.ok).toHaveLength(1);
    expect(await status(b.id)).toBe('RETURNED');
  });
});
