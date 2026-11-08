// The packaging shop: purchase orders that add stock and raise the supplier's bill, merchants
// ordering from their panel, stock that never sells twice, delivery with the merchant's code,
// cash or balance payment, and the books: sales, VAT, the cost leaving the stock.
import type { INestApplication } from '@nestjs/common';
import { splitVat } from '@shiplynow/shared/parcels';
import request from 'supertest';
import { createNetworkApp } from './setup-db';

process.env.SHIPLY_JOBS = 'off';

let app: INestApplication;
let prisma: any;
type Client = ReturnType<typeof request.agent>;
const as: Record<string, Client> = {};
const users: Record<string, string> = {};
let merchantId = '';
let supplierId = '';
let fly: any;

async function login(id: string, password = 'demo123456'): Promise<Client> {
  const c = request.agent(app.getHttpServer());
  const res = await c.post('/auth/login').send({ email: id, password });
  if (res.status !== 200) throw new Error(`login ${id}: ${res.status}`);
  return c;
}

async function ok<T = any>(req: request.Test, status = 200): Promise<T> {
  const res = await req;
  if (res.status !== status)
    throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as T;
}

// Ledger balances by account key (debit positive); income is shown with the sign flipped.
const sumOf = async (account: any) =>
  (await prisma.ledgerLine.aggregate({ _sum: { amountPiastres: true }, where: { account } }))._sum
    .amountPiastres ?? 0;
const balance = async (what: 'stock' | 'sales' | 'cost' | 'courierCash') =>
  what === 'stock'
    ? sumOf({ key: 'packaging_stock' })
    : what === 'sales'
      ? -(await sumOf({ key: 'parcel_packaging_sales' }))
      : what === 'cost'
        ? sumOf({ key: 'parcel_packaging_cost' })
        : sumOf({ key: { startsWith: 'courier_cash:' } });
const billOf = (label: string) =>
  prisma.bill.findUnique({ where: { number: Number(label.slice(5)) } });
const merchantBalance = async () =>
  (await ok(as.admin!.get('/parcels/finance/wallets/MERCHANT'))).find(
    (m: any) => m.id === merchantId,
  )?.balance ?? 0;
const balanced = async () =>
  expect((await ok(as.admin!.get('/parcels/finance/reports/trial-balance'))).balanced).toBe(true);
const stock = async () =>
  (await prisma.packagingProduct.findUnique({ where: { id: fly.id } })).stock;
const codeFor = async (orderId: string) => {
  const o = await prisma.packagingOrder.findUnique({ where: { id: orderId } });
  const m = await prisma.message.findFirst({
    where: { template: 'PACKAGING_CODE', body: { contains: o.code } },
    orderBy: { createdAt: 'desc' },
  });
  return m.body.match(/الاستلام (\d{4})/)[1] as string;
};

beforeAll(async () => {
  const { PrismaService } = await import('../../src/parcels/common/prisma.service');
  app = await createNetworkApp();
  prisma = app.get(PrismaService);
  as.admin = await login('admin@shiply.local', 'admin12345');
  as.finance = await login('finance@shiply.local');
  as.merchant = await login('merchant@evechantelle.example');
  as.staff = await login('staff.obr@shiply.local');
  as.courier = await login('courier.obr@shiply.local');
  for (const u of await ok(as.admin.get('/parcels/admin/users')))
    if (u.email) users[u.email] = u.id;
  merchantId = (await ok(as.merchant.get('/parcels/auth/me'))).merchantId;
  supplierId = (await prisma.supplier.findFirst({ where: { name: 'Cairo Packaging Co' } })).id;
  fly = (await ok(as.admin.get('/parcels/shop/products'))).find((p: any) => p.sku === 'FLY-M');
});

afterAll(async () => {
  await app?.close();
});

describe('packaging shop', () => {
  it('a purchase order adds stock as it arrives, moves the average cost and raises the supplier bill', async () => {
    const po = await ok(
      as
        .admin!.post('/parcels/shop/purchase-orders')
        .send({ supplierId, lines: [{ productId: fly.id, qty: 50, unitCost: 6000 }] }),
      201,
    );
    expect(po.code).toMatch(/^PO/);
    expect(po.net).toBe(300000);
    const line = (await ok(as.admin!.get('/parcels/shop/purchase-orders'))).find(
      (p: any) => p.id === po.id,
    ).lines[0];
    expect(
      (
        await as
          .admin!.post(`/parcels/shop/purchase-orders/${po.id}/receive`)
          .send({ lines: [{ lineId: line.id, qty: 30 }] })
      ).status,
    ).toBe(409);
    await ok(as.admin!.post(`/parcels/shop/purchase-orders/${po.id}/order`));

    const first = await ok(
      as
        .admin!.post(`/parcels/shop/purchase-orders/${po.id}/receive`)
        .send({ lines: [{ lineId: line.id, qty: 30 }], number: 'INV-77' }),
    );
    expect(first.complete).toBe(false);
    expect(await stock()).toBe(30);
    const bill = await billOf(first.bill);
    expect(bill.netPiastres).toBe(180000);
    expect(bill.vatPiastres).toBe(25200);
    expect(bill.supplierId).toBe(supplierId);
    expect(
      (
        await as
          .admin!.post(`/parcels/shop/purchase-orders/${po.id}/receive`)
          .send({ lines: [{ lineId: line.id, qty: 21 }] })
      ).status,
    ).toBe(422);

    // The stock is Shiply's and the bill waits in Accounting; it is never undone by a cancel.
    expect(await balance('stock')).toBe(180000);
    const entry = await prisma.ledgerEntry.findUnique({
      where: { id: bill.entryId },
      include: { lines: true },
    });
    expect(entry.lines.every((l: any) => l.company === 'shiply')).toBe(true);
    const cancel = await as
      .finance!.post(`/finance/bills/${bill.id}/cancel`)
      .send({ reason: 'Trying to undo the goods' });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error).toBe('bill_from_purchase_order');

    // The rest arrives dearer: the average cost moves.
    await prisma.shopPurchaseOrderLine.update({ where: { id: line.id }, data: { unitCost: 9000 } });
    const second = await ok(
      as
        .admin!.post(`/parcels/shop/purchase-orders/${po.id}/receive`)
        .send({ lines: [{ lineId: line.id, qty: 20 }], vat: false }),
    );
    expect(second.complete).toBe(true);
    const p = await prisma.packagingProduct.findUnique({ where: { id: fly.id } });
    expect(p.stock).toBe(50);
    expect(p.cost).toBe(Math.round((30 * 6000 + 20 * 9000) / 50));
    expect((await prisma.shopPurchaseOrder.findUnique({ where: { id: po.id } })).status).toBe(
      'RECEIVED',
    );
    expect((await billOf(second.bill)).vatPiastres).toBe(0);
    expect(await balance('stock')).toBe(180000 + 180000);
    await balanced();
  });

  it('the merchant sees the shop, cannot buy more than is on the shelf, and can cancel before packing', async () => {
    const shop = await ok(as.merchant!.get('/parcels/merchant/shop'));
    expect(shop.open).toBe(true);
    expect(shop.deliveryFee).toBe(2000);
    const item = shop.items.find((i: any) => i.id === fly.id);
    expect(item.available).toBe(50);
    expect(item.cost).toBeUndefined(); // our cost stays private

    const r = await as
      .merchant!.post('/parcels/merchant/shop/orders')
      .send({ payment: 'CASH', lines: [{ productId: fly.id, qty: 51 }] });
    expect(r.body.error).toBe('out_of_stock');
    expect(await stock()).toBe(50);
    // The balance is empty, so paying from it is refused.
    expect(
      (
        await as
          .merchant!.post('/parcels/merchant/shop/orders')
          .send({ payment: 'WALLET', lines: [{ productId: fly.id, qty: 1 }] })
      ).body.error,
    ).toBe('low_balance');

    const o = await ok(
      as
        .merchant!.post('/parcels/merchant/shop/orders')
        .send({ payment: 'CASH', lines: [{ productId: fly.id, qty: 4 }] }),
      201,
    );
    expect(o.status).toBe('PLACED');
    expect(await stock()).toBe(46);
    await ok(as.merchant!.post(`/parcels/merchant/shop/orders/${o.id}/cancel`));
    expect(await stock()).toBe(50);
    expect((await prisma.packagingOrder.findUnique({ where: { id: o.id } })).status).toBe(
      'CANCELLED',
    );
  });

  it('cash order: packed, given to a courier, handed over with the merchant code, booked as a sale', async () => {
    const o = await ok(
      as
        .merchant!.post('/parcels/merchant/shop/orders')
        .send({ payment: 'CASH', lines: [{ productId: fly.id, qty: 5 }], notes: 'Before noon' }),
      201,
    );
    expect(o.total).toBe(5 * 12000 + 2000);
    expect((await ok(as.staff!.get('/parcels/shop/orders'))).some((x: any) => x.id === o.id)).toBe(
      true,
    );
    expect(
      (
        await as
          .staff!.post(`/parcels/shop/orders/${o.id}/out`)
          .send({ courierId: users['courier.obr@shiply.local'] })
      ).status,
    ).toBe(409);
    await ok(as.staff!.post(`/parcels/shop/orders/${o.id}/pack`));
    expect((await as.merchant!.post(`/parcels/merchant/shop/orders/${o.id}/cancel`)).status).toBe(
      409,
    );
    await ok(
      as
        .staff!.post(`/parcels/shop/orders/${o.id}/out`)
        .send({ courierId: users['courier.obr@shiply.local'] }),
    );

    const mine = await ok(as.courier!.get('/parcels/courier/packaging'));
    expect(mine.find((x: any) => x.id === o.id).merchant.name).toBe('Eve Chantelle');
    expect(
      (await as.courier!.post(`/parcels/courier/packaging/${o.id}/deliver`).send({ code: '0000' }))
        .body.error,
    ).toBe('wrong_code');

    const [cash, sales, stockValue] = [
      await balance('courierCash'),
      await balance('sales'),
      await balance('stock'),
    ];
    const res = await ok(
      as
        .courier!.post(`/parcels/courier/packaging/${o.id}/deliver`)
        .send({ code: await codeFor(o.id) }),
    );
    expect(res.message).toContain('620.00');
    expect(await balance('courierCash')).toBe(cash + o.total);
    expect(await balance('sales')).toBe(sales + splitVat(60000, 1400).net);
    const cost =
      (await prisma.packagingOrderLine.findFirst({ where: { orderId: o.id } })).unitCost * 5;
    expect(await balance('stock')).toBe(stockValue - cost);
    expect(await balance('cost')).toBeGreaterThanOrEqual(cost);
    await balanced();
  });

  it('balance order: taken from the merchant balance on delivery; free delivery above the limit', async () => {
    const { post } = await import('../../src/parcels/finance/ledger');
    await prisma.tx((tx: any) =>
      post(tx, {
        memo: 'Top up for test',
        source: 'TEST',
        key: 'TEST:topup',
        userId: null as never,
        lines: [
          { account: '1000', debit: 200000 },
          { account: '2100', party: { type: 'MERCHANT', id: merchantId }, credit: 200000 },
        ],
      }),
    );
    await ok(
      as.admin!.put('/parcels/admin/settings/shop.free_delivery_from').send({ value: 100000 }),
    );
    const o = await ok(
      as
        .merchant!.post('/parcels/merchant/shop/orders')
        .send({ payment: 'WALLET', lines: [{ productId: fly.id, qty: 10 }] }),
      201,
    );
    expect(o.deliveryFee).toBe(0);
    await ok(as.staff!.post(`/parcels/shop/orders/${o.id}/pack`));
    await ok(
      as
        .staff!.post(`/parcels/shop/orders/${o.id}/out`)
        .send({ courierId: users['courier.obr@shiply.local'] }),
    );
    const before = await merchantBalance();
    await ok(
      as
        .courier!.post(`/parcels/courier/packaging/${o.id}/deliver`)
        .send({ code: await codeFor(o.id) }),
    );
    expect(await merchantBalance()).toBe(before - 120000);
    await balanced();
  });

  it('counting the shelf, low stock alerts, and a closed shop', async () => {
    const left = await stock();
    expect(
      (await as.admin!.post(`/parcels/shop/products/${fly.id}/adjust`).send({ qty: -2 })).status,
    ).toBe(422);
    await ok(
      as
        .admin!.post(`/parcels/shop/products/${fly.id}/adjust`)
        .send({ qty: -2, note: 'Two packs torn' }),
    );
    expect(await stock()).toBe(left - 2);
    expect((await ok(as.admin!.get(`/parcels/shop/products/${fly.id}/moves`)))[0].kind).toBe(
      'ADJUST',
    );
    await balanced();

    await ok(
      as
        .admin!.put(`/parcels/shop/products/${fly.id}`)
        .send({ sku: 'FLY-M', name: 'Flyer bags, medium', price: 12000, minStock: 100 }),
    );
    await ok(
      as.admin!.post(`/parcels/shop/products/${fly.id}/adjust`).send({ qty: 1, note: 'Found one' }),
    );
    expect(
      await prisma.networkAlert.count({
        where: { kind: 'LOW_STOCK', entityId: fly.id, status: 'OPEN' },
      }),
    ).toBe(1);

    await ok(as.admin!.put('/parcels/admin/settings/shop.open').send({ value: 'OFF' }));
    expect(
      (
        await as
          .merchant!.post('/parcels/merchant/shop/orders')
          .send({ payment: 'CASH', lines: [{ productId: fly.id, qty: 1 }] })
      ).body.error,
    ).toBe('closed');
    expect((await as.merchant!.get('/parcels/shop/products')).status).toBe(403);
  });
});
