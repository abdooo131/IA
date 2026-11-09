import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { LedgerService } from '../src/money';
import { db, resetDb, startApp } from './helpers';

let app: INestApplication;
let ledger: LedgerService;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  ledger = app.get(LedgerService);
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

const entry = (key: string, companyKey: 'shiply' | 'shiply_now', amount: number, income = '4301') => ({
  companyKey,
  date: new Date('2026-11-09'),
  memo: 'test',
  sourceType: 'test',
  sourceId: key,
  sourceKey: key,
  lines: [
    { accountCode: '1101', debit: amount, credit: 0 },
    { accountCode: income, debit: 0, credit: amount },
  ],
});

describe('ledger', () => {
  it('has the chart', async () => {
    expect(await db.account.findUnique({ where: { code: '2301' } })).toMatchObject({ nameEn: 'VAT payable', type: 'liability' });
    expect(await db.account.findUnique({ where: { code: '2101' } })).toMatchObject({ type: 'liability' });
  });

  it('refuses an entry that does not balance, or a line with both or neither side', async () => {
    const bad = { ...entry('u1', 'shiply', 100), lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4301', debit: 0, credit: 90 }] };
    await expect(db.$transaction((tx) => ledger.post(tx, bad))).rejects.toThrow('unbalanced');
    const both = { ...entry('u2', 'shiply', 100), lines: [{ accountCode: '1101', debit: 100, credit: 100 }] };
    await expect(db.$transaction((tx) => ledger.post(tx, both))).rejects.toThrow('unbalanced');
  });

  it('books the same source once', async () => {
    expect(await db.$transaction((tx) => ledger.post(tx, entry('k1', 'shiply', 100)))).toBeTruthy();
    expect(await db.$transaction((tx) => ledger.post(tx, entry('k1', 'shiply', 100)))).toBeNull();
    expect(await ledger.balance({ accountCode: '1101' })).toBe(100);
  });

  it('reverses an entry back to zero, and the trial balance always sums to zero', async () => {
    const id = (await db.$transaction((tx) => ledger.post(tx, entry('r1', 'shiply', 250))))!;
    await db.$transaction((tx) => ledger.reverse(tx, id, null));
    expect(await ledger.balance({ accountCode: '1101' })).toBe(0);
    const tb = await ledger.trialBalance();
    expect(tb.reduce((s, r) => s + r.debit - r.credit, 0)).toBe(0);
  });

  it('keeps each company in its own profit and loss', async () => {
    await db.$transaction((tx) => ledger.post(tx, entry('p1', 'shiply', 1000, '4301')));
    await db.$transaction((tx) => ledger.post(tx, entry('p2', 'shiply_now', 700, '4101')));
    const shiply = await ledger.profitAndLoss({ companyKey: 'shiply', from: new Date('2026-11-01'), to: new Date('2026-11-30') });
    expect(shiply.income).toBe(1000);
    expect(shiply.lines.map((l) => l.accountCode)).toEqual(['4301']);
    expect((await ledger.profitAndLoss({ from: new Date('2026-11-01'), to: new Date('2026-11-30') })).income).toBe(1700);
  });
});

describe('ledger reports', () => {
  it('serves the journal, trial balance and profit and loss to accounting viewers', async () => {
    await db.$transaction((tx) => ledger.post(tx, entry('rep1', 'shiply', 1000, '4301')));
    await db.$transaction((tx) => ledger.post(tx, entry('rep2', 'shiply_now', 700, '4101')));
    const request = (await import('supertest')).default;
    const { signIn } = await import('./helpers');
    const cookies = await signIn(app, '01012345678', 'viewer-pass-1');
    const get = (u: string) => request(app.getHttpServer()).get(u).set('Cookie', cookies);
    expect((await get('/money/journal?company=shiply')).body.rows).toHaveLength(1);
    expect((await get('/money/trial-balance')).body.reduce((s: number, r: { debit: number; credit: number }) => s + r.debit - r.credit, 0)).toBe(0);
    const pnl = (await get('/money/profit-and-loss?company=shiply&from=2026-11-01&to=2026-11-30')).body;
    expect(pnl).toMatchObject({ income: 1000, net: 1000 });
  });
});
