import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, createApp, login, sampleOrder } from './helpers';

let app: INestApplication;
let eve: ReturnType<typeof api>;
let nabta: ReturnType<typeof api>;
let ops: ReturnType<typeof api>;
let fin: ReturnType<typeof api>;
let prisma: PrismaService;

const FORWARD = ['PENDING_PICKUP', 'PICKED_UP', 'AT_SORTING_FACILITY', 'AT_LAST_MILE_HUB', 'ASSIGNED_TO_DRIVER', 'HEADING_TO_CUSTOMER'];

async function deliver(id: string) {
  for (const s of [...FORWARD, 'DELIVERED']) expect((await ops.post(`/orders/${id}/transition`, { to: s })).status).toBe(201);
}
async function fail(id: string) {
  for (const s of [...FORWARD, 'AWAITING_MERCHANT_ACTION', 'UNSUCCESSFUL']) expect((await ops.post(`/orders/${id}/transition`, { to: s })).status).toBe(201);
}
const wallet = async () => (await eve.get('/merchant/wallet')).body;
const settle = async () => {
  const r = await fin.post('/finance/settlement/run', {});
  expect(r.status).toBe(201);
  return r.body;
};

beforeAll(async () => {
  app = await createApp();
  prisma = app.get(PrismaService);
  eve = api(app, (await login(app, 'owner@evechantelle.com', 'merchant')).accessToken);
  nabta = api(app, (await login(app, 'owner@nabta.com', 'merchant')).accessToken);
  ops = api(app, (await login(app, 'ops@shiply.eg', 'ops')).accessToken);
  fin = api(app, (await login(app, 'finance@shiply.eg', 'ops')).accessToken);
});
afterAll(async () => app.close());

describe('cash cycle', () => {
  it('delivery records COD with the driver, the cash cycle moves COD minus fees into the wallet exactly once', async () => {
    await settle();
    const before = await wallet();
    const o = (await eve.post('/orders', sampleOrder)).body; // COD 450, fees 91.20
    await deliver(o.id);

    const cod = await fin.get(`/finance/journals?type=COD_COLLECTED&pageSize=100`);
    expect(cod.body.items.some((j: { orderId: string }) => j.orderId === o.id)).toBe(true);

    const pending = await wallet();
    expect(pending.pendingSettlement.amount - before.pendingSettlement.amount).toBe(45000 - 9120);

    const run = await settle();
    expect(run.status).toBe('DONE');
    expect(run.ordersSettled).toBeGreaterThanOrEqual(1);
    const after = await wallet();
    expect(after.balance - before.balance).toBe(45000 - 9120);

    await settle(); // running again never double counts
    expect((await wallet()).balance).toBe(after.balance);

    const statement = (await eve.get('/merchant/wallet/statement')).body;
    const lines = statement.items.filter((l: { trackingNumber: string }) => l.trackingNumber === o.trackingNumber);
    expect(lines.map((l: { amount: number }) => l.amount).sort()).toEqual([-9120, 45000].sort());
  });

  it('a failed order charges 60% of shipping plus VAT', async () => {
    await settle();
    const before = (await wallet()).balance;
    const o = (await eve.post('/orders', sampleOrder)).body;
    await fail(o.id);
    await settle();
    expect((await wallet()).balance - before).toBe(-(4800 + 672));
  });

  it('the trial balance and balance sheet always balance', async () => {
    const tb = (await fin.get('/finance/reports/trial_balance')).body;
    expect(tb.checks[0].ok).toBe(true);
    const bs = (await fin.get('/finance/reports/balance_sheet')).body;
    expect(bs.checks[0].ok).toBe(true);
    for (const k of ['income_statement', 'cash_flow', 'daily_cod', 'merchant_profitability']) {
      const r = await fin.get(`/finance/reports/${k}`);
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
    }
    const cf = (await fin.get('/finance/reports/cash_flow')).body;
    expect(cf.checks[0].ok).toBe(true);
  });
});

describe('cashouts', () => {
  it('requires bank details for a bank cashout', async () => {
    const r = await eve.post('/merchant/wallet/cashouts', { amount: 10000, method: 'BANK' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/bank details/);
  });

  it('pays a bank cashout with a 15 EGP fee, once', async () => {
    expect((await eve.put('/merchant/bank-details', { bankName: 'CIB', accountName: 'Eve Chantelle', iban: 'EG' + '2'.repeat(27) })).status).toBe(200);
    const before = await wallet();
    expect(before.available).toBeGreaterThan(10000);

    const tooMuch = await eve.post('/merchant/wallet/cashouts', { amount: before.available + 100, method: 'BANK' });
    expect(tooMuch.status).toBe(400);

    const req = await eve.post('/merchant/wallet/cashouts', { amount: 10000, method: 'BANK' });
    expect(req.status).toBe(201);
    expect(req.body).toMatchObject({ fee: 1500, netAmount: 8500, status: 'PENDING' });
    expect((await wallet()).available).toBe(before.available - 10000);

    const paid = await fin.post(`/finance/cashouts/${req.body.id}/approve`);
    expect(paid.status).toBe(201);
    expect(paid.body.payoutReference).toMatch(/^MOCK-BANK-/);
    expect((await wallet()).balance).toBe(before.balance - 10000);
    expect((await fin.post(`/finance/cashouts/${req.body.id}/approve`)).status).toBe(409);
  });

  it('charges 1% for Fawry and validates the Fawry number', async () => {
    expect((await eve.post('/merchant/wallet/cashouts', { amount: 5000, method: 'FAWRY_ACCOUNT', destination: '123' })).status).toBe(400);
    const r = await eve.post('/merchant/wallet/cashouts', { amount: 5000, method: 'FAWRY_ACCOUNT', destination: '01012345678' });
    expect(r.status).toBe(201);
    expect(r.body.fee).toBe(50);
    expect((await fin.post(`/finance/cashouts/${r.body.id}/reject`, { reason: 'test reject' })).body.status).toBe('REJECTED');
  });

  it('merchants cannot use finance endpoints or see other wallets', async () => {
    expect((await eve.get('/finance/overview')).status).toBe(403);
    const n = (await nabta.get('/merchant/wallet/statement')).body;
    expect(n.items.every((l: { trackingNumber: string | null }) => !l.trackingNumber || !l.trackingNumber.startsWith('X'))).toBe(true);
    const evesIds = new Set((await eve.get('/merchant/wallet/statement')).body.items.map((l: { id: string }) => l.id));
    expect(n.items.some((l: { id: string }) => evesIds.has(l.id))).toBe(false);
    expect((await ops.post('/finance/deposits', { kind: 'DRIVER_TO_FAWRY', amount: 100, reference: 'OPSX1' })).status).toBe(403);
  });
});

describe('deposits, adjustments and reversals', () => {
  it('records a Fawry deposit and refuses the same reference twice', async () => {
    const r = await fin.post('/finance/deposits', { kind: 'DRIVER_TO_FAWRY', amount: 20000, reference: 'FWR-778899' });
    expect(r.status).toBe(201);
    const dup = await fin.post('/finance/deposits', { kind: 'DRIVER_TO_FAWRY', amount: 20000, reference: 'fwr-778899' });
    expect(dup.status).toBe(409);
  });

  it('compensates a merchant and reverses it', async () => {
    const me = (await eve.get('/merchant/me')).body;
    const before = (await wallet()).balance;
    const j = await fin.post(`/finance/wallets/${me.id}/adjust`, { kind: 'COMPENSATION', amount: 5000, reason: 'Lost parcel' });
    expect(j.status).toBe(201);
    expect((await wallet()).balance).toBe(before + 5000);
    expect((await fin.post(`/finance/journals/${j.body.id}/reverse`, { reason: 'Parcel found' })).status).toBe(201);
    expect((await wallet()).balance).toBe(before);
    expect((await fin.post(`/finance/journals/${j.body.id}/reverse`, { reason: 'again' })).status).toBe(409);
  });

  it('order settlement journals cannot be reversed by hand', async () => {
    const j = (await fin.get('/finance/journals?type=ORDER_SETTLEMENT')).body.items[0];
    expect((await fin.post(`/finance/journals/${j.id}/reverse`, { reason: 'nope' })).status).toBe(400);
  });
});

describe('database guarantees', () => {
  it('rejects an unbalanced journal at commit', async () => {
    await expect(
      prisma.asSystem(async (tx) => {
        const j = await tx.journalEntry.create({ data: { type: 'MERCHANT_ADJUSTMENT', description: 'bad', idempotencyKey: 'bad-1' } });
        await tx.ledgerEntry.createMany({
          data: [
            { journalId: j.id, accountCode: '1010', debit: 100, occurredAt: new Date() },
            { journalId: j.id, accountCode: '2010', credit: 90, occurredAt: new Date() },
          ],
        });
      }),
    ).rejects.toThrow(/unbalanced/);
  });

  it('ledger rows are append only', async () => {
    await expect(prisma.asSystem((tx) => tx.$executeRaw`UPDATE ledger_entries SET debit = debit`)).rejects.toThrow();
    await expect(prisma.asSystem((tx) => tx.$executeRaw`DELETE FROM journal_entries`)).rejects.toThrow();
  });
});

describe('exports', () => {
  it('generates an Excel trial balance in the background', async () => {
    const r = await fin.post('/finance/exports', { kind: 'trial_balance', format: 'xlsx', params: {} });
    expect(r.status).toBe(201);
    let status = r.body.status;
    for (let i = 0; i < 50 && status !== 'DONE' && status !== 'FAILED'; i++) {
      await new Promise((res) => setTimeout(res, 100));
      status = (await fin.get('/finance/exports')).body.find((e: { id: string }) => e.id === r.body.id).status;
    }
    expect(status).toBe('DONE');
    const file = await fin.get(`/finance/exports/${r.body.id}/download`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect((file.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });
});
