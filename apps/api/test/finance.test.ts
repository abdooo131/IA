import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');
const NEW_CAIRO = { latitude: 30.03, longitude: 31.47 };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
// Ledger entries carry the real time, so day ranges use the real Cairo day.
const today = cairoDay(new Date());

describe('finance', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ncr: string;
  let merchantId: string;
  const clock = new FixedClock(NOON_CAIRO);

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    clock.set(NOON_CAIRO);
    const seeded = await resetAndSeed(prisma);
    ncr = seeded.stores.get('NCR')!;
    merchantId = (await prisma.merchant.findFirstOrThrow()).id;
  });

  /** A merchant COD order of 2 x EC-001, delivered by the New Cairo rider. */
  async function deliverOrder() {
    const merchant = await agent('merchant@evechantelle.example');
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    const created = await merchant
      .post('/merchant/orders')
      .send({
        customerName: 'Sara Ali',
        customerPhone: '01012345678',
        addressText: 'Villa 12, South 90th St',
        ...NEW_CAIRO,
        paymentMethod: 'cod',
        deliveryFeePiastres: 3000,
        items: [{ skuId: sku.id, quantity: 2 }],
      })
      .expect(201);
    const staff = await agent('staff.newcairo@shiplynow.local');
    const base = `/stores/${ncr}/orders/${created.body.id}`;
    await staff.post(`${base}/accept`).expect(201);
    await staff
      .post(`${base}/pick`)
      .send({ skuId: sku.id, quantity: 2, idempotencyKey: randomUUID() })
      .expect(201);
    const photo = await staff
      .post('/photos?kind=pack')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    await staff.post(`${base}/pack`).send({ photoId: photo.body.id }).expect(201);
    await staff.post(`${base}/handover`).send({ badgeCode: 'RDR-0001' }).expect(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.body.id } });
    const rider = await agent('rider.newcairo@shiplynow.local');
    const deliveries = await rider.get('/rider/deliveries').expect(200);
    await rider
      .post(`/rider/deliveries/${deliveries.body[0].id}/complete`)
      .send({ otp: order.deliveryOtp, codCollectedPiastres: order.codAmountPiastres })
      .expect(201);
    return { order, rider, merchant, staff };
  }

  it('is open to finance users and admins only', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    await admin
      .post('/admin/users')
      .send({
        email: 'fin@shiply.eg',
        name: 'Finance',
        role: 'finance',
        password: 'finance-pass-1',
      })
      .expect(201);
    const finance = await agent('fin@shiply.eg', 'finance-pass-1');
    await finance.get('/finance/overview').expect(200);
    await finance.get('/admin/orders').expect(403);
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get('/finance/overview').expect(403);
    const merchant = await agent('merchant@evechantelle.example');
    await merchant.get('/finance/overview').expect(403);
  });

  it('follows the money from delivery to payout', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    // Merchant specific order fee of 40.00 EGP plus 2%; 14% VAT; 10.00 EGP rider bonus.
    for (const [key, value, scope] of [
      ['fee.order_fixed_piastres', 4000, `merchant:${merchantId}`],
      ['fee.order_percent_bp', 200, 'global'],
      ['fee.vat_bp', 1400, 'global'],
      ['rider.bonus_per_delivery_piastres', 1000, 'global'],
    ] as const)
      await admin.put('/admin/settings').send({ key, value, scope }).expect(200);
    await admin
      .put('/admin/settings')
      .send({ key: 'fee.vat_bp', scope: `merchant:${merchantId}`, value: 0 })
      .expect(400);

    const { order, rider, merchant, staff } = await deliverOrder();
    const cash = order.codAmountPiastres; // 2 x 325.00 + 30.00 = 680.00
    expect(cash).toBe(68000);
    const fee = 4000 + 1300; // 40.00 + 2% of 650.00
    const vat = 742; // 14% of 53.00
    const me = await rider.get('/rider/me').expect(200);
    expect(me.body.wallet).toEqual({ cashPiastres: cash, bonusOwedPiastres: 1000 });

    // The rider hands in 5.00 EGP less than collected.
    const cashScreen = await staff.get(`/stores/${ncr}/cash`).expect(200);
    const riderRow = cashScreen.body.riders.find(
      (r: { badgeCode: string }) => r.badgeCode === 'RDR-0001',
    );
    expect(riderRow.cashPiastres).toBe(cash);
    const handover = await staff
      .post(`/stores/${ncr}/cash/handovers`)
      .send({ riderId: riderRow.id, countedPiastres: cash - 500, idempotencyKey: randomUUID() })
      .expect(201);
    expect(handover.body).toMatchObject({ status: 'pending', differencePiastres: 500 });

    const pending = await admin.get('/finance/handovers?status=pending').expect(200);
    expect(pending.body).toHaveLength(1);
    await admin
      .post(`/finance/handovers/${handover.body.id}/review`)
      .send({ decision: 'write_off', note: 'Recounted, coins missing' })
      .expect(201);
    await admin
      .post('/finance/deposits')
      .send({
        darkStoreId: ncr,
        amountPiastres: cash - 500,
        reference: 'CIB 1234',
        idempotencyKey: randomUUID(),
      })
      .expect(201);

    const overview = await admin.get('/finance/overview').expect(200);
    expect(overview.body.totals).toMatchObject({
      cashWithRidersPiastres: 0,
      cashInStoresPiastres: 0,
      owedToMerchantsPiastres: cash - fee - vat,
      riderBonusOwedPiastres: 1000,
      pendingHandovers: 0,
    });
    expect(overview.body.company).toMatchObject({
      bankPiastres: cash - 500,
      revenuePiastres: fee,
      vatPayablePiastres: vat,
      cashDifferencePiastres: 500,
    });

    const payout = await admin
      .post('/finance/payouts')
      .send({ merchantId, cutoffDay: today })
      .expect(201);
    expect(payout.body.amountPiastres).toBe(cash - fee - vat);
    const wallet = await merchant.get('/merchant/finance').expect(200);
    expect(wallet.body).toMatchObject({
      owedPiastres: cash - fee - vat,
      payoutSchedule: 'weekly',
      payouts: [{ status: 'draft', reference: null }],
    });
    await admin
      .post(`/finance/payouts/${payout.body.id}/paid`)
      .send({ reference: 'TRX-001' })
      .expect(201);
    const after = await merchant.get('/merchant/finance').expect(200);
    expect(after.body).toMatchObject({
      owedPiastres: 0,
      payouts: [{ status: 'paid', reference: 'TRX-001' }],
    });

    const statement = await merchant
      .get(`/merchant/finance/statement?from=${today}&to=${today}`)
      .expect(200);
    expect(statement.body.byKind).toEqual({
      cod_collected: cash,
      order_fee: -(fee + vat),
      merchant_payout: -(cash - fee - vat),
    });
    expect(statement.body.closingOwedPiastres).toBe(0);
    const statementCsv = await merchant
      .get(`/merchant/finance/statement/export.csv?from=${today}&to=${today}`)
      .expect(200);
    expect(statementCsv.text).toContain(
      `order_fee,${order.number},-${((fee + vat) / 100).toFixed(2)}`,
    );

    const tb = await admin.get('/finance/trial-balance').expect(200);
    expect(tb.body.totalDebitPiastres).toBe(tb.body.totalCreditPiastres);
    const journal = await admin
      .get(`/finance/ledger/export.csv?from=${today}&to=${today}`)
      .expect(200);
    expect(journal.text.charCodeAt(0)).toBe(0xfeff);
    expect(journal.text).toContain('merchant_payout');
    const ledger = await admin.get(`/finance/ledger?orderId=${order.id}`).expect(200);
    expect(ledger.body.rows.map((r: { kind: string }) => r.kind).sort()).toEqual([
      'cod_collected',
      'order_fee',
      'rider_bonus',
    ]);
  });

  it('prepares due payouts by schedule and lets finance change a schedule', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    await deliverOrder();
    await admin
      .patch(`/finance/merchants/${merchantId}/payout-schedule`)
      .send({ payoutSchedule: 'daily' })
      .expect(200);
    const due = await admin.post('/finance/payouts/due').send({ cutoffDay: today }).expect(201);
    expect(due.body.created).toEqual([{ merchantId, amountPiastres: 68000 }]);
    const again = await admin.post('/finance/payouts/due').send({ cutoffDay: today }).expect(201);
    expect(again.body.skipped).toContainEqual({ merchantId, reason: 'payout_already_open' });
  });

  it('lets merchants choose their own payout schedule, and only their own', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    await merchant
      .patch('/merchant/finance/payout-schedule')
      .send({ payoutSchedule: 'twice_weekly' })
      .expect(200);
    await merchant
      .patch('/merchant/finance/payout-schedule')
      .send({ payoutSchedule: 'hourly' })
      .expect(400);
    expect((await merchant.get('/merchant/finance').expect(200)).body.payoutSchedule).toBe(
      'twice_weekly',
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'merchant.payout_schedule' },
    });
    expect(audit.after).toEqual({ payoutSchedule: 'twice_weekly' });
    // Staff change it from the finance pages; this address is for merchants only.
    const admin = await agent('admin@test.eg', 'admin-password-1');
    await admin
      .patch('/merchant/finance/payout-schedule')
      .send({ payoutSchedule: 'daily' })
      .expect(403);
  });
});
