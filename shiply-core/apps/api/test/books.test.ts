// The rest of the books: VAT out of every fee, tax invoices and credit notes with the ETA file,
// supplier bills with withholding tax, the bank statement matched to the books, cash flow,
// profit, budgets, cash limits and agent advances.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestDatabase, dropTestDatabase, TEST_DB } from './setup-db';

process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.SHIPLY_JOBS = 'off';

let app: INestApplication;
let prisma: any;
type Client = ReturnType<typeof request.agent>;
const as: Record<string, Client> = {};
const hubs: Record<string, string> = {};
const users: Record<string, string> = {};
const parcels: any[] = [];
let merchantId = '';
const net = (gross: number) => Math.round((gross * 10000) / 11400);

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

function lastMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

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
  as.giz = await login('staff.giz@shiply.local');
  as.courierGiz = await login('courier.giz@shiply.local');
  as.delta = await login('agent@deltariders.example');
  for (const h of await ok(as.admin.get('/admin/hubs'))) hubs[h.code] = h.id;
  for (const u of await ok(as.admin.get('/admin/users'))) if (u.email) users[u.email] = u.id;
  merchantId = (await ok(as.merchant.get('/auth/me'))).merchantId;

  // Two parcels delivered in Giza, cash handed in at the hub.
  const locs = await ok(as.merchant.get('/reference/locations'));
  const dokki = locs.find((g: any) => g.code === 'GIZ').areas.find((a: any) => a.nameEn === 'Dokki');
  for (const cod of [50000, 30000]) {
    parcels.push(await ok(as.merchant.post('/merchant/shipments').send({ customerName: 'Mona', customerPhone: '01012345678', address: '5 Tahrir St', governorateCode: 'GIZ', areaId: dokki.id, codAmount: cod }), 201));
  }
  await prisma.shipment.updateMany({ where: { id: { in: parcels.map((p) => p.id) } }, data: { status: 'AT_HUB', currentHubId: hubs.GIZ } });
  const run = await ok(as.giz.post(`/hubs/${hubs.GIZ}/runs`).send({ courierId: users['courier.giz@shiply.local'] }), 201);
  for (const p of parcels) await ok(as.giz.post(`/hubs/${hubs.GIZ}/runs/${run.id}/add`).send({ code: p.trackingNumber }));
  await ok(as.giz.post(`/hubs/${hubs.GIZ}/runs/${run.id}/start`));
  for (const item of (await ok(as.courierGiz.get('/courier/run'))).items) await ok(as.courierGiz.post(`/courier/stops/${item.id}/deliver`).send({ codCollected: item.shipment.codAmount }));
  await ok(as.giz.post(`/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 80000 }));
});

afterAll(async () => {
  await app?.close();
  await dropTestDatabase();
});

describe('books', () => {
  it('fees include 14% VAT: revenue is booked before VAT, the VAT owed apart', async () => {
    const pnl = await ok(as.admin.get('/finance/reports/profit-and-loss'));
    const shipping = parcels.reduce((n, p) => n + net(p.shippingFee), 0);
    expect(pnl.income.find((r: any) => r.code === '4000').balance).toBe(shipping);
    const vat = await ok(as.admin.get('/finance/reports/vat'));
    const fees = parcels.reduce((n, p) => n + p.shippingFee + p.codFee, 0);
    expect(vat.outputVat).toBe(fees - parcels.reduce((n, p) => n + net(p.shippingFee) + net(p.codFee), 0));
    expect((await ok(as.admin.get('/finance/reports/trial-balance'))).balanced).toBe(true);
  });

  it('monthly tax invoices, credit notes with approval, and the ETA file', async () => {
    const month = lastMonth();
    await prisma.shipment.updateMany({ where: { id: { in: parcels.map((p) => p.id) } }, data: { deliveredAt: new Date(`${month}-15T10:00:00Z`) } });
    expect((await as.admin.post('/finance/invoices/issue').send({ month: new Date().toISOString().slice(0, 7) })).status).toBe(422);
    const r = await ok(as.admin.post('/finance/invoices/issue').send({ month }));
    expect(r.made).toHaveLength(1);
    expect((await ok(as.admin.post('/finance/invoices/issue').send({ month }))).made).toHaveLength(0); // never twice
    const inv = (await ok(as.admin.get(`/finance/invoices?month=${month}`)))[0];
    expect(inv.total).toBe(parcels.reduce((n, p) => n + p.shippingFee + p.codFee, 0));
    expect(inv.net + inv.vat).toBe(inv.total);
    // The merchant sees it too.
    expect((await ok(as.merchant.get(`/merchant/invoices/${inv.id}`))).number).toBe(inv.number);

    expect((await as.admin.post('/finance/credit-notes').send({ invoiceId: inv.id, amount: inv.total + 1, reason: 'Too much back' })).status).toBe(422);
    const cn = await ok(as.admin.post('/finance/credit-notes').send({ invoiceId: inv.id, amount: 1140, reason: 'Late delivery refund' }), 201);
    expect(cn.vat).toBe(140);
    expect((await as.admin.post(`/finance/credit-notes/${cn.id}/approve`)).status).toBe(403);
    const before = (await ok(as.admin.get('/finance/wallets/MERCHANT'))).find((m: any) => m.id === merchantId).balance;
    await ok(as.finance.post(`/finance/credit-notes/${cn.id}/approve`));
    const after = (await ok(as.admin.get('/finance/wallets/MERCHANT'))).find((m: any) => m.id === merchantId).balance;
    expect(after - before).toBe(1140);

    const eta = await ok(as.admin.get(`/finance/invoices/${inv.id}/eta`));
    const doc = eta.documents[0];
    expect(doc.documentType).toBe('I');
    expect(doc.internalID).toBe(inv.number);
    expect(doc.totalAmount).toBe(inv.total / 100);
    expect(doc.taxTotals[0].amount).toBe(inv.vat / 100);
    expect((await ok(as.admin.get(`/finance/invoices/${inv.id}`))).etaStatus).toBe('EXPORTED');
  });

  it('supplier bills: input VAT, withholding tax, approval, payment', async () => {
    const sup = await ok(as.admin.post('/finance/suppliers').send({ name: 'Wataniya Fuel', taxId: '123456789' }), 201);
    const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
    expect((await as.admin.post('/finance/bills').send({ supplierId: sup.id, date: today, dueDate: today, accountCode: '5240', net: 100000, vat: 14000, whtBp: 200 })).status).toBe(422);
    const bill = await ok(as.admin.post('/finance/bills').send({ supplierId: sup.id, number: 'F-881', date: today, dueDate: today, accountCode: '5240', net: 100000, vat: 14000, whtBp: 100 }), 201);
    expect(bill.wht).toBe(1000);
    expect(bill.payable).toBe(113000);
    expect((await as.admin.post(`/finance/bills/${bill.id}/paid`)).status).toBe(409);
    expect((await as.admin.post(`/finance/bills/${bill.id}/approve`)).status).toBe(403);
    await ok(as.finance.post(`/finance/bills/${bill.id}/approve`));
    expect((await ok(as.admin.get('/finance/suppliers')))[0].owed).toBe(113000);
    await ok(as.admin.post(`/finance/bills/${bill.id}/paid`).send({ reference: 'TRX 77' }));
    expect((await ok(as.admin.get('/finance/suppliers')))[0].owed).toBe(0);
    const vat = await ok(as.admin.get('/finance/reports/vat'));
    expect(vat.inputVat).toBe(14000);
    expect(vat.withholding).toBe(1000);
    expect((await as.admin.post('/finance/tax/vat-payment').send({ month: new Date().toISOString().slice(0, 7) })).status).toBe(422);
  });

  it('the bank statement is matched to the books; a bank charge is booked from it', async () => {
    const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
    const [y, m, d] = today.split('-');
    const csv = `Date,Description,Debit,Credit,Reference\n${d}/${m}/${y},"Transfer TRX 77","1,130.00",,TRX 77\n${d}/${m}/${y},Monthly account fee,25.00,,\n,,,,`;
    const r = await ok(as.admin.post('/finance/bank/import').send({ fileName: 'cib.csv', csv }), 201);
    expect(r.rows).toBe(2);
    expect(r.matched).toBe(1);
    const rec = await ok(as.admin.get('/finance/bank'));
    const fee = rec.lines.find((l: any) => l.amount === -2500);
    expect(fee.matched).toBeNull();
    await ok(as.admin.post(`/finance/bank/${fee.id}/book`).send({ accountCode: '5260', note: 'CIB fee' }));
    const again = await ok(as.admin.get('/finance/bank'));
    expect(again.lines.every((l: any) => l.matched)).toBe(true);
    expect((await as.admin.post('/finance/bank/import').send({ fileName: 'x.csv', csv: 'foo,bar\n1,2' })).status).toBe(422);
  });

  it('cash flow adds up to the cash we hold; profit per merchant; budgets', async () => {
    const cf = await ok(as.admin.get('/finance/reports/cash-flow'));
    const bs = await ok(as.admin.get('/finance/reports/balance-sheet'));
    const cash = bs.assets.filter((a: any) => a.code === '1000' || a.code === '1100').reduce((n: number, a: any) => n + a.balance, 0);
    expect(cf.closing).toBe(cash);
    const profit = await ok(as.admin.get(`/finance/reports/profit?from=${lastMonth()}-01`));
    const eve = profit.merchants.find((x: any) => x.id === merchantId);
    expect(eve.revenue).toBe(parcels.reduce((n, p) => n + net(p.shippingFee + p.codFee), 0));
    expect(eve.cost).toBe(2 * 2000);
    expect(profit.couriers.length).toBeGreaterThan(0);

    const month = new Date().toISOString().slice(0, 7);
    await ok(as.admin.put('/finance/budgets').send({ month, lines: [{ accountCode: '5260', amount: 1000 }] }));
    const b = await ok(as.admin.get(`/finance/budgets?month=${month}`));
    const row = b.rows.find((r: any) => r.code === '5260');
    expect(row.actual).toBe(2500);
    expect(row.difference).toBe(1500);
  });

  it('cash limits raise alerts and close them once back under', async () => {
    await ok(as.admin.put('/admin/settings/cash.safe_limit').send({ value: 100 }));
    expect((await ok(as.admin.post('/finance/jobs/cash-limits'))).raised).toBeGreaterThan(0);
    expect((await ok(as.admin.get('/admin/alerts'))).some((a: any) => a.kind === 'CASH_LIMIT_SAFE' && a.entityId === hubs.GIZ)).toBe(true);
    await ok(as.admin.put('/admin/settings/cash.safe_limit').send({ value: 5000000 }));
    await ok(as.admin.post('/finance/jobs/cash-limits'));
    expect((await ok(as.admin.get('/admin/alerts'))).some((a: any) => a.kind === 'CASH_LIMIT_SAFE')).toBe(false);
  });

  it('agent advances come off the month end payment', async () => {
    const agentId = (await ok(as.delta.get('/auth/me'))).agentId;
    const mine = await ok(as.delta.get('/agent/advances'));
    // Work so far: 2 deliveries (4,000) + 15% commission = 4,600; half may be taken.
    expect(mine.room.earnedSoFar).toBe(4600);
    expect(mine.room.available).toBe(2300);
    expect((await as.delta.post('/agent/advances').send({ amount: 2301 })).status).toBe(422);
    const adv = await ok(as.delta.post('/agent/advances').send({ amount: 2000, note: 'Fuel for the week' }), 201);
    await ok(as.admin.post(`/finance/advances/${adv.id}/approve`));
    await ok(as.admin.post(`/finance/advances/${adv.id}/paid`));
    expect((await ok(as.delta.get('/agent/advances'))).room.available).toBe(300);

    const month = lastMonth();
    await prisma.courierEarning.updateMany({ where: { agentId }, data: { date: `${month}-20` } });
    const x = await ok(as.admin.post('/finance/settlements').send({ agentId, month }), 201);
    expect(x.total).toBe(4600);
    expect(x.advances).toBe(2000);
    await ok(as.finance.post(`/finance/settlements/${x.id}/approve`));
    await ok(as.delta.post(`/agent/settlements/${x.id}/invoice`).send({ fileName: 'inv.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF').toString('base64') }));
    await ok(as.admin.post(`/finance/settlements/${x.id}/paid`).send({ reference: 'CIB 9' }));
    expect((await ok(as.admin.get('/finance/wallets/AGENT'))).find((a: any) => a.id === agentId)).toBeUndefined(); // settled to zero
    expect((await ok(as.admin.get('/finance/reports/trial-balance'))).balanced).toBe(true);
    expect((await ok(as.admin.get('/finance/reports/balance-sheet'))).balanced).toBe(true);
  });
});
