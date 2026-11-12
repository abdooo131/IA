import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

describe('tax returns end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const agent = async (email: string, password = 'demo-password-1') => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  it('serves the worksheets and their lists, and books company tax for approvers only', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    expect((await finance.get('/finance/tax-returns/vat').expect(200)).body).toHaveProperty(
      'duePiastres',
    );
    expect((await finance.get('/finance/tax-returns/withholding').expect(200)).body).toEqual([]);
    const list = await finance.get('/finance/tax-returns/withholding.csv').expect(200);
    expect(list.text).toContain('Tax registration number');
    const tax = await finance.get('/finance/tax-returns/payroll.csv?kind=insurance').expect(200);
    expect(tax.text).toContain('Insurance number');
    expect((await finance.get('/finance/tax-returns/corporate').expect(200)).body).toHaveProperty(
      'rateBp',
      2250,
    );
    expect((await finance.get('/finance/comparative-statements').expect(200)).body).toHaveProperty(
      'previous',
    );
    const me = await prisma.user.findUniqueOrThrow({ where: { email: 'finance@shiplynow.local' } });
    await admin.patch(`/admin/users/${me.id}`).send({ financeLevel: 'prepare' }).expect(200);
    await finance
      .post('/finance/tax-returns/corporate')
      .send({ year: 2025, amountPiastres: 0 })
      .expect(403);
  });
});
