// Shiply's people are in HR (docs/MERGE.md step 6): hub staff and couriers get an employee file
// at their hub; couriers are paid per delivery; people who come through an agent are outsourced
// to that agent, which is a supplier in Accounting.
import type { INestApplication } from '@nestjs/common';
import { createNetworkApp } from './setup-db';

let app: INestApplication;
let prisma: any;

beforeAll(async () => {
  const { PrismaService } = await import('../../src/parcels/common/prisma.service');
  app = await createNetworkApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
});

const fileOf = (email: string) =>
  prisma.employee.findFirst({
    where: { user: { email } },
    include: { department: true, staffingSupplier: { include: { agent: true } }, hub: true },
  });

describe('Shiply people in HR', () => {
  it('opens files for hub staff and couriers, outsourced to their agent', async () => {
    const staff = await fileOf('staff.obr@shiply.local');
    expect(staff.hub.code).toBe('OBR');
    expect(staff.department.code).toBe('SHP-HUB');
    expect(staff.employment).toBe('employee');
    expect(staff.payBasis).toBe('monthly_salary');

    const courier = await fileOf('courier.giz@shiply.local');
    expect(courier.hub.code).toBe('GIZ');
    expect(courier.department.code).toBe('SHP-CUR');
    expect(courier.payBasis).toBe('per_delivery');
    expect(courier.employment).toBe('outsourced');
    expect(courier.staffingSupplier.agent.code).toBe('AGDELTA');

    // Agents are suppliers, not people: no file.
    expect(await fileOf('agent@deltariders.example')).toBeNull();
  });

  it('a courier who asks to join gets a file only once the agent approves', async () => {
    const request = (await import('supertest')).default;
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/auth/login')
      .send({ email: 'agent@deltariders.example', password: 'demo123456' })
      .expect(200);
    const agentId = (await agent.get('/parcels/auth/me').expect(200)).body.agentId;
    const giz = await prisma.hub.findUnique({ where: { code: 'GIZ' } });
    const made = await agent
      .post(`/parcels/agent/staff`)
      .send({
        name: 'Waiting Courier',
        phone: '01090001999',
        password: 'courier-pass-1',
        courierType: 'DELIVERY',
        workDays: [0, 1, 2, 3, 4],
        shiftStart: '09:00',
        areaIds: [],
      })
      .expect(201);
    expect(await prisma.employee.findUnique({ where: { userId: made.body.id } })).toBeNull();
    await agent
      .put(`/parcels/agent/staff/${made.body.id}`)
      .send({
        name: 'Waiting Courier',
        phone: '01090001999',
        courierType: 'DELIVERY',
        workDays: [0, 1, 2, 3, 4],
        shiftStart: '09:00',
        hubId: giz.id,
        areaIds: [],
      })
      .expect(200);
    const file = await prisma.employee.findUnique({
      where: { userId: made.body.id },
      include: { staffingSupplier: { include: { agent: true } } },
    });
    expect(file.hubId).toBe(giz.id);
    expect(file.staffingSupplier.agent.id).toBe(agentId);
  });
});
