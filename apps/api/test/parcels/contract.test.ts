// One contract for both services (docs/MERGE.md step 6): a version's next day terms (a fixed
// price per zone and size, a discount, cash collection and return fees) decide what Shiply
// charges a merchant for a parcel; without them the network's list prices and settings apply.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createNetworkApp } from './setup-db';

let app: INestApplication;
let prisma: any;
type Client = ReturnType<typeof request.agent>;
let admin: Client;
let merchant: Client;

const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);

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
  startDate: today,
};

async function login(email: string, password: string) {
  const c = request.agent(app.getHttpServer());
  await c.post('/auth/login').send({ email, password }).expect(200);
  return c;
}

const parcel = (governorateCode: string, size: string, codAmount = 100_00) =>
  merchant
    .post('/parcels/merchant/shipments')
    .send({
      customerName: 'Mona Adel',
      customerPhone: '01012345678',
      address: '12 Some St',
      governorateCode,
      size,
      codAmount,
    })
    .expect(201);

beforeAll(async () => {
  const { PrismaService } = await import('../../src/parcels/common/prisma.service');
  app = await createNetworkApp();
  prisma = app.get(PrismaService);
  admin = await login('admin@shiply.local', 'admin12345');
  merchant = await login('merchant@evechantelle.example', 'demo123456');
});

afterAll(async () => {
  await app?.close();
});

describe('one contract for both services', () => {
  it('prices next day parcels from the contract in force, else the list price', async () => {
    const zone = await prisma.pricingZone.findUnique({ where: { code: 'GC' } });
    const before = await parcel('EG-GZ', 'M');
    expect(before.body.shippingFee).toBe(zone.priceM);

    const mid = (await prisma.merchant.findUnique({ where: { code: 'EVE' } })).id;
    const draft = await admin
      .post(`/admin/merchants/${mid}/contract/versions`)
      .send({
        ...BODY,
        parcelDiscountBp: 1000,
        parcelCodFeeBp: 50,
        parcelReturnFeeBp: 2000,
        parcelPrices: [{ zoneCode: 'GC', size: 'S', pricePiastres: 2_500 }],
      })
      .expect(201);
    // A zone the network does not have is refused.
    await admin
      .put(`/admin/merchants/${mid}/contract/versions/${draft.body.id}`)
      .send({ ...BODY, parcelPrices: [{ zoneCode: 'NOPE', size: 'S', pricePiastres: 1 }] })
      .expect(400);
    const active = await admin
      .post(`/admin/merchants/${mid}/contract/versions/${draft.body.id}/activate`)
      .send({ effectiveFrom: today })
      .expect(201);
    expect(active.body.current.parcels).toMatchObject({
      discountBp: 1000,
      codFeeBp: 50,
      returnFeeBp: 2000,
      prices: [{ zoneCode: 'GC', size: 'S', pricePiastres: 2_500 }],
    });

    // A fixed price replaces the list price and takes no discount.
    expect((await parcel('EG-GZ', 'S')).body.shippingFee).toBe(2_500);
    // Other sizes take the contract's discount on the list price.
    // Cash above the free amount (3,000 EGP by default) pays the contract's share.
    const m = await parcel('EG-GZ', 'M', 5_000_00);
    expect(m.body.shippingFee).toBe(zone.priceM - Math.round((zone.priceM * 1000) / 10000));
    expect(m.body.codFee).toBe(Math.round(((5_000_00 - 3_000_00) * 50) / 10000));

    // An active version never changes.
    await admin
      .put(`/admin/merchants/${mid}/contract/versions/${draft.body.id}`)
      .send({ ...BODY, parcelDiscountBp: 0 })
      .expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
  });

  it('the merchant page shows and saves the next day setup; the facility is the nearest', async () => {
    const mid = (await prisma.merchant.findUnique({ where: { code: 'EVE' } })).id;
    const nd = await admin.get(`/parcels/admin/merchants/${mid}/next-day`).expect(200);
    expect(nd.body).toMatchObject({ code: 'EVE', ready: true, homeHub: { code: 'OBR' } });
    const alx = await admin
      .put(`/parcels/admin/merchants/${mid}/next-day`)
      .send({ code: 'EVE', pickupAddress: '40 Fouad St, Alexandria', governorateCode: 'EG-ALX' })
      .expect(200);
    expect(alx.body.homeHub.code).toBe('ALXSF');
    await admin
      .put(`/parcels/admin/merchants/${mid}/next-day`)
      .send({ code: 'NILE', pickupAddress: '40 Fouad St, Alexandria', governorateCode: 'EG-ALX' })
      .expect(409);
  });
});
