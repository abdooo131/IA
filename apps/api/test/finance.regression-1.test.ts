// Regression: ISSUE-001 — a statement for an unknown merchant answered 500
// Regression: ISSUE-002 — an impossible day (30 February) was accepted as 2 March
// Found by /qa on 2026-10-28
// Report: docs/QA_REPORT.md
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

describe('finance input regressions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let finance: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
    finance = request.agent(app.getHttpServer());
    await finance
      .post('/auth/login')
      .send({ email: 'finance@shiplynow.local', password: 'demo-password-1' })
      .expect(200);
  });

  it('answers 404 for the statement of a merchant that does not exist', async () => {
    const res = await finance.get('/finance/statements/no-such-merchant').expect(404);
    expect(res.body.error).toBe('merchant_not_found');
    await finance.get('/finance/statements/no-such-merchant/export.csv').expect(404);
  });

  it('refuses days that do not exist, in bodies and in filters', async () => {
    const cib = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
    const res = await finance
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: cib.id,
        amountPiastres: 5,
        reference: 'qa date',
        day: '2026-02-30',
        idempotencyKey: 'regression-feb-30',
      })
      .expect(400);
    expect(res.body.error).toBe('validation_failed');
    expect(await prisma.ledgerEntry.count()).toBe(0);
    await finance.get('/finance/ledger?from=2026-02-30').expect(400);
    await finance.get('/finance/balance-sheet?day=2026-13-01').expect(400);
  });
});
