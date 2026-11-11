import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const PASSWORD = 'team-password-1';

describe('budgets by quarter', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: ReturnType<typeof request.agent>;
  let stores: Map<string, string>;

  const agent = async (email: string, password: string) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const member = async (email: string, jobRole: string) => {
    await admin
      .post('/admin/users')
      .send({ email, name: email, role: 'finance', jobRole, password: PASSWORD })
      .expect(201);
    return agent(email, PASSWORD);
  };
  const account = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    ({ stores } = await resetAndSeed(prisma));
    admin = await agent('admin@test.eg', 'admin-password-1');
  });

  it('reads with accounting view, writes with accounting use', async () => {
    const viewer = await member('budget.view@test.eg', 'accountant');
    const writer = await member('budget.use@test.eg', 'finance_officer');
    const rent = await account('expense:rent');
    const storeId = [...stores.values()][0]!;

    const quarter = { year: 2027, quarter: 1, accountId: rent.id, darkStoreId: storeId };
    expect(
      (
        await viewer
          .put('/finance/budgets/quarter')
          .send({ ...quarter, amountPiastres: 100 })
          .expect(403)
      ).body.error,
    ).toBe('no_access');
    const set = await writer
      .put('/finance/budgets/quarter')
      .send({ ...quarter, amountPiastres: 100 })
      .expect(200);
    expect(set.body.months.map((m: { amountPiastres: number }) => m.amountPiastres)).toEqual([
      33, 33, 34,
    ]);
    // A month changed by hand through the month route; the quarter follows.
    await writer
      .put('/finance/budgets')
      .send({ month: '2027-02', accountId: rent.id, darkStoreId: storeId, amountPiastres: 50 })
      .expect(200);

    const year = await viewer.get(`/finance/budgets/year?year=2027&scope=${storeId}`).expect(200);
    const row = year.body.rows.find((r: { accountId: string }) => r.accountId === rent.id);
    expect(row.quarters[0]).toMatchObject({ budgetPiastres: 117, edited: true });
    expect(row.year.budgetPiastres).toBe(117);
    const fees = await viewer.get('/finance/budgets/year?year=2027&group=4100').expect(200);
    expect(fees.body.rows.every((r: { groupCode: number }) => r.groupCode === 4100)).toBe(true);
    await viewer.get('/finance/budgets/year?year=2027&scope=company').expect(200);
    await viewer.get('/finance/budgets/year?year=2027&scope=nope').expect(404);

    const copy = { fromYear: 2027, toYear: 2028, scope: storeId, percentBp: 1_000 };
    await viewer.post('/finance/budgets/copy').send(copy).expect(403);
    const copied = await writer.post('/finance/budgets/copy').send(copy).expect(201);
    expect(copied.body).toMatchObject({ copied: 3, replaced: 0 });
    expect((await writer.post('/finance/budgets/copy').send(copy).expect(409)).body.error).toBe(
      'budget_year_not_empty',
    );
    await writer
      .post('/finance/budgets/copy')
      .send({ ...copy, replace: true })
      .expect(201);
    const next = await viewer.get(`/finance/budgets/year?year=2028&scope=${storeId}`).expect(200);
    expect(
      next.body.rows.find((r: { accountId: string }) => r.accountId === rent.id).year
        .budgetPiastres,
    ).toBe(36 + 55 + 37);
    await writer.post('/finance/budgets/copy').send({ fromYear: 2027, toYear: 2027 }).expect(400);
  });

  it('refuses people without accounting', async () => {
    const ops = await agent('staff.newcairo@shiplynow.local', 'demo-password-1');
    await ops.get('/finance/budgets/year').expect(403);
  });
});
