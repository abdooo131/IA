import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, cairoDay } from '@shiplynow/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
let n = 0;
const key = () => `api-books-${++n}-${Math.random()}`;

describe('company books', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // Money entries are dated with the real time, so the clock follows it.
  const clock = new FixedClock(new Date());
  const today = cairoDay(new Date());
  const monthStart = addDays(today, -20);
  let finance: ReturnType<typeof request.agent>;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const account = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    clock.set(new Date());
    await resetAndSeed(prisma);
    finance = await agent('finance@shiplynow.local');
  });

  it('opens a bank account with the next code and runs a month of money through it', async () => {
    const chart = await finance.get('/finance/accounts').expect(200);
    expect(chart.body[0]).toMatchObject({ code: '1101', nameEn: 'CIB', locked: true, money: true });

    const nbe = await finance
      .post('/finance/accounts')
      .send({
        groupCode: 1100,
        nameEn: 'NBE current',
        nameAr: 'الأهلي جاري',
        bankName: 'NBE',
        accountNumber: '100200300',
        iban: 'EG38 0019 0005 0000 0000 2631 8000 2',
      })
      .expect(201);
    expect(nbe.body.code).toBe('1102');
    const cib = await account('bank');

    const capital = await finance
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: cib.id,
        amountPiastres: 1_000_000,
        reference: 'Opening capital',
        idempotencyKey: key(),
      })
      .expect(201);
    expect(capital.body.number).toBe('JV-000001');

    await finance
      .post('/finance/transfers')
      .send({
        fromAccountId: cib.id,
        toAccountId: nbe.body.id,
        amountPiastres: 300_000,
        reference: 'Fund NBE',
        idempotencyKey: key(),
      })
      .expect(201);
    const rent = await account('expense:rent');
    const expense = await finance
      .post('/finance/expenses')
      .send({
        expenseAccountId: rent.id,
        paidFromAccountId: nbe.body.id,
        amountPiastres: 114_000,
        vatPiastres: 14_000,
        reference: 'INV-88',
        memo: 'January rent',
        idempotencyKey: key(),
      })
      .expect(201);
    expect(expense.body.number).toBe('JV-000003');

    const statement = await finance
      .get(`/finance/accounts/${nbe.body.id}/statement?from=${monthStart}&to=${today}`)
      .expect(200);
    expect(statement.body).toMatchObject({ openingPiastres: 0, closingPiastres: 186_000 });
    expect(statement.body.lines.map((l: { number: string }) => l.number)).toEqual([
      'JV-000002',
      'JV-000003',
    ]);
    const csv = await finance
      .get(`/finance/accounts/${nbe.body.id}/statement.csv?from=${monthStart}&to=${today}`)
      .expect(200);
    expect(csv.text).toContain('JV-000003,expense,INV-88');

    const pl = await finance
      .get(`/finance/profit-and-loss?from=${monthStart}&to=${today}`)
      .expect(200);
    expect(pl.body.totalExpensesPiastres).toBe(100_000);
    const sheet = await finance.get(`/finance/balance-sheet?day=${today}`).expect(200);
    expect(sheet.body.totalAssetsPiastres).toBe(
      sheet.body.totalLiabilitiesPiastres + sheet.body.totalEquityPiastres,
    );
    const trial = await finance.get('/finance/trial-balance').expect(200);
    expect(trial.body.totalDebitPiastres).toBe(trial.body.totalCreditPiastres);
    const journal = await finance.get('/finance/ledger').expect(200);
    expect(journal.body.rows[0]).toMatchObject({ number: 'JV-000003', kind: 'expense' });
  });

  it('refuses bad input with clear codes', async () => {
    const cib = await account('bank');
    const box = (await finance.get('/finance/money-accounts').expect(200)).body.find(
      (a: { groupCode: number }) => a.groupCode === 1200,
    );
    const post = (path: string, body: object) => finance.post(path).send(body);

    // Invalid IBAN, missing bank number, a group that is opened by the system.
    expect(
      (
        await post('/finance/accounts', {
          groupCode: 1100,
          nameEn: 'QNB',
          nameAr: 'QNB',
          bankName: 'QNB',
          accountNumber: '1',
          iban: 'EG12',
        }).expect(400)
      ).body.error,
    ).toBe('validation_failed');
    await post('/finance/accounts', { groupCode: 1100, nameEn: 'QNB', nameAr: 'QNB' }).expect(400);
    await post('/finance/accounts', { groupCode: 2100, nameEn: 'Merchant X', nameAr: 'X' }).expect(
      400,
    );

    // Spending money that is not there.
    const empty = await post('/finance/transfers', {
      fromAccountId: cib.id,
      toAccountId: box?.id ?? cib.id,
      amountPiastres: 100,
      reference: 'test',
      idempotencyKey: key(),
    });
    expect(empty.status).toBeGreaterThanOrEqual(400);
    // Future dates, fractions of a piastre and unbalanced journals.
    const rent = await account('expense:rent');
    expect(
      (
        await post('/finance/expenses', {
          expenseAccountId: rent.id,
          paidFromAccountId: cib.id,
          amountPiastres: 100,
          reference: 'x1',
          memo: 'future bill',
          day: addDays(today, 2),
          idempotencyKey: key(),
        }).expect(400)
      ).body.error,
    ).toBe('future_date');
    await post('/finance/capital', {
      direction: 'in',
      moneyAccountId: cib.id,
      amountPiastres: 10.5,
      reference: 'x1',
      idempotencyKey: key(),
    }).expect(400);
    const other = await account('expense:other');
    expect(
      (
        await post('/finance/journal-entries', {
          lines: [
            { accountId: rent.id, debitPiastres: 10, creditPiastres: 0 },
            { accountId: other.id, debitPiastres: 0, creditPiastres: 9 },
          ],
          reason: 'should fail',
          idempotencyKey: key(),
        }).expect(400)
      ).body.error,
    ).toBe('not_balanced');
    await finance.get('/finance/balance-sheet?day=yesterday').expect(400);
    await finance.get('/finance/accounts/nope/statement').expect(404);
  });

  it('is closed to everyone but finance and admin', async () => {
    for (const email of [
      'merchant@evechantelle.example',
      'staff.newcairo@shiplynow.local',
      'rider.newcairo@shiplynow.local',
    ]) {
      const other = await agent(email);
      await other.get('/finance/accounts').expect(403);
      await other.post('/finance/expenses').send({}).expect(403);
    }
    await request(app.getHttpServer()).get('/finance/accounts').expect(401);
  });
});
