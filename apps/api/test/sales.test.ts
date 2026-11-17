import type { INestApplication } from '@nestjs/common';
import type { JobRole } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, grantAccess, resetAndSeed } from './helpers';

/** The Sales app (docs/SALES.md): routes and who may call them. */
describe('sales CRM', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let n = 0;
  const key = () => `sales-key-${++n}-0000`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  const signIn = async (email: string, password: string) => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password }).expect(200);
    return agent;
  };
  const member = async (email: string, jobRole: JobRole) => {
    const user = await createUser(prisma, {
      email,
      name: email.split('@')[0],
      password: 'team-password-1',
      role: 'admin',
    });
    await prisma.userAccess.deleteMany({ where: { userId: user.id } });
    await grantAccess(prisma, user.id, jobRole);
    return { user, agent: await signIn(email, 'team-password-1') };
  };
  const addDeal = (agent: request.Agent, brandName: string, extra: object = {}) =>
    agent
      .post('/sales/deals')
      .send({
        company: { brandName, city: 'Cairo' },
        contact: { name: 'Hana', phone: '0101 234 5678', whatsapp: true },
        expectedMonthlyOrders: 400,
        expectedMonthlyFeePiastres: 1_250_000,
        idempotencyKey: key(),
        ...extra,
      })
      .expect(201);

  it('keeps a rep to their own deals and answers deal_not_allowed for others', async () => {
    const a = await member('rep.a@test.eg', 'sales_rep');
    const b = await member('rep.b@test.eg', 'sales_rep');
    const mine = await addDeal(a.agent, 'Alpha Foods');
    const theirs = await addDeal(b.agent, 'Beta Home');

    const list = await a.agent.get('/sales/deals').expect(200);
    expect(list.body.map((d: { company: { brandName: string } }) => d.company.brandName)).toEqual([
      'Alpha Foods',
    ]);
    const deal = await a.agent.get(`/sales/deals/${mine.body.id}`).expect(200);
    expect(deal.body).toMatchObject({
      label: 'DEAL-000001',
      stage: 'new',
      owner: { id: a.user.id },
      company: { brandName: 'Alpha Foods', contacts: [{ phone: '+201012345678' }] },
    });

    const refuse = async (res: request.Test) =>
      expect((await res.expect(403)).body.error).toBe('deal_not_allowed');
    await refuse(a.agent.get(`/sales/deals/${theirs.body.id}`));
    await refuse(a.agent.get(`/sales/deals/${theirs.body.id}/history`));
    await refuse(a.agent.patch(`/sales/deals/${theirs.body.id}`).send({ title: 'Mine now' }));
    await refuse(a.agent.post(`/sales/deals/${theirs.body.id}/stage`).send({ stage: 'contacted' }));
    await refuse(
      a.agent.post('/sales/activities').send({
        dealId: theirs.body.id,
        type: 'note',
        subject: 'Peek',
        done: true,
        idempotencyKey: key(),
      }),
    );
    const companyB = (await b.agent.get(`/sales/deals/${theirs.body.id}`)).body.companyId;
    await refuse(a.agent.get(`/sales/companies/${companyB}`));
    // A rep may not reassign.
    expect(
      (
        await a.agent
          .post(`/sales/deals/${mine.body.id}/owner`)
          .send({ ownerId: b.user.id })
          .expect(403)
      ).body.error,
    ).toBe('no_access');
  });

  it('lets a manager see everything, reassign and lose a deal with a reason', async () => {
    const rep = await member('rep@test.eg', 'sales_rep');
    const manager = await member('boss@test.eg', 'sales_manager');
    const queued = await addDeal(manager.agent, 'Queued Brand');
    const repDeal = await addDeal(rep.agent, 'Rep Brand');

    const queue = await manager.agent.get('/sales/deals?unassigned=true').expect(200);
    expect(queue.body.map((d: { id: string }) => d.id)).toEqual([queued.body.id]);
    await manager.agent
      .post(`/sales/deals/${queued.body.id}/owner`)
      .send({ ownerId: rep.user.id })
      .expect(201);
    const now = await rep.agent.get(`/sales/deals/${queued.body.id}`).expect(200);
    expect(now.body.owner.id).toBe(rep.user.id);
    expect((await manager.agent.get('/sales/deals').expect(200)).body).toHaveLength(2);

    // Lost needs a reason; "other" needs a note.
    const stage = (body: object) =>
      manager.agent.post(`/sales/deals/${repDeal.body.id}/stage`).send(body);
    expect((await stage({ stage: 'lost' }).expect(400)).body.issues[0].message).toBe(
      'lost_reason_required',
    );
    await stage({ stage: 'lost', lostReason: 'other' }).expect(400);
    await stage({ stage: 'lost', lostReason: 'competitor' }).expect(201);
    const lost = await manager.agent.get(`/sales/deals/${repDeal.body.id}`).expect(200);
    expect(lost.body).toMatchObject({
      stage: 'lost',
      lostReason: 'competitor',
      lostReasonLabel: { en: 'Chose a competitor' },
    });
    expect(lost.body.history.map((h: { toStage: string }) => h.toStage)).toEqual(['lost', 'new']);
    const history = await manager.agent.get(`/sales/deals/${repDeal.body.id}/history`).expect(200);
    expect(history.body.map((h: { action: string }) => h.action)).toEqual([
      'crm_deal.stage',
      'crm_deal.create',
    ]);

    // A plan, then my day for the rep, and the manager looking at the rep's day.
    await rep.agent
      .post('/sales/activities')
      .send({
        dealId: queued.body.id,
        type: 'call',
        subject: 'Call about the price',
        dueAt: new Date(Date.now() - 60_000).toISOString(),
        idempotencyKey: key(),
      })
      .expect(201);
    const day = await rep.agent.get('/sales/my-day').expect(200);
    expect(day.body.overdue.map((a: { subject: string }) => a.subject)).toEqual([
      'Call about the price',
    ]);
    const watched = await manager.agent.get(`/sales/my-day?ownerId=${rep.user.id}`).expect(200);
    expect(watched.body.overdue).toHaveLength(1);

    // The list as CSV with the house rules.
    const csv = await manager.agent.get('/sales/deals.csv').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain('DEAL-000001,Queued Brand,manual,Cairo,rep');
    expect(csv.text).toContain('12500.00');
  });

  it('lets sales view read but not write, and keeps lost reasons for managers', async () => {
    const manager = await member('boss@test.eg', 'sales_manager');
    await addDeal(manager.agent, 'Read Me');
    const viewer = await createUser(prisma, {
      email: 'viewer@test.eg',
      password: 'team-password-1',
      role: 'admin',
    });
    await prisma.userAccess.update({
      where: { userId: viewer.id },
      data: { sales: 'view', settings: 'none', jobRole: 'custom' },
    });
    const v = await signIn('viewer@test.eg', 'team-password-1');
    expect((await v.get('/sales/deals').expect(200)).body).toHaveLength(1);
    expect((await v.get('/sales/meta').expect(200)).body.me).toMatchObject({ level: 'view' });
    expect(
      (
        await v
          .post('/sales/deals')
          .send({ company: { brandName: 'Nope' }, idempotencyKey: key() })
          .expect(403)
      ).body.error,
    ).toBe('no_access');

    const rep = await member('rep@test.eg', 'sales_rep');
    await rep.agent
      .post('/sales/lost-reasons')
      .send({ code: 'too_far', labelEn: 'Too far', labelAr: 'بعيد جدًا' })
      .expect(403);
    await manager.agent
      .post('/sales/lost-reasons')
      .send({ code: 'too_far', labelEn: 'Too far', labelAr: 'بعيد جدًا' })
      .expect(201);
    await manager.agent.patch('/sales/lost-reasons/price').send({ active: false }).expect(200);
    const meta = await rep.agent.get('/sales/meta').expect(200);
    const codes = meta.body.lostReasons.map((r: { code: string }) => r.code);
    expect(codes).toContain('too_far');
    expect(codes).not.toContain('price');
    // People without sales access open nothing.
    const hr = await member('hr@test.eg', 'hr_officer');
    expect((await hr.agent.get('/sales/meta').expect(403)).body.error).toBe('no_access');
  });

  it('opens a lead for every merchant sign up', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        businessName: 'Nile Pantry',
        contactName: 'Hana Adel',
        email: 'hana@nilepantry.eg',
        phone: '01012345678',
        password: 'nile-pantry-1',
      })
      .expect(201);
    const admin = await signIn('admin@test.eg', 'admin-password-1');
    const leads = await admin.get('/sales/deals?unassigned=true&source=signup').expect(200);
    expect(leads.body).toHaveLength(1);
    expect(leads.body[0].company).toMatchObject({ brandName: 'Nile Pantry', source: 'signup' });
  });
});
