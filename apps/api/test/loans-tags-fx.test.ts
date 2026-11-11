import type { INestApplication } from '@nestjs/common';
import { addDays, cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setSetting } from '@shiplynow/db';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, grantAccess, resetAndSeed } from './helpers';

let n = 0;
const key = () => `ltf-api-${++n}-${Date.now()}`;

describe('loans, cost tags and bank accounts in another currency', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const today = () => cairoDay(new Date());

  const agent = async (email: string, password: string) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const admin = () => agent('admin@test.eg', 'admin-password-1');
  const bank = () => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
  const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
    await setSetting(prisma, { key: 'finance.approve_money_in', value: 0, actorUserId: null });
    await setSetting(prisma, {
      key: 'finance.approval_threshold_piastres',
      value: 0,
      actorUserId: null,
    });
    const a = await admin();
    await a
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: (await bank()).id,
        amountPiastres: 50_000_000,
        reference: 'Owner',
        day: addDays(today(), -60),
        idempotencyKey: key(),
      })
      .expect(201);
  });

  it('records a loan after a second person, shows its schedule and pays the next instalment', async () => {
    await setSetting(prisma, { key: 'finance.approve_money_in', value: 1, actorUserId: null });
    const a = await admin();
    await createUser(prisma, { email: 'fm@test.eg', password: 'finance-pass-1', role: 'finance' });
    const fm = await agent('fm@test.eg', 'finance-pass-1');
    const sent = await a
      .post('/finance/loans')
      .send({
        lender: 'bank',
        lenderName: 'Banque Misr',
        principalPiastres: 600_000,
        moneyAccountId: (await bank()).id,
        startDay: addDays(today(), -35),
        annualRateBp: 0,
        months: 6,
        firstPaymentDay: addDays(today(), -5),
        reference: 'Owner loan',
        idempotencyKey: key(),
      })
      .expect(201);
    expect(sent.body.status).toBe('pending');
    await fm
      .post(`/finance/requests/${sent.body.requestId}/decide`)
      .send({ approve: true })
      .expect(201);
    const list = await a.get('/finance/loans').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ number: 'LN-000001', owedPiastres: 600_000 });
    const id = list.body[0].id as string;
    const detail = await a.get(`/finance/loans/${id}`).expect(200);
    expect(detail.body.instalments).toHaveLength(6);
    expect(detail.body.instalments[0]).toMatchObject({ instalmentPiastres: 100_000 });
    const paid = await a
      .post(`/finance/loans/${id}/pay`)
      .send({ moneyAccountId: (await bank()).id, reference: 'Cash', idempotencyKey: key() })
      .expect(201);
    expect(paid.body).toMatchObject({ status: 'posted' });
    expect(paid.body.number).toMatch(/^JV-/);
    const after = await a.get(`/finance/loans/${id}`).expect(200);
    expect(after.body.owedPiastres).toBe(500_000);
    // The Today strip counts unpaid instalments due within 7 days (overdue included): none now.
    const dash = await a.get('/finance/dashboard').expect(200);
    const item = (dash.body.todayItems as { key: string; count: number }[]).find(
      (i) => i.key === 'loanInstalmentsDue',
    );
    expect(item).toMatchObject({ count: 0 });
    // The balance sheet shows what is still owed under 2700.
    const sheet = await a
      .get(`/finance/reports/balance_sheet?from=${today()}&to=${today()}`)
      .expect(200);
    const liabilities = (
      sheet.body.sections as { key: string; lines: { code: string; amountPiastres: number }[] }[]
    ).find((s) => s.key === 'liabilities')!;
    expect(liabilities.lines.find((l) => l.code === '2701')?.amountPiastres).toBe(500_000);
  });

  it('lets accounting manage open cost tags, tags an expense and reports it', async () => {
    const a = await admin();
    const acc = await createUser(prisma, {
      email: 'acc@test.eg',
      password: 'accountant-pass-1',
      role: 'finance',
    });
    await grantAccess(prisma, acc.id, 'finance_officer');
    const accountant = await agent('acc@test.eg', 'accountant-pass-1');
    await accountant
      .post('/finance/cost-tags')
      .send({ nameEn: 'Ramadan campaign', nameAr: 'حملة رمضان' })
      .expect(403);
    const tag = await a
      .post('/finance/cost-tags')
      .send({ nameEn: 'Ramadan campaign', nameAr: 'حملة رمضان' })
      .expect(201);
    const tags = await accountant.get('/finance/cost-tags?active=true').expect(200);
    expect(tags.body.map((t: { nameEn: string }) => t.nameEn)).toEqual(['Ramadan campaign']);
    const marketing = await byKey('expense:marketing');
    await accountant
      .post('/finance/expenses')
      .send({
        expenseAccountId: marketing.id,
        paidFromAccountId: (await bank()).id,
        amountPiastres: 30_000,
        reference: 'Ads',
        memo: 'Ramadan ads',
        costTagId: tag.body.id,
        idempotencyKey: key(),
      })
      .expect(201);
    const report = await a.get(`/finance/cost-tags/report?compare=previous`).expect(200);
    expect(report.body.rows[0]).toMatchObject({
      nameEn: 'Ramadan campaign',
      costsPiastres: 30_000,
    });
    const lines = await a
      .get(
        `/finance/ledger-lines?set=income_costs&tag=${tag.body.id}&from=${today()}&to=${today()}`,
      )
      .expect(200);
    expect(lines.body.totals.debit).toBe(30_000);
    // Switched off: kept on its lines, refused on new ones.
    await a.patch(`/finance/cost-tags/${tag.body.id}`).send({ isActive: false }).expect(200);
    const refused = await accountant
      .post('/finance/expenses')
      .send({
        expenseAccountId: marketing.id,
        paidFromAccountId: (await bank()).id,
        amountPiastres: 1_000,
        reference: 'Ads',
        memo: 'More ads',
        costTagId: tag.body.id,
        idempotencyKey: key(),
      })
      .expect(409);
    expect(refused.body.error).toBe('cost_tag_inactive');
  });

  it('opens a USD bank, moves money with both amounts, revalues once and refuses EGP only uses', async () => {
    const a = await admin();
    const created = await a
      .post('/finance/accounts')
      .send({
        groupCode: 1100,
        nameEn: 'CIB USD',
        nameAr: 'CIB دولار',
        bankName: 'CIB',
        accountNumber: '777',
        currency: 'USD',
      })
      .expect(201);
    const usd = created.body.id as string;
    const lastMonthDay = addDays(`${today().slice(0, 7)}-01`, -1);
    await a
      .post('/finance/transfers')
      .send({
        fromAccountId: (await bank()).id,
        toAccountId: usd,
        amountPiastres: 4_850_000,
        foreignCents: 100_000,
        reference: 'Buy USD',
        day: lastMonthDay,
        idempotencyKey: key(),
      })
      .expect(201);
    const accounts = await a.get('/finance/accounts').expect(200);
    expect(accounts.body.find((x: { id: string }) => x.id === usd)).toMatchObject({
      currency: 'USD',
      foreignBalanceCents: 100_000,
      balancePiastres: 4_850_000,
    });
    const position = await a.get('/finance/cash-position').expect(200);
    expect(position.body.money.rows.find((x: { id: string }) => x.id === usd)).toMatchObject({
      currency: 'USD',
      foreignBalanceCents: 100_000,
    });
    const month = lastMonthDay.slice(0, 7);
    const reval = await a
      .post(`/finance/accounts/${usd}/revalue`)
      .send({ month, fxRate: '49.5' })
      .expect(201);
    expect(reval.body.differencePiastres).toBe(100_000);
    const again = await a
      .post(`/finance/accounts/${usd}/revalue`)
      .send({ month, fxRate: '49.5' })
      .expect(409);
    expect(again.body.error).toBe('already_revalued');
    const banks = await a.get('/finance/foreign-banks').expect(200);
    expect(banks.body[0]).toMatchObject({
      currency: 'USD',
      lastMonthRevalued: true,
      balancePiastres: 4_950_000,
    });
    // An expense cannot be paid from it.
    const refused = await a
      .post('/finance/expenses')
      .send({
        expenseAccountId: (await byKey('expense:other')).id,
        paidFromAccountId: usd,
        amountPiastres: 1_000,
        reference: 'x1',
        memo: 'Something',
        idempotencyKey: key(),
      })
      .expect(409);
    expect(refused.body.error).toBe('foreign_currency_account');
  });
});
