import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hash } from 'argon2';
import type { INestApplication } from '@nestjs/common';
import { LedgerService } from '../src/money';
import { publish } from '../src/platform';
import { processDue } from '../src/platform/events';
import { db, resetDb, signIn, startApp } from './helpers';

let app: INestApplication;
let owner: string[];
let second: string[];
let courier: string;
let safe: string;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  const role = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' } });
  await db.user.create({ data: { name: 'Second', nameAr: 'ثاني', email: 'second@test.local', passwordHash: await hash('second-pass-1'), roleId: role.id } });
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  second = await signIn(app, 'second@test.local', 'second-pass-1');
  courier = (await db.cashHolder.create({ data: { kind: 'courier', nameEn: 'Omar', nameAr: 'عمر', companyKey: 'shiply', accountCode: '1201' } })).id;
  safe = (await db.cashHolder.create({ data: { kind: 'hub_safe', nameEn: 'Safe', nameAr: 'خزنة', companyKey: 'shiply', accountCode: '1203' } })).id;
  await db.$transaction((tx) => publish(tx, 'cash.collected', { companyKey: 'shiply', holderId: courier, merchantId: 'M1', amount: 100000, sourceType: 'parcel', sourceId: 'P1' }, 'cc:P1'));
  await processDue(db);
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const post = (url: string, body: object, cookies = owner) => request(app.getHttpServer()).post(url).set('Cookie', cookies).send(body);
const held = (id: string) => app.get(LedgerService).balance({ partyType: 'holder', partyId: id, accountCodes: ['1101', '1201', '1202', '1203', '1204'] });

describe('money review fixes', () => {
  it('confirms a handover where nothing arrived, booking it all as a shortage', async () => {
    const h = (await post('/money/handovers', { fromHolderId: courier, toHolderId: safe, amount: '1000' })).body;
    expect((await post(`/money/handovers/${h.id}/confirm`, { receivedAmount: '0' }, second)).status).toBe(200);
    expect(await held(courier)).toBe(0);
    expect(await app.get(LedgerService).balance({ accountCode: '5301' })).toBe(100000);
  });

  it('never lets two handovers at once pass what the giver holds', async () => {
    const [a, b] = await Promise.all([
      post('/money/handovers', { fromHolderId: courier, toHolderId: safe, amount: '1000' }),
      post('/money/handovers', { fromHolderId: courier, toHolderId: safe, amount: '1000' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
  });

  it('refuses paying an expense from a cash holder with more than it holds', async () => {
    const res = await post('/money/expenses', { companyKey: 'shiply', date: '2026-11-09', accountCode: '5401', amount: '2000', fromHolderId: courier, note: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('more_than_held');
  });

  it('refuses negative VAT and huge amounts with the field named', async () => {
    const neg = await post('/money/bills', { companyKey: 'shiply', payee: 'A', number: '1', date: '2026-11-01', dueDate: '2026-11-10', amount: '10', vat: '-5', accountCode: '5401' });
    expect(neg.status).toBe(400);
    expect(JSON.stringify(neg.body)).toContain('vat');
    const huge = await post('/money/bills', { companyKey: 'shiply', payee: 'A', number: '1', date: '2026-11-01', dueDate: '2026-11-10', amount: '999,999,999', accountCode: '5401' });
    expect(huge.status).toBe(400);
  });

  it('cancels a draft bill', async () => {
    const bill = (await post('/money/bills', { companyKey: 'shiply', payee: 'A', number: '1', date: '2026-11-01', dueDate: '2026-11-10', amount: '10', accountCode: '5401' })).body;
    expect((await post(`/money/bills/${bill.id}/cancel`, {})).status).toBe(200);
    expect((await post(`/money/bills/${bill.id}/approve`, {}, second)).status).toBe(409);
  });

  it('does not book cash collected into a holder of the other company', async () => {
    await db.$transaction((tx) => publish(tx, 'cash.collected', { companyKey: 'shiply_now', holderId: courier, merchantId: 'M1', amount: 5000, sourceType: 'parcel', sourceId: 'P2' }, 'cc:P2'));
    await processDue(db);
    expect(await held(courier)).toBe(100000);
  });

  it('a duplicate booked at the same moment returns null instead of failing', async () => {
    const e = { companyKey: 'shiply' as const, date: new Date(), memo: 'x', sourceType: 't', sourceId: 'd', sourceKey: 'dup:1', lines: [{ accountCode: '1101', debit: 1, credit: 0 }, { accountCode: '4301', debit: 0, credit: 1 }] };
    const ledger = app.get(LedgerService);
    const results = await Promise.all([db.$transaction((tx) => ledger.post(tx, e)), db.$transaction((tx) => ledger.post(tx, e))]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
  });
});
