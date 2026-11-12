import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { MailMessage } from '@shiplynow/db';
import { cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Mailer } from '../src/email/mailer';
import { JobsService } from '../src/jobs/jobs.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, FixedClock, readyToPay, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');
const NEW_CAIRO = { latitude: 30.03, longitude: 31.47 };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const key = () => randomUUID();

/** Records emails instead of sending them. */
class FakeMailer extends Mailer {
  enabled = true;
  sent: MailMessage[] = [];
  async send(message: MailMessage) {
    this.sent.push(message);
  }
}

describe('emails, packaging and purchase orders', () => {
  const mailer = new FakeMailer();
  // Orders need an open store (noon); money days are real days.
  const clock = new FixedClock(NOON_CAIRO);
  let app: INestApplication;
  let prisma: PrismaService;
  let ncr: string;
  let merchantId: string;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const account = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ mailer, clock }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    mailer.enabled = true;
    mailer.sent = [];
    clock.set(new Date());
    ncr = (await resetAndSeed(prisma)).stores.get('NCR')!;
    merchantId = (await prisma.merchant.findFirstOrThrow()).id;
  });

  it('lets the merchant and finance choose billing emails, and shows the outbox', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const mine = await merchant.get('/merchant/email-settings').expect(200);
    expect(mine.body).toMatchObject({ configured: true, language: 'ar', optOuts: [] });
    await merchant
      .put('/merchant/email-settings')
      .send({ billingEmails: ['not an email'], language: 'en', optOuts: [] })
      .expect(400);
    const saved = await merchant
      .put('/merchant/email-settings')
      .send({ billingEmails: ['Billing@Eve.example'], language: 'en', optOuts: ['invoice'] })
      .expect(200);
    expect(saved.body).toMatchObject({
      billingEmails: ['billing@eve.example'],
      language: 'en',
      optOuts: ['invoice'],
    });
    const finance = await agent('finance@shiplynow.local');
    await finance
      .put(`/finance/merchants/${merchantId}/email-settings`)
      .send({ billingEmails: ['billing@eve.example'], language: 'en', optOuts: [] })
      .expect(200);
    // Merchants never see the outbox; store staff neither.
    await merchant.get('/finance/emails').expect(403);
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get('/finance/emails').expect(403);

    // A paid payout queues its notice and statement; the job sends them once.
    await prisma.$transaction(async (tx) => {
      const { post } = await import('@shiplynow/db');
      await post(tx, {
        kind: 'cod_collected',
        idempotencyKey: key(),
        lines: [
          { account: { type: 'bank' }, amount: 50_000 },
          { account: { type: 'merchant', merchantId }, amount: -50_000 },
        ],
      });
    });
    const payout = await finance
      .post('/finance/payouts')
      .send({ merchantId, cutoffDay: cairoDay(new Date()) })
      .expect(201);
    await readyToPay(prisma, payout.body.id);
    await finance
      .post(`/finance/payouts/${payout.body.id}/paid`)
      .send({ reference: 'TRX-9' })
      .expect(201);
    const outbox = await finance.get('/finance/emails').expect(200);
    expect(outbox.body.configured).toBe(true);
    expect(outbox.body.rows.map((r: { kind: string }) => r.kind).sort()).toEqual([
      'payout_paid',
      'statement',
    ]);
    const jobs = app.get(JobsService);
    expect(await jobs.runEmails()).toMatchObject({ sent: 2 });
    expect(await jobs.runEmails()).toMatchObject({ sent: 0 });
    expect(mailer.sent.map((m) => m.to)).toEqual([
      ['billing@eve.example'],
      ['billing@eve.example'],
    ]);
    const statement = (await finance.get('/finance/emails?status=sent').expect(200)).body.rows.find(
      (r: { kind: string }) => r.kind === 'statement',
    );
    expect(statement.attachments[0]).toMatch(/\.csv$/);
    const preview = await finance.get(`/finance/emails/${statement.id}/preview`).expect(200);
    expect(preview.body.html).toContain('http://localhost:3000/merchant/wallet');
    await finance.post(`/finance/emails/${statement.id}/retry`).expect(409);

    // Without SMTP the screens say so and nothing goes out.
    mailer.enabled = false;
    expect((await finance.get('/finance/emails').expect(200)).body.configured).toBe(false);
  });

  it('keeps packaging stock per store and uses it when an order is packed', async () => {
    clock.set(NOON_CAIRO);
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const staff = await agent('staff.newcairo@shiplynow.local');
    const bag = await admin
      .post('/packaging/items')
      .send({ code: 'bag-m', nameEn: 'Medium bag', nameAr: 'كيس وسط', unitCostPiastres: 150 })
      .expect(201);
    expect(bag.body.code).toBe('BAG-M');
    const box = await admin
      .post('/packaging/items')
      .send({ code: 'BOX-S', nameEn: 'Small box', nameAr: 'علبة صغيرة', isBox: true })
      .expect(201);
    // Store staff do not manage packaging.
    await staff
      .post('/packaging/items')
      .send({ code: 'X1', nameEn: 'x x', nameAr: 'x x' })
      .expect(403);
    const cib = await account('bank');
    await prisma.$transaction(async (tx) => {
      const { post } = await import('@shiplynow/db');
      await post(tx, {
        kind: 'capital_in',
        idempotencyKey: key(),
        lines: [
          { account: { id: cib.id } },
          { account: { id: (await account('equity:capital')).id } },
        ].map((l, i) => ({ ...l, amount: i ? -1_000_000 : 1_000_000 })),
      });
    });
    for (const [itemId, quantity, amount] of [
      [bag.body.id, 50, 7_500],
      [box.body.id, 20, 8_000],
    ] as const)
      await admin
        .post(`/packaging/stores/${ncr}/purchases`)
        .send({
          itemId,
          quantity,
          amountPiastres: amount,
          moneyAccountId: cib.id,
          reference: 'Shop receipt',
          idempotencyKey: key(),
        })
        .expect(201)
        .expect((r) => expect(r.body.status).toBe('posted'));
    await admin
      .put('/packaging/recipes')
      .send({ darkStoreId: ncr, lines: [{ itemId: bag.body.id, quantity: 1 }] })
      .expect(200);
    const boxes = await staff.get(`/stores/${ncr}/packaging/boxes`).expect(200);
    expect(boxes.body).toEqual([expect.objectContaining({ code: 'BOX-S', onHand: 20 })]);

    // An order packed with the small box uses one bag and one box.
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
        items: [{ skuId: sku.id, quantity: 1 }],
      })
      .expect(201);
    const base = `/stores/${ncr}/orders/${created.body.id}`;
    await staff.post(`${base}/accept`).expect(201);
    await staff
      .post(`${base}/pick`)
      .send({ skuId: sku.id, quantity: 1, idempotencyKey: key() })
      .expect(201);
    const photo = await staff
      .post('/photos?kind=pack')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    const packed = await staff
      .post(`${base}/pack`)
      .send({ photoId: photo.body.id, boxItemId: box.body.id })
      .expect(201);
    expect(packed.body).toEqual({ status: 'packed', packagingShort: false });
    const stock = await admin.get(`/packaging/stock?darkStoreId=${ncr}`).expect(200);
    const row = (code: string) =>
      stock.body.rows.find((r: { item: { code: string } }) => r.item.code === code);
    expect(row('BAG-M')).toMatchObject({ onHand: 49, valuePiastres: 7_350 });
    expect(row('BOX-S')).toMatchObject({ onHand: 19, valuePiastres: 7_600 });
    const used = await prisma.ledgerEntry.findFirstOrThrow({ where: { kind: 'packaging_used' } });
    expect(used.orderId).toBe(created.body.id);

    // Counting is store work (inventory use); adjusting needs inventory manage.
    await admin
      .post(`/packaging/stores/${ncr}/count`)
      .send({ itemId: bag.body.id, counted: 48, idempotencyKey: key() })
      .expect(201)
      .expect((r) => expect(r.body).toEqual({ difference: -1 }));
    const movements = await admin.get(`/packaging/movements?darkStoreId=${ncr}`).expect(200);
    expect(movements.body.map((m: { type: string }) => m.type)).toEqual(
      expect.arrayContaining(['receive', 'consume', 'count']),
    );
  });

  it('runs a purchase order from request to closed with a second person', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    await createUser(prisma, {
      email: 'fin2@shiply.eg',
      password: 'finance-pass-2',
      role: 'finance',
    });
    const second = await agent('fin2@shiply.eg', 'finance-pass-2');
    const supplier = await finance
      .post('/finance/suppliers')
      .send({ name: 'Cairo Packaging Co', whtBp: 0 })
      .expect(201);
    const bag = await admin
      .post('/packaging/items')
      .send({ code: 'BAG', nameEn: 'Bag', nameAr: 'كيس' })
      .expect(201);
    const created = await finance
      .post('/finance/purchase-orders')
      .send({
        supplierId: supplier.body.id,
        darkStoreId: ncr,
        lines: [
          {
            packagingItemId: bag.body.id,
            description: 'Bags',
            quantity: 40_000,
            unitPricePiastres: 50,
          },
        ],
        idempotencyKey: key(),
      })
      .expect(201);
    expect(created.body).toMatchObject({ number: 'PO-000001', status: 'requested' });
    const id = created.body.id;
    await finance.post(`/finance/purchase-orders/${id}/decide`).send({ approve: true }).expect(403);
    await second.post(`/finance/purchase-orders/${id}/decide`).send({ approve: true }).expect(201);
    await finance.post(`/finance/purchase-orders/${id}/ordered`).expect(201);
    let detail = (await finance.get(`/finance/purchase-orders/${id}`).expect(200)).body;
    expect(detail.status).toBe('ordered');
    await finance
      .post(`/finance/purchase-orders/${id}/receive`)
      .send({ lines: [{ lineId: detail.lines[0].id, quantity: 40_000 }], idempotencyKey: key() })
      .expect(201);
    await finance
      .post(`/finance/purchase-orders/${id}/bill`)
      .send({
        reference: 'S-1001',
        billDate: cairoDay(new Date()),
        dueDate: cairoDay(new Date()),
        netPiastres: 2_100_000,
        vatPiastres: 0,
        idempotencyKey: key(),
      })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('bill_above_order'));
    const bill = await finance
      .post(`/finance/purchase-orders/${id}/bill`)
      .send({
        reference: 'S-1001',
        billDate: cairoDay(new Date()),
        dueDate: cairoDay(new Date()),
        netPiastres: 2_000_000,
        vatPiastres: 280_000,
        idempotencyKey: key(),
      })
      .expect(201);
    expect(bill.body.number).toBe('BILL-000001');
    detail = (await finance.get(`/finance/purchase-orders/${id}`).expect(200)).body;
    expect(detail).toMatchObject({ status: 'billed', unbilledPiastres: 0 });
    expect(detail.bills).toEqual([expect.objectContaining({ numberLabel: 'BILL-000001' })]);
    await finance.post(`/finance/purchase-orders/${id}/close`).send({ note: 'All in' }).expect(201);
    const history = await admin.get(`/history/purchase_order/${id}`).expect(200);
    expect(history.body.map((h: { action: string }) => h.action)).toEqual(
      expect.arrayContaining(['purchase_order.request', 'purchase_order.approve']),
    );
    const list = await finance.get('/finance/purchase-orders?status=closed').expect(200);
    expect(list.body).toHaveLength(1);
  });
});
