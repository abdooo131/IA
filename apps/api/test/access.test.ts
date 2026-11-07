import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');
const NEW_CAIRO = { latitude: 30.03, longitude: 31.47 };
const PASSWORD = 'team-password-1';

/** Access rights (docs/ACCESS.md): the server checks every route against the person's profile. */
describe('access rights', () => {
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

  /** Creates a team member through admin with a job role, signed in. */
  const member = async (
    email: string,
    role: 'admin' | 'finance' | 'store_staff',
    jobRole: string,
    extra: Record<string, unknown> = {},
  ) => {
    const res = await admin
      .post('/admin/users')
      .send({ email, name: email, role, jobRole, password: PASSWORD, ...extra })
      .expect(201);
    return { id: res.body.id as string, agent: await agent(email, PASSWORD) };
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

  it('keeps store staff to their own store', async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get(`/stores/${stores.get('NCR')}/summary`).expect(200);
    const refused = await staff.get(`/stores/${stores.get('MAA')}/summary`).expect(403);
    expect(refused.body.error).toBe('store_not_allowed');
    await staff.get(`/stores/${stores.get('MAA')}/orders`).expect(403);
    const mine = await staff.get('/stores').expect(200);
    expect(mine.body.map((s: { id: string }) => s.id)).toEqual([stores.get('NCR')]);
    // Store staff have no other app.
    expect((await staff.get('/admin/orders').expect(403)).body.error).toBe('no_access');
  });

  it('filters lists to the stores of a person without every store', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    await merchant
      .post('/merchant/orders')
      .send({
        customerName: 'Sara Ali',
        customerPhone: '01012345678',
        addressText: 'Villa 12',
        ...NEW_CAIRO,
        paymentMethod: 'cod',
        deliveryFeePiastres: 3000,
        items: [{ skuId: sku.id, quantity: 1 }],
      })
      .expect(201);
    const maadi = await member('lead.maadi@shiply.eg', 'admin', 'store_manager', {
      storeIds: [stores.get('MAA')],
    });
    const ncr = await member('lead.ncr@shiply.eg', 'admin', 'store_manager', {
      storeIds: [stores.get('NCR')],
    });
    expect((await maadi.agent.get('/admin/orders').expect(200)).body).toHaveLength(0);
    expect((await ncr.agent.get('/admin/orders').expect(200)).body).toHaveLength(1);
    const refused = await maadi.agent
      .get(`/admin/orders?darkStoreId=${stores.get('NCR')}`)
      .expect(403);
    expect(refused.body.error).toBe('store_not_allowed');
    const order = await prisma.order.findFirstOrThrow();
    await maadi.agent.get(`/admin/orders/${order.id}`).expect(403);
    await ncr.agent.get(`/admin/orders/${order.id}`).expect(200);
    const live = await maadi.agent.get('/admin/live').expect(200);
    expect(live.body.stores.map((s: { darkStore: { code: string } }) => s.darkStore.code)).toEqual([
      'MAA',
    ]);
    const stock = await maadi.agent.get('/admin/stock').expect(200);
    expect(
      stock.body.every((l: { darkStore: { id: string } }) => l.darkStore.id === stores.get('MAA')),
    ).toBe(true);
    // A store manager approves nothing in inventory (use, not manage).
    const transfer = await admin
      .post('/admin/transfers')
      .send({
        fromId: stores.get('MAA'),
        toId: stores.get('ZAM'),
        lines: [{ skuId: sku.id, quantity: 1 }],
      })
      .expect(201);
    expect(
      (await maadi.agent.post(`/admin/transfers/${transfer.body.id}/approve`).send({}).expect(403))
        .body.error,
    ).toBe('no_access');
  });

  it('keeps an Operations manager out of accounting and a Finance officer off approvals', async () => {
    const ops = await member('ops@shiply.eg', 'admin', 'operations_manager');
    expect((await ops.agent.get('/finance/overview').expect(403)).body.error).toBe('no_access');
    await ops.agent.get('/admin/orders').expect(200);
    await ops.agent.get('/admin/users').expect(403);

    const officer = await member('officer@shiply.eg', 'finance', 'finance_officer');
    await officer.agent.get('/finance/overview').expect(200);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const refused = await officer.agent
      .post('/finance/books-lock')
      .send({ day: yesterday })
      .expect(403);
    expect(refused.body.error).toBe('no_access');
    // Salary pages also need the salaries right.
    await officer.agent.get('/finance/staff-pay').expect(403);
    await agent('finance@shiplynow.local').then((m) => m.get('/finance/staff-pay').expect(200));
  });

  it('needs customer_data for named customer profiles', async () => {
    const cs = await member('cs@shiply.eg', 'admin', 'customer_service');
    await cs.agent.get('/admin/customers/overview').expect(200);
    await cs.agent.get('/admin/customers').expect(200);

    // The same person without customer_data reads summaries but no names.
    await admin
      .put(`/admin/users/${cs.id}/access`)
      .send({
        jobRole: 'custom',
        store: 'none',
        operations: 'use',
        inventory: 'view',
        merchants: 'view',
        customers: 'view',
        accounting: 'none',
        settings: 'none',
        allStores: true,
        customerData: false,
        salaries: false,
      })
      .expect(200);
    await cs.agent.get('/admin/customers/overview').expect(200);
    expect((await cs.agent.get('/admin/customers').expect(403)).body.error).toBe('no_access');
    await cs.agent.get('/admin/customers/some-id').expect(403);
    await cs.agent.get('/admin/customers/export').expect(403);
  });

  it('applies a change at once, audited, never on oneself, and keeps an owner', async () => {
    const ops = await member('ops@shiply.eg', 'admin', 'operations_manager');
    await ops.agent.get('/admin/orders').expect(200);
    const before = await admin.get(`/admin/users/${ops.id}/access`).expect(200);
    expect(before.body.profile).toMatchObject({ jobRole: 'operations_manager', settings: 'none' });

    // Without settings manage nobody changes access.
    expect(
      (await ops.agent.put(`/admin/users/${ops.id}/access`).send({ jobRole: 'owner' }).expect(403))
        .body.error,
    ).toBe('no_access');

    await admin.put(`/admin/users/${ops.id}/access`).send({ jobRole: 'accountant' }).expect(200);
    // Read fresh on the next request: no sign out needed.
    await ops.agent.get('/admin/zones').expect(200);
    await ops.agent.post('/admin/zones').send({}).expect(403);
    await ops.agent.get('/finance/overview').expect(200);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.access', entityId: ops.id },
    });
    expect(audit.before).toMatchObject({ jobRole: 'operations_manager' });
    expect(audit.after).toMatchObject({ jobRole: 'accountant', accounting: 'view' });

    // Nobody changes their own access, even an owner.
    const me = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.eg' } });
    expect(
      (await admin.put(`/admin/users/${me.id}/access`).send({ jobRole: 'accountant' }).expect(403))
        .body.error,
    ).toBe('cannot_change_own_access');

    // A second owner may lower the first; then the remaining owner cannot be disabled by the
    // lowered one, and cannot disable or lower themselves.
    await admin.put(`/admin/users/${ops.id}/access`).send({ jobRole: 'owner' }).expect(200);
    await ops.agent
      .put(`/admin/users/${me.id}/access`)
      .send({ jobRole: 'operations_manager' })
      .expect(200);
    await admin.patch(`/admin/users/${ops.id}`).send({ isActive: false }).expect(403);
    await ops.agent.patch(`/admin/users/${ops.id}`).send({ isActive: false }).expect(400);
    await ops.agent
      .put(`/admin/users/${ops.id}/access`)
      .send({ jobRole: 'accountant' })
      .expect(403);

    const roles = await ops.agent.get('/admin/access/job-roles').expect(200);
    expect(roles.body.map((r: { jobRole: string }) => r.jobRole)).toContain('finance_manager');
    expect((await admin.get('/admin/access/job-roles').expect(403)).body.error).toBe('no_access');
  });

  it('always keeps one active person with settings manage (last_owner)', async () => {
    // Two owners disable each other at the same moment: one wins, the other is refused, either
    // by the guard (already disabled) or by last_owner inside the change.
    const second = await member('owner2@shiply.eg', 'admin', 'owner');
    const me = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.eg' } });
    const [a, b] = await Promise.all([
      admin.patch(`/admin/users/${second.id}`).send({ isActive: false }),
      second.agent.patch(`/admin/users/${me.id}`).send({ isActive: false }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const loser = a.status === 200 ? b : a;
    expect(['no_access', 'last_owner']).toContain(loser.body.error);
    const owners = await prisma.userAccess.count({
      where: { settings: 'manage', user: { isActive: true } },
    });
    expect(owners).toBe(1);
  });

  it('keeps merchant members to their rights; owners manage the team', async () => {
    const owner = await agent('merchant@evechantelle.example');
    await owner.get('/merchant/finance').expect(200);
    const created = await owner
      .post('/merchant/team')
      .send({
        email: 'clerk@evechantelle.example',
        name: 'Clerk',
        password: PASSWORD,
        merchantRole: 'member',
        merchantRights: ['orders'],
      })
      .expect(201);
    expect(created.body).toMatchObject({ merchantRole: 'member', merchantRights: ['orders'] });
    const clerk = await agent('clerk@evechantelle.example', PASSWORD);
    await clerk.get('/merchant/orders').expect(200);
    expect((await clerk.get('/merchant/finance').expect(403)).body.error).toBe('no_access');
    await clerk.get('/merchant/team').expect(403);
    await clerk.get('/merchant/me').expect(200);

    await owner
      .patch(`/merchant/team/${created.body.id}`)
      .send({ merchantRights: ['orders', 'money'] })
      .expect(200);
    await clerk.get('/merchant/finance').expect(200);

    const team = await owner.get('/merchant/team').expect(200);
    expect(team.body).toHaveLength(2);
    const self = team.body.find(
      (u: { email: string }) => u.email === 'merchant@evechantelle.example',
    );
    expect((await owner.post(`/merchant/team/${self.id}/disable`).expect(403)).body.error).toBe(
      'cannot_remove_self',
    );
    await owner
      .post(`/merchant/team/${created.body.id}/password`)
      .send({ password: 'another-password-2' })
      .expect(201);
    await owner.post(`/merchant/team/${created.body.id}/disable`).expect(201);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'clerk@evechantelle.example', password: 'another-password-2' })
      .expect(401);
  });

  it('tells each person what they may open', async () => {
    const mine = await admin.get('/me/access').expect(200);
    expect(mine.body).toMatchObject({
      kind: 'team',
      role: 'admin',
      profile: { jobRole: 'owner', settings: 'manage', allStores: true },
    });
    const staff = await agent('staff.newcairo@shiplynow.local');
    expect((await staff.get('/me/access').expect(200)).body.profile).toMatchObject({
      jobRole: 'store_staff',
      store: 'use',
      storeIds: [stores.get('NCR')],
    });
    const merchant = await agent('merchant@evechantelle.example');
    expect((await merchant.get('/me/access').expect(200)).body).toEqual({
      kind: 'merchant',
      merchantRole: 'owner',
      rights: ['orders', 'stock', 'money', 'settings'],
    });
    const rider = await agent('rider.newcairo@shiplynow.local');
    expect((await rider.get('/me/access').expect(200)).body).toEqual({ kind: 'rider' });
    await request(app.getHttpServer()).get('/me/access').expect(401);
  });
});
