import type { INestApplication } from '@nestjs/common';
import { appListGaps } from '@shiplynow/db';
import { cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const PASSWORD = 'team-password-1';
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');
const NEW_CAIRO = { latitude: 30.03, longitude: 31.47 };

/** UX phase C step 1: the Operations list views, bulk actions and document pages. */
describe('operations list views, bulk actions and documents', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stores: Map<string, string>;
  let admin: ReturnType<typeof request.agent>;
  const clock = new FixedClock(NOON_CAIRO);

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const member = async (email: string, jobRole: string, extra: Record<string, unknown> = {}) => {
    const res = await admin
      .post('/admin/users')
      .send({ email, name: email, role: 'admin', jobRole, password: PASSWORD, ...extra })
      .expect(201);
    return { id: res.body.id as string, agent: await agent(email, PASSWORD) };
  };

  /** A cash order of the sample merchant at New Cairo; moved to another store when asked. */
  let phone = 0;
  const placeOrder = async (opts: { store?: string; payment?: 'cod' | 'prepaid' } = {}) => {
    const merchant = await agent('merchant@evechantelle.example');
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    const res = await merchant
      .post('/merchant/orders')
      .send({
        customerName: `Customer ${++phone}`,
        customerPhone: `0101234567${phone % 10}`,
        addressText: 'Villa 12, South 90th St',
        ...NEW_CAIRO,
        paymentMethod: opts.payment ?? 'cod',
        deliveryFeePiastres: 3000,
        items: [{ skuId: sku.id, quantity: 1 }],
      })
      .expect(201);
    const id = res.body.id as string;
    if (opts.store) await prisma.order.update({ where: { id }, data: { darkStoreId: opts.store } });
    return prisma.order.findUniqueOrThrow({ where: { id } });
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    clock.set(NOON_CAIRO);
    ({ stores } = await resetAndSeed(prisma));
    admin = await agent('admin@test.eg', 'admin-password-1');
  });

  it('implements every filter, value, grouping and sort the shared list meta names', () => {
    expect(appListGaps()).toEqual([]);
  });

  it('searches, filters, groups and totals the orders on the server', async () => {
    const a = await placeOrder();
    const b = await placeOrder({ payment: 'prepaid' });
    const c = await placeOrder({ store: stores.get('MAA') });
    await prisma.order.update({ where: { id: c.id }, data: { lateStage: 'accept' } });

    const all = await admin.get('/lists/operations/orders?f=').expect(200);
    expect(all.body.total).toBe(3);
    expect(all.body.totals.cod).toBe(a.codAmountPiastres + c.codAmountPiastres);
    expect(all.body.totals.value).toBe(
      a.subtotalPiastres + b.subtotalPiastres + c.subtotalPiastres,
    );

    const prepaid = await admin.get('/lists/operations/orders?f=prepaid').expect(200);
    expect(prepaid.body.rows.map((r: { id: string }) => r.id)).toEqual([b.id]);
    const late = await admin.get('/lists/operations/orders?f=late_now').expect(200);
    expect(late.body.rows.map((r: { id: string }) => r.id)).toEqual([c.id]);
    // Typed search finds a local phone form and an order number.
    const byPhone = await admin
      .get(`/lists/operations/orders?f=&q=${encodeURIComponent(`0${a.customerPhone.slice(3)}`)}`)
      .expect(200);
    expect(byPhone.body.rows.map((r: { id: string }) => r.id)).toContain(a.id);
    const byNumber = await admin.get(`/lists/operations/orders?f=&q=${b.number}`).expect(200);
    expect(byNumber.body.total).toBe(1);

    // Value filters: a store, and Cairo days.
    const atMaadi = await admin
      .get(`/lists/operations/orders?f=&v=store:${stores.get('MAA')}`)
      .expect(200);
    expect(atMaadi.body.rows.map((r: { id: string }) => r.id)).toEqual([c.id]);
    const day = cairoDay(a.placedAt);
    const onDay = await admin
      .get(`/lists/operations/orders?f=&v=from:${day},to:${day}`)
      .expect(200);
    expect(onDay.body.total).toBe(3);
    const later = await admin.get('/lists/operations/orders?f=&v=from:2099-01-01').expect(200);
    expect(later.body.total).toBe(0);
    // A malformed day is ignored, not an error.
    await admin.get('/lists/operations/orders?f=&v=from:nonsense').expect(200);

    const grouped = await admin.get('/lists/operations/orders?f=&g=store').expect(200);
    expect(grouped.body.rows).toEqual([]);
    const ncr = grouped.body.groups.find((g: { key: string }) => g.key === stores.get('NCR'));
    expect(ncr).toMatchObject({ count: 2, label: 'NCR' });

    const options = await admin.get('/lists/operations/orders/options').expect(200);
    expect(options.body.store.map((s: { value: string }) => s.value)).toContain(stores.get('MAA'));
    expect(options.body.merchant).toHaveLength(1);

    await admin.get('/lists/operations/nope').expect(404);
    await admin.get('/lists/accounting/orders').expect(404);
  });

  it('keeps a person limited to some stores to their stores', async () => {
    const mine = await placeOrder();
    const theirs = await placeOrder({ store: stores.get('MAA') });
    const lead = await member('lead.ncr@shiply.eg', 'store_manager', {
      storeIds: [stores.get('NCR')],
    });
    const list = await lead.agent.get('/lists/operations/orders?f=').expect(200);
    expect(list.body.rows.map((r: { id: string }) => r.id)).toEqual([mine.id]);
    // Choosing another store's value shows nothing rather than its orders.
    const other = await lead.agent
      .get(`/lists/operations/orders?f=&v=store:${stores.get('MAA')}`)
      .expect(200);
    expect(other.body.total).toBe(0);
    const options = await lead.agent.get('/lists/operations/orders/options').expect(200);
    expect(options.body.store.map((s: { value: string }) => s.value)).toEqual([stores.get('NCR')]);

    // Documents, chatter and history of another store's order are refused.
    await lead.agent.get(`/admin/orders/${theirs.id}/document`).expect(403);
    await lead.agent.get(`/records/order/${theirs.id}/notes`).expect(403);
    await lead.agent.get(`/history/order/${theirs.id}`).expect(403);
    await lead.agent.get(`/records/order/${mine.id}/notes`).expect(200);
    await lead.agent.get(`/history/order/${mine.id}`).expect(200);

    // Store staff have no Operations app at all.
    const staff = await agent('staff.newcairo@shiplynow.local');
    expect((await staff.get('/lists/operations/orders').expect(403)).body.error).toBe('no_access');
  });

  it('accepts and cancels several orders, each on its own', async () => {
    const a = await placeOrder();
    const b = await placeOrder();
    const theirs = await placeOrder({ store: stores.get('MAA') });
    const lead = await member('lead.ncr@shiply.eg', 'store_manager', {
      storeIds: [stores.get('NCR')],
    });

    const accepted = await lead.agent
      .post('/admin/orders/bulk-accept')
      .send({ ids: [a.id, theirs.id, 'missing'] })
      .expect(201);
    expect(accepted.body.results).toEqual([
      { id: a.id, ok: true },
      { id: theirs.id, ok: false, error: 'store_not_allowed' },
      { id: 'missing', ok: false, error: 'order_not_found' },
    ]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('accepted');
    // Accepting twice is refused for that row only.
    const again = await admin
      .post('/admin/orders/bulk-accept')
      .send({ ids: [a.id, b.id] })
      .expect(201);
    expect(again.body.results).toEqual([
      { id: a.id, ok: false, error: 'invalid_order_state' },
      { id: b.id, ok: true },
    ]);

    // Cancelling needs a reason; each order follows the single cancel rules.
    await admin
      .post('/admin/orders/bulk-cancel')
      .send({ ids: [a.id] })
      .expect(400);
    const cancelled = await admin
      .post('/admin/orders/bulk-cancel')
      .send({ ids: [a.id, b.id], note: 'Customer called' })
      .expect(201);
    expect(cancelled.body.results).toEqual([
      { id: a.id, ok: true },
      { id: b.id, ok: true },
    ]);
    const done = await prisma.order.findUniqueOrThrow({ where: { id: a.id } });
    expect(done).toMatchObject({ status: 'cancelled', closedReason: 'Customer called' });
    const twice = await admin
      .post('/admin/orders/bulk-cancel')
      .send({ ids: [a.id], note: 'Again' })
      .expect(201);
    expect(twice.body.results[0]).toMatchObject({ ok: false, error: 'invalid_order_state' });

    // A viewer cannot run bulk actions at all.
    const viewer = await member('acc@shiply.eg', 'accountant');
    await viewer.agent
      .post('/admin/orders/bulk-accept')
      .send({ ids: [theirs.id] })
      .expect(403);
  });

  it('lists alerts and marks several as handled', async () => {
    const order = await placeOrder();
    const theirs = await placeOrder({ store: stores.get('MAA') });
    const [a1, a2] = await Promise.all([
      prisma.alert.create({
        data: { type: 'late', stage: 'accept', orderId: order.id, darkStoreId: order.darkStoreId },
      }),
      prisma.alert.create({
        data: {
          type: 'item_missing',
          orderId: theirs.id,
          darkStoreId: theirs.darkStoreId,
          data: { sku: 'EC-001', quantity: 1 },
        },
      }),
    ]);
    const open = await admin.get('/lists/operations/alerts').expect(200);
    expect(open.body.total).toBe(2);
    const late = await admin.get('/lists/operations/alerts?f=open&v=type:late').expect(200);
    expect(late.body.rows.map((r: { id: string }) => r.id)).toEqual([a1.id]);
    const byOrder = await admin.get(`/lists/operations/alerts?f=&q=${order.number}`).expect(200);
    expect(byOrder.body.total).toBe(1);
    const grouped = await admin.get('/lists/operations/alerts?f=open&g=type').expect(200);
    expect(grouped.body.groups.map((g: { key: string }) => g.key).sort()).toEqual([
      'item_missing',
      'late',
    ]);

    const lead = await member('lead.ncr@shiply.eg', 'store_manager', {
      storeIds: [stores.get('NCR')],
    });
    expect((await lead.agent.get('/lists/operations/alerts').expect(200)).body.total).toBe(1);
    const res = await lead.agent
      .post('/admin/alerts/bulk-resolve')
      .send({ ids: [a1.id, a2.id] })
      .expect(201);
    expect(res.body.results).toEqual([
      { id: a1.id, ok: true },
      { id: a2.id, ok: false, error: 'store_not_allowed' },
    ]);
    const twice = await admin
      .post('/admin/alerts/bulk-resolve')
      .send({ ids: [a1.id, a2.id] })
      .expect(201);
    expect(twice.body.results).toEqual([
      { id: a1.id, ok: false, error: 'alert_not_open' },
      { id: a2.id, ok: true },
    ]);
    const audits = await prisma.auditLog.count({ where: { action: 'alert.resolve' } });
    expect(audits).toBe(2);
    expect((await admin.get('/lists/operations/alerts').expect(200)).body.total).toBe(0);
    expect((await admin.get('/lists/operations/alerts?f=handled').expect(200)).body.total).toBe(2);
  });

  it('gives an order its smart buttons and a damage report its document', async () => {
    const order = await placeOrder();
    await admin
      .post(`/admin/orders/${order.id}/notes`)
      .send({ audience: 'team', body: 'Call first' })
      .expect(201);
    const doc = await admin.get(`/admin/orders/${order.id}/document`).expect(200);
    const keys = doc.body.smart.map((s: { key: string }) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining(['merchant', 'store', 'entries', 'photos', 'notes', 'alerts']),
    );
    expect(doc.body.smart.find((s: { key: string }) => s.key === 'notes').count).toBe(1);

    // An Operations manager has no accounting: no money button.
    const ops = await member('ops@shiply.eg', 'operations_manager');
    const opsDoc = await ops.agent.get(`/admin/orders/${order.id}/document`).expect(200);
    expect(opsDoc.body.smart.map((s: { key: string }) => s.key)).not.toContain('entries');

    // Chatter on an order: read with view, write with use.
    await ops.agent
      .post(`/records/order/${order.id}/activities`)
      .send({ dueOn: '2026-01-20', note: 'Check the refund' })
      .expect(201);
    const viewer = await member('acc@shiply.eg', 'accountant');
    await viewer.agent.get(`/records/order/${order.id}/activities`).expect(200);
    await viewer.agent
      .post(`/records/order/${order.id}/notes`)
      .send({ body: 'Viewer note' })
      .expect(403);

    // A damage report: list, document, chatter (inventory).
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    const staff = await agent('staff.newcairo@shiplynow.local');
    const bin = await prisma.bin.findFirstOrThrow({
      where: {
        darkStoreId: stores.get('NCR'),
        type: 'pickable',
        stock: { some: { skuId: sku.id } },
      },
    });
    await staff
      .post(`/stores/${stores.get('NCR')}/damage`)
      .send({
        skuId: sku.id,
        fromBinId: bin.id,
        quantity: 1,
        cause: 'store_handling',
        idempotencyKey: `dmg-${Date.now()}`,
      })
      .expect(201);
    const list = await admin.get('/lists/inventory/damage').expect(200);
    expect(list.body.total).toBe(1);
    const report = list.body.rows[0] as { id: string; value: number };
    expect(list.body.totals.value).toBe(report.value);
    const byCause = await admin.get('/lists/inventory/damage?f=customer').expect(200);
    expect(byCause.body.total).toBe(0);
    const one = await admin.get(`/admin/damage/${report.id}`).expect(200);
    expect(one.body.row).toMatchObject({ id: report.id, status: 'pending' });
    await admin
      .post(`/admin/damage/${report.id}/settle`)
      .send({ cause: 'store_handling', chargeRider: false })
      .expect(201);
    const settled = await admin.get(`/admin/damage/${report.id}`).expect(200);
    expect(settled.body.entries).toHaveLength(1);
    expect(settled.body.smart.find((s: { key: string }) => s.key === 'entries').count).toBe(1);
    await admin
      .post(`/records/damage_report/${report.id}/notes`)
      .send({ body: 'Shelf was loose' })
      .expect(201);
    const lead = await member('lead.maa@shiply.eg', 'store_manager', {
      storeIds: [stores.get('MAA')],
    });
    await lead.agent.get(`/admin/damage/${report.id}`).expect(403);
    await lead.agent.get(`/records/damage_report/${report.id}/notes`).expect(403);
    expect((await lead.agent.get('/lists/inventory/damage?f=').expect(200)).body.total).toBe(0);
  });
});
