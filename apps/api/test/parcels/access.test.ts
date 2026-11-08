// Office team members open the network's screens through their access profile: Shiply for its
// operations, Accounting for its money screens; reading needs view, changing needs use.
import type { INestApplication } from '@nestjs/common';
import { hashPassword, writeAccess } from '@shiplynow/db';
import { JOB_ROLE_TEMPLATES, type JobRole } from '@shiplynow/shared';
import request from 'supertest';
import { createNetworkApp } from './setup-db';

let app: INestApplication;
let prisma: any;

async function teamMember(email: string, role: 'admin' | 'finance', jobRole: JobRole) {
  const user = await prisma.user.create({
    data: { email, name: email, role, passwordHash: await hashPassword('team-password-1') },
  });
  await prisma.$transaction((tx: any) =>
    writeAccess(tx, user.id, { ...JOB_ROLE_TEMPLATES[jobRole], jobRole }, []),
  );
  const c = request.agent(app.getHttpServer());
  const res = await c.post('/auth/login').send({ email, password: 'team-password-1' });
  expect(res.status).toBe(200);
  return c;
}

beforeAll(async () => {
  const { PrismaService } = await import('../../src/parcels/common/prisma.service');
  app = await createNetworkApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
});

describe('network access', () => {
  it('Shiply and Accounting levels decide what an office team member opens', async () => {
    // HR: no Shiply, no Accounting.
    const hr = await teamMember('hr@team.test', 'admin', 'hr_officer');
    expect((await hr.get('/parcels/admin/hubs')).status).toBe(403);
    expect((await hr.get('/parcels/finance/couriers')).status).toBe(403);

    // Finance officer: Shiply view (as operations), Accounting use.
    const fin = await teamMember('fin@team.test', 'finance', 'finance_officer');
    expect((await fin.get('/parcels/admin/hubs')).status).toBe(200);
    expect((await fin.get('/parcels/finance/couriers')).status).toBe(200);
    const change = await fin
      .post('/parcels/admin/hubs')
      .send({ code: 'ZZZ', name: 'Not allowed', governorateCode: 'EG-C' });
    expect(change.status).toBe(403);
    expect(change.body.error).toBe('no_access');

    // Operations manager: Shiply manage, no Accounting.
    const ops = await teamMember('ops@team.test', 'admin', 'operations_manager');
    expect((await ops.get('/parcels/admin/hubs')).status).toBe(200);
    expect((await ops.get('/parcels/finance/couriers')).status).toBe(403);

    // Office accounts are made in Shiply Now's Users page, never from the network's.
    const owner = request.agent(app.getHttpServer());
    await owner.post('/auth/login').send({ email: 'admin@shiply.local', password: 'admin12345' });
    const made = await owner.post('/parcels/admin/users').send({
      email: 'x@team.test',
      name: 'Office',
      role: 'ADMIN',
      password: 'office-password-1',
    });
    expect(made.status).toBe(422);
    expect(made.body.error).toBe('use_team_users');
  });

  it('one alerts list: both companies, each to the people of its app', async () => {
    const shiplyAlert = await prisma.networkAlert.create({
      data: { kind: 'LATE_CHECK_IN', entity: 'shift', entityId: 'x1', message: 'Courier late' },
    });
    const owner = request.agent(app.getHttpServer());
    await owner.post('/auth/login').send({ email: 'admin@shiply.local', password: 'admin12345' });
    const all = (await owner.get('/admin/alerts').expect(200)).body;
    const row = all.find((a: any) => a.id === `nw_${shiplyAlert.id}`);
    expect(row).toMatchObject({
      company: 'shiply',
      type: 'network',
      data: { message: 'Courier late' },
    });
    const nowOnly = (await owner.get('/admin/alerts?company=shiply_now').expect(200)).body;
    expect(nowOnly.every((a: any) => a.company === 'shiply_now')).toBe(true);

    // HR sees neither company's alerts.
    const hr = await teamMember('hr2@team.test', 'admin', 'hr_officer');
    expect((await hr.get('/admin/alerts')).status).toBe(403);
    // Viewing is not handling.
    const fin = await teamMember('fin2@team.test', 'finance', 'finance_officer');
    expect((await fin.get('/admin/alerts?company=shiply')).body.length).toBeGreaterThan(0);
    expect((await fin.post(`/admin/alerts/nw_${shiplyAlert.id}/resolve`)).status).toBe(403);

    await owner.post(`/admin/alerts/nw_${shiplyAlert.id}/resolve`).expect(201);
    expect((await prisma.networkAlert.findUnique({ where: { id: shiplyAlert.id } })).status).toBe(
      'RESOLVED',
    );
    await owner.post(`/admin/alerts/nw_${shiplyAlert.id}/resolve`).expect(409);
  });
});
