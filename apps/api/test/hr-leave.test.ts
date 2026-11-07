import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const NOW = new Date('2026-11-06T10:00:00Z');
const PASSWORD = 'team-password-1';
const PDF = Buffer.from('%PDF-1.4\n% medical note\n');
let n = 0;
const key = () => `api-hr3-${++n}-${Date.now()}`;

/** HR phase 3 (docs/HR.md "Phase 3 as built"): who may read, ask, approve and decide. */
describe('hr phase 3', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stores: Map<string, string>;
  let admin: ReturnType<typeof request.agent>;
  const clock = new FixedClock(NOW);

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
  const fileOf = (email: string) =>
    prisma.employee.findFirstOrThrow({ where: { user: { email } } });
  const annual = () =>
    prisma.leaveType.findUniqueOrThrow({ where: { code: 'annual' } }).then((t) => t.id);

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

  it('lets people see only their own requests and their manager approve before HR', async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    const other = await agent('staff.maadi@shiplynow.local');
    const lead = await member('lead@shiply.eg', 'store_manager', {
      storeIds: [stores.get('NCR')],
    });
    const leadFile = await fileOf('lead@shiply.eg');
    const staffFile = await fileOf('staff.newcairo@shiplynow.local');
    await prisma.employee.update({
      where: { id: staffFile.id },
      data: { managerId: leadFile.id },
    });

    const mine = (await staff.get('/me/leave').expect(200)).body;
    expect(mine.balances.annual.entitlement).toBeGreaterThan(0);
    expect(mine.types.map((t: { code: string }) => t.code)).toContain('annual');
    const r = (
      await staff
        .post('/me/leave/requests')
        .send({
          typeId: await annual(),
          from: '2026-11-15',
          to: '2026-11-16',
          idempotencyKey: key(),
        })
        .expect(201)
    ).body;
    expect(r.status).toBe('pending_manager');
    // An overlapping request is refused.
    await staff
      .post('/me/leave/requests')
      .send({
        typeId: await annual(),
        from: '2026-11-15',
        to: '2026-11-16',
        idempotencyKey: 'dup-key-123',
      })
      .expect(409);
    // Nobody else reads it; HR store staff profiles have no HR access.
    await other.get(`/me/leave/requests/${r.id}`).expect(404);
    expect((await other.get('/hr/leave/requests').expect(403)).body.error).toBe('no_access');
    // The person cannot approve their own request, another person is not their manager.
    expect((await staff.post(`/me/inbox/leave/${r.id}/approve`).expect(403)).body.error).toBe(
      'own_request',
    );
    expect((await other.post(`/me/inbox/leave/${r.id}/approve`).expect(403)).body.error).toBe(
      'not_your_team',
    );
    const inbox = (await lead.agent.get('/me/inbox').expect(200)).body;
    expect(inbox.manager.leave.map((x: { id: string }) => x.id)).toEqual([r.id]);
    expect((await lead.agent.get('/me/hr-badges').expect(200)).body.inbox).toBe(1);
    // The manager reads it as their team's, then approves; HR view alone cannot approve.
    await lead.agent.get(`/me/team-leave/${r.id}`).expect(200);
    await other.get(`/me/team-leave/${r.id}`).expect(403);
    await lead.agent.post(`/me/inbox/leave/${r.id}/approve`).expect(201);
    expect(
      (await lead.agent.post(`/hr/leave/requests/${r.id}/approve`).expect(403)).body.error,
    ).toBe('no_access');
    const hr = await member('hr@shiply.eg', 'hr_officer');
    expect((await hr.agent.get('/me/hr-badges').expect(200)).body.inbox).toBe(1);
    const approved = (await hr.agent.post(`/hr/leave/requests/${r.id}/approve`).expect(201)).body;
    expect(approved.status).toBe('approved');
    const cal = (await hr.agent.get('/hr/leave/calendar?month=2026-11').expect(200)).body;
    expect(cal.people[0].days['2026-11-15']).toMatchObject({ status: 'approved' });
    // The manager's calendar shows their people only.
    const teamCal = (await lead.agent.get('/me/team-leave-calendar?month=2026-11').expect(200))
      .body;
    expect(teamCal.people).toHaveLength(1);
    expect(
      (await other.get('/me/team-leave-calendar?month=2026-11').expect(200)).body.people,
    ).toEqual([]);
    // History of the request is HR's.
    const history = (await hr.agent.get(`/history/leave_request/${r.id}`).expect(200)).body;
    expect(history.map((h: { action: string }) => h.action)).toEqual([
      'leave.approve',
      'leave.manager_approve',
      'leave.request',
    ]);
  });

  it('keeps HR people with listed stores to those stores and documents to the owner and HR', async () => {
    const hrMaadi = await member('hr.maadi@shiply.eg', 'hr_officer');
    await admin
      .put(`/admin/users/${hrMaadi.id}/access`)
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
    const staff = await agent('staff.newcairo@shiplynow.local');
    const sick = await prisma.leaveType.findUniqueOrThrow({ where: { code: 'sick' } });
    const staffFile = await fileOf('staff.newcairo@shiplynow.local');
    await prisma.employee.update({ where: { id: staffFile.id }, data: { managerId: null } });
    const r = (
      await staff
        .post('/me/leave/requests')
        .send({ typeId: sick.id, from: '2026-11-08', to: '2026-11-10', idempotencyKey: key() })
        .expect(201)
    ).body;
    // Without a manager in force it may still go to a department head; make sure it reaches HR.
    if (r.status === 'pending_manager')
      await prisma.leaveRequest.update({ where: { id: r.id }, data: { status: 'pending_hr' } });
    await staff
      .put(`/me/leave/requests/${r.id}/document?name=note.pdf`)
      .set('content-type', 'application/pdf')
      .send(PDF)
      .expect(200);
    const doc = await staff.get(`/me/leave/requests/${r.id}/document`).expect(200);
    expect(doc.headers['content-type']).toBe('application/pdf');
    expect((await hrMaadi.agent.get(`/hr/leave/requests/${r.id}`).expect(403)).body.error).toBe(
      'store_not_allowed',
    );
    expect(
      (await hrMaadi.agent.get('/hr/leave/requests').expect(200)).body.every(
        (x: { employee: { store: { id: string } } }) => x.employee.store.id === stores.get('MAA'),
      ),
    ).toBe(true);
    await admin.get(`/hr/leave/requests/${r.id}/document`).expect(200);
    const done = (await admin.post(`/hr/leave/requests/${r.id}/approve`).expect(201)).body;
    expect(done.status).toBe('approved');
  });

  it('records violations with HR use, lets only the person appeal and HR manage decide', async () => {
    const officer = await member('hr@shiply.eg', 'hr_officer');
    const staffFile = await fileOf('staff.newcairo@shiplynow.local');
    const staff = await agent('staff.newcairo@shiplynow.local');
    const other = await agent('staff.maadi@shiplynow.local');
    const type = await prisma.violationType.findUniqueOrThrow({ where: { code: 'misconduct' } });
    const next = (
      await officer.agent
        .get(
          `/hr/violations/next-step?employeeId=${staffFile.id}&typeId=${type.id}&occurredOn=2026-11-05`,
        )
        .expect(200)
    ).body;
    expect(next).toMatchObject({ step: 1, penalty: { penalty: 'written_warning' } });
    await staff
      .post('/hr/violations')
      .send({
        employeeId: staffFile.id,
        typeId: type.id,
        occurredOn: '2026-11-05',
        description: 'Rude to a rider',
        idempotencyKey: key(),
      })
      .expect(403);
    const v = (
      await officer.agent
        .post('/hr/violations')
        .send({
          employeeId: staffFile.id,
          typeId: type.id,
          occurredOn: '2026-11-05',
          description: 'Rude to a rider',
          idempotencyKey: key(),
        })
        .expect(201)
    ).body;
    expect(v).toMatchObject({ number: 'VIO-000001', step: 1, status: 'recorded' });
    const mine = (await staff.get('/me/violations').expect(200)).body;
    expect(mine.violations[0]).toMatchObject({ id: v.id, canAppeal: true });
    await other.get(`/me/violations/${v.id}`).expect(404);
    await other.post(`/me/violations/${v.id}/appeal`).send({ reason: 'Not me' }).expect(404);
    await staff
      .post(`/me/violations/${v.id}/appeal`)
      .send({ reason: 'The rider was rude first' })
      .expect(201);
    const inbox = (await admin.get('/me/inbox').expect(200)).body;
    expect(inbox.appeals.map((a: { id: string }) => a.id)).toEqual([v.id]);
    // HR officer is HR manage but recorded it: someone else decides.
    expect(
      (
        await officer.agent
          .post(`/hr/violations/${v.id}/decide`)
          .send({ decision: 'upheld', note: 'Seen on camera' })
          .expect(403)
      ).body.error,
    ).toBe('same_person');
    const decided = (
      await admin
        .post(`/hr/violations/${v.id}/decide`)
        .send({ decision: 'cancelled', note: 'Camera shows the rider started it' })
        .expect(201)
    ).body;
    expect(decided.status).toBe('cancelled');
    // Store managers read HR but never record.
    const lead = await member('lead@shiply.eg', 'store_manager', { storeIds: [stores.get('NCR')] });
    await lead.agent.get('/hr/violations').expect(200);
    await lead.agent.get('/hr/violations/types').expect(200);
    await lead.agent
      .post('/hr/violations/types')
      .send({
        code: 'x_type',
        nameEn: 'X type',
        nameAr: 'نوع',
        category: 'conduct',
        isActive: true,
        steps: [{ penalty: 'verbal_warning' }],
      })
      .expect(403);
  });

  it('lets a person ask to fix a day and HR apply it', async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    const staffFile = await fileOf('staff.newcairo@shiplynow.local');
    await prisma.employee.update({ where: { id: staffFile.id }, data: { managerId: null } });
    const c = (
      await staff
        .post('/me/corrections')
        .send({
          day: '2026-11-05',
          problem: 'Forgot to clock in',
          proposedIn: '10:00',
          proposedOut: '16:00',
          idempotencyKey: key(),
        })
        .expect(201)
    ).body;
    if (c.status === 'pending_manager')
      await prisma.attendanceCorrection.update({
        where: { id: c.id },
        data: { status: 'pending_hr' },
      });
    expect((await staff.get('/me/corrections').expect(200)).body).toHaveLength(1);
    const applied = (await admin.post(`/hr/corrections/${c.id}/apply`).send({}).expect(201)).body;
    expect(applied.status).toBe('applied');
    expect(
      await prisma.punch.count({ where: { employeeId: staffFile.id, source: 'manual' } }),
    ).toBe(2);
  });
});
