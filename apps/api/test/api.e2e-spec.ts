import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, createApp, login, sampleOrder } from './helpers';

let app: INestApplication;
let eve: ReturnType<typeof api>;
let nabta: ReturnType<typeof api>;
let ops: ReturnType<typeof api>;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createApp();
  prisma = app.get(PrismaService);
  eve = api(app, (await login(app, 'owner@evechantelle.com', 'merchant')).accessToken);
  nabta = api(app, (await login(app, 'owner@nabta.com', 'merchant')).accessToken);
  ops = api(app, (await login(app, 'ops@shiply.eg', 'ops')).accessToken);
});
afterAll(async () => app.close());

describe('auth', () => {
  it('rejects a wrong password', async () => {
    const res = await api(app, 'x').post('/auth/login', { email: 'ops@shiply.eg', password: 'nope', app: 'ops' });
    expect(res.status).toBe(401);
  });

  it('keeps apps separate: merchant cannot sign in to ops, pickup driver cannot use the delivery app', async () => {
    const a = await api(app, 'x').post('/auth/login', { email: 'owner@evechantelle.com', password: 'Shiply@2026', app: 'ops' });
    expect(a.status).toBe(403);
    const b = await api(app, 'x').post('/auth/login', { email: 'pickup.driver@shiply.eg', password: 'Shiply@2026', app: 'delivery' });
    expect(b.status).toBe(403);
  });

  it('requires a token', async () => {
    const res = await api(app, 'garbage').get('/orders');
    expect(res.status).toBe(401);
  });

  it('rotates refresh tokens and rejects reuse', async () => {
    const first = await login(app, 'owner@hanser.com', 'merchant');
    const r1 = await api(app, 'x').post('/auth/refresh', { refreshToken: first.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    const reuse = await api(app, 'x').post('/auth/refresh', { refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);
  });

  it('stores language per user', async () => {
    const res = await eve.patch('/auth/me/language', { language: 'ar' });
    expect(res.body.language).toBe('ar');
    const me = await eve.get('/auth/me');
    expect(me.body.user.language).toBe('ar');
    await eve.patch('/auth/me/language', { language: 'en' });
  });

  it('enforces RBAC: a merchant cannot read system config', async () => {
    expect((await eve.get('/admin/config')).status).toBe(403);
    expect((await ops.get('/admin/config')).status).toBe(200);
  });
});

describe('order creation', () => {
  it('creates an order with frozen price, tracking number, hub and a CREATED event', async () => {
    const res = await eve.post('/orders', sampleOrder);
    expect(res.status).toBe(201);
    const o = res.body;
    expect(o.trackingNumber).toMatch(/^SHP\d{10}$/);
    expect(o.customerPhone).toBe('+201012345678');
    expect(o.shippingFee).toBe(8000);
    expect(o.vatAmount).toBe(1120);
    expect(o.totalFees).toBe(9120);
    expect(o.failedDeliveryFee).toBe(4800);
    expect(o.status).toBe('NEW');

    const detail = await eve.get(`/orders/${o.id}`);
    expect(detail.body.destinationHub.code).toBe('MAADI');
    expect(detail.body.events[0]).toMatchObject({ eventType: 'CREATED', toStatus: 'NEW' });
  });

  it('rejects an invalid Egyptian phone', async () => {
    const res = await eve.post('/orders', { ...sampleOrder, customerPhone: '0123' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('customerPhone');
  });

  it('flags destinations with no last mile hub for manual assignment', async () => {
    const res = await eve.post('/orders', { ...sampleOrder, governorateCode: 'ASN', area: 'Aswan', addressLine: 'Corniche, Aswan' });
    expect(res.status).toBe(201);
    expect(res.body.needsManualHub).toBe(true);
    expect(res.body.destZone).toBe('FAR_UPPER_MATROUH');
  });

  it('keeps old prices frozen when config changes, new orders use the new value', async () => {
    const before = (await eve.post('/orders', { ...sampleOrder, allowOpenPackage: true })).body;
    expect(before.openPackageFee).toBe(700);
    expect((await ops.patch('/admin/config/pricing.open_package_fee', { value: 1000, reason: 'test' })).status).toBe(200);
    const after = (await eve.post('/orders', { ...sampleOrder, allowOpenPackage: true })).body;
    expect(after.openPackageFee).toBe(1000);
    const reread = (await eve.get(`/orders/${before.id}`)).body;
    expect(reread.openPackageFee).toBe(700);
    await ops.patch('/admin/config/pricing.open_package_fee', { value: 700 });
  });

  it('rejects non integer config values for money', async () => {
    const res = await ops.patch('/admin/config/pricing.open_package_fee', { value: 7.5 });
    expect(res.status).toBe(400);
  });

  it('the database refuses to change a frozen price', async () => {
    const o = (await eve.post('/orders', sampleOrder)).body;
    await expect(prisma.asSystem((tx) => tx.order.update({ where: { id: o.id }, data: { shippingFee: 1 } }))).rejects.toThrow(/frozen/);
  });
});

describe('tenant isolation (RLS)', () => {
  it("Nabta cannot see Eve Chantelle's orders", async () => {
    const o = (await eve.post('/orders', sampleOrder)).body;
    expect((await nabta.get(`/orders/${o.id}`)).status).toBe(404);
    const list = await nabta.get('/orders?pageSize=200');
    expect(list.body.items.find((x: { id: string }) => x.id === o.id)).toBeUndefined();
    expect((await nabta.post(`/orders/${o.id}/transition`, { to: 'PENDING_PICKUP' })).status).toBe(404);
  });

  it('a merchant cannot create orders for another merchant', async () => {
    const me = (await nabta.get('/merchant/me')).body;
    const res = await eve.post('/orders', { ...sampleOrder, merchantId: me.id });
    expect(res.status).toBe(201);
    expect(res.body.merchantId).not.toBe(me.id);
  });

  it('staff see all merchants', async () => {
    const res = await ops.get('/orders?pageSize=200');
    const merchants = new Set(res.body.items.map((x: { merchantId: string }) => x.merchantId));
    expect(merchants.size).toBeGreaterThanOrEqual(1);
  });
});

describe('status machine', () => {
  it('merchant can mark ready and cancel, but not deliver', async () => {
    const o = (await eve.post('/orders', sampleOrder)).body;
    expect((await eve.post(`/orders/${o.id}/transition`, { to: 'DELIVERED' })).status).toBe(400);
    expect((await eve.post(`/orders/${o.id}/transition`, { to: 'PENDING_PICKUP' })).status).toBe(201);
    expect((await eve.post(`/orders/${o.id}/transition`, { to: 'PICKED_UP' })).status).toBe(403);
    expect((await ops.post(`/orders/${o.id}/transition`, { to: 'PICKED_UP' })).status).toBe(201);
    const d = (await eve.get(`/orders/${o.id}`)).body;
    expect(d.events.map((e: { toStatus: string }) => e.toStatus)).toEqual(['NEW', 'PENDING_PICKUP', 'PICKED_UP']);
  });

  it('writes an audit row for each transition', async () => {
    const o = (await eve.post('/orders', sampleOrder)).body;
    await eve.post(`/orders/${o.id}/transition`, { to: 'TERMINATED', note: 'customer cancelled' });
    const audit = await ops.get(`/admin/audit?entityType=order&entityId=${o.id}`);
    const actions = audit.body.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['order.create', 'order.transition']));
    const t = audit.body.find((a: { action: string }) => a.action === 'order.transition');
    expect(t.before).toEqual({ status: 'NEW' });
    expect(t.after).toEqual({ status: 'TERMINATED' });
  });

  it('order_events and audit_log are append only', async () => {
    await expect(prisma.asSystem((tx) => tx.$executeRaw`UPDATE order_events SET note = 'x'`)).rejects.toThrow();
    await expect(prisma.asSystem((tx) => tx.$executeRaw`DELETE FROM audit_log`)).rejects.toThrow();
  });
});

describe('CSV import', () => {
  const header = 'customer_name,customer_phone,governorate,area,address,cod_amount,size,type,allow_open_package,merchant_reference\n';
  it('imports valid rows and reports row level errors', async () => {
    const rows = [
      'Ali,01011111111,CAI,Maadi,"1 Road 9, Maadi",100,Small/Medium,Deliver,yes,R1',
      'Bad Phone,0101,CAI,Maadi,"1 Road 9, Maadi",100,,,,R2',
      'Bad Gov,01011111112,Atlantis,Nowhere,"Somewhere far",100,,,,R3',
      'Huda,01211111111,Giza,Dokki,"7 Tahrir St, Dokki",250.50,Large,Exchange,no,R4',
    ].join('\n');
    const res = await eve.upload('/orders/import', 'file', header + rows, 'orders.csv');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ totalRows: 4, successRows: 2, errorRows: 2 });
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, field: 'customerPhone' }),
        expect.objectContaining({ row: 4, field: 'governorate' }),
      ]),
    );
    const report = await eve.get(`/orders/import/${res.body.batchId}/errors.csv`);
    expect(report.text).toContain('row,field,message');
    const huda = (await eve.get(`/orders/${res.body.created[1].id}`)).body;
    expect(huda.codAmount).toBe(25050);
    expect(huda.type).toBe('EXCHANGE');
    expect(huda.source).toBe('CSV');
  });

  it('rejects a file without required columns', async () => {
    const res = await eve.upload('/orders/import', 'file', 'foo,bar\n1,2\n', 'x.csv');
    expect(res.status).toBe(400);
  });
});

describe('labels', () => {
  it('returns a PDF and marks orders printed', async () => {
    const a = (await eve.post('/orders', sampleOrder)).body;
    const b = (await eve.post('/orders', { ...sampleOrder, customerName: 'منى عادل' })).body;
    const notPrinted = await eve.get('/orders?printed=false&pageSize=200');
    expect(notPrinted.body.items.some((o: { id: string }) => o.id === a.id)).toBe(true);

    const res = await eve.post('/orders/labels', { ids: [a.id, b.id] }).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const printed = await eve.get('/orders?printed=true&pageSize=200');
    expect(printed.body.items.some((o: { id: string }) => o.id === a.id)).toBe(true);
    const d = (await eve.get(`/orders/${a.id}`)).body;
    expect(d.events.some((e: { eventType: string }) => e.eventType === 'LABEL_PRINTED')).toBe(true);
  });
});

describe('merchant settings', () => {
  it('bank details can only change once every 15 days (DB trigger)', async () => {
    const hanser = api(app, (await login(app, 'owner@hanser.com', 'merchant')).accessToken);
    const iban = 'EG' + '1'.repeat(27);
    expect((await hanser.put('/merchant/bank-details', { bankName: 'CIB', accountName: 'Hanser', iban })).status).toBe(200);
    const again = await hanser.put('/merchant/bank-details', { bankName: 'NBE', accountName: 'Hanser', iban });
    expect(again.status).toBe(422);
    expect(again.body.message).toMatch(/15 days/);
  });

  it('customer success score spans merchants', async () => {
    const o = (await nabta.post('/orders', { ...sampleOrder, customerPhone: '01099999999' })).body;
    for (const s of ['PENDING_PICKUP', 'PICKED_UP', 'AT_SORTING_FACILITY', 'AT_LAST_MILE_HUB', 'ASSIGNED_TO_DRIVER', 'HEADING_TO_CUSTOMER', 'DELIVERED']) {
      expect((await ops.post(`/orders/${o.id}/transition`, { to: s })).status).toBe(201);
    }
    const e = (await eve.post('/orders', { ...sampleOrder, customerPhone: '01099999999' })).body;
    const d = (await eve.get(`/orders/${e.id}`)).body;
    expect(d.customerScore).toMatchObject({ delivered: 1, finished: 1, percent: 100 });
  });

  it('dashboard returns counts and cash', async () => {
    const d = (await eve.get('/orders/dashboard')).body;
    expect(d.counts.NEW).toBeGreaterThan(0);
    expect(typeof d.codInTransit.amount).toBe('number');
    expect(typeof d.walletBalance).toBe('number');
    expect(d.nextCashoutDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
