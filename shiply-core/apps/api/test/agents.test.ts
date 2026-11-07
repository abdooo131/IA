// Agents and workforce: agent profiles, staff joining with the agent code, approval, attendance
// alerts (late / not coming / replacement in 1 hour), check in with a photo, vehicle requests.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestDatabase, dropTestDatabase, TEST_DB } from './setup-db';

process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.SHIPLY_JOBS = 'off';

let app: INestApplication;
let prisma: any;
let service: any;
type Client = ReturnType<typeof request.agent>;
let admin: Client;
let agentA: Client;
const hubs: Record<string, string> = {};
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const PHOTO = Buffer.from('fake jpeg bytes for the check in photo').toString('base64');

async function login(id: string, password: string, status = 200): Promise<Client> {
  const c = request.agent(app.getHttpServer());
  const res = await c.post('/auth/login').send({ login: id, password });
  if (res.status !== status) throw new Error(`login ${id}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}

async function ok<T = any>(req: request.Test, status = 200): Promise<T> {
  const res = await req;
  if (res.status !== status) throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as T;
}

let agent: any;
const staff: Record<string, any> = {};

beforeAll(async () => {
  await createTestDatabase();
  const { createApp } = await import('../src/main');
  const { PrismaService } = await import('../src/common/prisma.service');
  const { AgentsService } = await import('../src/agents/agents.service');
  app = await createApp();
  await app.init();
  prisma = app.get(PrismaService);
  service = app.get(AgentsService);
  admin = await login('admin@shiply.local', 'admin12345');
  for (const h of await ok(admin.get('/admin/hubs'))) hubs[h.code] = h.id;
});

afterAll(async () => {
  await app?.close();
  await dropTestDatabase();
});

describe('agents and workforce', () => {
  it('admin registers an agent with papers, bank details and a login', async () => {
    agent = await ok(
      admin.post('/admin/agents').send({ name: 'Giza Fleet', phone: '01055500011', supplies: 'BOTH', iban: 'EG' + '1'.repeat(27), bankName: 'CIB', nationalIdNo: '29001011234567' }),
      201,
    );
    expect(agent.code).toMatch(/^AG[A-Z0-9]{5}$/);
    const bad = await admin.post('/admin/agents').send({ name: 'X Fleet', phone: '01055500012', iban: 'EG12' });
    expect(bad.status).toBe(422);

    const doc = await ok(admin.post(`/admin/agents/${agent.id}/documents`).send({ kind: 'NATIONAL_ID', fileName: 'id.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 test').toString('base64') }), 201);
    const file = await admin.get(`/admin/agents/${agent.id}/documents/${doc.id}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/pdf');

    const full = await ok(admin.get(`/admin/agents/${agent.id}`));
    expect(full.effectiveCommissionBp).toBe(1000); // default from settings
    expect(full.documents).toHaveLength(1);

    await ok(admin.post(`/admin/agents/${agent.id}/logins`).send({ name: 'Giza Fleet owner', email: 'owner@gizafleet.example', password: 'fleet12345' }), 201);
    agentA = await login('owner@gizafleet.example', 'fleet12345');
    const me = await ok(agentA.get('/auth/me'));
    expect(me.agent.code).toBe(agent.code);
    // An agent cannot open the admin screens.
    expect((await agentA.get('/admin/agents')).status).toBe(403);
  });

  it('couriers join with the agent code and wait for approval', async () => {
    const wrong = await request(app.getHttpServer()).post('/auth/join').send({ agentCode: 'AGXXXXX', name: 'Nobody', phone: '01111111111', password: 'pass12345', courierType: 'DELIVERY' });
    expect(wrong.status).toBe(422);

    for (const [key, phone] of [['mona', '01122233301'], ['omar', '01122233302'], ['ali', '01122233303']] as const) {
      const r = await ok(request(app.getHttpServer()).post('/auth/join').send({ agentCode: agent.code.toLowerCase(), name: key, phone, password: 'pass12345', courierType: 'DELIVERY' }), 201);
      staff[key] = { id: r.id, phone };
    }
    // Not approved yet: cannot sign in.
    await login('01122233301', 'pass12345', 401);

    const alerts = await ok(agentA.get('/agent/alerts'));
    expect(alerts.filter((a: any) => a.kind === 'STAFF_WAITING_APPROVAL')).toHaveLength(3);
    const ov = await ok(agentA.get('/agent/overview'));
    expect(ov.pending).toBe(3);
  });

  it('the agent approves staff into the right kind of hub', async () => {
    const body = (name: string, phone: string, hubId: string) => ({ name, phone, courierType: 'DELIVERY', hubId, workDays: ALL_DAYS, shiftStart: '09:00', active: true });
    // Delivery staff work from a last mile hub, not a sorting facility.
    const facility = (await ok(admin.get('/admin/hubs'))).find((h: any) => h.isSorting);
    const wrongHub = await agentA.put(`/agent/staff/${staff.mona.id}`).send(body('mona', staff.mona.phone, facility.id));
    expect(wrongHub.status).toBe(422);
    const lastMile = (await ok(admin.get('/admin/hubs'))).find((h: any) => !h.isSorting);
    staff.hubId = lastMile.id;
    await ok(agentA.put(`/agent/staff/${staff.mona.id}`).send(body('mona', staff.mona.phone, lastMile.id)));
    await ok(agentA.put(`/agent/staff/${staff.omar.id}`).send(body('omar', staff.omar.phone, lastMile.id)));
    staff.monaClient = await login('01122233301', 'pass12345'); // phone login
    staff.omarClient = await login('+201122233302', 'pass12345');
    const left = await ok(agentA.get('/agent/alerts'));
    expect(left.filter((a: any) => a.kind === 'STAFF_WAITING_APPROVAL')).toHaveLength(1);

    // An agent cannot touch staff of another agent.
    const other = await prisma.user.findFirst({ where: { role: 'COURIER', agentId: { not: agent.id }, NOT: { agentId: null } } });
    expect((await agentA.put(`/agent/staff/${other.id}`).send(body('Other person', '01199999999', lastMile.id))).status).toBe(404);
  });

  it('no check in after 30 minutes alerts the agent; not coming needs a replacement within 1 hour', async () => {
    await service.ensureShifts(new Date());
    const day = (await ok(agentA.get('/agent/shifts'))).shifts;
    const mona = day.find((s: any) => s.courier.id === staff.mona.id);
    const omar = day.find((s: any) => s.courier.id === staff.omar.id);
    expect(mona.status).toBe('SCHEDULED');

    // Pretend both shifts started 40 minutes ago.
    await prisma.shift.updateMany({ where: { id: { in: [mona.id, omar.id] } }, data: { startAt: new Date(Date.now() - 40 * 60000) } });
    const tick = await ok(admin.post('/admin/jobs/attendance'));
    expect(tick.alerted).toBeGreaterThanOrEqual(2);
    const alerts = await ok(agentA.get('/agent/alerts'));
    expect(alerts.filter((a: any) => a.kind === 'NOT_CHECKED_IN')).toHaveLength(2);
    // A second tick does not alert twice.
    await ok(admin.post('/admin/jobs/attendance'));
    expect((await ok(agentA.get('/agent/alerts'))).filter((a: any) => a.kind === 'NOT_CHECKED_IN')).toHaveLength(2);

    const answer = await ok(agentA.post(`/agent/shifts/${mona.id}/answer`).send({ answer: 'NOT_COMING' }));
    expect(answer.status).toBe('NOT_COMING');
    expect((await ok(agentA.get('/agent/alerts'))).some((a: any) => a.kind === 'REPLACEMENT_NEEDED' && a.entityId === mona.id)).toBe(true);
    // Mona was reported as not coming, so she cannot check in.
    expect((await staff.monaClient.post('/courier/check-in').send({ photoBase64: PHOTO })).status).toBe(409);

    // The hour passes with no replacement: operations get a high alert.
    await prisma.shift.update({ where: { id: mona.id }, data: { replacementDeadline: new Date(Date.now() - 1000) } });
    const t2 = await ok(admin.post('/admin/jobs/attendance'));
    expect(t2.replacementOverdue).toBe(1);
    const ops = await ok(admin.get('/admin/alerts'));
    const overdue = ops.find((a: any) => a.kind === 'REPLACEMENT_OVERDUE' && a.entityId === mona.id);
    expect(overdue.severity).toBe('high');

    // Omar already has his own shift today, so he cannot cover.
    expect((await agentA.post(`/agent/shifts/${mona.id}/replacement`).send({ courierId: staff.omar.id })).status).toBe(422);
    // Ali (approved now, no shift today) covers.
    await ok(agentA.put(`/agent/staff/${staff.ali.id}`).send({ name: 'ali', phone: staff.ali.phone, courierType: 'DELIVERY', hubId: staff.hubId, workDays: ALL_DAYS, active: true }));
    const rep = await ok(agentA.post(`/agent/shifts/${mona.id}/replacement`).send({ courierId: staff.ali.id }));
    expect(rep.onTime).toBe(false);
    const after = await ok(admin.get('/admin/alerts'));
    expect(after.some((a: any) => a.entityId === mona.id)).toBe(false);

    const ali = await login('01122233303', 'pass12345');
    const mine = await ok(ali.get('/courier/shift'));
    expect(mine.shift.replacesShiftId).toBe(mona.id);
    const ci = await ok(ali.post('/courier/check-in').send({ photoBase64: PHOTO, lat: 30.05, lng: 31.23 }));
    expect(ci.status).toBe('CHECKED_IN');
  });

  it('late with an expected time, then checking in closes the alerts', async () => {
    const omar = (await ok(agentA.get('/agent/shifts'))).shifts.find((s: any) => s.courier.id === staff.omar.id);
    await ok(agentA.post(`/agent/shifts/${omar.id}/answer`).send({ answer: 'LATE', expectedTime: '00:00' }));
    expect((await ok(agentA.get('/agent/alerts'))).some((a: any) => a.kind === 'NOT_CHECKED_IN' && a.entityId === omar.id)).toBe(false);
    const t = await ok(admin.post('/admin/jobs/attendance'));
    expect(t.lateStillMissing).toBe(1);

    const r = await ok(staff.omarClient.post('/courier/check-in').send({ photoBase64: PHOTO }));
    expect(r.lateMinutes).toBeGreaterThanOrEqual(40);
    expect((await staff.omarClient.post('/courier/check-in').send({ photoBase64: PHOTO })).status).toBe(409);
    expect((await ok(agentA.get('/agent/alerts'))).some((a: any) => a.entityId === omar.id)).toBe(false);
    const photo = await admin.get(`/admin/attendance/${omar.id}/photo`);
    expect(photo.status).toBe(200);
    // The agent's attendance board shows who checked in and how late.
    const board = await ok(admin.get(`/admin/attendance?agentId=${agent.id}`));
    expect(board.shifts.find((s: any) => s.id === omar.id).status).toBe('CHECKED_IN');
  });

  it('special vehicle requests go to the agent and back', async () => {
    const tooBig = await agentA.post('/agent/vehicles').send({ plate: 'abc 123', kind: 'VAN', contract: 'FIXED' });
    expect(tooBig.status).toBe(422); // fixed vans need their monthly rent
    const van = await ok(agentA.post('/agent/vehicles').send({ plate: 'abc 123', kind: 'VAN', contract: 'FIXED', monthlyRent: 1200000 }), 201);
    expect(van.plate).toBe('ABC 123');

    const req = await ok(admin.post('/admin/vehicle-requests').send({ agentId: agent.id, reason: 'MERCHANT_SPECIAL', date: '2026-11-10', price: 80000, notes: 'Big furniture pickup' }), 201);
    expect((await ok(agentA.get('/agent/alerts'))).some((a: any) => a.kind === 'VEHICLE_REQUESTED')).toBe(true);
    await ok(agentA.post(`/agent/vehicle-requests/${req.id}/provide`).send({ vehicleId: van.id, driverName: 'Hassan', driverPhone: '01233344455' }));
    expect((await agentA.post(`/agent/vehicle-requests/${req.id}/provide`).send({ driverName: 'Hassan', driverPhone: '01233344455' })).status).toBe(409);
    await ok(admin.post(`/admin/vehicle-requests/${req.id}/done`));
    const list = await ok(admin.get(`/admin/vehicle-requests?agentId=${agent.id}`));
    expect(list[0].status).toBe('DONE');
    expect(list[0].vehicle.plate).toBe('ABC 123');
  });
});
