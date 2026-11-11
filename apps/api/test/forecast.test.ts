import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, FixedClock, grantAccess, resetAndSeed } from './helpers';

// Forecast (Accounting > Planning): view reads, use edits drafts, manage approves and
// writes an approved scenario into the budgets.

const clock = new FixedClock(new Date('2026-11-15T10:00:00Z'));

describe('forecast API', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const agent = async (email: string, password: string) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const person = async (email: string, role: 'accountant' | 'finance_officer') => {
    const u = await createUser(prisma, { email, password: 'pass-word-123', role: 'finance' });
    await grantAccess(prisma, u.id, role);
    return agent(email, 'pass-word-123');
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  it('lets use edit, view read, and only manage approve and make the budget', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const viewer = await person('viewer@test.eg', 'accountant');
    const officer = await person('officer@test.eg', 'finance_officer');

    await viewer.post('/finance/forecasts').send({ name: 'Expected' }).expect(403);
    const created = await officer.post('/finance/forecasts').send({ name: 'Expected' }).expect(201);
    const id = created.body.id as string;

    const detail = await viewer.get(`/finance/forecasts/${id}`).expect(200);
    expect(detail.body.forecast).toMatchObject({ number: 'FC-000001', status: 'draft' });
    expect(detail.body.months).toHaveLength(12);
    expect(detail.body.months[0]).toBe('2026-11');
    for (const m of detail.body.result.months)
      expect(m.balanceSheet.totalAssets).toBe(
        m.balanceSheet.totalLiabilities + m.balanceSheet.totalEquity,
      );

    await officer
      .put(`/finance/forecasts/${id}/drivers`)
      .send({ changes: [{ month: '2026-11', key: 'orders', value: 1.5 }] })
      .expect(400);
    await officer
      .put(`/finance/forecasts/${id}/drivers`)
      .send({
        changes: [
          { month: '2026-11', key: 'orders', value: 300 },
          { month: '2026-11', key: 'fee:order_fee', value: 2_500 },
          { month: '2026-11', key: 'rent', value: 400_000 },
        ],
      })
      .expect(200);
    await officer
      .put(`/finance/forecasts/${id}/overrides`)
      .send({
        changes: [{ month: '2026-12', lineKey: 'rent', amountPiastres: 0, note: 'Rent free' }],
      })
      .expect(200);
    const after = await viewer.get(`/finance/forecasts/${id}`).expect(200);
    expect(after.body.result.months[0].lines['fee:order_fee']).toBe(750_000);
    expect(after.body.result.months[1].edited).toContain('rent');

    const copy = await officer
      .post('/finance/forecasts')
      .send({ name: 'Worst case', copyFromId: id })
      .expect(201);
    const compared = await viewer
      .get(`/finance/forecasts/compare?ids=${id},${copy.body.id}`)
      .expect(200);
    expect(compared.body).toHaveLength(2);
    expect(compared.body[1].months[0].profit).toBe(compared.body[0].months[0].profit);
    expect((await viewer.get('/finance/forecasts').expect(200)).body).toHaveLength(2);

    await officer.post(`/finance/forecasts/${id}/approve`).expect(403);
    await officer.post(`/finance/forecasts/${id}/to-budget`).send({ mode: 'skip' }).expect(403);
    await admin.post(`/finance/forecasts/${id}/to-budget`).send({ mode: 'skip' }).expect(409);
    await admin.post(`/finance/forecasts/${id}/approve`).expect(201);
    await officer
      .put(`/finance/forecasts/${id}/drivers`)
      .send({ changes: [{ month: '2026-11', key: 'rent', value: 1 }] })
      .expect(409);

    const preview = await viewer.get(`/finance/forecasts/${id}/budget-preview`).expect(200);
    expect(preview.body.existing).toBe(0);
    const made = await admin
      .post(`/finance/forecasts/${id}/to-budget`)
      .send({ mode: 'replace' })
      .expect(201);
    expect(made.body.written).toBeGreaterThan(0);
    const fees = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'revenue' } });
    const budget = await prisma.budget.findFirstOrThrow({
      where: { month: '2026-11', accountId: fees.id, darkStoreId: null },
    });
    expect(budget.amountPiastres).toBe(750_000);
    const again = await viewer.get(`/finance/forecasts/${id}/budget-preview`).expect(200);
    expect(again.body.existing).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { action: 'finance.forecast_to_budget' } })).toBe(
      1,
    );

    await officer.delete(`/finance/forecasts/${copy.body.id}`).expect(200);
    await officer.delete(`/finance/forecasts/${id}`).expect(409);
  });
});
