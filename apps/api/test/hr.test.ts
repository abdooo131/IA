import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { JobsService } from '../src/jobs/jobs.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const NOW = new Date('2026-11-06T10:00:00Z');
const PASSWORD = 'team-password-1';
const PDF = Buffer.from('%PDF-1.4\n% employee contract\n');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

/** HR step 1 (docs/HR.md): employee files, documents, history, My HR and account managers. */
describe('hr', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stores: Map<string, string>;
  let merchantId: string;
  let admin: ReturnType<typeof request.agent>;
  const clock = new FixedClock(NOW);

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };

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

  const fileOf = async (email: string) =>
    prisma.employee.findFirstOrThrow({ where: { user: { email } } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    clock.set(NOW);
    ({ stores, merchantId } = await resetAndSeed(prisma));
    admin = await agent('admin@test.eg', 'admin-password-1');
  });

  it('gives seeded people files and keeps HR to people with HR access', async () => {
    const list = (await admin.get('/hr/employees').expect(200)).body as {
      user: { role: string };
    }[];
    // The admin, the finance user, two store staff and two riders.
    expect(list.map((e) => e.user.role).sort()).toEqual([
      'admin',
      'finance',
      'rider',
      'rider',
      'store_staff',
      'store_staff',
    ]);
    const staff = await agent('staff.newcairo@shiplynow.local');
    expect((await staff.get('/hr/employees').expect(403)).body.error).toBe('no_access');
    const ops = await member('ops@shiply.eg', 'admin', 'operations_manager');
    await ops.agent.get('/hr/employees').expect(403);

    // The HR officer reads and changes files of every store, but no settings and no pay.
    const hr = await member('hr@shiply.eg', 'admin', 'hr_officer');
    const rider = await fileOf('rider.maadi@shiplynow.local');
    const detail = (await hr.agent.get(`/hr/employees/${rider.id}`).expect(200)).body;
    expect(detail).toMatchObject({ nameEn: expect.any(String), bank: null, salary: null });
    expect(detail.homeStore.id).toBe(stores.get('MAA'));
    const refused = await hr.agent
      .patch(`/hr/employees/${rider.id}`)
      .send({ bankName: 'CIB' })
      .expect(403);
    expect(refused.body.error).toBe('salaries_required');
    await hr.agent
      .patch(`/hr/employees/${rider.id}`)
      .send({ jobTitle: 'Rider', department: 'delivery', nationalId: '29001011234567' })
      .expect(200);
    await hr.agent
      .put('/admin/settings')
      .send({ key: 'hr.document_alert_days', scope: 'global', value: 10 })
      .expect(403);
    // The owner sees pay as well.
    expect((await admin.get(`/hr/employees/${rider.id}`).expect(200)).body.bank).toEqual({
      bankName: null,
      bankAccountNumber: null,
      iban: null,
      bankAccountHolder: null,
    });
    const history = (await admin.get(`/hr/employees/${rider.id}/history`).expect(200)).body;
    expect(history[0]).toMatchObject({
      action: 'employee.update',
      actor: { name: 'hr@shiply.eg' },
      after: { jobTitle: 'Rider', nationalId: '29001011234567' },
    });
  });

  it('limits HR people with listed stores to the files of those stores', async () => {
    const hr = await member('hr.maadi@shiply.eg', 'admin', 'hr_officer');
    await admin
      .put(`/admin/users/${hr.id}/access`)
      .send({
        jobRole: 'custom',
        store: 'none',
        operations: 'none',
        inventory: 'none',
        merchants: 'none',
        customers: 'none',
        accounting: 'none',
        hr: 'use',
        settings: 'none',
        allStores: false,
        customerData: false,
        salaries: false,
        ownMerchantsOnly: false,
        storeIds: [stores.get('MAA')],
      })
      .expect(200);
    const list = (await hr.agent.get('/hr/employees').expect(200)).body as {
      homeStore: { id: string };
    }[];
    expect(list).toHaveLength(2);
    expect(list.every((e) => e.homeStore.id === stores.get('MAA'))).toBe(true);
    const ncr = await fileOf('rider.newcairo@shiplynow.local');
    expect((await hr.agent.get(`/hr/employees/${ncr.id}`).expect(403)).body.error).toBe(
      'store_not_allowed',
    );
    // Use is not enough to mark someone as left.
    const maa = await fileOf('rider.maadi@shiplynow.local');
    await hr.agent
      .post(`/hr/employees/${maa.id}/status`)
      .send({ status: 'left', leftOn: '2026-11-06', reason: 'Resigned' })
      .expect(403);
  });

  it('stores documents, alerts before they expire once a day, and marks people as left', async () => {
    const rider = await fileOf('rider.maadi@shiplynow.local');
    await admin
      .post(`/hr/employees/${rider.id}/documents?kind=text`)
      .set('content-type', 'application/pdf')
      .send(PDF)
      .expect(400);
    const doc = (
      await admin
        .post(`/hr/employees/${rider.id}/documents?kind=medical&expiresOn=2026-11-20`)
        .set('content-type', 'application/pdf')
        .send(PDF)
        .expect(201)
    ).body;
    await admin
      .post(`/hr/employees/${rider.id}/documents?kind=national_id`)
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    const docs = (await admin.get(`/hr/employees/${rider.id}/documents`).expect(200)).body;
    expect(docs).toHaveLength(2);
    const file = await admin.get(`/hr/employees/${rider.id}/documents/${doc.id}`).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(
      Buffer.from(file.body as Buffer)
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');

    // The daily job raises one alert per document, however often it runs.
    const jobs = app.get(JobsService);
    expect(await jobs.runDocumentExpiry(NOW)).toEqual({ raised: 1 });
    expect(await jobs.runDocumentExpiry(NOW)).toBeNull();
    const alerts = (await admin.get('/hr/alerts').expect(200)).body;
    expect(alerts).toMatchObject([{ type: 'document_expiring', data: { documentId: doc.id } }]);
    // Operations people without HR access do not see employee documents in their alerts.
    const ops = await member('ops@shiply.eg', 'admin', 'operations_manager');
    const opsAlerts = (await ops.agent.get('/admin/alerts').expect(200)).body as { type: string }[];
    expect(opsAlerts.some((a) => a.type.startsWith('document_'))).toBe(false);
    await admin.post(`/hr/alerts/${alerts[0].id}/resolve`).expect(201);

    await admin.delete(`/hr/employees/${rider.id}/documents/${doc.id}`).expect(200);
    await admin
      .post(`/hr/employees/${rider.id}/status`)
      .send({ status: 'left', leftOn: '2026-11-06' })
      .expect(400);
    await admin
      .post(`/hr/employees/${rider.id}/status`)
      .send({ status: 'left', leftOn: '2026-11-06', reason: 'Moved city' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'rider.maadi@shiplynow.local', password: DEMO })
      .expect(401);
    const actions = (await admin.get(`/hr/employees/${rider.id}/history`).expect(200)).body.map(
      (h: { action: string }) => h.action,
    );
    expect(actions.slice(0, 4)).toEqual([
      'employee.status',
      'employee.document_delete',
      'employee.document_add',
      'employee.document_add',
    ]);
  });

  it('lets every team member and rider read only their own file', async () => {
    const rider = await agent('rider.newcairo@shiplynow.local');
    const mine = (await rider.get('/me/employee').expect(200)).body;
    expect(mine).toMatchObject({ user: { role: 'rider' }, documents: [] });
    await rider.get('/me/employee/history').expect(200);
    const other = await fileOf('rider.maadi@shiplynow.local');
    await rider.get(`/hr/employees/${other.id}`).expect(403);
    const doc = (
      await admin
        .post(`/hr/employees/${other.id}/documents?kind=contract`)
        .set('content-type', 'application/pdf')
        .send(PDF)
        .expect(201)
    ).body;
    // Someone else's document is not found from My HR.
    await rider.get(`/me/employee/documents/${doc.id}`).expect(404);
    const owner = await agent('rider.maadi@shiplynow.local');
    await owner.get(`/me/employee/documents/${doc.id}`).expect(200);
    const merchant = await agent('merchant@evechantelle.example');
    await merchant.get('/me/employee').expect(404);
  });

  it('opens a file for an account without one and creates one with every new account', async () => {
    const bare = await prisma.user.create({
      data: { email: 'bare@shiply.eg', name: 'Bare', role: 'store_staff', passwordHash: 'x' },
    });
    const waiting = (await admin.get('/hr/people-without-file').expect(200)).body;
    expect(waiting.map((u: { id: string }) => u.id)).toEqual([bare.id]);
    const created = (
      await admin
        .post('/hr/employees')
        .send({
          userId: bare.id,
          nameEn: 'Bare Person',
          hireDate: '2026-11-01',
          contractType: 'fixed_term',
          contractEndsOn: '2027-10-31',
        })
        .expect(201)
    ).body;
    // Probation is filled in from the hire date (hr.probation_months, 3).
    expect(created).toMatchObject({
      code: expect.stringMatching(/^EMP-\d{4}$/),
      probationEndsOn: '2027-01-31',
    });
    await admin.post('/hr/employees').send({ userId: bare.id }).expect(409);
    const qc = await member('qc@shiply.eg', 'store_staff', 'qc_agent', {
      darkStoreId: stores.get('NCR'),
      storeIds: [stores.get('NCR')],
    });
    const file = await fileOf('qc@shiply.eg');
    expect(file.homeStoreId).toBe(stores.get('NCR'));
    await qc.agent.get('/me/employee').expect(200);
  });

  it('keeps account managers to their own merchants', async () => {
    const am = await member('am@shiply.eg', 'admin', 'account_manager');
    const other = await prisma.merchant.create({ data: { name: 'Other Shop' } });
    expect((await am.agent.get('/admin/merchants').expect(200)).body).toEqual([]);
    const managers = (await admin.get('/admin/account-managers').expect(200)).body;
    expect(managers.map((m: { id: string }) => m.id)).toContain(am.id);
    await am.agent
      .put(`/admin/merchants/${merchantId}/account-manager`)
      .send({ userId: am.id })
      .expect(403);
    await admin
      .put(`/admin/merchants/${merchantId}/account-manager`)
      .send({ userId: am.id })
      .expect(200);
    const list = (await am.agent.get('/admin/merchants').expect(200)).body;
    expect(list.map((m: { id: string }) => m.id)).toEqual([merchantId]);
    expect(list[0].accountManager).toEqual({ id: am.id, name: 'am@shiply.eg' });
    const refused = await am.agent.get(`/admin/orders?merchantId=${other.id}`).expect(403);
    expect(refused.body.error).toBe('merchant_not_allowed');
    await am.agent.get(`/admin/orders?merchantId=${merchantId}`).expect(200);
    await am.agent.patch(`/admin/merchants/${other.id}`).send({ name: 'Nope' }).expect(403);
    await am.agent.patch(`/admin/merchants/${merchantId}`).send({ name: 'Mine' }).expect(200);
    const skus = (await am.agent.get('/admin/skus').expect(200)).body as {
      merchant: { id: string };
    }[];
    expect(skus.length).toBeGreaterThan(0);
    expect(skus.every((s) => s.merchant.id === merchantId)).toBe(true);
    // A merchant the account manager opens is theirs.
    const opened = (await am.agent.post('/admin/merchants').send({ name: 'New Shop' }).expect(201))
      .body;
    expect(
      (await am.agent.get('/admin/merchants').expect(200)).body.map((m: { id: string }) => m.id),
    ).toContain(opened.id);
    // The alerts of their merchants come to them, others' do not.
    await prisma.alert.createMany({
      data: [
        { type: 'merchant_signup', merchantId, data: { merchantId } },
        { type: 'merchant_signup', merchantId: other.id, data: { merchantId: other.id } },
      ],
    });
    const alerts = (await am.agent.get('/admin/alerts').expect(200)).body as {
      type: string;
    }[];
    expect(alerts.filter((a) => a.type === 'merchant_signup')).toHaveLength(1);
  });
});
