// Money end to end: deliveries post to the books, Fawry pay ins, a short run freezes the courier,
// recharge, withdrawals after the freeze, hub safe deposits, agent month end, expenses, opening
// balances, closing the books, and the reports that must always balance.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createNetworkApp } from './setup-db';

process.env.SHIPLY_JOBS = 'off';

let app: INestApplication;
let prisma: any;
type Client = ReturnType<typeof request.agent>;

const as: Record<string, any> = {};
const hubs: Record<string, string> = {};
const users: Record<string, string> = {};
const RECEIPT = {
  fileName: 'receipt.jpg',
  mime: 'image/jpeg',
  dataBase64: Buffer.from('fake receipt image').toString('base64'),
};

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

const wallet = (id: string) => ok(as.admin!.get(`/parcels/finance/couriers/${id}`));
const balanced = async () => {
  const tb = await ok(as.admin!.get('/parcels/finance/reports/trial-balance'));
  expect(tb.balanced).toBe(true);
  const bs = await ok(as.admin!.get('/parcels/finance/reports/balance-sheet'));
  expect(bs.balanced).toBe(true);
  return { tb, bs };
};

function lastMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

beforeAll(async () => {
  const { PrismaService } = await import('../../src/parcels/common/prisma.service');
  app = await createNetworkApp();
  prisma = app.get(PrismaService);
  as.admin = await login('admin@shiply.local', 'admin12345');
  as.finance = await login('finance@shiply.local');
  as.merchant = await login('merchant@evechantelle.example');
  as.giz = await login('staff.giz@shiply.local');
  as.courierGiz = await login('courier.giz@shiply.local');
  as.courierObr = await login('courier.obr@shiply.local');
  as.delta = await login('agent@deltariders.example');
  for (const h of await ok(as.admin.get('/parcels/admin/hubs'))) hubs[h.code] = h.id;
  for (const u of await ok(as.admin.get('/parcels/admin/users')))
    if (u.email) users[u.email] = u.id;
});

afterAll(async () => {
  await app?.close();
});

describe('money', () => {
  const parcels: any[] = [];
  let run: any;

  it('a delivery books the cash with the courier, the merchant balance and our revenue', async () => {
    const locs = await ok(as.merchant!.get('/parcels/reference/locations'));
    const dokki = locs
      .find((g: any) => g.code === 'EG-GZ')
      .areas.find((a: any) => a.nameEn === 'Dokki');
    for (const cod of [50000, 30000]) {
      parcels.push(
        await ok(
          as.merchant!.post('/parcels/merchant/shipments').send({
            customerName: 'Mona',
            customerPhone: '01012345678',
            address: '5 Tahrir St',
            governorateCode: 'EG-GZ',
            areaId: dokki.id,
            codAmount: cod,
          }),
          201,
        ),
      );
    }
    // Skip the line haul (covered by the flow test): put both parcels on the Giza shelf.
    await prisma.shipment.updateMany({
      where: { id: { in: parcels.map((p) => p.id) } },
      data: { status: 'AT_HUB', currentHubId: hubs.GIZ },
    });

    run = await ok(
      as
        .giz!.post(`/parcels/hubs/${hubs.GIZ}/runs`)
        .send({ courierId: users['courier.giz@shiply.local'] }),
      201,
    );
    for (const p of parcels)
      await ok(
        as
          .giz!.post(`/parcels/hubs/${hubs.GIZ}/runs/${run.id}/add`)
          .send({ code: p.trackingNumber }),
      );
    await ok(as.giz!.post(`/parcels/hubs/${hubs.GIZ}/runs/${run.id}/start`));
    const mine = await ok(as.courierGiz!.get('/parcels/courier/run'));
    for (const item of mine.items)
      await ok(
        as
          .courierGiz!.post(`/parcels/courier/stops/${item.id}/deliver`)
          .send({ codCollected: item.shipment.codAmount }),
      );

    const w = await wallet(users['courier.giz@shiply.local']!);
    expect(w.cashToHandIn).toBe(80000);
    expect(w.wallet).toBe(2 * 20 * 100); // 20 points a delivery, 1 EGP a point
    expect(w.paidByAgent).toBe(true); // Delta Riders staff: paid through the agent
    const merchants = await ok(as.admin!.get('/parcels/finance/wallets/MERCHANT'));
    const fees = parcels.reduce((n, p) => n + p.shippingFee + p.codFee, 0);
    expect(merchants[0].balance).toBe(80000 - fees);
    await balanced();
  });

  it('cash paid in through Fawry lowers what the hub expects; a short run freezes the courier', async () => {
    const pi = await ok(
      as
        .courierGiz!.post('/parcels/courier/pay-ins')
        .send({ amount: 30000, reference: 'FWR-123', runId: run.id, receipt: RECEIPT }),
      201,
    );
    await ok(as.finance!.post(`/parcels/finance/pay-ins/${pi.id}/approve`));
    expect((await as.finance!.post(`/parcels/finance/pay-ins/${pi.id}/approve`)).status).toBe(409);
    const receipt = await as.admin!.get(`/parcels/finance/pay-ins/${pi.id}/receipt`);
    expect(receipt.headers['content-type']).toContain('image/jpeg');

    const closed = await ok(
      as.giz!.post(`/parcels/hubs/${hubs.GIZ}/runs/${run.id}/close`).send({ cashReceived: 40000 }),
    );
    expect(closed.due).toBe(50000);
    expect(closed.short).toBe(10000);

    const w = await wallet(users['courier.giz@shiply.local']!);
    expect(w.cashToHandIn).toBe(0);
    expect(w.wallet).toBe(4000 - 10000);
    expect(w.frozen).toBe(true);
    const blocked = await as
      .giz!.post(`/parcels/hubs/${hubs.GIZ}/runs`)
      .send({ courierId: users['courier.giz@shiply.local'] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('courier_frozen');

    // Finance lets him work today, with a reason.
    expect(
      (
        await as
          .admin!.post(`/parcels/finance/couriers/${users['courier.giz@shiply.local']}/unfreeze`)
          .send({ reason: 'x' })
      ).status,
    ).toBe(422);
    await ok(
      as
        .admin!.post(`/parcels/finance/couriers/${users['courier.giz@shiply.local']}/unfreeze`)
        .send({ reason: 'Promised to recharge tonight', hours: 12 }),
    );
    const again = await ok(
      as
        .giz!.post(`/parcels/hubs/${hubs.GIZ}/runs`)
        .send({ courierId: users['courier.giz@shiply.local'] }),
      201,
    );
    await prisma.run.delete({ where: { id: again.id } });

    // He recharges 6,000 piastres through Fawry: the wallet is back to zero.
    const rc = await ok(
      as
        .courierGiz!.post('/parcels/courier/pay-ins')
        .send({ amount: 6000, purpose: 'RECHARGE', reference: 'FWR-777', receipt: RECEIPT }),
      201,
    );
    await ok(as.finance!.post(`/parcels/finance/pay-ins/${rc.id}/approve`));
    expect((await wallet(users['courier.giz@shiply.local']!)).wallet).toBe(0);
    await balanced();
  });

  it('the hub safe goes to the bank, confirmed by finance', async () => {
    const safe = await ok(as.giz!.get(`/parcels/hubs/${hubs.GIZ}/safe`));
    expect(safe.balance).toBe(40000);
    expect(
      (
        await as
          .giz!.post(`/parcels/hubs/${hubs.GIZ}/safe/deposits`)
          .send({ amount: 50000, reference: 'CIB slip 1' })
      ).status,
    ).toBe(422);
    const dep = await ok(
      as
        .giz!.post(`/parcels/hubs/${hubs.GIZ}/safe/deposits`)
        .send({ amount: 40000, reference: 'CIB slip 1', receipt: RECEIPT }),
      201,
    );
    expect(
      (
        await as
          .giz!.post(`/parcels/hubs/${hubs.GIZ}/safe/deposits`)
          .send({ amount: 1, reference: 'again' })
      ).status,
    ).toBe(422); // all of it is waiting already
    await ok(as.admin!.post(`/parcels/finance/deposits/${dep.id}/approve`));
    expect((await ok(as.giz!.get(`/parcels/hubs/${hubs.GIZ}/safe`))).balance).toBe(0);
  });

  it('company paid couriers withdraw only after the freeze, with approval', async () => {
    const obr = users['courier.obr@shiply.local']!;
    await ok(
      as
        .admin!.post(`/parcels/finance/couriers/${obr}/adjust`)
        .send({ kind: 'BONUS', amount: 50000, note: 'Best pickup courier of the week' }),
      201,
    );
    let w = await wallet(obr);
    expect(w.paidByAgent).toBe(false); // pickup staff are paid by the company (setting)
    expect(w.wallet).toBe(50000);
    expect(w.withdrawable).toBe(0); // frozen for 3 days
    expect(
      (
        await as
          .courierObr!.post('/parcels/courier/withdrawals')
          .send({ amount: 20000, method: 'InstaPay 01000000100' })
      ).status,
    ).toBe(422);

    await prisma.courierEarning.updateMany({
      where: { courierId: obr },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    w = await wallet(obr);
    expect(w.withdrawable).toBe(50000);
    const wd = await ok(
      as
        .courierObr!.post('/parcels/courier/withdrawals')
        .send({ amount: 20000, method: 'InstaPay 01000000100' }),
      201,
    );
    expect((await as.admin!.post(`/parcels/finance/withdrawals/${wd.id}/paid`)).status).toBe(409); // approve first
    await ok(as.admin!.post(`/parcels/finance/withdrawals/${wd.id}/approve`));
    await ok(as.finance!.post(`/parcels/finance/withdrawals/${wd.id}/paid`));
    expect((await wallet(obr)).wallet).toBe(30000);

    // Delivery staff of an agent cannot withdraw: their agent is paid.
    expect(
      (
        await as
          .courierGiz!.post('/parcels/courier/withdrawals')
          .send({ amount: 100, method: 'InstaPay 0100' })
      ).status,
    ).toBe(409);
  });

  it('agent month end: staff pay with commission on work only, invoice before payment', async () => {
    const giz = users['courier.giz@shiply.local']!;
    const month = lastMonth();
    // Pretend the work happened last month.
    await prisma.courierEarning.updateMany({
      where: { courierId: giz },
      data: { date: `${month}-15` },
    });
    const agentId = (await ok(as.delta!.get('/parcels/auth/me'))).agentId;
    const preview = await ok(
      as.admin!.get(`/parcels/finance/settlements/preview?agentId=${agentId}&month=${month}`),
    );
    // Work 4,000; shortage −10,000 and recharge +6,000 cancel out; commission 15% of the work only.
    expect(preview.staffPay).toBe(4000 - 10000 + 6000);
    expect(preview.commission).toBe(600);
    expect(preview.total).toBe(600);

    expect(
      (
        await as
          .admin!.post('/parcels/finance/settlements')
          .send({ agentId, month: new Date().toISOString().slice(0, 7) })
      ).status,
    ).toBe(422); // month not over
    const x = await ok(
      as.admin!.post('/parcels/finance/settlements').send({ agentId, month }),
      201,
    );
    expect((await as.admin!.post(`/parcels/finance/settlements/${x.id}/approve`)).status).toBe(403);
    await ok(as.finance!.post(`/parcels/finance/settlements/${x.id}/approve`));
    expect((await as.admin!.post(`/parcels/finance/settlements/${x.id}/paid`)).status).toBe(422); // no invoice yet
    await ok(
      as.delta!.post(`/parcels/agent/settlements/${x.id}/invoice`).send({
        fileName: 'invoice.pdf',
        mime: 'application/pdf',
        dataBase64: Buffer.from('%PDF-1.4').toString('base64'),
      }),
    );
    await ok(
      as.admin!.post(`/parcels/finance/settlements/${x.id}/paid`).send({ reference: 'CIB 5' }),
    );
    const agents = await ok(as.admin!.get('/parcels/finance/wallets/AGENT'));
    expect(agents.find((a: any) => a.id === agentId)).toBeUndefined(); // paid to zero
    expect((await wallet(giz)).wallet).toBe(0); // moved to the agent
    await balanced();
  });

  it('network money is booked for the company Shiply, on the hub cost center, in the one ledger', async () => {
    // Expenses, journals and closing the books are done once, in Accounting, for both companies.
    const lines = await prisma.ledgerLine.findMany({
      where: { account: { code: { in: ['4301', '4302'] } } },
      select: { company: true, costCenterId: true, hubId: true, amountPiastres: true },
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l: any) => l.company === 'shiply')).toBe(true);
    expect(lines.every((l: any) => l.hubId && l.costCenterId)).toBe(true);
    const centers = await prisma.costCenter.findMany({
      where: { id: { in: lines.map((l: any) => l.costCenterId) } },
    });
    expect(centers.every((c: any) => c.company === 'shiply' && c.code.startsWith('NW-'))).toBe(
      true,
    );
    const revenue = -lines.reduce((n: number, l: any) => n + l.amountPiastres, 0);
    expect(revenue).toBeGreaterThan(0);
    const { bs } = await balanced();
    expect(bs.totalAssetsPiastres).toBe(bs.totalLiabilitiesPiastres + bs.totalEquityPiastres);
  });

  it('Accounting shows profit per company and cost center, combined or separated', async () => {
    const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
    const range = `from=${today.slice(0, 8)}01&to=${today}`;
    const split = await ok(as.admin!.get(`/finance/profit-and-loss/by-cost-center?${range}`));
    const shiply = split.companies.find((c: any) => c.company === 'shiply');
    expect(shiply.incomePiastres).toBeGreaterThan(0);
    const rows = split.costCenters.filter((r: any) => r.company === 'shiply');
    // Hubs are NW- cost centers; agent commission has no hub and shows as no cost center.
    expect(rows.every((r: any) => r.costCenterId === null || r.code.startsWith('NW-'))).toBe(true);
    expect(rows.some((r: any) => r.code === 'NW-GIZ' && r.incomePiastres > 0)).toBe(true);
    expect(rows.reduce((n: number, r: any) => n + r.profitPiastres, 0)).toBe(shiply.profitPiastres);
    expect(split.group.profitPiastres).toBe(
      split.companies.reduce((n: number, c: any) => n + c.profitPiastres, 0),
    );
    const network = await ok(as.admin!.get(`/finance/profit-and-loss?${range}&company=shiply`));
    expect(network.income.some((r: any) => r.code === '4301')).toBe(true);
    expect(network.profitPiastres).toBe(shiply.profitPiastres);
    const now = await ok(as.admin!.get(`/finance/profit-and-loss?${range}&company=shiply_now`));
    expect(now.income.some((r: any) => r.code === '4301')).toBe(false);
    const giza = rows.find((r: any) => r.code === 'NW-GIZ');
    const center = giza.costCenterId;
    const one = await ok(as.admin!.get(`/finance/profit-and-loss?${range}&costCenter=${center}`));
    expect(one.profitPiastres).toBe(giza.profitPiastres);
    const centers = await ok(as.admin!.get('/finance/cost-centers'));
    expect(centers.some((c: any) => c.id === center)).toBe(true);
    expect((await as.admin!.get(`/finance/profit-and-loss?company=other`)).status).toBe(400);
  });

  it('the books cannot be edited and must balance', async () => {
    await expect(prisma.ledgerLine.updateMany({ data: { amountPiastres: 1 } })).rejects.toThrow();
    await expect(prisma.ledgerEntry.deleteMany({})).rejects.toThrow();
  });
});
