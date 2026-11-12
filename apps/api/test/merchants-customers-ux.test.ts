import type { INestApplication } from '@nestjs/common';
import { appListGaps } from '@shiplynow/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const PASSWORD = 'team-password-1';
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');
const NEW_CAIRO = { latitude: 30.03, longitude: 31.47 };

type Row = { id: string } & Record<string, unknown>;
const ids = (body: { rows: Row[] }) => body.rows.map((r) => r.id);

/** UX phase C step 3: the Merchants and Customers list views, bulk actions and documents. */
describe('merchants and customers list views, bulk actions and documents', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let merchantId: string;
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
  const newMerchant = async (name: string) =>
    (await admin.post('/admin/merchants').send({ name }).expect(201)).body.id as string;
  /** A sign up waiting for approval, as /signup leaves it. */
  const pendingMerchant = async (name: string) => {
    const id = await newMerchant(name);
    await prisma.merchant.update({ where: { id }, data: { approval: 'pending', isActive: false } });
    return id;
  };

  let phone = 0;
  /** A delivered style order of the sample merchant, owned by a customer profile. */
  const orderFor = async (customerId: string) => {
    const merchant = await agent('merchant@evechantelle.example');
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    const res = await merchant
      .post('/merchant/orders')
      .send({
        customerName: `Customer ${++phone}`,
        customerPhone: `0101234567${phone % 10}`,
        addressText: 'Villa 12, South 90th St',
        ...NEW_CAIRO,
        paymentMethod: 'cod',
        deliveryFeePiastres: 3000,
        items: [{ skuId: sku.id, quantity: 1 }],
      })
      .expect(201);
    return prisma.order.update({ where: { id: res.body.id }, data: { customerId } });
  };
  const customer = (name: string, phoneNumber: string) =>
    prisma.customer.create({
      data: {
        name,
        phone: phoneNumber,
        governorate: 'Cairo',
        firstSeenAt: NOON_CAIRO,
        lastSeenAt: NOON_CAIRO,
      },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    clock.set(NOON_CAIRO);
    ({ merchantId } = await resetAndSeed(prisma));
    admin = await agent('admin@test.eg', 'admin-password-1');
  });

  it('implements every filter, value, grouping and sort the shared list meta names', () => {
    expect(appListGaps()).toEqual([]);
  });

  it('searches, filters, groups and totals the merchants', async () => {
    const other = await newMerchant('Nile Pantry');
    const pending = await pendingMerchant('Delta Crafts');
    await admin.patch(`/admin/merchants/${other}`).send({ isActive: false }).expect(200);
    await admin
      .patch(`/admin/merchants/${merchantId}`)
      .send({ contactPhone: '01001234567' })
      .expect(200);

    const all = await admin.get('/lists/merchants/merchants').expect(200);
    expect(all.body.total).toBe(3);
    expect(ids(all.body)).toEqual(expect.arrayContaining([merchantId, other, pending]));
    // A phone typed the local way finds the merchant stored with +20.
    const byPhone = await admin.get('/lists/merchants/merchants?q=01001234567').expect(200);
    expect(ids(byPhone.body)).toEqual([merchantId]);

    const paused = await admin.get('/lists/merchants/merchants?f=paused').expect(200);
    expect(ids(paused.body).sort()).toEqual([other, pending].sort());
    const waiting = await admin.get('/lists/merchants/merchants?f=pending').expect(200);
    expect(ids(waiting.body)).toEqual([pending]);
    // Filters of one group are OR'ed, groups are AND'ed.
    const either = await admin
      .get('/lists/merchants/merchants?f=pending,rejected,paused')
      .expect(200);
    expect(ids(either.body)).toEqual([pending]);
    const noContract = await admin.get('/lists/merchants/merchants?f=no_contract').expect(200);
    expect(ids(noContract.body)).toEqual(expect.arrayContaining([other, pending]));

    const byApproval = await admin.get('/lists/merchants/merchants?g=approval').expect(200);
    expect(
      byApproval.body.groups.map((g: { key: string; count: number }) => [g.key, g.count]),
    ).toEqual([
      ['approved', 2],
      ['pending', 1],
    ]);
    await admin.get('/lists/merchants/merchants?g=manager,schedule').expect(200);
    expect(all.body.totals).toEqual(
      expect.objectContaining({ orders30: expect.any(Number), balance: expect.any(Number) }),
    );
    expect(all.body.totals.skus).toBe(await prisma.sku.count());
  });

  it('keeps account managers to their own merchants', async () => {
    const other = await newMerchant('Nile Pantry');
    const am = await member('am@shiply.eg', 'account_manager');
    await admin
      .put(`/admin/merchants/${merchantId}/account-manager`)
      .send({ userId: am.id })
      .expect(200);

    const list = await am.agent.get('/lists/merchants/merchants').expect(200);
    expect(ids(list.body)).toEqual([merchantId]);
    const mine = await admin.get(`/lists/merchants/merchants?v=manager:${am.id}`).expect(200);
    expect(ids(mine.body)).toEqual([merchantId]);
    const unmanaged = await admin.get('/lists/merchants/merchants?f=no_manager').expect(200);
    expect(ids(unmanaged.body)).toEqual([other]);
    const options = await admin.get('/lists/merchants/merchants/options').expect(200);
    expect(options.body.manager).toEqual([{ value: am.id, label: 'am@shiply.eg' }]);

    // Products of other merchants stay out of the list; their document and chatter refuse.
    const products = await am.agent.get('/lists/merchants/products?size=200').expect(200);
    expect(products.body.rows.every((r: Row) => r.merchantId === merchantId)).toBe(true);
    const theirs = await prisma.sku.create({
      data: {
        merchantId: other,
        sku: 'NP-1',
        titleEn: 'Dates',
        titleAr: 'تمر',
        pricePiastres: 5000,
      },
    });
    await am.agent.get(`/admin/skus/${theirs.id}/document`).expect(403);
    await am.agent.get(`/records/sku/${theirs.id}/notes`).expect(403);
    await am.agent.get(`/records/merchant/${other}/notes`).expect(403);
    await am.agent.get(`/history/merchant/${other}`).expect(403);
    await am.agent.get(`/admin/merchants/${other}/document`).expect(403);
    await am.agent.get(`/admin/merchants/${merchantId}/document`).expect(200);
    await am.agent.get(`/records/merchant/${merchantId}/notes`).expect(200);

    // Bulk actions check every row against the person's merchants.
    const paused = await am.agent
      .post('/admin/merchants/bulk-pause')
      .send({ ids: [merchantId, other] })
      .expect(201);
    expect(paused.body.results).toEqual([
      { id: merchantId, ok: true },
      { id: other, ok: false, error: 'merchant_not_allowed' },
    ]);
  });

  it('approves sign ups and pauses or opens merchants in bulk, each on its own', async () => {
    const a = await pendingMerchant('Delta Crafts');
    const b = await pendingMerchant('Sinai Herbs');
    const approved = await admin
      .post('/admin/merchants/bulk-approve')
      .send({ ids: [a, merchantId, b] })
      .expect(201);
    expect(approved.body.results).toEqual([
      { id: a, ok: true },
      { id: merchantId, ok: false, error: 'not_pending' },
      { id: b, ok: true },
    ]);
    const merchantA = await prisma.merchant.findUniqueOrThrow({ where: { id: a } });
    expect(merchantA).toMatchObject({ approval: 'approved', isActive: true });

    const rejected = await pendingMerchant('Never Approved');
    const paused = await admin
      .post('/admin/merchants/bulk-pause')
      .send({ ids: [a, rejected] })
      .expect(201);
    expect(paused.body.results).toEqual([
      { id: a, ok: true },
      { id: rejected, ok: false, error: 'not_approved' },
    ]);
    expect(await prisma.auditLog.count({ where: { entityId: a, action: 'merchant.update' } })).toBe(
      1,
    );
    const again = await admin
      .post('/admin/merchants/bulk-pause')
      .send({ ids: [a] })
      .expect(201);
    expect(again.body.results).toEqual([{ id: a, ok: false, error: 'already_paused' }]);
    const opened = await admin
      .post('/admin/merchants/bulk-activate')
      .send({ ids: [a, rejected] })
      .expect(201);
    expect(opened.body.results).toEqual([
      { id: a, ok: true },
      { id: rejected, ok: false, error: 'not_approved' },
    ]);

    // Approving sign ups needs merchants manage; viewers cannot run bulk actions.
    const viewer = await member('ops@shiply.eg', 'operations_manager');
    await viewer.agent
      .post('/admin/merchants/bulk-approve')
      .send({ ids: [b] })
      .expect(403);
    await viewer.agent
      .post('/admin/merchants/bulk-pause')
      .send({ ids: [b] })
      .expect(403);
  });

  it('gives a merchant its smart buttons and its chatter', async () => {
    const doc = await admin.get(`/admin/merchants/${merchantId}/document`).expect(200);
    const keys = doc.body.smart.map((s: { key: string }) => s.key);
    expect(keys).toEqual([
      'orders',
      'products',
      'shipments',
      'returns',
      'payouts',
      'invoices',
      'contract',
      'users',
    ]);
    const products = doc.body.smart.find((s: { key: string }) => s.key === 'products');
    expect(products).toMatchObject({
      count: await prisma.sku.count({ where: { merchantId } }),
      href: `/admin/products?f=&v=merchant:${merchantId}`,
    });
    expect(typeof doc.body.balancePiastres).toBe('number');

    // Without Accounting there is no wallet, payouts or invoices; without Operations no orders.
    const sales = await member('rep@shiply.eg', 'sales_manager');
    const limited = await sales.agent.get(`/admin/merchants/${merchantId}/document`).expect(200);
    expect(limited.body.smart.map((s: { key: string }) => s.key)).toEqual([
      'products',
      'contract',
      'users',
    ]);
    expect(limited.body.balancePiastres).toBeNull();
    // A merchants viewer reads the chatter but cannot write in it.
    await sales.agent.get(`/records/merchant/${merchantId}/notes`).expect(200);
    await sales.agent
      .post(`/records/merchant/${merchantId}/notes`)
      .send({ body: 'Called them' })
      .expect(403);
    await admin
      .post(`/records/merchant/${merchantId}/notes`)
      .send({ body: 'Called them about the contract' })
      .expect(201);
    const notes = await sales.agent.get(`/records/merchant/${merchantId}/notes`).expect(200);
    expect(notes.body).toHaveLength(1);
  });

  it('lists products with stock and opens a product document', async () => {
    const all = await admin.get('/lists/merchants/products?size=200').expect(200);
    expect(all.body.total).toBe(await prisma.sku.count());
    const levels = await prisma.stockLevel.findMany();
    expect(all.body.totals.onHand).toBe(levels.reduce((s, l) => s + l.onHand, 0));

    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    await prisma.sku.update({ where: { id: sku.id }, data: { isActive: false } });
    const inactive = await admin.get('/lists/merchants/products?f=inactive').expect(200);
    expect(ids(inactive.body)).toEqual([sku.id]);
    const found = await admin.get(`/lists/merchants/products?q=${sku.sku}`).expect(200);
    expect(ids(found.body)).toContain(sku.id);
    const byBarcode = sku.barcode
      ? await admin.get(`/lists/merchants/products?q=${sku.barcode}`).expect(200)
      : null;
    if (byBarcode) expect(ids(byBarcode.body)).toContain(sku.id);
    const notLinked = await admin.get('/lists/merchants/products?f=not_linked').expect(200);
    expect(notLinked.body.total).toBe(
      await prisma.sku.count({ where: { shopifyVariantId: null } }),
    );
    const grouped = await admin.get('/lists/merchants/products?g=merchant').expect(200);
    expect(grouped.body.groups[0]).toMatchObject({ key: merchantId });

    const doc = await admin.get(`/admin/skus/${sku.id}/document`).expect(200);
    expect(doc.body.row).toMatchObject({ sku: 'EC-001', isActive: false });
    expect(doc.body.row.stock.reduce((s: number, l: { onHand: number }) => s + l.onHand, 0)).toBe(
      levels.filter((l) => l.skuId === sku.id).reduce((s, l) => s + l.onHand, 0),
    );
    expect(doc.body.smart.map((s: { key: string }) => s.key)).toEqual([
      'merchant',
      'stock',
      'damage',
      'stores',
    ]);
    await admin.post(`/records/sku/${sku.id}/notes`).send({ body: 'New label soon' }).expect(201);
    await admin.get(`/history/sku/${sku.id}`).expect(200);
  });

  it('lists customers only for people with customer data, and audits each profile opened', async () => {
    const mona = await customer('Mona Adel', '+201001112223');
    const omar = await customer('Omar Fathy', '+201001112224');
    await orderFor(mona.id);
    await orderFor(mona.id);
    await orderFor(omar.id);

    const all = await admin.get('/lists/customers/customers').expect(200);
    expect(ids(all.body)).toEqual([mona.id, omar.id]);
    expect(all.body.totals.orders).toBe(3);
    expect(all.body.rows[0]).toMatchObject({ orders: 2, mainMerchantId: merchantId });
    // Local phone form, name and segment filters.
    const byPhone = await admin.get('/lists/customers/customers?q=01001112224').expect(200);
    expect(ids(byPhone.body)).toEqual([omar.id]);
    const loyal = await admin.get('/lists/customers/customers?f=loyal,new').expect(200);
    expect(loyal.body.total).toBe(2);
    const unknown = await admin.get('/lists/customers/customers?f=risk_unknown').expect(200);
    expect(unknown.body.total).toBe(2);
    const bySegment = await admin.get('/lists/customers/customers?g=segment').expect(200);
    expect(bySegment.body.groups.reduce((s: number, g: { count: number }) => s + g.count, 0)).toBe(
      2,
    );
    const byMerchant = await admin.get('/lists/customers/customers?g=merchant').expect(200);
    expect(byMerchant.body.groups).toEqual([
      expect.objectContaining({ key: merchantId, count: 2, totals: expect.any(Object) }),
    ]);
    const chosen = await admin
      .get(`/lists/customers/customers?v=merchant:${merchantId}`)
      .expect(200);
    expect(chosen.body.total).toBe(2);
    const other = await newMerchant('Nile Pantry');
    const none = await admin.get(`/lists/customers/customers?v=merchant:${other}`).expect(200);
    expect(none.body.total).toBe(0);

    // Customers view without the customer data switch: no names, no chatter, no history.
    const ops = await member('ops@shiply.eg', 'operations_manager');
    expect((await ops.agent.get('/lists/customers/customers').expect(403)).body.error).toBe(
      'no_access',
    );
    await ops.agent.get('/lists/customers/customers/options').expect(403);
    await ops.agent.get(`/admin/customers/${mona.id}`).expect(403);
    await ops.agent.get(`/records/customer/${mona.id}/notes`).expect(403);
    await ops.agent.get(`/history/customer/${mona.id}`).expect(403);

    // Customer service has customer data: the profile opens and is audited each time.
    const cs = await member('cs@shiply.eg', 'customer_service');
    await cs.agent.get('/lists/customers/customers').expect(200);
    await cs.agent.get(`/admin/customers/${mona.id}`).expect(200);
    await cs.agent.get(`/admin/customers/${mona.id}`).expect(200);
    expect(
      await prisma.auditLog.count({
        where: { entityType: 'customer', entityId: mona.id, action: 'customer.view' },
      }),
    ).toBe(2);
    // Customer service only views: the chatter reads but takes no notes.
    await cs.agent
      .post(`/records/customer/${mona.id}/notes`)
      .send({ body: 'Prefers calls after 6 pm' })
      .expect(403);
    await admin
      .post(`/records/customer/${mona.id}/notes`)
      .send({ body: 'Prefers calls after 6 pm' })
      .expect(201);
    expect(
      (await cs.agent.get(`/records/customer/${mona.id}/notes`).expect(200)).body,
    ).toHaveLength(1);
    await cs.agent.get(`/history/customer/${mona.id}`).expect(200);
    // Reminders go only to people with customer data, under a label without the name.
    await admin
      .post(`/records/customer/${mona.id}/activities`)
      .send({ dueOn: '2026-01-15', note: 'Call back', assigneeId: ops.id })
      .expect(400);
    const people = await admin.get(`/records/customer/${mona.id}/people`).expect(200);
    expect(people.body.map((p: { id: string }) => p.id)).toContain(cs.id);
    expect(people.body.map((p: { id: string }) => p.id)).not.toContain(ops.id);
    const reminder = await admin
      .post(`/records/customer/${mona.id}/activities`)
      .send({ dueOn: '2026-01-15', note: 'Call back', assigneeId: cs.id })
      .expect(201);
    expect(reminder.body.label).not.toContain('Mona');
  });
});
