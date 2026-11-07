// The packaging shop: purchase orders that add stock and raise the supplier's bill, merchants
// ordering from their panel, stock that never sells twice, delivery with the merchant's code,
// cash or balance payment, and the books: sales, VAT, the cost leaving the stock.
import type { INestApplication } from '@nestjs/common';
import { splitVat } from '@shiply/shared';
import request from 'supertest';
import { createTestDatabase, dropTestDatabase, TEST_DB } from './setup-db';

process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.SHIPLY_JOBS = 'off';

let app: INestApplication;
let prisma: any;
type Client = ReturnType<typeof request.agent>;
const as: Record<string, Client> = {};
const users: Record<string, string> = {};
let merchantId = '';
let supplierId = '';
let fly: any;

async function login(id: string, password = 'demo12345'): Promise<Client> {
  const c = request.agent(app.getHttpServer());
  const res = await c.post('/auth/login').send({ login: id, password });
  if (res.status !== 200) throw new Error(`login ${id}: ${res.status}`);
  return c;
}

async function ok<T = any>(req: request.Test, status = 200): Promise<T> {
  const res = await req;
  if (res.status !== status) throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as T;
}

const balance = async (code: string) => (await ok(as.admin!.get('/finance/reports/trial-balance'))).rows.find((r: any) => r.code === code)?.balance ?? 0;
const merchantBalance = async () => (await ok(as.admin!.get('/finance/wallets/MERCHANT'))).find((m: any) => m.id === merchantId)?.balance ?? 0;
const balanced = async () => expect((await ok(as.admin!.get('/finance/reports/trial-balance'))).balanced).toBe(true);
const stock = async () => (await prisma.packagingProduct.findUnique({ where: { id: fly.id } })).stock;
const codeFor = async (orderId: string) => {
  const o = await prisma.packagingOrder.findUnique({ where: { id: orderId } });
  const m = await prisma.message.findFirst({ where: { template: 'PACKAGING_CODE', body: { contains: o.code } }, orderBy: { createdAt: 'desc' } });
  return m.body.match(/الاستلام (\d{4})/)[1] as string;
};

beforeAll(async () => {
  await createTestDatabase();
  const { createApp } = await import('../src/main');
  const { PrismaService } = await import('../src/common/prisma.service');
  app = await createApp();
  await app.init();
  prisma = app.get(PrismaService);
  as.admin = await login('admin@shiply.local', 'admin12345');
  as.finance = await login('finance@shiply.local');
  as.merchant = await login('merchant@evechantelle.example');
  as.staff = await login('staff.obr@shiply.local');
  as.courier = await login('courier.obr@shiply.local');
  for (const u of await ok(as.admin.get('/admin/users'))) if (u.email) users[u.email] = u.id;
  merchantId = (await ok(as.merchant.get('/auth/me'))).merchantId;
  supplierId = (await prisma.supplier.findFirst({ where: { name: 'Cairo Packaging Co' } })).id;
  fly = (await ok(as.admin.get('/shop/products'))).find((p: any) => p.sku === 'FLY-M');
});

afterAll(async () => {
  await app?.close();
  await dropTestDatabase();
});

describe('packaging shop', () => {
  it('a purchase order adds stock as it arrives, moves the average cost and raises the supplier bill', async () => {
    const po = await ok(as.admin!.post('/shop/purchase-orders').send({ supplierId, lines: [{ productId: fly.id, qty: 50, unitCost: 6000 }] }), 201);
    expect(po.code).toMatch(/^PO/);
    expect(po.net).toBe(300000);
    const line = (await ok(as.admin!.get('/shop/purchase-orders'))).find((p: any) => p.id === po.id).lines[0];
    expect((await as.admin!.post(`/shop/purchase-orders/${po.id}/receive`).send({ lines: [{ lineId: line.id, qty: 30 }] })).status).toBe(409);
    await ok(as.admin!.post(`/shop/purchase-orders/${po.id}/order`));

    const first = await ok(as.admin!.post(`/shop/purchase-orders/${po.id}/receive`).send({ lines: [{ lineId: line.id, qty: 30 }], number: 'INV-77' }));
    expect(first.complete).toBe(false);
    expect(await stock()).toBe(30);
    const bill = (await ok(as.admin!.get('/finance/bills'))).find((b: any) => b.code === first.bill);
    expect(bill.accountCode).toBe('1300');
    expect(bill.net).toBe(180000);
    expect(bill.vat).toBe(25200);
    expect(bill.status).toBe('PENDING_APPROVAL');
    expect((await as.admin!.post(`/shop/purchase-orders/${po.id}/receive`).send({ lines: [{ lineId: line.id, qty: 21 }] })).status).toBe(422);

    // Same person cannot approve; finance does, and the stock lands in the books.
    expect((await as.admin!.post(`/finance/bills/${bill.id}/approve`)).status).toBe(403);
    await ok(as.finance!.post(`/finance/bills/${bill.id}/approve`));
    expect(await balance('1300')).toBe(180000);

    // The rest arrives dearer: the average cost moves.
    await prisma.purchaseOrderLine.update({ where: { id: line.id }, data: { unitCost: 9000 } });
    const second = await ok(as.admin!.post(`/shop/purchase-orders/${po.id}/receive`).send({ lines: [{ lineId: line.id, qty: 20 }], vat: false }));
    expect(second.complete).toBe(true);
    const p = await prisma.packagingProduct.findUnique({ where: { id: fly.id } });
    expect(p.stock).toBe(50);
    expect(p.cost).toBe(Math.round((30 * 6000 + 20 * 9000) / 50));
    expect((await prisma.purchaseOrder.findUnique({ where: { id: po.id } })).status).toBe('RECEIVED');
    const b2 = (await ok(as.admin!.get('/finance/bills'))).find((b: any) => b.code === second.bill);
    await ok(as.finance!.post(`/finance/bills/${b2.id}/approve`));
    await balanced();
  });

  it('the merchant sees the shop, cannot buy more than is on the shelf, and can cancel before packing', async () => {
    const shop = await ok(as.merchant!.get('/merchant/shop'));
    expect(shop.open).toBe(true);
    expect(shop.deliveryFee).toBe(2000);
    const item = shop.items.find((i: any) => i.id === fly.id);
    expect(item.available).toBe(50);
    expect(item.cost).toBeUndefined(); // our cost stays private

    const r = await as.merchant!.post('/merchant/shop/orders').send({ payment: 'CASH', lines: [{ productId: fly.id, qty: 51 }] });
    expect(r.body.error).toBe('out_of_stock');
    expect(await stock()).toBe(50);
    // The balance is empty, so paying from it is refused.
    expect((await as.merchant!.post('/merchant/shop/orders').send({ payment: 'WALLET', lines: [{ productId: fly.id, qty: 1 }] })).body.error).toBe('low_balance');

    const o = await ok(as.merchant!.post('/merchant/shop/orders').send({ payment: 'CASH', lines: [{ productId: fly.id, qty: 4 }] }), 201);
    expect(o.status).toBe('PLACED');
    expect(await stock()).toBe(46);
    await ok(as.merchant!.post(`/merchant/shop/orders/${o.id}/cancel`));
    expect(await stock()).toBe(50);
    expect((await prisma.packagingOrder.findUnique({ where: { id: o.id } })).status).toBe('CANCELLED');
  });

  it('cash order: packed, given to a courier, handed over with the merchant code, booked as a sale', async () => {
    const o = await ok(as.merchant!.post('/merchant/shop/orders').send({ payment: 'CASH', lines: [{ productId: fly.id, qty: 5 }], notes: 'Before noon' }), 201);
    expect(o.total).toBe(5 * 12000 + 2000);
    expect((await ok(as.staff!.get('/shop/orders'))).some((x: any) => x.id === o.id)).toBe(true);
    expect((await as.staff!.post(`/shop/orders/${o.id}/out`).send({ courierId: users['courier.obr@shiply.local'] })).status).toBe(409);
    await ok(as.staff!.post(`/shop/orders/${o.id}/pack`));
    expect((await as.merchant!.post(`/merchant/shop/orders/${o.id}/cancel`)).status).toBe(409);
    await ok(as.staff!.post(`/shop/orders/${o.id}/out`).send({ courierId: users['courier.obr@shiply.local'] }));

    const mine = await ok(as.courier!.get('/courier/packaging'));
    expect(mine.find((x: any) => x.id === o.id).merchant.name).toBe('Eve Chantelle');
    expect((await as.courier!.post(`/courier/packaging/${o.id}/deliver`).send({ code: '0000' })).body.error).toBe('wrong_code');

    const [cash, sales, stockValue] = [await balance('1200'), await balance('4040'), await balance('1300')];
    const res = await ok(as.courier!.post(`/courier/packaging/${o.id}/deliver`).send({ code: await codeFor(o.id) }));
    expect(res.message).toContain('620.00');
    expect(await balance('1200')).toBe(cash + o.total);
    expect(await balance('4040')).toBe(sales + splitVat(60000, 1400).net);
    const cost = (await prisma.packagingOrderLine.findFirst({ where: { orderId: o.id } })).unitCost * 5;
    expect(await balance('1300')).toBe(stockValue - cost);
    expect(await balance('5255')).toBeGreaterThanOrEqual(cost);
    await balanced();
  });

  it('balance order: taken from the merchant balance on delivery; free delivery above the limit', async () => {
    const { post } = await import('../src/finance/ledger');
    await prisma.tx((tx: any) => post(tx, { memo: 'Top up for test', source: 'TEST', key: 'TEST:topup', userId: null as never, lines: [{ account: '1000', debit: 200000 }, { account: '2100', party: { type: 'MERCHANT', id: merchantId }, credit: 200000 }] }));
    await ok(as.admin!.put('/admin/settings/shop.free_delivery_from').send({ value: 100000 }));
    const o = await ok(as.merchant!.post('/merchant/shop/orders').send({ payment: 'WALLET', lines: [{ productId: fly.id, qty: 10 }] }), 201);
    expect(o.deliveryFee).toBe(0);
    await ok(as.staff!.post(`/shop/orders/${o.id}/pack`));
    await ok(as.staff!.post(`/shop/orders/${o.id}/out`).send({ courierId: users['courier.obr@shiply.local'] }));
    const before = await merchantBalance();
    await ok(as.courier!.post(`/courier/packaging/${o.id}/deliver`).send({ code: await codeFor(o.id) }));
    expect(await merchantBalance()).toBe(before - 120000);
    await balanced();
  });

  it('counting the shelf, low stock alerts, and a closed shop', async () => {
    const left = await stock();
    expect((await as.admin!.post(`/shop/products/${fly.id}/adjust`).send({ qty: -2 })).status).toBe(422);
    await ok(as.admin!.post(`/shop/products/${fly.id}/adjust`).send({ qty: -2, note: 'Two packs torn' }));
    expect(await stock()).toBe(left - 2);
    expect((await ok(as.admin!.get(`/shop/products/${fly.id}/moves`)))[0].kind).toBe('ADJUST');
    await balanced();

    await ok(as.admin!.put(`/shop/products/${fly.id}`).send({ sku: 'FLY-M', name: 'Flyer bags, medium', price: 12000, minStock: 100 }));
    await ok(as.admin!.post(`/shop/products/${fly.id}/adjust`).send({ qty: 1, note: 'Found one' }));
    expect(await prisma.alert.count({ where: { kind: 'LOW_STOCK', entityId: fly.id, status: 'OPEN' } })).toBe(1);

    await ok(as.admin!.put('/admin/settings/shop.open').send({ value: 'OFF' }));
    expect((await as.merchant!.post('/merchant/shop/orders').send({ payment: 'CASH', lines: [{ productId: fly.id, qty: 1 }] })).body.error).toBe('closed');
    expect((await as.merchant!.get('/shop/products')).status).toBe(403);
  });
});
