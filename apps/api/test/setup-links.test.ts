import type { INestApplication } from '@nestjs/common';
import { issueSetupToken, runExitDisables } from '@shiplynow/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const PASSWORD = 'team-password-1';

/** A setup link never opens an account that was closed (disabled, left or leaving). */
describe('setup links and closed accounts', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: ReturnType<typeof request.agent>;
  const anon = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
    admin = request.agent(app.getHttpServer());
    await admin.post('/auth/login').send({ email: 'admin@test.eg', password: 'admin-password-1' });
  });

  /** A team member with an employee file; inactive and holding a fresh link when pending. */
  const person = async (pending: boolean) => {
    const res = await admin
      .post('/admin/users')
      .send({
        email: 'p@t.eg',
        name: 'Pat',
        role: 'admin',
        jobRole: 'hr_officer',
        password: PASSWORD,
      })
      .expect(201);
    const userId = res.body.id as string;
    if (pending) await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    const token = await prisma.$transaction((tx) => issueSetupToken(tx, userId, null));
    const employee = await prisma.employee.findUniqueOrThrow({ where: { userId } });
    return { userId, token, employeeId: employee.id };
  };
  const tokenRow = (userId: string) =>
    prisma.userSetupToken.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: 'desc' } });

  it('expires open links when admin disables the account, and refuses older ones too', async () => {
    const p = await person(false);
    await admin.patch(`/admin/users/${p.userId}`).send({ isActive: false }).expect(200);
    expect((await tokenRow(p.userId)).expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    await anon().get(`/auth/setup/${p.token}`).expect(404);
    // A link made before links were expired on disable: the audit trail still closes it.
    await prisma.userSetupToken.updateMany({
      where: { userId: p.userId },
      data: { expiresAt: new Date(Date.now() + 86_400_000) },
    });
    await anon().get(`/auth/setup/${p.token}`).expect(404);
    await anon().post(`/auth/setup/${p.token}`).send({ password: 'new-password-1' }).expect(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: p.userId } })).isActive).toBe(false);
  });

  it('gives a new link only while the person never chose a password', async () => {
    const p = await person(true);
    await anon().post(`/auth/setup/${p.token}`).send({ password: 'pat-password-1' }).expect(201);
    await admin.patch(`/admin/users/${p.userId}`).send({ isActive: false }).expect(200);
    const refused = await admin.post(`/hr/employees/${p.employeeId}/setup-link`).expect(409);
    expect(refused.body.error).toBe('login_already_active');
    const file = (await admin.get(`/hr/employees/${p.employeeId}`).expect(200)).body;
    expect(file.login).toBe('disabled');
  });

  it('refuses links of a person who left or is leaving, and the exit job expires them', async () => {
    const p = await person(true);
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.eg' } })).id;
    const exit = await prisma.employeeExit.create({
      data: {
        employeeId: p.employeeId,
        lastDay: new Date('2026-01-01'),
        reason: 'resignation',
        noticeDays: 30,
        settlement: {},
        disableAt: new Date(Date.now() + 86_400_000),
        createdById: adminId,
        idempotencyKey: 'exit-setup-test',
      },
    });
    // Leaving recorded (last day still ahead): the open link and a new one are refused.
    await anon().get(`/auth/setup/${p.token}`).expect(404);
    const refused = await admin.post(`/hr/employees/${p.employeeId}/setup-link`).expect(409);
    expect(refused.body.error).toBe('employee_left');

    await prisma.employee.update({
      where: { id: p.employeeId },
      data: { status: 'left', leftOn: new Date('2026-01-01'), leftReason: 'resignation' },
    });
    await prisma.employeeExit.update({
      where: { id: exit.id },
      data: { disableAt: new Date(Date.now() - 1000) },
    });
    await runExitDisables(prisma);
    expect((await tokenRow(p.userId)).expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    await anon().post(`/auth/setup/${p.token}`).send({ password: 'pat-password-1' }).expect(404);
  });

  it('still opens a pending account with its link', async () => {
    const p = await person(true);
    await anon().get(`/auth/setup/${p.token}`).expect(200);
    await anon().post(`/auth/setup/${p.token}`).send({ password: 'pat-password-1' }).expect(201);
    await anon()
      .post('/auth/login')
      .send({ email: 'p@t.eg', password: 'pat-password-1' })
      .expect(200);
  });
});
