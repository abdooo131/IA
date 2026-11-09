import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { db, resetDb, signIn, startApp } from './helpers';

let app: INestApplication;
let owner: string[];
let merchantId: string;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  merchantId = (await post('/merchants', { name: 'Eve Chantelle', contactName: 'Mona', contactPhone: '01012345678', services: ['shiply_now'] })).body.id;
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = (url: string, body: object) => http().post(url).set('Cookie', owner).send(body);

describe('products', () => {
  it('keeps one SKU whatever its case or spaces, and stores the price in piastres', async () => {
    const a = await post(`/merchants/${merchantId}/products`, { sku: ' eve-01 ', nameEn: 'Lipstick', nameAr: 'أحمر شفاه', price: '12.50' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ sku: 'EVE-01', price: 1250 });
    const b = await post(`/merchants/${merchantId}/products`, { sku: 'EVE-01', nameEn: 'Copy', nameAr: 'نسخة', price: '1' });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('sku_taken');
  });

  it('imports a file and reports the rows it refused', async () => {
    const csv = 'sku,barcode,name_en,name_ar,price,weight_grams\nA1,,Cream,كريم,45.00,200\nA2,,Soap,صابون,abc,100\nA3,123,Oil,زيت,30,250';
    const res = await post(`/merchants/${merchantId}/products/import`, { csv });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 2, updated: 0 });
    expect(res.body.refused).toEqual([{ row: 3, reason: 'price' }]);
  });

  it('records a Shopify shop once', async () => {
    expect((await post(`/merchants/${merchantId}/shopify`, { domain: 'Eve-Shop.myshopify.com' })).body.domain).toBe('eve-shop.myshopify.com');
    expect((await post(`/merchants/${merchantId}/shopify`, { domain: 'eve-shop.myshopify.com' })).status).toBe(409);
  });
});
