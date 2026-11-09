import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hash } from 'argon2';
import type { INestApplication } from '@nestjs/common';
import { LedgerService } from '../src/money';
import { db, resetDb, signIn, startApp } from './helpers';
import { courier } from './parcel-fixtures';

let app: INestApplication;
let owner: string[];
let second: string[];
let agentId: string;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  const role = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' } });
  await db.user.create({ data: { name: 'Second', nameAr: 'ثاني', email: 'second@test.local', passwordHash: await hash('second-pass-1'), roleId: role.id } });
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  second = await signIn(app, 'second@test.local', 'second-pass-1');
  // the fixture agent pays 20 EGP a delivery and 15 EGP a pickup
  const omar = await courier('omar', '01111111111');
  agentId = (await db.person.findUniqueOrThrow({ where: { userId: omar.id } })).agentId;
  const at = new Date('2026-11-05T12:00:00Z');
  await db.workLog.createMany({
    data: [
      ...[1, 2, 3].map((i) => ({ sourceKey: `delivery:P${i}`, agentId, personUserId: omar.id, kind: 'delivery', companyKey: 'shiply', at })),
      { sourceKey: 'pickup:K1', agentId, personUserId: omar.id, kind: 'pickup', companyKey: 'shiply', at },
      { sourceKey: 'delivery:OLD', agentId, personUserId: omar.id, kind: 'delivery', companyKey: 'shiply', at: new Date('2026-10-01') },
    ],
  });
  // he holds 250 EGP of COD
  const holder = await db.cashHolder.create({ data: { kind: 'courier', refId: omar.id, nameEn: 'Omar', nameAr: 'عمر', companyKey: 'shiply', accountCode: '1201' } });
  await db.$transaction((tx) =>
    app.get(LedgerService).post(tx, { companyKey: 'shiply', date: at, memo: 'cod', sourceType: 'test', sourceId: 'c', sourceKey: 'test:cod', lines: [{ accountCode: '1201', debit: 25000, credit: 0, partyType: 'holder', partyId: holder.id }, { accountCode: '2101', debit: 0, credit: 25000 }] }),
  );
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const post = (url: string, body: object, cookies = owner) => request(app.getHttpServer()).post(url).set('Cookie', cookies).send(body);

describe('settlements', () => {
  it('counts the period work at the agent rates, less the cash his people hold', async () => {
    const s = (await post('/agents/settlements', { agentId, from: '2026-11-01', to: '2026-11-07' })).body;
    expect(s).toMatchObject({ gross: 7500, cashHeld: 25000, net: -17500, status: 'draft' });
    expect(s.lines).toEqual(expect.arrayContaining([expect.objectContaining({ companyKey: 'shiply', kind: 'delivery', count: 3, rate: 2000, amount: 6000 })]));
  });

  it('is approved by a second person and becomes a draft bill when the invoice arrives', async () => {
    const s = (await post('/agents/settlements', { agentId, from: '2026-11-01', to: '2026-11-07' })).body;
    expect((await post(`/agents/settlements/${s.id}/approve`, {})).body.error).toBe('own_settlement');
    expect((await post(`/agents/settlements/${s.id}/approve`, {}, second)).body.status).toBe('approved');
    const billed = (await post(`/agents/settlements/${s.id}/invoice`, { invoiceNumber: 'INV-77' })).body;
    expect(billed.status).toBe('billed');
    expect(await db.bill.findMany()).toEqual([expect.objectContaining({ companyKey: 'shiply', payee: 'Fixture Agent', number: 'INV-77', amount: 7500, accountCode: '5101', status: 'draft' })]);
    expect((await post(`/agents/settlements/${s.id}/invoice`, { invoiceNumber: 'INV-77' })).status).toBe(409);
  });

  it('refuses an overlapping period for the same agent', async () => {
    await post('/agents/settlements', { agentId, from: '2026-11-01', to: '2026-11-07' });
    const again = await post('/agents/settlements', { agentId, from: '2026-11-06', to: '2026-11-13' });
    expect([again.status, again.body.error]).toEqual([409, 'overlapping_period']);
  });
});
