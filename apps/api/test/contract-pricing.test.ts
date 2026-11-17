import type { INestApplication } from '@nestjs/common';
import { allInclusivePrices, cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

let n = 0;
const key = () => `cpx-${++n}-${Date.now()}`;

/** Reads a binary answer (a PDF) as a Buffer. */
const binary = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

const BODY = {
  orderFixedPiastres: null,
  orderPercentBp: null,
  codPercentBp: null,
  failedDeliveryPiastres: null,
  receivingPerUnitPiastres: null,
  storagePerUnitMonthPiastres: null,
  returnPerUnitPiastres: null,
  payoutSchedule: null,
  minimumPayoutPiastres: null,
  promiseMinutes: null,
  deliveryAttempts: null,
  minimumMonthlyFeePiastres: null,
  securityDepositPiastres: null,
  creditLimitPiastres: null,
  storeIds: [],
  noticeDays: 30,
  endDate: null,
  tiers: [],
};

describe('contract pricing end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const agent = async (email: string, password = 'demo-password-1') => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const merchantId = async () =>
    (await prisma.merchant.findFirstOrThrow({ where: { name: { contains: 'Eve' } } })).id;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  it('writes the all inclusive shipping fee and product prices; only merchants manage', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const merchant = await agent('merchant@evechantelle.example');
    const mid = await merchantId();
    const today = cairoDay(new Date());
    const skus = await prisma.sku.findMany({ where: { merchantId: mid }, orderBy: { sku: 'asc' } });
    expect(skus.length).toBeGreaterThan(1);

    const view = await admin.get(`/admin/merchants/${mid}/contract`).expect(200);
    expect(view.body.products.length).toBe(skus.length);
    expect(view.body.standardFailedPercentBp).toBe(10_000);
    expect(view.body.standard).toMatchObject({
      shippingFeePiastres: 0,
      packagingChargePiastres: 0,
    });

    const body = {
      ...BODY,
      ...allInclusivePrices(12_000),
      productPrices: [
        { skuId: skus[0]!.id, pricePiastres: 500 },
        { skuId: skus[1]!.id, pricePiastres: 750 },
      ],
      startDate: today,
    };
    // Accounting reads contracts but never writes them.
    await finance
      .post(`/admin/merchants/${mid}/contract/versions`)
      .send({ ...body, idempotencyKey: key() })
      .expect(403);
    // A product twice, or a product of another merchant, is refused.
    await admin
      .post(`/admin/merchants/${mid}/contract/versions`)
      .send({
        ...body,
        productPrices: [body.productPrices[0], body.productPrices[0]],
        idempotencyKey: key(),
      })
      .expect(400);
    const other = await prisma.merchant.create({ data: { name: 'Other brand' } });
    const foreign = await prisma.sku.create({
      data: { merchantId: other.id, sku: 'OTHER-1', titleEn: 'O', titleAr: 'O', pricePiastres: 1 },
    });
    const refused = await admin
      .post(`/admin/merchants/${mid}/contract/versions`)
      .send({
        ...body,
        productPrices: [{ skuId: foreign.id, pricePiastres: 1 }],
        idempotencyKey: key(),
      })
      .expect(400);
    expect(refused.body.error).toBe('product_not_found');

    const draft = await admin
      .post(`/admin/merchants/${mid}/contract/versions`)
      .send({ ...body, idempotencyKey: key() })
      .expect(201);
    const active = await admin
      .post(`/admin/merchants/${mid}/contract/versions/${draft.body.id}/activate`)
      .send({ effectiveFrom: today })
      .expect(201);
    expect(active.body.current).toMatchObject({
      prices: {
        shippingFeePiastres: 12_000,
        orderFixedPiastres: 0,
        codPercentBp: 0,
        packagingChargePiastres: 0,
        failedDeliveryPiastres: null,
      },
      failedDeliveryPercentBp: 10_000,
    });
    expect(active.body.current.productPrices).toHaveLength(2);

    // The prices file of the version: house CSV rules, readable by Accounting.
    const csv = await finance
      .get(`/admin/merchants/${mid}/contract/versions/${draft.body.id}/product-prices.csv`)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain('sku,price_egp,title_en,title_ar');
    expect(csv.text).toContain(`${skus[0]!.sku},5.00,`);

    // The printed contract shows the product table.
    const pdf = await admin
      .get(`/admin/merchants/${mid}/contract/pdf?lang=ar`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // The merchant reads their prices; they cannot write.
    const mine = await merchant.get('/merchant/contract').expect(200);
    expect(mine.body.current.productPrices).toHaveLength(2);
    await merchant
      .post(`/admin/merchants/${mid}/contract/product-prices/check`)
      .send({ rows: [{ sku: skus[0]!.sku, price_egp: '1' }] })
      .expect(403);
  });

  it('checks a prices file before it goes into the draft', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const mid = await merchantId();
    const skus = await prisma.sku.findMany({ where: { merchantId: mid }, orderBy: { sku: 'asc' } });
    const path = `/admin/merchants/${mid}/contract/product-prices/check`;

    await finance
      .post(path)
      .send({ rows: [{ sku: skus[0]!.sku, price_egp: '1' }] })
      .expect(403);
    await admin.post(path).send({ rows: [] }).expect(400);

    const good = await admin
      .post(path)
      .send({
        rows: [
          { sku: skus[0]!.sku, price_egp: '12.50', title_en: 'ignored' },
          { sku: skus[1]!.sku.toLowerCase(), price_egp: '٣' },
        ],
      })
      .expect(201);
    expect(good.body.errors).toEqual([]);
    expect(good.body.rows.map((r: { pricePiastres: number }) => r.pricePiastres)).toEqual([
      1_250, 300,
    ]);

    const bad = await admin
      .post(path)
      .send({
        rows: [
          { sku: skus[0]!.sku, price_egp: '12.555' },
          { sku: 'NOT-OURS', price_egp: '1' },
          { sku: skus[1]!.sku, price_egp: '1' },
          { sku: skus[1]!.sku, price_egp: '2' },
          { price_egp: '2' },
        ],
      })
      .expect(201);
    expect(bad.body.rows).toEqual([]);
    expect(bad.body.errors.map((e: { row: number; error: string }) => [e.row, e.error])).toEqual([
      [2, 'invalid_price'],
      [3, 'unknown_sku'],
      [5, 'duplicate_sku_in_file'],
      [6, 'sku_required'],
    ]);
  });
});
