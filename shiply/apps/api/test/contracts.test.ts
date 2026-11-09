import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hash } from 'argon2';
import type { INestApplication } from '@nestjs/common';
import { MerchantsService } from '../src/merchants';
import { db, resetDb, signIn, startApp } from './helpers';

let app: INestApplication;
let owner: string[];
let second: string[];
let merchantId: string;
let cairoZone: string;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  const role = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' } });
  await db.user.create({ data: { name: 'Second', nameAr: 'ثاني', email: 'second@test.local', passwordHash: await hash('second-pass-1'), roleId: role.id } });
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  second = await signIn(app, 'second@test.local', 'second-pass-1');
  merchantId = (await post('/merchants', { name: 'Eve Chantelle', contactName: 'Mona', contactPhone: '01012345678', services: ['shiply'] })).body.id;
  cairoZone = (await post('/merchants/pricing-zones', { code: 'GC', nameEn: 'Greater Cairo', nameAr: 'القاهرة الكبرى' })).body.id;
  await http().put(`/merchants/pricing-zones/${cairoZone}/areas`).set('Cookie', owner).send({ placeIds: ['cairo', 'giza'] });
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = (url: string, body: object, cookies = owner) => http().post(url).set('Cookie', cookies).send(body);

async function draftWithPrices() {
  const draft = (await post(`/merchants/${merchantId}/contract/drafts`, {})).body;
  await http()
    .patch(`/merchants/contract-versions/${draft.id}`)
    .set('Cookie', owner)
    .send({ codFeeBp: 100, prices: [{ pricingZoneId: cairoZone, size: 'medium', price: 5000 }], tiers: [{ minParcels: 1000, discountBp: 500 }] });
  await post(`/merchants/contract-versions/${draft.id}/submit`, {});
  return draft.id as string;
}

describe('contracts', () => {
  it('never lets the author approve their own version', async () => {
    const id = await draftWithPrices();
    const res = await post(`/merchants/contract-versions/${id}/approve`, {});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('own_version');
  });

  it('activates on a second person approval and keeps the old version as history', async () => {
    const first = await draftWithPrices();
    expect((await post(`/merchants/contract-versions/${first}/approve`, {}, second)).status).toBe(200);
    const next = (await post(`/merchants/${merchantId}/contract/drafts`, {})).body.id;
    await post(`/merchants/contract-versions/${next}/submit`, {});
    await post(`/merchants/contract-versions/${next}/approve`, {}, second);
    const versions = (await http().get(`/merchants/${merchantId}/contract`).set('Cookie', owner)).body.versions;
    expect(versions.map((v: { version: number; status: string }) => `${v.version}:${v.status}`).sort()).toEqual(['1:superseded', '2:active']);
  });

  it('counts only one of two approvals at the same moment', async () => {
    const id = await draftWithPrices();
    const third = await signIn(app, 'owner@test.local', 'owner-pass-1');
    const role = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' } });
    await db.user.create({ data: { name: 'Third', nameAr: 'ثالث', email: 'third@test.local', passwordHash: await hash('third-pass-1'), roleId: role.id } });
    const thirdCookies = await signIn(app, 'third@test.local', 'third-pass-1');
    void third;
    const [a, b] = await Promise.all([post(`/merchants/contract-versions/${id}/approve`, {}, second), post(`/merchants/contract-versions/${id}/approve`, {}, thirdCookies)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('prices a parcel by pricing zone and size, less the volume discount', async () => {
    const id = await draftWithPrices();
    await post(`/merchants/contract-versions/${id}/approve`, {}, second);
    const merchants = app.get(MerchantsService);
    expect(await merchants.parcelPrice(merchantId, { destinationPlaceId: 'new-maadi', size: 'medium', monthParcels: 1200 })).toMatchObject({ price: 4750, discountBp: 500 });
    expect(await merchants.parcelPrice(merchantId, { destinationPlaceId: 'new-maadi', size: 'medium', monthParcels: 10 })).toMatchObject({ price: 5000 });
    expect(await merchants.parcelPrice(merchantId, { destinationPlaceId: 'alexandria', size: 'medium', monthParcels: 10 })).toEqual({ error: 'no_price' });
    expect(await merchants.parcelPrice(merchantId, { destinationPlaceId: 'new-maadi', size: 'heavy_bulky', monthParcels: 10 })).toEqual({ error: 'no_price' });
  });

  it('puts a governorate in one pricing zone only', async () => {
    const delta = (await post('/merchants/pricing-zones', { code: 'DL', nameEn: 'Delta', nameAr: 'الدلتا' })).body.id;
    const res = await http().put(`/merchants/pricing-zones/${delta}/areas`).set('Cookie', owner).send({ placeIds: ['giza'] });
    expect(res.status).toBe(409);
    expect((await http().put(`/merchants/pricing-zones/${delta}/areas`).set('Cookie', owner).send({ placeIds: ['maadi'] })).status).toBe(400);
  });
});
