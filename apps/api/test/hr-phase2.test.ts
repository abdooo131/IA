import { addDays, cairoDay } from '@shiplynow/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const NOW = new Date('2026-11-07T10:00:00Z');
const TODAY = cairoDay(NOW);
const PASSWORD = 'team-password-1';
const PDF = Buffer.from('%PDF-1.4\n% id copy\n');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

/** HR phase 2 (docs/HR.md "Phase 2 as built"): the hire and leaving wizards and documents. */
describe('hr phase 2', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stores: Map<string, string>;
  let admin: ReturnType<typeof request.agent>;
  const clock = new FixedClock(NOW);
  let n = 0;
  const key = () => `api-p2-${++n}-${Math.random().toString(36).slice(2)}`;

  const agent = async (email: string, password: string) => {
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
  const custom = async (email: string, hr: string, salaries = false) => {
    const m = await member(email, 'hr_officer');
    await admin
      .put(`/admin/users/${m.id}/access`)
      .send({
        jobRole: 'custom',
        store: 'none',
        operations: 'none',
        inventory: 'none',
        merchants: 'none',
        customers: 'none',
        accounting: 'none',
        hr,
        settings: 'none',
        allStores: true,
        customerData: false,
        salaries,
      })
      .expect(200);
    return m;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    clock.set(NOW);
    ({ stores } = await resetAndSeed(prisma));
    admin = await agent('admin@test.eg', 'admin-password-1');
  });

  const draftData = (store: string) => ({
    person: { nameEn: 'Omar Said', mobile: '01098765432', email: 'omar@t.eg' },
    job: {
      kind: 'team',
      positionId: 'pos_picker',
      gradeId: 'grade_junior',
      storeIds: [store],
      hireDate: TODAY,
      employment: 'employee',
      contractType: 'permanent',
    },
    pay: { basicPiastres: 800_000, allowances: [] },
    access: { login: true, jobRole: 'store_staff', allStores: false, storeIds: [store] },
  });

  it('runs a whole hire through the wizard, with the pay step behind the salaries switch', async () => {
    const store = stores.get('MAA')!;
    // HR view cannot start a hire; HR use without salaries cannot type pay.
    const viewer = await custom('view@t.eg', 'view');
    await viewer.agent
      .post('/hr/hire-drafts')
      .send({ step: 'person', data: draftData(store) })
      .expect(403);
    const officer = await custom('officer@t.eg', 'use');
    const refused = await officer.agent
      .post('/hr/hire-drafts')
      .send({ step: 'person', data: draftData(store) })
      .expect(403);
    expect(refused.body.error).toBe('salaries_required');
    await officer.agent.get('/hr/hire-drafts/pay-pending').expect(403);

    // The owner fills it step by step; the draft is listed until it is created.
    const draft = (
      await admin
        .post('/hr/hire-drafts')
        .send({ step: 'person', data: { person: { nameEn: 'Omar Said' } } })
        .expect(201)
    ).body;
    await admin
      .put(`/hr/hire-drafts/${draft.id}`)
      .send({ step: 'documents', data: draftData(store) })
      .expect(200);
    expect((await admin.get('/hr/hire-drafts').expect(200)).body).toMatchObject([
      { id: draft.id, name: 'Omar Said', step: 'documents' },
    ]);
    // An officer without salaries reads the draft without its pay.
    expect((await officer.agent.get(`/hr/hire-drafts/${draft.id}`).expect(200)).body).toMatchObject(
      { data: { pay: {} }, hasPay: true },
    );
    const required = (await admin.get(`/hr/hire-drafts/${draft.id}/required-documents`).expect(200))
      .body as { code: string; required: boolean }[];
    expect(required.filter((t) => t.required).map((t) => t.code)).toContain('national_id');
    await admin
      .post(
        `/hr/hire-drafts/${draft.id}/files?typeId=doctype_national_id&expiresOn=${addDays(TODAY, 900)}`,
      )
      .set('content-type', 'application/pdf')
      .send(PDF)
      .expect(201);
    await admin
      .put(`/hr/hire-drafts/${draft.id}/photo`)
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(200);
    const photo = await admin.get(`/hr/hire-drafts/${draft.id}/photo`).expect(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    // The officer cannot create it either: pay was typed by someone with the switch.
    expect(
      (
        await officer.agent
          .post(`/hr/hire-drafts/${draft.id}/create`)
          .send({ idempotencyKey: key() })
          .expect(403)
      ).body.error,
    ).toBe('salaries_required');

    const k = key();
    const made = (
      await admin.post(`/hr/hire-drafts/${draft.id}/create`).send({ idempotencyKey: k }).expect(201)
    ).body;
    expect(made).toMatchObject({ code: expect.stringMatching(/^EMP-/), payPending: false });
    expect(made.setupToken).toEqual(expect.any(String));
    const again = (
      await admin.post(`/hr/hire-drafts/${draft.id}/create`).send({ idempotencyKey: k }).expect(201)
    ).body;
    expect(again).toMatchObject({ employeeId: made.employeeId, setupToken: null, repeated: true });
    expect((await admin.get('/hr/hire-drafts').expect(200)).body).toEqual([]);

    const file = (await admin.get(`/hr/employees/${made.employeeId}`).expect(200)).body;
    expect(file).toMatchObject({ login: 'pending', photoVersion: expect.any(Number) });
    expect(file.salary.basicPiastres).toBe(800_000);

    // The setup page opens the account with the link HR was shown once.
    expect(
      (await request(app.getHttpServer()).get(`/auth/setup/${made.setupToken}`).expect(200)).body,
    ).toMatchObject({ email: 'omar@t.eg' });
    const fresh = (
      await officer.agent.post(`/hr/employees/${made.employeeId}/setup-link`).expect(201)
    ).body;
    await request(app.getHttpServer()).get(`/auth/setup/${made.setupToken}`).expect(404);
    await request(app.getHttpServer())
      .post(`/auth/setup/${fresh.setupToken}`)
      .send({ password: 'omar-password-1' })
      .expect(201);
    await agent('omar@t.eg', 'omar-password-1');
  });

  it('lets an officer without salaries hire, flagging the pay for an HR manager', async () => {
    const store = stores.get('MAA')!;
    const officer = await custom('officer@t.eg', 'use');
    const data = { ...draftData(store), pay: {} };
    const draft = (
      await officer.agent.post('/hr/hire-drafts').send({ step: 'access', data }).expect(201)
    ).body;
    const made = (
      await officer.agent
        .post(`/hr/hire-drafts/${draft.id}/create`)
        .send({ idempotencyKey: key() })
        .expect(201)
    ).body;
    expect(made.payPending).toBe(true);
    const pending = (await admin.get('/hr/hire-drafts/pay-pending').expect(200)).body;
    expect(pending.map((p: { id: string }) => p.id)).toEqual([made.employeeId]);
  });

  it('keeps the leaving wizard to HR manage and closes the account after the last day', async () => {
    const officer = await custom('officer@t.eg', 'use');
    const hrManager = await member('hrm@t.eg', 'hr_manager');
    const rider = await prisma.employee.findFirstOrThrow({
      where: { user: { email: 'rider.maadi@shiplynow.local' } },
    });
    // The seed opens the file on the real day; this test runs on a fixed day, so the rider
    // must have joined before it (a last day before the hire day is refused).
    await prisma.employee.update({
      where: { id: rider.id },
      data: { hireDate: new Date('2026-01-01T00:00:00Z') },
    });
    await officer.agent.get(`/hr/employees/${rider.id}/leaving`).expect(403);
    const lastDay = addDays(TODAY, 1);
    const preview = (
      await hrManager.agent
        .get(`/hr/employees/${rider.id}/leaving?lastDay=${lastDay}&noticeGivenOn=${TODAY}`)
        .expect(200)
    ).body;
    expect(preview).toMatchObject({
      lastDay,
      notice: { givenDays: 1, shortBy: 29 },
      settlement: { money: true },
      blockers: { alreadyLeft: false, self: false },
    });
    const body = {
      lastDay,
      reason: 'termination',
      noticeGivenOn: TODAY,
      itemsReturned: [preview.items[0].titleEn],
      idempotencyKey: key(),
    };
    await officer.agent.post(`/hr/employees/${rider.id}/leaving`).send(body).expect(403);
    const exit = (
      await hrManager.agent.post(`/hr/employees/${rider.id}/leaving`).send(body).expect(201)
    ).body;
    expect(exit).toMatchObject({ reason: 'termination', disabledAt: null });
    const riderAgent = await agent('rider.maadi@shiplynow.local', 'demo-password-1');
    expect((await hrManager.agent.get(`/hr/employees/${rider.id}/exit`).expect(200)).body.id).toBe(
      exit.id,
    );
    // The account still works on the last day, and is closed by the job after it.
    await riderAgent.get('/auth/me').expect(200);
    const jobs = app.get(JobsService);
    clock.set(new Date(`${addDays(lastDay, 1)}T00:30:00+02:00`));
    const result = await jobs.runAttendanceClose(clock.now());
    expect(result?.exits).toEqual({ disabled: 1, cancelled: 0 });
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'rider.maadi@shiplynow.local', password: 'demo-password-1' })
      .expect(401);
    expect((await admin.get('/hr/reassignments').expect(200)).body.rows).toEqual([]);
  });

  it('reminds people of documents and shows the expiry calendar', async () => {
    const rider = await prisma.employee.findFirstOrThrow({
      where: { user: { email: 'rider.maadi@shiplynow.local' } },
    });
    const viewer = await custom('view@t.eg', 'view');
    await viewer.agent
      .post(`/hr/employees/${rider.id}/documents/remind`)
      .send({ typeId: 'doctype_driving_license' })
      .expect(403);
    expect(
      (
        await admin
          .post(`/hr/employees/${rider.id}/documents/remind`)
          .send({ typeId: 'doctype_driving_license' })
          .expect(201)
      ).body,
    ).toEqual({ sent: true, alreadyToday: false });
    const all = (await admin.post(`/hr/employees/${rider.id}/documents/remind-all`).expect(201))
      .body;
    expect(all.alreadyToday).toBe(1);
    const riderAgent = await agent('rider.maadi@shiplynow.local', 'demo-password-1');
    const mine = (await riderAgent.get('/me/employee/reminders').expect(200)).body;
    expect(mine.length).toBeGreaterThan(0);
    await admin
      .post(`/hr/employees/${rider.id}/documents?typeId=doctype_national_id&expiresOn=2027-02-10`)
      .set('content-type', 'application/pdf')
      .send(PDF)
      .expect(201);
    const calendar = (await viewer.agent.get('/hr/documents/expiring?month=2027-02').expect(200))
      .body;
    expect(calendar.items).toMatchObject([{ day: '2027-02-10', employee: { id: rider.id } }]);
    await viewer.agent.get('/hr/documents/expiring?month=2027-13').expect(400);
  });
});
