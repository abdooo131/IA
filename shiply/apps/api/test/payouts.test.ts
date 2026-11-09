import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hash } from 'argon2';
import type { INestApplication } from '@nestjs/common';
import { LedgerService, WalletsService } from '../src/money';
import { publish } from '../src/platform';
import { processDue } from '../src/platform/events';
import { db, resetDb, signIn, startApp } from './helpers';

let app: INestApplication;
let owner: string[];
let second: string[];
let third: string[];
let merchantId: string;
let bankId: string;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  const role = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' } });
  for (const n of ['second', 'third']) await db.user.create({ data: { name: n, nameAr: n, email: `${n}@test.local`, passwordHash: await hash(`${n}-pass-1`), roleId: role.id } });
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  second = await signIn(app, 'second@test.local', 'second-pass-1');
  third = await signIn(app, 'third@test.local', 'third-pass-1');
  merchantId = (await db.merchant.create({ data: { code: 'EVE', name: 'Eve', contactName: 'Mona', contactPhone: '+201012345678', services: ['shiply_now'], status: 'approved' } })).id;
  const rider = (await db.cashHolder.create({ data: { kind: 'rider', nameEn: 'Ali', nameAr: 'علي', companyKey: 'shiply_now', accountCode: '1201' } })).id;
  bankId = (await db.cashHolder.create({ data: { kind: 'bank', nameEn: 'CIB', nameAr: 'البنك', companyKey: 'shiply_now', accountCode: '1101' } })).id;
  await db.$transaction((tx) => publish(tx, 'cash.collected', { companyKey: 'shiply_now', holderId: rider, merchantId, amount: 50000, sourceType: 'order', sourceId: 'O1' }, 'cc:O1'));
  await db.$transaction((tx) => publish(tx, 'fee.charged', { companyKey: 'shiply_now', merchantId, kind: 'delivery', amount: 4000, sourceType: 'order', sourceId: 'O1' }, 'fee:O1'));
  await processDue(db);
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = (url: string, body: object, cookies = owner) => http().post(url).set('Cookie', cookies).send(body);

describe('payouts', () => {
  it('needs a second person, and never the preparer', async () => {
    const p = (await post('/money/payouts', { merchantId, amount: '100' })).body;
    expect((await post(`/money/payouts/${p.id}/approve`, {})).status).toBe(403);
    expect((await post(`/money/payouts/${p.id}/approve`, {}, second)).status).toBe(200);
  });

  it('never pays out more than the balance, even when two are approved at once', async () => {
    const a = (await post('/money/payouts', { merchantId, amount: '300' })).body;
    const b = (await post('/money/payouts', { merchantId, amount: '300' })).body;
    const [x, y] = await Promise.all([post(`/money/payouts/${a.id}/approve`, {}, second), post(`/money/payouts/${b.id}/approve`, {}, third)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect([x.body.error, y.body.error]).toContain('over_balance');
  });

  it('lowers the balance when paid', async () => {
    const p = (await post('/money/payouts', { merchantId, amount: '400' })).body;
    await post(`/money/payouts/${p.id}/approve`, {}, second);
    expect((await post(`/money/payouts/${p.id}/paid`, { reference: 'TRX-1', fromHolderId: bankId })).status).toBe(200);
    expect(await app.get(WalletsService).available(merchantId)).toBe(5440);
  });
});

describe('bills and expenses', () => {
  it('books a bill on approval and clears it when paid', async () => {
    const bill = (await post('/money/bills', { companyKey: 'shiply_now', payee: 'Landlord', number: 'R-11', date: '2026-11-01', dueDate: '2026-11-10', amount: '10,000', vat: '0', accountCode: '5401' })).body;
    expect((await post(`/money/bills/${bill.id}/approve`, {})).status).toBe(403);
    expect((await post(`/money/bills/${bill.id}/approve`, {}, second)).status).toBe(200);
    const ledger = app.get(LedgerService);
    expect(await ledger.balance({ accountCode: '2201' })).toBe(-1000000);
    expect((await post(`/money/bills/${bill.id}/pay`, { fromHolderId: bankId })).status).toBe(200);
    expect(await ledger.balance({ accountCode: '2201' })).toBe(0);
    expect(await ledger.balance({ accountCode: '5401' })).toBe(1000000);
  });

  it('refuses an expense booked to an income account', async () => {
    const res = await post('/money/expenses', { companyKey: 'shiply_now', date: '2026-11-09', accountCode: '4101', amount: '50', fromHolderId: bankId, note: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('not_an_expense_account');
  });

  it('shows approvals waiting on Home', async () => {
    await post('/money/payouts', { merchantId, amount: '100' });
    const home = (await http().get('/me/home').set('Cookie', second)).body;
    expect(home.attention).toContainEqual(expect.objectContaining({ app: 'accounting', text: 'home.approvalsWaiting', values: { count: 1 } }));
  });
});
