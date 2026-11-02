import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

describe('payout file, partners and merchant bank details end to end', () => {
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

  it('lets a merchant set their bank account and finance download the payout file', async () => {
    const finance = await agent('finance@shiplynow.local');
    const merchantUser = await prisma.user.findFirstOrThrow({ where: { role: 'merchant' } });
    const merchant = await agent(merchantUser.email!);
    const bad = await merchant.put('/merchant/finance/bank').send({ iban: 'EG1' }).expect(400);
    expect(JSON.stringify(bad.body)).toContain('invalid_iban');
    await merchant
      .put('/merchant/finance/bank')
      .send({ bankName: 'CIB', bankAccountNumber: '100012345678', beneficiaryName: 'Eve LLC' })
      .expect(200);
    expect((await merchant.get('/merchant/finance/bank').expect(200)).body).toMatchObject({
      bankName: 'CIB',
      beneficiaryName: 'Eve LLC',
    });
    expect((await finance.get('/finance/payouts/bank-file').expect(200)).body).toHaveProperty(
      'ready',
    );
    const file = await finance.get('/finance/payouts/bank-file.csv').expect(200);
    expect(file.text).toContain('Beneficiary name');
    const partners = await finance.get('/finance/partners').expect(200);
    expect(Array.isArray(partners.body)).toBe(true);
    await finance.get('/finance/partners/nobody/x').expect(404);
  });
});
