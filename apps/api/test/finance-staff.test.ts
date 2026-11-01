import type { INestApplication } from '@nestjs/common';
import { addDays, cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
let n = 0;
const key = () => `fst-${++n}-${Date.now()}`;

describe('employees and outsourced staff end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const account = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  it('pays employees with taxes, and outsourced people only through their company', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const cib = await account('bank');
    const capital = await finance
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: cib.id,
        amountPiastres: 5_000_000,
        reference: 'Owner',
        idempotencyKey: key(),
      })
      .expect(201);
    await admin
      .post(`/finance/requests/${capital.body.requestId}/decide`)
      .send({ approve: true })
      .expect(201);
    const staff = await prisma.user.findFirstOrThrow({ where: { role: 'store_staff' } });
    const rider = await prisma.user.findFirstOrThrow({ where: { role: 'rider' } });
    const agency = await finance
      .post('/finance/suppliers')
      .send({ name: 'Delta Staffing', whtBp: 300 })
      .expect(201);

    // Only admin decides who is outsourced.
    await finance
      .put(`/finance/employment/${rider.id}`)
      .send({ employment: 'outsourced', staffingSupplierId: agency.body.id })
      .expect(403);
    await admin
      .put(`/finance/employment/${rider.id}`)
      .send({ employment: 'outsourced', staffingSupplierId: agency.body.id })
      .expect(200);
    await admin
      .put(`/finance/salaries/${staff.id}`)
      .send({ monthlyPiastres: 800_000, insuredWagePiastres: 600_000 })
      .expect(200);
    const team = await finance.get('/finance/staff-pay').expect(200);
    expect(team.body.find((p: { userId: string }) => p.userId === rider.id)).toMatchObject({
      employment: 'outsourced',
      staffingSupplier: { name: 'Delta Staffing' },
    });

    const month = addDays(cairoDay(new Date()), -35).slice(0, 7);
    const run = await finance
      .post('/finance/payroll')
      .send({ month, moneyAccountId: cib.id, lines: [{ userId: staff.id }] })
      .expect(201);
    expect(run.body.status).toBe('posted');
    const slips = await finance.get(`/finance/payslips?month=${month}`).expect(200);
    expect(slips.body.people[0]).toMatchObject({ gross: 800_000, siEmployee: 66_000 });
    const taxes = await finance.get('/finance/taxes').expect(200);
    expect(taxes.body.socialInsurancePiastres).toBe(66_000 + 112_500);

    const bonus = await finance
      .post('/finance/staff-bonuses')
      .send({
        userId: rider.id,
        amountPiastres: 10_000,
        moneyAccountId: cib.id,
        reference: 'Best rider',
        idempotencyKey: key(),
      })
      .expect(201);
    expect(bonus.body.status).toBe('posted');
    const refused = await finance
      .post('/finance/staff-bonuses')
      .send({
        userId: staff.id,
        amountPiastres: 10_000,
        moneyAccountId: cib.id,
        reference: 'Bonus',
        idempotencyKey: key(),
      })
      .expect(409);
    expect(refused.body.error).toBe('employee_bonus_in_payroll');
  });
});
