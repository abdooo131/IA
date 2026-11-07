import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoginThrottleService } from '../src/auth/login-throttle.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, grantAccess, resetAndSeed } from './helpers';

const lead = {
  name: 'Mona Adel',
  phone: '010 1234 5678',
  website: 'monastore.com',
  ordersBand: '300_1000',
  locale: 'ar',
  idempotencyKey: 'lead-key-0001',
};

/** The public website's contact form and the admin leads list (docs/ARCHITECTURE.md). */
describe('website leads', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    const throttle = app.get(LoginThrottleService);
    (throttle as unknown as { failures: Map<string, number[]> }).failures.clear();
    await resetAndSeed(prisma);
  });

  const signIn = async (email: string, password: string) => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password }).expect(200);
    return agent;
  };
  /** A team member with one job role's access. */
  const member = async (email: string, jobRole: 'hr_officer' | 'accountant') => {
    const user = await createUser(prisma, { email, password: 'team-password-1', role: 'admin' });
    await prisma.userAccess.deleteMany({ where: { userId: user.id } });
    await grantAccess(prisma, user.id, jobRole);
    return signIn(email, 'team-password-1');
  };

  it('stores a lead with a valid mobile, raises one alert and audits it', async () => {
    const web = request(app.getHttpServer());
    const sent = await web.post('/site/leads').send(lead).expect(201);
    const row = await prisma.siteLead.findUniqueOrThrow({ where: { id: sent.body.id } });
    expect(row).toMatchObject({
      name: 'Mona Adel',
      phone: '+201012345678',
      phoneValid: true,
      website: 'monastore.com',
      ordersBand: '300_1000',
      locale: 'ar',
      status: 'new',
    });
    // A double tap sends the same key: one lead, one alert.
    const again = await web.post('/site/leads').send(lead).expect(201);
    expect(again.body.id).toBe(sent.body.id);
    const alerts = await prisma.alert.findMany({ where: { type: 'site_lead' } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.data).toMatchObject({ leadId: row.id, name: 'Mona Adel' });
    const audit = await prisma.auditLog.findMany({ where: { action: 'site_lead.create' } });
    expect(audit).toHaveLength(1);
  });

  it('keeps a phone that is not an Egyptian mobile as typed and flags it', async () => {
    const web = request(app.getHttpServer());
    const sent = await web
      .post('/site/leads')
      .send({ ...lead, phone: '+44 20 7946 0958', website: '', idempotencyKey: 'lead-key-0002' })
      .expect(201);
    const row = await prisma.siteLead.findUniqueOrThrow({ where: { id: sent.body.id } });
    expect(row).toMatchObject({ phone: '+44 20 7946 0958', phoneValid: false, website: null });
    // Missing fields are refused with the field named.
    const bad = await web
      .post('/site/leads')
      .send({ ...lead, name: '', idempotencyKey: 'lead-key-0003' })
      .expect(400);
    expect(bad.body.issues).toEqual([{ path: 'name', message: 'name_required' }]);
  });

  it('takes at most 5 leads per address in 15 minutes', async () => {
    const web = request(app.getHttpServer());
    for (let i = 0; i < 5; i++)
      await web
        .post('/site/leads')
        .set('x-forwarded-for', '10.0.0.1, 41.33.1.9')
        .send({ ...lead, idempotencyKey: `lead-burst-${i}0000` })
        .expect(201);
    const refused = await web
      .post('/site/leads')
      .set('x-forwarded-for', '10.0.0.1, 41.33.1.9')
      .send({ ...lead, idempotencyKey: 'lead-burst-90000' })
      .expect(429);
    expect(refused.body.error).toBe('too_many_attempts');
    // The last X-Forwarded-For entry is the address; another visitor still gets through.
    await web
      .post('/site/leads')
      .set('x-forwarded-for', '41.33.1.9, 41.33.2.7')
      .send({ ...lead, idempotencyKey: 'lead-other-0001' })
      .expect(201);
  });

  it('lists leads for merchants view and lets merchants use follow them up', async () => {
    const web = request(app.getHttpServer());
    const first = await web.post('/site/leads').send(lead).expect(201);
    await web
      .post('/site/leads')
      .send({ ...lead, name: 'Karim Said', idempotencyKey: 'lead-key-0009' })
      .expect(201);

    const admin = await signIn('admin@test.eg', 'admin-password-1');
    const list = await admin.get('/admin/site-leads').expect(200);
    expect(list.body.map((l: { name: string }) => l.name)).toEqual(['Karim Said', 'Mona Adel']);

    const updated = await admin
      .patch(`/admin/site-leads/${first.body.id}`)
      .send({ status: 'contacted', note: 'Called, sending rates' })
      .expect(200);
    expect(updated.body).toMatchObject({
      status: 'contacted',
      note: 'Called, sending rates',
      handledBy: { name: 'Admin' },
    });
    const contacted = await admin.get('/admin/site-leads?status=contacted').expect(200);
    expect(contacted.body).toHaveLength(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'site_lead.update' } });
    expect(audit).toMatchObject({
      entityId: first.body.id,
      before: { status: 'new', note: null },
      after: { status: 'contacted', note: 'Called, sending rates' },
    });
    // Following the lead up handles its alert.
    const alert = await prisma.alert.findUniqueOrThrow({
      where: { key: `site_lead:${first.body.id}` },
    });
    expect(alert.resolvedAt).not.toBeNull();
    await admin.patch(`/admin/site-leads/${first.body.id}`).send({}).expect(400);
    await admin.patch('/admin/site-leads/nope').send({ status: 'won' }).expect(404);

    // Merchants view reads but cannot change; no merchants access reads nothing.
    const viewer = await member('accountant@test.eg', 'accountant');
    await viewer.get('/admin/site-leads').expect(200);
    const refused = await viewer
      .patch(`/admin/site-leads/${first.body.id}`)
      .send({ status: 'won' })
      .expect(403);
    expect(refused.body.error).toBe('no_access');
    const hr = await member('hr@test.eg', 'hr_officer');
    expect((await hr.get('/admin/site-leads').expect(403)).body.error).toBe('no_access');
    await request(app.getHttpServer()).get('/admin/site-leads').expect(401);
  });
});
