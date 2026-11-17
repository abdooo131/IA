import type { INestApplication } from '@nestjs/common';
import { appListGaps } from '@shiplynow/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const PASSWORD = 'team-password-1';
const NOW = new Date('2026-11-06T10:00:00Z');

type Row = { id: string } & Record<string, unknown>;
const ids = (body: { rows: Row[] }) => body.rows.map((r) => r.id);
let n = 0;
const key = () => `sales-hr-ux-${++n}-${Date.now()}`;

/** UX phase C step 4: the Sales and HR list views, bulk actions, documents and chatter. */
describe('sales and hr list views, bulk actions and documents', () => {
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
      .send({
        email,
        name: email.split('@')[0],
        role: 'admin',
        jobRole,
        password: PASSWORD,
        ...extra,
      })
      .expect(201);
    return { id: res.body.id as string, agent: await agent(email, PASSWORD) };
  };
  const fileOf = (email: string) =>
    prisma.employee.findFirstOrThrow({ where: { user: { email } } });
  const addDeal = async (a: ReturnType<typeof request.agent>, brandName: string, phone: string) =>
    (
      await a
        .post('/sales/deals')
        .send({
          company: { brandName, city: 'Cairo' },
          contact: { name: `${brandName} owner`, phone, whatsapp: true },
          expectedMonthlyOrders: 300,
          expectedMonthlyFeePiastres: 1_000_000,
          idempotencyKey: key(),
        })
        .expect(201)
    ).body.id as string;
  /** Limits a person to some stores (HR use unless said), as the access editor does. */
  const limitTo = (userId: string, storeIds: string[], hr = 'use') =>
    admin
      .put(`/admin/users/${userId}/access`)
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
        allStores: storeIds.length === 0,
        customerData: false,
        salaries: false,
        ownMerchantsOnly: false,
        storeIds,
      })
      .expect(200);

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

  it('implements every filter, value, grouping and sort the shared list meta names', () => {
    expect(appListGaps()).toEqual([]);
  });

  it('keeps reps to their own deals in the lists, the documents and the chatter', async () => {
    const a = await member('rep.a@test.eg', 'sales_rep');
    const b = await member('rep.b@test.eg', 'sales_rep');
    const boss = await member('boss@test.eg', 'sales_manager');
    const mine = await addDeal(a.agent, 'Alpha Foods', '0101 234 5678');
    const theirs = await addDeal(b.agent, 'Beta Home', '0122 222 3333');
    const queued = await addDeal(boss.agent, 'Queued Brand', '0155 555 6666');

    // A rep sees only their own; a manager sees all and the queue.
    const own = await a.agent.get('/lists/sales/deals').expect(200);
    expect(ids(own.body)).toEqual([mine]);
    expect(own.body.rows[0]).toMatchObject({ number: 'DEAL-000001', company: 'Alpha Foods' });
    const all = await boss.agent.get('/lists/sales/deals').expect(200);
    expect(ids(all.body).sort()).toEqual([mine, theirs, queued].sort());
    // A phone typed the local way finds the contact stored with +20.
    const byPhone = await boss.agent.get('/lists/sales/deals?q=01222223333').expect(200);
    expect(ids(byPhone.body)).toEqual([theirs]);
    expect(ids((await boss.agent.get('/lists/sales/deals?f=unassigned')).body)).toEqual([queued]);
    // No deal has a next step planned yet; grouped by owner with counts and fee totals.
    expect((await boss.agent.get('/lists/sales/deals?f=no_next_step')).body.total).toBe(3);
    const grouped = await boss.agent.get('/lists/sales/deals?g=owner').expect(200);
    expect(grouped.body.groups).toHaveLength(3);
    expect(grouped.body.totals.expectedFee).toBe(3_000_000);
    // A rep may pick only themselves as owner; another owner's value shows nothing.
    const options = await a.agent.get('/lists/sales/deals/options').expect(200);
    expect(options.body.owner.map((o: { value: string }) => o.value)).toEqual([a.id]);
    expect(ids((await a.agent.get(`/lists/sales/deals?v=owner:${b.id}`)).body)).toEqual([]);
    // Companies follow the same rule.
    const companies = await a.agent.get('/lists/sales/companies').expect(200);
    expect(companies.body.rows.map((r: Row) => r.name)).toEqual(['Alpha Foods']);

    // The chatter and history of a deal: a rep only on their own.
    await a.agent
      .post(`/records/crm_deal/${mine}/notes`)
      .send({ body: 'Called back, sending rates.' })
      .expect(201);
    const refused = await a.agent
      .post(`/records/crm_deal/${theirs}/notes`)
      .send({ body: 'Peek' })
      .expect(403);
    expect(refused.body.error).toBe('deal_not_allowed');
    await a.agent.get(`/records/crm_deal/${theirs}/notes`).expect(403);
    await a.agent.get(`/history/crm_deal/${theirs}`).expect(403);
    await boss.agent.get(`/records/crm_deal/${theirs}/notes`).expect(200);
    // Reminders go only to people who may open the deal (not the other rep).
    const people = await boss.agent.get(`/records/crm_deal/${mine}/people`).expect(200);
    const names = people.body.map((p: { id: string }) => p.id);
    expect(names).toContain(a.id);
    expect(names).not.toContain(b.id);
    const companyB = (await b.agent.get(`/sales/deals/${theirs}`)).body.companyId as string;
    await a.agent.get(`/records/crm_company/${companyB}/notes`).expect(403);
    await a.agent.get(`/sales/deals/${theirs}/document`).expect(403);
    const doc = await a.agent.get(`/sales/deals/${mine}/document`).expect(200);
    expect(doc.body.smart.map((s: { key: string }) => s.key)).toEqual([
      'company',
      'contacts',
      'proposals',
      'activities',
    ]);
  });

  it('assigns, moves and loses deals in bulk under the single rules', async () => {
    const a = await member('rep.a@test.eg', 'sales_rep');
    const b = await member('rep.b@test.eg', 'sales_rep');
    const boss = await member('boss@test.eg', 'sales_manager');
    const mine = await addDeal(a.agent, 'Alpha Foods', '0101 234 5678');
    const theirs = await addDeal(b.agent, 'Beta Home', '0122 222 3333');
    const queued = await addDeal(boss.agent, 'Queued Brand', '0155 555 6666');

    // Only managers assign.
    await a.agent
      .post('/sales/deals/bulk-assign')
      .send({ ids: [mine], ownerId: b.id })
      .expect(403);
    const assigned = await boss.agent
      .post('/sales/deals/bulk-assign')
      .send({ ids: [queued, theirs], ownerId: b.id })
      .expect(201);
    expect(assigned.body.results).toEqual([
      { id: queued, ok: true },
      { id: theirs, ok: false, error: 'already_owner' },
    ]);
    const back = await boss.agent
      .post('/sales/deals/bulk-assign')
      .send({ ids: [queued], ownerId: 'none' })
      .expect(201);
    expect(back.body.results[0].ok).toBe(true);
    expect((await prisma.crmDeal.findUniqueOrThrow({ where: { id: queued } })).ownerId).toBeNull();

    // A rep moves their own deal; another rep's is refused, row by row.
    const moved = await a.agent
      .post('/sales/deals/bulk-stage')
      .send({ ids: [mine, theirs], stage: 'contacted' })
      .expect(201);
    expect(moved.body.results).toEqual([
      { id: mine, ok: true },
      { id: theirs, ok: false, error: 'deal_not_allowed' },
    ]);
    // Won is never a bulk move; lost needs the note.
    await a.agent
      .post('/sales/deals/bulk-stage')
      .send({ ids: [mine], stage: 'won' })
      .expect(400);
    await a.agent
      .post('/sales/deals/bulk-lost')
      .send({ ids: [mine] })
      .expect(400);
    const lost = await a.agent
      .post('/sales/deals/bulk-lost')
      .send({ ids: [mine], note: 'Went with their own riders' })
      .expect(201);
    expect(lost.body.results[0].ok).toBe(true);
    expect(await prisma.crmDeal.findUniqueOrThrow({ where: { id: mine } })).toMatchObject({
      stage: 'lost',
      lostReason: 'other',
      lostNote: 'Went with their own riders',
    });
    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'crm_deal', entityId: mine },
      select: { action: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((r) => r.action)).toEqual([
      'crm_deal.create',
      'crm_deal.stage',
      'crm_deal.stage',
    ]);
    const lostList = await a.agent.get('/lists/sales/deals?f=lost').expect(200);
    expect(ids(lostList.body)).toEqual([mine]);
  });

  it('lists employees inside the HR store scope and keeps salaries and national IDs back', async () => {
    const maadi = await fileOf('staff.maadi@shiplynow.local');
    const newCairo = await fileOf('staff.newcairo@shiplynow.local');
    await prisma.employee.update({
      where: { id: maadi.id },
      data: { nationalId: '29001010101234' },
    });

    const everyone = await admin.get('/lists/hr/employees').expect(200);
    expect(ids(everyone.body)).toEqual(expect.arrayContaining([maadi.id, newCairo.id]));
    expect(ids((await admin.get('/lists/hr/employees?q=29001010101234')).body)).toEqual([maadi.id]);
    const byStore = await admin.get('/lists/hr/employees?g=store').expect(200);
    expect(byStore.body.groups.length).toBeGreaterThan(1);

    // HR limited to Maadi: only Maadi's people, their records and history.
    const hrMaadi = await member('hr.maadi@test.eg', 'hr_officer');
    await limitTo(hrMaadi.id, [stores.get('MAA')!]);
    const limited = await hrMaadi.agent.get('/lists/hr/employees').expect(200);
    expect(ids(limited.body)).toContain(maadi.id);
    expect(ids(limited.body)).not.toContain(newCairo.id);
    expect(
      (await hrMaadi.agent.get(`/records/employee/${newCairo.id}/notes`).expect(403)).body.error,
    ).toBe('store_not_allowed');
    await hrMaadi.agent
      .post(`/records/employee/${maadi.id}/notes`)
      .send({ body: 'Asked for a uniform.' })
      .expect(201);
    await hrMaadi.agent.get(`/history/employee/${newCairo.id}`).expect(403);

    // HR view reads the list but never searches by national ID.
    const viewer = await member('hr.view@test.eg', 'hr_officer');
    await limitTo(viewer.id, [], 'view');
    expect((await viewer.agent.get('/lists/hr/employees?q=29001010101234')).body.total).toBe(0);
    await viewer.agent.post(`/records/employee/${maadi.id}/notes`).send({ body: 'No' }).expect(403);

    // A salary package shows in the history only with the salaries switch.
    const hrManager = await member('hr.manager@test.eg', 'hr_manager');
    await hrManager.agent
      .post(`/hr/employees/${maadi.id}/package`)
      .send({ basicPiastres: 900_000, allowances: [] })
      .expect(201);
    const withPay = await hrManager.agent.get(`/history/employee/${maadi.id}`).expect(200);
    expect(withPay.body.map((r: { action: string }) => r.action)).toContain('employee.package');
    const officer = await member('hr.officer@test.eg', 'hr_officer');
    const withoutPay = await officer.agent.get(`/history/employee/${maadi.id}`).expect(200);
    expect(withoutPay.body.map((r: { action: string }) => r.action)).not.toContain(
      'employee.package',
    );

    // The document: status bar and smart buttons, no money.
    const doc = await officer.agent.get(`/hr/employees/${maadi.id}/document`).expect(200);
    expect(['active', 'on_probation']).toContain(doc.body.status);
    expect(doc.body.smart.map((s: { key: string }) => s.key)).toEqual([
      'leaveLeft',
      'openViolations',
      'documentsMissing',
      'daysWorked',
      'team',
    ]);
    await hrMaadi.agent.get(`/hr/employees/${newCairo.id}/document`).expect(403);
  });

  it('decides leave in bulk at the step each request waits for, never one’s own', async () => {
    const annual = (await prisma.leaveType.findUniqueOrThrow({ where: { code: 'annual' } })).id;
    const hr = await member('hr@test.eg', 'hr_officer');
    const hrFile = await fileOf('hr@test.eg');
    const ncrFile = await fileOf('staff.newcairo@shiplynow.local');
    // The New Cairo person's manager is the HR officer; the Maadi person has none.
    await prisma.employee.update({ where: { id: ncrFile.id }, data: { managerId: hrFile.id } });
    const ask = async (a: ReturnType<typeof request.agent>, from: string) =>
      (
        await a
          .post('/me/leave/requests')
          .send({ typeId: annual, from, to: from, idempotencyKey: key() })
          .expect(201)
      ).body as { id: string; status: string };
    const ncr = await ask(await agent('staff.newcairo@shiplynow.local'), '2026-11-15');
    const maa = await ask(await agent('staff.maadi@shiplynow.local'), '2026-11-16');
    const own = await ask(hr.agent, '2026-11-17');
    // New Cairo waits for its manager (the HR officer), Maadi for its own department head.
    expect([ncr.status, maa.status, own.status]).toEqual([
      'pending_manager',
      'pending_manager',
      'pending_hr',
    ]);

    const waiting = await hr.agent.get('/lists/hr/leave?f=waiting_for_me').expect(200);
    expect(ids(waiting.body)).toEqual([ncr.id]);
    const pending = await hr.agent.get('/lists/hr/leave').expect(200);
    expect(pending.body.total).toBe(3);
    expect(pending.body.totals.days).toBe(3);

    const first = await hr.agent
      .post('/hr/leave/requests/bulk-approve')
      .send({ ids: [ncr.id, maa.id, own.id] })
      .expect(201);
    expect(first.body.results).toEqual([
      { id: ncr.id, ok: true },
      { id: maa.id, ok: false, error: 'not_your_team' },
      { id: own.id, ok: false, error: 'own_request' },
    ]);
    const statuses = async () =>
      Object.fromEntries(
        (
          await prisma.leaveRequest.findMany({
            where: { id: { in: [ncr.id, maa.id, own.id] } },
          })
        ).map((r) => [r.id, r.status]),
      );
    // The manager step moved New Cairo on to HR, where the same list approves it.
    expect((await statuses())[ncr.id]).toBe('pending_hr');
    const second = await hr.agent
      .post('/hr/leave/requests/bulk-approve')
      .send({ ids: [ncr.id] })
      .expect(201);
    expect(second.body.results).toEqual([{ id: ncr.id, ok: true }]);
    expect(await statuses()).toEqual({
      [ncr.id]: 'approved',
      [maa.id]: 'pending_manager',
      [own.id]: 'pending_hr',
    });
    // HR limited to New Cairo cannot touch Maadi's request; a refusal needs a reason.
    const hrNcr = await member('hr.ncr@test.eg', 'hr_officer');
    await limitTo(hrNcr.id, [stores.get('NCR')!]);
    const outside = await hrNcr.agent
      .post('/hr/leave/requests/bulk-reject')
      .send({ ids: [maa.id], note: 'Busy week' })
      .expect(201);
    expect(outside.body.results[0]).toMatchObject({ ok: false, error: 'store_not_allowed' });
    await hr.agent
      .post('/hr/leave/requests/bulk-reject')
      .send({ ids: [maa.id] })
      .expect(400);
    // HR refuses at either step; an approved request no longer waits.
    const rejected = await hr.agent
      .post('/hr/leave/requests/bulk-reject')
      .send({ ids: [maa.id, ncr.id, own.id], note: 'Busy week' })
      .expect(201);
    expect(rejected.body.results).toEqual([
      { id: maa.id, ok: true },
      { id: ncr.id, ok: false, error: 'leave_not_waiting' },
      { id: own.id, ok: false, error: 'own_request' },
    ]);
    // HR view may read, never decide.
    const viewer = await member('hr.view@test.eg', 'hr_officer');
    await limitTo(viewer.id, [], 'view');
    await viewer.agent
      .post('/hr/leave/requests/bulk-approve')
      .send({ ids: [own.id] })
      .expect(403);
    const notes = await viewer.agent.get(`/records/leave_request/${own.id}/notes`).expect(200);
    expect(notes.body).toEqual([]);
  });

  it('confirms and dismisses suggested violations in bulk and lists violations', async () => {
    const late = await prisma.violationType.findUniqueOrThrow({ where: { code: 'late_arrival' } });
    const maa = await fileOf('staff.maadi@shiplynow.local');
    const ncr = await fileOf('staff.newcairo@shiplynow.local');
    const suggest = (employeeId: string, day: string) =>
      prisma.violationSuggestion.create({
        data: {
          employeeId,
          day: new Date(`${day}T00:00:00Z`),
          kind: 'late',
          lateMinutes: 25,
          typeId: late.id,
        },
      });
    const s1 = await suggest(maa.id, '2026-11-02');
    const s2 = await suggest(maa.id, '2026-11-03');
    const s3 = await suggest(ncr.id, '2026-11-03');
    const hr = await member('hr@test.eg', 'hr_officer');

    const open = await hr.agent.get('/lists/hr/suggestions').expect(200);
    expect(open.body.total).toBe(3);

    const hrMaadi = await member('hr.maadi@test.eg', 'hr_officer');
    await limitTo(hrMaadi.id, [stores.get('MAA')!]);
    expect((await hrMaadi.agent.get('/lists/hr/suggestions')).body.total).toBe(2);
    const outside = await hrMaadi.agent
      .post('/hr/violations/suggestions/bulk-dismiss')
      .send({ ids: [s3.id] })
      .expect(201);
    expect(outside.body.results[0]).toMatchObject({ ok: false, error: 'store_not_allowed' });

    const confirmed = await hr.agent
      .post('/hr/violations/suggestions/bulk-confirm')
      .send({ ids: [s1.id, s2.id] })
      .expect(201);
    expect(confirmed.body.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    const again = await hr.agent
      .post('/hr/violations/suggestions/bulk-confirm')
      .send({ ids: [s1.id] })
      .expect(201);
    expect(again.body.results[0]).toMatchObject({ ok: false, error: 'suggestion_closed' });
    await hr.agent
      .post('/hr/violations/suggestions/bulk-dismiss')
      .send({ ids: [s3.id] })
      .expect(201);
    expect((await hr.agent.get('/lists/hr/suggestions')).body.total).toBe(0);
    expect((await hr.agent.get('/lists/hr/suggestions?f=dismissed')).body.total).toBe(1);

    // The ladder: the second late arrival takes the next step.
    const list = await hr.agent.get('/lists/hr/violations?f=recorded&sort=occurred').expect(200);
    expect(list.body.rows.map((r: Row) => r.step)).toEqual([1, 2]);
    const byType = await hr.agent.get('/lists/hr/violations?g=type').expect(200);
    expect(byType.body.groups).toHaveLength(1);
    expect((await hrMaadi.agent.get('/lists/hr/violations')).body.total).toBe(2);
    const vio = list.body.rows[0].id as string;
    await hr.agent
      .post(`/records/violation/${vio}/notes`)
      .send({ body: 'Talked to him.' })
      .expect(201);
  });
});
