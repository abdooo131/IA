import { cairoDay } from '@shiplynow/shared';
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
      .send({ jobTitle: 'Rider', departmentId: 'dept_ops_rid', nationalId: '29001011234567' })
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
      .post(`/hr/employees/${rider.id}/documents?typeId=nope`)
      .set('content-type', 'application/pdf')
      .send(PDF)
      .expect(404);
    const doc = (
      await admin
        .post(`/hr/employees/${rider.id}/documents?typeId=doctype_medical&expiresOn=2026-11-20`)
        .set('content-type', 'application/pdf')
        .send(PDF)
        .expect(201)
    ).body;
    await admin
      .post(`/hr/employees/${rider.id}/documents?typeId=doctype_national_id&expiresOn=2031-01-01`)
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    const docs = (await admin.get(`/hr/employees/${rider.id}/documents`).expect(200)).body;
    expect(docs.documents).toHaveLength(2);
    expect(docs.checklist).toMatchObject({ required: 4, done: 1, percent: 25 });
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
    // The file's hire date is the real day the account was opened, so leave on that day or
    // later (a fixed date failed once Cairo passed midnight).
    const leftToday = cairoDay(new Date());
    await admin
      .post(`/hr/employees/${rider.id}/status`)
      .send({ status: 'left', leftOn: leftToday })
      .expect(400);
    await admin
      .post(`/hr/employees/${rider.id}/status`)
      .send({ status: 'left', leftOn: leftToday, reason: 'Moved city' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'rider.maadi@shiplynow.local', password: DEMO })
      .expect(401);
    const actions = (await admin.get(`/hr/employees/${rider.id}/history`).expect(200)).body.map(
      (h: { action: string }) => h.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'employee.status',
        'employee.checklist_start',
        'employee.document_delete',
        'employee.document_add',
      ]),
    );
    // Leaving started the offboarding checklist.
    const lists = (await admin.get(`/hr/employees/${rider.id}/checklists`).expect(200)).body;
    expect(lists[0]).toMatchObject({ kind: 'offboarding', status: 'open' });
  });

  it('lets every team member and rider read only their own file', async () => {
    const rider = await agent('rider.newcairo@shiplynow.local');
    const mine = (await rider.get('/me/employee').expect(200)).body;
    expect(mine).toMatchObject({
      user: { role: 'rider' },
      documents: [],
      checklist: { percent: 0 },
      position: { titleEn: 'Rider' },
    });
    await rider.get('/me/employee/history').expect(200);
    const other = await fileOf('rider.maadi@shiplynow.local');
    await rider.get(`/hr/employees/${other.id}`).expect(403);
    const doc = (
      await admin
        .post(`/hr/employees/${other.id}/documents?typeId=doctype_contract`)
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
  it('keeps salary packages in HR: HR with salaries edits, finance and HR without pay cannot', async () => {
    const rider = await fileOf('rider.maadi@shiplynow.local');
    const body = {
      basicPiastres: 600_000,
      allowances: [
        { kind: 'transport', amountPiastres: 80_000 },
        { kind: 'phone', amountPiastres: 20_000 },
      ],
    };
    // HR officer: HR manage but no salaries switch.
    const officer = await member('hr@shiply.eg', 'admin', 'hr_officer');
    expect(
      (await officer.agent.post(`/hr/employees/${rider.id}/package`).send(body).expect(403)).body
        .error,
    ).toBe('no_access');
    await officer.agent.get(`/hr/employees/${rider.id}/package`).expect(403);
    // Finance manager: runs payroll (salaries) but has no HR access, so cannot edit people.
    const finance = await agent('finance@shiplynow.local');
    await finance.post(`/hr/employees/${rider.id}/package`).send(body).expect(403);
    await finance.put(`/finance/salaries/${rider.userId}`).send({ monthlyPiastres: 1 }).expect(404);
    // HR manager: HR manage with salaries.
    const manager = await member('hr.manager@shiply.eg', 'admin', 'hr_manager');
    // Riders are paid per delivered order: no package until HR moves them to a salary.
    await manager.agent
      .post(`/hr/employees/${rider.id}/package`)
      .send(body)
      .expect(400, { error: 'per_delivery_no_salary' });
    await manager.agent
      .put(`/hr/employees/${rider.id}/pay-basis`)
      .send({ payBasis: 'monthly_salary' })
      .expect(200);
    const saved = (
      await manager.agent.post(`/hr/employees/${rider.id}/package`).send(body).expect(201)
    ).body;
    expect(saved).toMatchObject({ grossPiastres: 700_000, current: true });
    const pkg = (await manager.agent.get(`/hr/employees/${rider.id}/package`).expect(200)).body;
    expect(pkg.history).toHaveLength(1);
    const detail = (await manager.agent.get(`/hr/employees/${rider.id}`).expect(200)).body;
    expect(detail.salary).toMatchObject({ grossPiastres: 700_000, basicPiastres: 600_000 });
    expect((await officer.agent.get(`/hr/employees/${rider.id}`).expect(200)).body.salary).toBe(
      null,
    );
    // Accounting reads the package to pay it.
    const pay = (await finance.get('/finance/staff-pay').expect(200)).body as {
      userId: string;
      monthlyPiastres: number;
      allowancesPiastres: number;
    }[];
    expect(pay.find((p) => p.userId === rider.userId)).toMatchObject({
      monthlyPiastres: 700_000,
      allowancesPiastres: 100_000,
    });
    // HR use without manage changes employment but not the structure.
    const supplier = await prisma.supplier.create({
      data: { name: 'Delta Staffing', createdById: (await fileOf('admin@test.eg')).userId },
    });
    await manager.agent
      .put(`/hr/employees/${rider.id}/employment`)
      .send({ employment: 'outsourced', staffingSupplierId: supplier.id })
      .expect(200);
    expect(
      (await manager.agent.post(`/hr/employees/${rider.id}/package`).send(body).expect(400)).body
        .error,
    ).toBe('outsourced_not_on_payroll');
  });

  it('shows managers their team without pay, and each person only their own file', async () => {
    // The seed places the first store person (New Cairo) at the head of Dark stores, the
    // Maadi store person under them, and each store's riders under their store's person.
    const lead = await agent('staff.newcairo@shiplynow.local');
    const team = (await lead.get('/me/team').expect(200)).body;
    expect(team.people.map((p: { nameEn: string }) => p.nameEn).sort()).toEqual([
      'Ahmed Samir',
      'Karim Fathy',
      'Mahmoud Hassan',
    ]);
    expect(team).toMatchObject({ direct: 2, total: 3 });
    const ahmed = await fileOf('rider.newcairo@shiplynow.local');
    const file = (await lead.get(`/me/team/${ahmed.id}`).expect(200)).body;
    expect(file).toMatchObject({
      nameEn: 'Ahmed Samir',
      bank: null,
      nationalId: null,
      position: { titleEn: 'Rider' },
    });
    expect(file).not.toHaveProperty('salary');
    // A manager without HR access still cannot open the HR screens.
    await lead.get(`/hr/employees/${ahmed.id}`).expect(403);
    // Someone not above the person cannot open their file.
    const maadi = await agent('staff.maadi@shiplynow.local');
    expect((await maadi.get(`/me/team/${ahmed.id}`).expect(403)).body.error).toBe('not_in_team');
    const rider = await agent('rider.newcairo@shiplynow.local');
    expect((await rider.get('/me/team').expect(200)).body.total).toBe(0);
    await rider.get(`/hr/employees/${ahmed.id}`).expect(403);

    // Photos: the person and their managers see them, other people do not.
    await rider.put('/me/employee/photo').set('content-type', 'image/jpeg').send(JPEG).expect(200);
    await rider.get('/me/employee/photo').expect(200);
    await lead.get(`/people/${ahmed.id}/photo`).expect(200);
    await maadi.get(`/people/${ahmed.id}/photo`).expect(403);
    await admin.get(`/people/${ahmed.id}/photo`).expect(200);
    const merchant = await agent('merchant@evechantelle.example');
    await merchant.get(`/people/${ahmed.id}/photo`).expect(403);
  });

  it('lets people upload a missing document themselves for HR to verify', async () => {
    const rider = await agent('rider.newcairo@shiplynow.local');
    const file = await fileOf('rider.newcairo@shiplynow.local');
    const up = (
      await rider
        .post('/me/employee/documents?typeId=doctype_driving_license&expiresOn=2029-05-01')
        .set('content-type', 'image/jpeg')
        .send(JPEG)
        .expect(201)
    ).body;
    expect(up).toMatchObject({ status: 'pending', selfUploaded: true });
    // The contract is HR's to upload.
    await rider
      .post('/me/employee/documents?typeId=doctype_contract')
      .set('content-type', 'application/pdf')
      .send(PDF)
      .expect(403);
    const pending = (await admin.get('/hr/documents/pending').expect(200)).body;
    expect(pending.map((d: { id: string }) => d.id)).toEqual([up.id]);
    const hrUse = await member('hr.use@shiply.eg', 'admin', 'hr_officer');
    await hrUse.agent
      .post(`/hr/employees/${file.id}/documents/${up.id}/review`)
      .send({ status: 'rejected' })
      .expect(400);
    await hrUse.agent
      .post(`/hr/employees/${file.id}/documents/${up.id}/review`)
      .send({ status: 'verified' })
      .expect(201);
    const mine = (await rider.get('/me/employee').expect(200)).body;
    const licence = mine.checklist.items.find(
      (i: { type: { code: string } }) => i.type.code === 'driving_license',
    );
    expect(licence).toMatchObject({ state: 'verified' });
    // The company view of what is missing, also as CSV.
    const missing = (
      await admin.get('/hr/documents/missing?typeId=doctype_driving_license').expect(200)
    ).body as { employee: { id: string } }[];
    expect(missing.map((m) => m.employee.id)).not.toContain(file.id);
    const csv = await admin.get('/hr/documents/missing.csv').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Mahmoud Hassan');
  });

  it('draws the org chart and keeps the structure to HR manage', async () => {
    const chart = (await admin.get('/hr/org').expect(200)).body;
    const ceo = chart.people.find((p: { nameEn: string }) => p.nameEn === 'Admin');
    expect(ceo).toMatchObject({ titleEn: 'Chief executive officer', managerId: null });
    const nadia = chart.people.find((p: { nameEn: string }) => p.nameEn === 'Nadia Mostafa');
    expect(nadia).toMatchObject({ managerId: ceo.id, managerSource: 'department' });
    expect(chart.departments.length).toBeGreaterThan(10);
    expect(chart.vacancies.some((v: { code: string }) => v.code === 'PICKER')).toBe(true);
    const use = await member('hr.use@shiply.eg', 'admin', 'hr_officer');
    await admin
      .put(`/admin/users/${use.id}/access`)
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
        allStores: true,
        customerData: false,
        salaries: false,
        ownMerchantsOnly: false,
        storeIds: [],
      })
      .expect(200);
    const dept = {
      code: 'LEGAL',
      nameEn: 'Legal',
      nameAr: 'الشؤون القانونية',
      parentId: 'dept_mgt',
    };
    await use.agent.post('/hr/departments').send(dept).expect(403);
    await use.agent.get('/hr/departments').expect(200);
    const legal = (await admin.post('/hr/departments').send(dept).expect(201)).body;
    await admin.patch('/hr/departments/dept_mgt').send({ parentId: legal.id }).expect(400);
    await admin.post('/hr/grades/grade_lead/move?direction=up').expect(201);
    const grades = (await admin.get('/hr/grades').expect(200)).body as { code: string }[];
    expect(grades.map((g) => g.code).slice(4, 6)).toEqual(['SUPERVISOR', 'LEAD']);
    const csv = await admin.get('/hr/employees.csv?departmentId=dept_ops').expect(200);
    expect(csv.text.split('\r\n')[0]).toContain('code,name_en');
    expect(csv.text).toContain('Ahmed Samir');
    expect(csv.text).not.toContain('Nadia Mostafa');
  });
});
