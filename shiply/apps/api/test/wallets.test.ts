import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { publish } from '../src/platform';
import { processDue } from '../src/platform/events';
import { db, resetDb, signIn, startApp } from './helpers';

let app: INestApplication;
let owner: string[];
let merchantId: string;
let holderId: string;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  merchantId = (await db.merchant.create({ data: { code: 'EVE', name: 'Eve Chantelle', contactName: 'Mona', contactPhone: '+201012345678', services: ['shiply_now'], status: 'approved' } })).id;
  holderId = (await db.cashHolder.create({ data: { kind: 'rider', nameEn: 'Ali', nameAr: 'علي', companyKey: 'shiply_now', accountCode: '1201' } })).id;
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const event = async (type: string, payload: object, key: string) => {
  await db.$transaction((tx) => publish(tx, type, payload, key));
  await processDue(db);
};

async function orderDelivered() {
  await event('cash.collected', { companyKey: 'shiply_now', holderId, merchantId, amount: 50000, sourceType: 'order', sourceId: 'O1' }, 'cc:O1');
  await event('fee.charged', { companyKey: 'shiply_now', merchantId, kind: 'delivery', amount: 4000, sourceType: 'order', sourceId: 'O1' }, 'fee:O1');
}

describe('merchant wallets', () => {
  it('owes the merchant the cash collected less our fee and its VAT', async () => {
    await orderDelivered();
    const wallets = (await http().get('/money/wallets').set('Cookie', owner)).body.rows;
    expect(wallets).toEqual([expect.objectContaining({ merchantId, name: 'Eve Chantelle', collected: 50000, fees: 4000, vat: 560, available: 45440 })]);
  });

  it('books a fee once even when its event comes twice', async () => {
    await orderDelivered();
    await db.$transaction((tx) => publish(tx, 'fee.charged', { companyKey: 'shiply_now', merchantId, kind: 'delivery', amount: 4000, sourceType: 'order', sourceId: 'O1' }, 'fee:O1:again'));
    await processDue(db);
    const statement = (await http().get(`/money/wallets/${merchantId}/statement`).set('Cookie', owner)).body;
    expect(statement.balance).toBe(45440);
    expect(statement.lines.map((l: { amount: number }) => l.amount)).toEqual([50000, -4000, -560]);
    expect(statement.lines.at(-1).running).toBe(45440);
  });
});
