import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const key = () => randomUUID();

describe('suppliers apart from bills, and purchase orders for assets', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ncr: string;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const balance = async (k: string) => {
    const account = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
    const sum = await prisma.ledgerLine.aggregate({
      where: { accountId: account.id },
      _sum: { amountPiastres: true },
    });
    return sum._sum.amountPiastres ?? 0;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    ncr = (await resetAndSeed(prisma)).stores.get('NCR')!;
  });

  it('lists suppliers with their balance, opens a supplier page and edits it', async () => {
    const finance = await agent('finance@shiplynow.local');
    const made = await finance
      .post('/finance/suppliers')
      .send({ name: 'Nile Office Supplies', taxId: '123-456-789', whtBp: 100 })
      .expect(201);
    await finance.post('/finance/suppliers').send({ name: 'No Tax Co' }).expect(201);
    const other = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'expense:other' } });
    await finance
      .post('/finance/bills')
      .send({
        supplierId: made.body.id,
        reference: 'NOS-1',
        billDate: cairoDay(new Date()),
        dueDate: cairoDay(new Date()),
        expenseAccountId: other.id,
        netPiastres: 100_000,
        vatPiastres: 14_000,
        idempotencyKey: key(),
      })
      .expect(201);

    const all = await finance.get('/finance/lists/suppliers?f=').expect(200);
    expect(all.body.total).toBe(2);
    const owing = await finance.get('/finance/lists/suppliers?f=we_owe_them').expect(200);
    expect(owing.body.rows).toEqual([
      expect.objectContaining({
        name: 'Nile Office Supplies',
        kind: 'supplier',
        status: 'active',
        openBills: 1,
        balance: 114_000,
      }),
    ]);
    expect(owing.body.totals.balance).toBe(114_000);
    const noTax = await finance.get('/finance/lists/suppliers?f=no_tax_number').expect(200);
    expect(noTax.body.rows.map((r: { name: string }) => r.name)).toEqual(['No Tax Co']);
    const searched = await finance.get('/finance/lists/suppliers?q=nile&f=').expect(200);
    expect(searched.body.total).toBe(1);

    const doc = await finance.get(`/finance/documents/supplier/${made.body.id}`).expect(200);
    expect(doc.body).toMatchObject({ type: 'supplier', title: 'Nile Office Supplies' });
    expect(doc.body.smart.map((s: { key: string }) => s.key)).toEqual([
      'bills',
      'payments',
      'purchaseOrders',
      'supplierBalance',
    ]);
    expect(doc.body.fields).toEqual(
      expect.arrayContaining([{ key: 'weOwe', value: 114_000, kind: 'money' }]),
    );

    // The chatter works on a supplier like on other accounting records.
    await finance
      .post(`/records/supplier/${made.body.id}/notes`)
      .send({ body: 'Calls on Sundays' })
      .expect(201);
    await finance
      .patch(`/finance/suppliers/${made.body.id}`)
      .send({ phone: '0225550000', isActive: false })
      .expect(200);
    const inactive = await finance.get('/finance/lists/suppliers?f=inactive').expect(200);
    expect(inactive.body.rows).toEqual([expect.objectContaining({ phone: '0225550000' })]);

    // Store staff and merchants never see suppliers.
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get('/finance/lists/suppliers').expect(403);
    await staff.get(`/finance/documents/supplier/${made.body.id}`).expect(403);
  });

  it('buys a laptop through a purchase order: receiving opens the asset, the bill clears 2401', async () => {
    const finance = await agent('finance@shiplynow.local');
    const supplier = await finance
      .post('/finance/suppliers')
      .send({ name: 'Cairo Computers', whtBp: 0 })
      .expect(201);
    // An asset line names its life, not an expense, and a store that exists.
    await finance
      .post('/finance/purchase-orders')
      .send({
        supplierId: supplier.body.id,
        lines: [
          {
            assetLifeMonths: 36,
            expenseAccountId: supplier.body.id,
            description: 'Laptop',
            quantity: 1,
            unitPricePiastres: 100_000,
          },
        ],
        idempotencyKey: key(),
      })
      .expect(400);
    const created = await finance
      .post('/finance/purchase-orders')
      .send({
        supplierId: supplier.body.id,
        lines: [
          {
            assetLifeMonths: 24,
            assetDarkStoreId: ncr,
            description: 'Laptop for the store',
            quantity: 1,
            unitPricePiastres: 480_000,
          },
        ],
        idempotencyKey: key(),
      })
      .expect(201);
    expect(created.body.status).toBe('approved'); // below the approval limit
    const id = created.body.id;
    await finance.post(`/finance/purchase-orders/${id}/ordered`).expect(201);
    let detail = (await finance.get(`/finance/purchase-orders/${id}`).expect(200)).body;
    expect(detail.lines[0]).toMatchObject({
      kind: 'asset',
      assetLifeMonths: 24,
      assetDarkStore: expect.objectContaining({ id: ncr }),
      fixedAssets: [],
    });
    await finance
      .post(`/finance/purchase-orders/${id}/receive`)
      .send({ lines: [{ lineId: detail.lines[0].id, quantity: 1 }], idempotencyKey: key() })
      .expect(201);
    detail = (await finance.get(`/finance/purchase-orders/${id}`).expect(200)).body;
    expect(detail.status).toBe('received');
    expect(detail.lines[0].fixedAssets).toHaveLength(1);
    expect(await balance('fixed_assets')).toBe(480_000);
    expect(await balance('goods_received')).toBe(-480_000);
    const register = await finance.get('/finance/assets').expect(200);
    expect(register.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Laptop for the store',
          costPiastres: 480_000,
          lifeMonths: 24,
          monthlyPiastres: 20_000,
        }),
      ]),
    );
    await finance
      .post(`/finance/purchase-orders/${id}/bill`)
      .send({
        reference: 'CC-77',
        billDate: cairoDay(new Date()),
        dueDate: cairoDay(new Date()),
        netPiastres: 480_000,
        vatPiastres: 67_200,
        idempotencyKey: key(),
      })
      .expect(201);
    expect(await balance('goods_received')).toBe(0);
    expect((await finance.get(`/finance/purchase-orders/${id}`).expect(200)).body.status).toBe(
      'billed',
    );
    // The supplier's page counts the order.
    const doc = await finance.get(`/finance/documents/supplier/${supplier.body.id}`).expect(200);
    expect(doc.body.smart).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'purchaseOrders', count: 1 })]),
    );
  });
});
