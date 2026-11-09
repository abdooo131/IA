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
let courier: { id: string };
let safe: { id: string };
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  const role = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' } });
  await db.user.create({ data: { name: 'Second', nameAr: 'ثاني', email: 'second@test.local', passwordHash: await hash('second-pass-1'), roleId: role.id } });
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  second = await signIn(app, 'second@test.local', 'second-pass-1');
  courier = (await post('/money/holders', { kind: 'courier', nameEn: 'Omar', nameAr: 'عمر', companyKey: 'shiply' })).body;
  safe = (await post('/money/holders', { kind: 'hub_safe', nameEn: 'Maadi hub safe', nameAr: 'خزنة مركز المعادي', companyKey: 'shiply' })).body;
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = (url: string, body: object, cookies = owner) => http().post(url).set('Cookie', cookies).send(body);
const holderBalance = (id: string) => app.get(LedgerService).balance({ partyType: 'holder', partyId: id, accountCodes: ['1101', '1201', '1202', '1203', '1204'] });

async function collect(amount: number, key = 'P1') {
  await db.$transaction((tx) =>
    publish(tx, 'cash.collected', { companyKey: 'shiply', holderId: courier.id, merchantId: 'M1', amount, sourceType: 'parcel', sourceId: key }, `cash.collected:${key}`),
  );
  await processDue(db);
}

describe('cash', () => {
  it('books cash collected once, even if the event comes twice', async () => {
    await collect(100000);
    await db.$transaction((tx) => app.get(LedgerService).post(tx, { companyKey: 'shiply', date: new Date(), memo: 'x', sourceType: 'cash.collected', sourceId: 'P1', sourceKey: 'cash.collected:P1', lines: [{ accountCode: '1201', debit: 1, credit: 0 }, { accountCode: '2101', debit: 0, credit: 1 }] }));
    expect(await holderBalance(courier.id)).toBe(100000);
  });

  it('never lets the giver confirm, and confirms once', async () => {
    await collect(100000);
    const h = (await post('/money/handovers', { fromHolderId: courier.id, toHolderId: safe.id, amount: '1000' })).body;
    const own = await post(`/money/handovers/${h.id}/confirm`, { receivedAmount: '1000' });
    expect(own.status).toBe(403);
    expect((await post(`/money/handovers/${h.id}/confirm`, { receivedAmount: '1000' }, second)).status).toBe(200);
    expect((await post(`/money/handovers/${h.id}/confirm`, { receivedAmount: '1000' }, second)).status).toBe(409);
    expect(await holderBalance(safe.id)).toBe(100000);
    expect(await holderBalance(courier.id)).toBe(0);
  });

  it('books a shortage against the giver and shows it on Home', async () => {
    await collect(100000);
    const h = (await post('/money/handovers', { fromHolderId: courier.id, toHolderId: safe.id, amount: '1,000' })).body;
    await post(`/money/handovers/${h.id}/confirm`, { receivedAmount: '٩٥٠' }, second);
    expect(await holderBalance(safe.id)).toBe(95000);
    expect(await holderBalance(courier.id)).toBe(0);
    expect(await app.get(LedgerService).balance({ accountCode: '5301', partyType: 'holder', partyId: courier.id })).toBe(5000);
    const home = (await http().get('/me/home').set('Cookie', owner)).body;
    expect(home.attention).toContainEqual(expect.objectContaining({ app: 'accounting', text: 'home.handoverShort', values: { count: 1 } }));
  });

  it('refuses handing over more than the giver holds', async () => {
    await collect(50000);
    const res = await post('/money/handovers', { fromHolderId: courier.id, toHolderId: safe.id, amount: '600' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('more_than_held');
  });
});
