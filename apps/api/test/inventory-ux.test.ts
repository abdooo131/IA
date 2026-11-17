import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { appListGaps, createTransfer } from '@shiplynow/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const PASSWORD = 'team-password-1';

type Row = { id: string } & Record<string, unknown>;
const ids = (body: { rows: Row[] }) => body.rows.map((r) => r.id);

/** UX phase C step 2: the Inventory list views, bulk actions and document pages. */
describe('inventory list views, bulk actions and documents', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ncr: string;
  let maa: string;
  let admin: ReturnType<typeof request.agent>;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const member = async (email: string, jobRole: string, extra: Record<string, unknown> = {}) => {
    const res = await admin
      .post('/admin/users')
      .send({ email, name: email, role: 'admin', jobRole, password: PASSWORD, ...extra })
      .expect(201);
    return { id: res.body.id as string, agent: await agent(email, PASSWORD) };
  };
  const shelfStock = (store: string) =>
    prisma.stockLevel.findFirstOrThrow({
      where: { darkStoreId: store, onHand: { gt: 5 } },
      orderBy: { skuId: 'asc' },
    });
  /** A draft transfer, as the automatic refill prepares them for admin to approve. */
  const draftTransfer = async (from: string, to: string, quantity = 2) => {
    const level = await shelfStock(from);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.eg' } });
    const t = await createTransfer(prisma, {
      fromId: from,
      toId: to,
      lines: [{ skuId: level.skuId, quantity }],
      draft: true,
      origin: 'refill',
      actorUserId: owner.id,
    });
    return t.id;
  };
  /** A hub (a third location) for transfers that do not touch a store. */
  const openHub = async () =>
    (
      await admin
        .post('/admin/dark-stores')
        .send({
          kind: 'hub',
          code: 'hub',
          nameEn: 'Main sorting facility',
          nameAr: 'مركز الفرز الرئيسي',
          addressEn: 'Obour industrial zone',
          addressAr: 'المنطقة الصناعية بالعبور',
          governorateId: 4,
          latitude: 30.22,
          longitude: 31.47,
          shelves: 4,
        })
        .expect(201)
    ).body.id as string;
  /** A count of a shelf of the store with one product two units short. */
  const submitCount = async (store: string, staffEmail: string) => {
    const staff = await agent(staffEmail);
    const shelf = await prisma.bin.findFirstOrThrow({
      where: { darkStoreId: store, type: 'pickable', stock: { some: { quantity: { gt: 2 } } } },
      orderBy: { code: 'asc' },
    });
    const contents = await prisma.binStock.findMany({
      where: { binId: shelf.id, quantity: { gt: 0 } },
      orderBy: { quantity: 'desc' },
    });
    const [first, ...rest] = contents;
    const res = await staff
      .post(`/stores/${store}/counts`)
      .send({
        binId: shelf.id,
        lines: [
          { skuId: first!.skuId, countedQty: first!.quantity - 2 },
          ...rest.map((c) => ({ skuId: c.skuId, countedQty: c.quantity })),
        ],
      })
      .expect(201);
    return { id: res.body.id as string, shelf, first: first! };
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    const seeded = await resetAndSeed(prisma);
    ncr = seeded.stores.get('NCR')!;
    maa = seeded.stores.get('MAA')!;
    admin = await agent('admin@test.eg', 'admin-password-1');
  });

  it('implements every filter, value, grouping and sort the shared list meta names', () => {
    expect(appListGaps()).toEqual([]);
  });

  it('lists stock per store and product with flags, groups and unit totals', async () => {
    const all = await admin.get('/lists/inventory/stock?size=200').expect(200);
    const levels = await prisma.stockLevel.findMany();
    expect(all.body.total).toBe(levels.length);
    expect(all.body.totals.onHand).toBe(levels.reduce((s, l) => s + l.onHand, 0));
    expect(all.body.totals.reserved).toBe(levels.reduce((s, l) => s + l.reserved, 0));

    const atNcr = await admin.get(`/lists/inventory/stock?v=store:${ncr}&size=200`).expect(200);
    expect(atNcr.body.rows.every((r: Row) => r.storeId === ncr)).toBe(true);
    expect(atNcr.body.total).toBe(levels.filter((l) => l.darkStoreId === ncr).length);

    // Out of stock: a product emptied at New Cairo shows, and is low stock too.
    const level = await shelfStock(ncr);
    await prisma.stockLevel.update({
      where: { darkStoreId_skuId: { darkStoreId: ncr, skuId: level.skuId } },
      data: { onHand: 0 },
    });
    const out = await admin.get('/lists/inventory/stock?f=out_of_stock').expect(200);
    expect(ids(out.body)).toContain(`${ncr}:${level.skuId}`);
    const low = await admin.get('/lists/inventory/stock?f=low_stock&size=200').expect(200);
    expect(ids(low.body)).toContain(`${ncr}:${level.skuId}`);
    const inStock = await admin.get('/lists/inventory/stock?f=in_stock&size=200').expect(200);
    expect(ids(inStock.body)).not.toContain(`${ncr}:${level.skuId}`);

    const sku = await prisma.sku.findUniqueOrThrow({ where: { id: level.skuId } });
    const found = await admin.get(`/lists/inventory/stock?q=${sku.sku}`).expect(200);
    expect(found.body.rows.every((r: Row) => r.sku === sku.sku)).toBe(true);

    const byStore = await admin.get('/lists/inventory/stock?g=store').expect(200);
    const ncrGroup = byStore.body.groups.find((g: { key: string }) => g.key === ncr);
    expect(ncrGroup).toMatchObject({ label: 'NCR' });
    expect(ncrGroup.totals.onHand).toBe(
      levels.filter((l) => l.darkStoreId === ncr).reduce((s, l) => s + l.onHand, 0) - level.onHand,
    );
    await admin.get('/lists/inventory/stock?g=product,merchant').expect(200);

    const options = await admin.get('/lists/inventory/stock/options').expect(200);
    expect(options.body.store.map((s: { value: string }) => s.value)).toEqual(
      expect.arrayContaining([ncr, maa]),
    );
    expect(options.body.merchant).toHaveLength(1);
  });

  it('keeps a person limited to some stores to their stores in every inventory list', async () => {
    const lead = await member('lead.ncr@shiply.eg', 'store_manager', { storeIds: [ncr] });
    const stock = await lead.agent.get('/lists/inventory/stock?size=200').expect(200);
    expect(stock.body.rows.every((r: Row) => r.storeId === ncr)).toBe(true);
    const other = await lead.agent.get(`/lists/inventory/stock?v=store:${maa}`).expect(200);
    expect(other.body.total).toBe(0);

    const mine = await draftTransfer(ncr, maa);
    const theirs = await draftTransfer(maa, ncr);
    // A transfer reaching New Cairo is theirs too; one between two other stores is not.
    const away = { id: await draftTransfer(maa, await openHub()) };
    const list = await lead.agent.get('/lists/inventory/transfers').expect(200);
    expect(ids(list.body).sort()).toEqual([mine, theirs].sort());
    const chosen = await lead.agent.get(`/lists/inventory/transfers?v=sender:${maa}`).expect(200);
    expect(chosen.body.total).toBe(0);
    await lead.agent.get(`/admin/transfers/${away.id}/document`).expect(403);
    await lead.agent.get(`/records/transfer/${away.id}/notes`).expect(403);
    await lead.agent.get(`/history/transfer/${away.id}`).expect(403);
    await lead.agent.get(`/records/transfer/${mine}/notes`).expect(200);
    await lead.agent.get(`/history/transfer/${mine}`).expect(200);

    // Riders and merchants have no inventory lists.
    const merchant = await agent('merchant@evechantelle.example');
    await merchant.get('/lists/inventory/stock').expect(403);
  });

  it('lists shipments in with differences and opens one as a document', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-019' } });
    const extra = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-003' } });
    const ship = async (store: string, reference: string) =>
      (
        await merchant
          .post('/merchant/manifests')
          .send({ darkStoreId: store, reference, lines: [{ skuId: sku.id, expectedQty: 5 }] })
          .expect(201)
      ).body.id as string;
    const a = await ship(ncr, 'PO-A');
    const b = await ship(maa, 'PO-B');

    const staff = await agent('staff.newcairo@shiplynow.local');
    for (const [skuId, quantity] of [
      [sku.id, 3],
      [extra.id, 1],
    ] as const)
      await staff
        .post(`/stores/${ncr}/manifests/${a}/receive`)
        .send({ skuId, quantity, idempotencyKey: randomUUID() })
        .expect(201);
    await staff.post(`/stores/${ncr}/manifests/${a}/close`).expect(201);

    const all = await admin.get('/lists/inventory/shipments').expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.totals).toMatchObject({
      expectedUnits: 10,
      receivedUnits: 4,
      extraUnits: 1,
      shortUnits: 2,
    });
    expect(ids((await admin.get('/lists/inventory/shipments?f=open').expect(200)).body)).toEqual([
      b,
    ]);
    expect(ids((await admin.get('/lists/inventory/shipments?f=short').expect(200)).body)).toEqual([
      a,
    ]);
    expect(ids((await admin.get('/lists/inventory/shipments?f=extra').expect(200)).body)).toEqual([
      a,
    ]);
    expect(
      ids((await admin.get(`/lists/inventory/shipments?v=store:${maa}`).expect(200)).body),
    ).toEqual([b]);
    const q = await admin.get('/lists/inventory/shipments?q=po-b').expect(200);
    expect(ids(q.body)).toEqual([b]);
    const grouped = await admin.get('/lists/inventory/shipments?g=status').expect(200);
    expect(grouped.body.groups.map((g: { key: string }) => g.key).sort()).toEqual([
      'expected',
      'received',
    ]);

    const doc = await admin.get(`/admin/manifests/${a}/document`).expect(200);
    const keys = doc.body.smart.map((s: { key: string }) => s.key);
    expect(keys).toEqual(['merchant', 'store', 'lines', 'received', 'entries']);
    expect(doc.body.smart.find((s: { key: string }) => s.key === 'received').value).toBe('4 / 5');
    expect(doc.body.entries.length).toBe(
      doc.body.smart.find((s: { key: string }) => s.key === 'entries').count,
    );
    // An inventory person without accounting gets no money button.
    const keeper = await member('stock@shiply.eg', 'operations_manager');
    const theirs = await keeper.agent.get(`/admin/manifests/${a}/document`).expect(200);
    expect(theirs.body.smart.map((s: { key: string }) => s.key)).not.toContain('entries');
    await keeper.agent
      .post(`/records/inbound_manifest/${a}/notes`)
      .send({ body: 'Driver late' })
      .expect(201);
    const lead = await member('lead.maa@shiply.eg', 'store_manager', { storeIds: [maa] });
    await lead.agent.get(`/admin/manifests/${a}/document`).expect(403);
    await lead.agent.get(`/records/inbound_manifest/${a}/notes`).expect(403);
    await lead.agent.get(`/records/inbound_manifest/${b}/notes`).expect(200);
  });

  it('approves several draft transfers, each on its own', async () => {
    const t1 = await draftTransfer(ncr, maa);
    const t2 = await draftTransfer(ncr, maa);
    const big = await draftTransfer(ncr, maa, 1);
    await prisma.transferLine.updateMany({ where: { transferId: big }, data: { quantity: 99999 } });

    const drafts = await admin.get('/lists/inventory/transfers?f=draft').expect(200);
    expect(drafts.body.total).toBe(3);
    expect(drafts.body.totals.units).toBe(4 + 99999);

    // A viewer may read but not approve.
    const viewer = await member('acc@shiply.eg', 'accountant');
    await viewer.agent.get('/lists/inventory/transfers').expect(200);
    await viewer.agent
      .post('/admin/transfers/bulk-approve')
      .send({ ids: [t1] })
      .expect(403);

    const res = await admin
      .post('/admin/transfers/bulk-approve')
      .send({ ids: [t1, big, 'missing'] })
      .expect(201);
    expect(res.body.results).toEqual([
      { id: t1, ok: true },
      { id: big, ok: false, error: 'not_enough_available' },
      { id: 'missing', ok: false, error: 'transfer_not_found' },
    ]);
    const again = await admin
      .post('/admin/transfers/bulk-approve')
      .send({ ids: [t1, t2] })
      .expect(201);
    expect(again.body.results).toEqual([
      { id: t1, ok: false, error: 'invalid_transfer_state' },
      { id: t2, ok: true },
    ]);
    expect(await prisma.auditLog.count({ where: { action: 'transfer.approve' } })).toBe(2);
    const approved = await admin.get('/lists/inventory/transfers?f=approved').expect(200);
    expect(ids(approved.body).sort()).toEqual([t1, t2].sort());
    const bySender = await admin.get(`/lists/inventory/transfers?g=sender`).expect(200);
    expect(bySender.body.groups).toEqual([expect.objectContaining({ key: ncr, count: 3 })]);

    const doc = await admin.get(`/admin/transfers/${t1}/document`).expect(200);
    expect(doc.body.smart.map((s: { key: string }) => s.key)).toEqual([
      'sender',
      'receiver',
      'lines',
      'unitsMoved',
    ]);
  });

  it('lists returns and opens one as a document', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const stock = await merchant.get(`/merchant/returns/stock?darkStoreId=${ncr}`).expect(200);
    const row = stock.body.find((r: { sellable: number }) => r.sellable >= 2);
    const created = await merchant
      .post('/merchant/returns')
      .send({ darkStoreId: ncr, lines: [{ skuId: row.skuId, source: 'sellable', quantity: 2 }] })
      .expect(201);
    const id = created.body.id as string;

    const list = await admin.get('/lists/inventory/returns?f=open').expect(200);
    expect(ids(list.body)).toEqual([id]);
    expect(list.body.totals).toMatchObject({ units: 2, pickedUnits: 0 });
    expect((await admin.get('/lists/inventory/returns?f=damaged').expect(200)).body.total).toBe(0);
    expect((await admin.get('/lists/inventory/returns?f=sellable').expect(200)).body.total).toBe(1);
    expect((await admin.get('/lists/inventory/returns?q=RET-1001').expect(200)).body.total).toBe(1);

    const doc = await admin.get(`/admin/returns/${id}/document`).expect(200);
    expect(doc.body.smart.map((s: { key: string }) => s.key)).toEqual([
      'merchant',
      'store',
      'lines',
      'picked',
      'entries',
    ]);
    const lead = await member('lead.maa@shiply.eg', 'store_manager', { storeIds: [maa] });
    await lead.agent.get(`/admin/returns/${id}/document`).expect(403);
    await lead.agent.get(`/history/merchant_return/${id}`).expect(403);
    expect((await lead.agent.get('/lists/inventory/returns').expect(200)).body.total).toBe(0);
  });

  it('approves several counts; a bin that changed makes its count stale', async () => {
    const c1 = await submitCount(ncr, 'staff.newcairo@shiplynow.local');
    const c2 = await submitCount(maa, 'staff.maadi@shiplynow.local');

    const waiting = await admin.get('/lists/inventory/counts').expect(200);
    expect(ids(waiting.body).sort()).toEqual([c1.id, c2.id].sort());
    expect(waiting.body.totals).toMatchObject({ differences: 2, netDifference: -4 });
    const one = await admin.get(`/admin/stock-counts/${c1.id}`).expect(200);
    expect(one.body.row.lines.length).toBeGreaterThan(0);
    expect(one.body.smart.find((s: { key: string }) => s.key === 'differences').count).toBe(1);

    // The Maadi bin changes after its count: approving it makes it stale.
    await prisma.binStock.update({
      where: { binId_skuId: { binId: c2.shelf.id, skuId: c2.first.skuId } },
      data: { quantity: { increment: 1 } },
    });
    const lead = await member('lead.ncr@shiply.eg', 'store_manager', { storeIds: [ncr] });
    // Store managers use inventory; reviewing counts needs manage.
    await lead.agent
      .post('/admin/stock-counts/bulk-approve')
      .send({ ids: [c1.id] })
      .expect(403);
    await prisma.userAccess.update({ where: { userId: lead.id }, data: { inventory: 'manage' } });
    const limited = await lead.agent
      .post('/admin/stock-counts/bulk-approve')
      .send({ ids: [c1.id, c2.id] })
      .expect(201);
    expect(limited.body.results).toEqual([
      { id: c1.id, ok: true },
      { id: c2.id, ok: false, error: 'store_not_allowed' },
    ]);
    const res = await admin
      .post('/admin/stock-counts/bulk-approve')
      .send({ ids: [c1.id, c2.id] })
      .expect(201);
    expect(res.body.results).toEqual([
      { id: c1.id, ok: false, error: 'count_already_reviewed' },
      { id: c2.id, ok: false, error: 'count_stale' },
    ]);
    const after = await prisma.binStock.findUniqueOrThrow({
      where: { binId_skuId: { binId: c1.shelf.id, skuId: c1.first.skuId } },
    });
    expect(after.quantity).toBe(c1.first.quantity - 2);
    const statuses = await admin.get('/lists/inventory/counts?f=&g=status').expect(200);
    expect(statuses.body.groups.map((g: { key: string }) => g.key).sort()).toEqual([
      'approved',
      'stale',
    ]);
    expect((await admin.get('/lists/inventory/counts').expect(200)).body.total).toBe(0);
    await admin
      .post(`/records/stock_count/${c1.id}/notes`)
      .send({ body: 'Checked with the shift lead' })
      .expect(201);
    await lead.agent.get(`/records/stock_count/${c2.id}/notes`).expect(403);
  });
});
