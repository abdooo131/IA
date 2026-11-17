import { addDays, cairoDay, cairoDayStart, foldSearch, type ListQuery } from '@shiplynow/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryAppList } from '../src/app-lists';
import { ensureDefaultAccounts, ledgerLinesList, post } from '../src/finance';
import type { ListScope } from '../src/list-query';
import { setSetting } from '../src/settings';
import { createFixture, prisma, resetDatabase } from './helpers';

// The database twins of the orders, alerts and stock lists (list-sql.ts) must answer exactly
// as the lists' own loaders and the shared engine do: every address below runs both ways.

const NOW = new Date('2026-11-17T10:00:00Z');
const TODAY = cairoDay(NOW);
let fx: Awaited<ReturnType<typeof createFixture>>;
let other: { id: string };
const all: ListScope = { userId: 'u', storeIds: null, merchantIds: null };

/** A small random generator, so the data is the same on every run. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
}

const STATUSES = [
  'new',
  'accepted',
  'picking',
  'packed',
  'out_for_delivery',
  'attempt_failed',
  'delivered',
  'cancelled',
  'failed',
  'moved_to_standard',
] as const;
const NAMES = ['أحمد علي', 'احمد سامي', 'Mona Adel', 'إيمان', 'سارة محمودة', 'mona'];

beforeAll(async () => {
  await resetDatabase();
  fx = await createFixture();
  other = await prisma.merchant.create({ data: { name: 'متجر أمل' } });
  const user = await prisma.user.create({
    data: { email: 'resolver@test', passwordHash: 'x', name: 'Huda', role: 'admin' },
  });
  const r = rng(7);
  const pickOf = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  for (let i = 0; i < 90; i++) {
    const placedAt = new Date(NOW.getTime() - Math.floor(r() * 75 * 24 * 60) * 60_000);
    const sla = r() < 0.8 ? new Date(placedAt.getTime() + 60 * 60_000) : null;
    const status = pickOf(STATUSES);
    const delivered =
      status === 'delivered' ? new Date(placedAt.getTime() + Math.floor(r() * 120) * 60_000) : null;
    const order = await prisma.order.create({
      data: {
        number: `SN${100_001 + i}`,
        merchantId: r() < 0.6 ? fx.merchant.id : other.id,
        darkStoreId: r() < 0.5 ? fx.store.id : fx.other.id,
        customerName: pickOf(NAMES),
        customerPhone: r() < 0.7 ? `+2010${String(10_000_000 + i).padStart(8, '0')}` : `12${i}`,
        phoneFlagged: r() < 0.2,
        addressText: 'x',
        deliveryOtp: '1234',
        trackingToken: `t${i}`,
        paymentMethod: r() < 0.6 ? 'cod' : 'prepaid',
        source: r() < 0.5 ? 'manual' : 'shopify',
        status,
        subtotalPiastres: Math.floor(r() * 50_000),
        deliveryFeePiastres: Math.floor(r() * 5_000),
        codAmountPiastres: Math.floor(r() * 60_000),
        placedAt,
        slaDueAt: sla,
        deliveredAt: delivered,
        lateStage: r() < 0.15 ? 'pick' : null,
        // Some orders share their placing time, so ties are broken the same way both ways.
        ...(i % 10 === 9 && { placedAt: new Date(NOW.getTime() - 3 * 3600_000) }),
      },
    });
    if (r() < 0.2)
      await prisma.alert.create({
        data: { type: 'late', stage: 'pick', orderId: order.id, darkStoreId: order.darkStoreId },
      });
    if (r() < 0.4)
      await prisma.alert.create({
        data: {
          type: pickOf(['cod_mismatch', 'goods_not_returned', 'document_expiring', 'low_rating']),
          stage: `s${i}`,
          orderId: r() < 0.6 ? order.id : null,
          darkStoreId: r() < 0.8 ? order.darkStoreId : null,
          merchantId: r() < 0.5 ? order.merchantId : null,
          data: r() < 0.5 ? { amount: i * 100, note: `إجمالي ${i}`, nested: { a: 1 } } : ['x', i],
          createdAt: new Date(NOW.getTime() - Math.floor(r() * 40 * 24 * 60) * 60_000),
          resolvedAt: r() < 0.5 ? NOW : null,
          resolvedById: r() < 0.5 ? user.id : null,
        },
      });
  }
  // Stock: every product in both stores, a buffer at one store.
  const skus = [fx.sku, fx.sku2];
  for (let i = 0; i < 12; i++)
    skus.push(
      await prisma.sku.create({
        data: {
          merchantId: i % 2 ? fx.merchant.id : other.id,
          sku: pickOf(['ab-', 'AB', 'b_', 'Zz', 'a1']) + i,
          barcode: r() < 0.5 ? `622${i}` : null,
          titleEn: `Item ${i}`,
          titleAr: `صنف ${i}`,
          pricePiastres: 100,
        },
      }),
    );
  for (const s of skus)
    for (const store of [fx.store, fx.other]) {
      const onHand = Math.floor(r() * 12);
      await prisma.stockLevel.create({
        data: {
          darkStoreId: store.id,
          skuId: s.id,
          onHand,
          reserved: Math.min(onHand, Math.floor(r() * 4)),
        },
      });
    }
  await setSetting(prisma, {
    key: 'stock.buffer_units',
    value: 2,
    scope: fx.other.id,
    actorUserId: null,
  });
});
afterAll(() => prisma.$disconnect());

async function both(app: string, id: string, query: ListQuery, scope: ListScope = all) {
  const sql = await queryAppList(prisma, app, id, query, scope, NOW);
  const memory = await queryAppList(prisma, app, id, query, scope, NOW, { memory: true });
  return { sql: sql!, memory: memory! };
}

const same = async (app: string, id: string, query: ListQuery, scope?: ListScope) => {
  const { sql, memory } = await both(app, id, query, scope);
  const view = (r: typeof sql) => ({
    total: r.total,
    page: r.page,
    totals: r.totals,
    ids: r.rows.map((row) => row.id),
    rows: r.rows,
    groups: r.groups,
  });
  expect(view(sql), JSON.stringify(query)).toEqual(view(memory));
  return sql;
};

describe('lists in the database answer as the lists in memory', () => {
  it('folds typed search as foldSearch does', async () => {
    const texts = [
      'أحمد إبراهيم آمنة',
      'مُحَمَّدٌ',
      'سلمى مدرسة',
      'ABC Déjà vu',
      'ﻻ ﷲ',
      'Ⅻ ﬁle ①',
      'SN100001 +201001234567',
      'ٱلْقُرْآن',
    ];
    for (const text of texts) {
      const [row] = await prisma.$queryRaw<{ f: string }[]>`SELECT sn_fold(${text}) AS f`;
      // The SQL fold keeps runs of spaces; search words never hold one.
      expect(row!.f.replace(/\s+/g, ' ').trim(), text).toBe(foldSearch(text));
    }
  });

  it('orders', async () => {
    const values = [
      `store:${fx.store.id}`,
      `merchant:${other.id}`,
      `from:${addDays(TODAY, -10)},to:${addDays(TODAY, -2)}`,
    ];
    const queries: ListQuery[] = [
      {},
      { f: 'active' },
      { f: 'new,delivered,cancelled' },
      { f: 'late_now,was_late' },
      { f: 'was_late' },
      { f: 'delivered_late' },
      { f: 'cod', sort: 'value', desc: '1' },
      { f: 'shopify,phone_flagged' },
      { f: 'today' },
      { f: 'yesterday' },
      { f: 'last_7_days,cod' },
      { f: 'this_month' },
      { f: 'last_month' },
      ...values.map((v) => ({ v })),
      { q: 'احمد' },
      { q: 'أحمد علي' },
      { q: 'محموده' },
      { q: 'MONA' },
      { q: '01000000' },
      { q: '+2010' },
      { q: 'sn10003' },
      { q: 'tst' },
      { q: 'امل' },
      { q: 'nothing here' },
      { sort: 'number' },
      { sort: 'number', desc: '1', size: '25', page: '2' },
      { sort: 'placed' },
      { sort: 'promise' },
      { sort: 'promise', desc: '1' },
      { sort: 'cod' },
      { size: '25', page: '3' },
      { size: '25', page: '99' },
      { all: '1', sort: 'value' },
      { g: 'status' },
      { g: 'store,merchant', q: 'mona' },
      { g: 'status', open: 'delivered' },
    ];
    const ordersTotals: number[] = [];
    for (const q of queries) ordersTotals.push((await same('operations', 'orders', q)).total);
    // Most addresses find something, so the comparison means something.
    expect(ordersTotals.filter((n) => n > 0).length).toBeGreaterThan(queries.length * 0.7);
    // Limited people see only their stores and merchants.
    await same('operations', 'orders', { f: 'active' }, { ...all, storeIds: [fx.store.id] });
    await same('operations', 'orders', {}, { ...all, merchantIds: [other.id] });
    await same('operations', 'orders', { v: `store:${fx.other.id}` }, { ...all, storeIds: [] });
    // The database answered (no truncation, one page loaded).
    const page = await queryAppList(prisma, 'operations', 'orders', { size: '25' }, all, NOW);
    expect(page!.rows).toHaveLength(25);
    expect(page!.total).toBe(90);
  });

  it('alerts', async () => {
    const queries: ListQuery[] = [
      {},
      { f: '' },
      { f: 'handled' },
      { f: 'open,handled,with_order' },
      { f: 'today' },
      { f: 'last_7_days' },
      { f: 'this_month' },
      { v: 'type:late' },
      { v: `store:${fx.other.id}`, f: '' },
      { q: 'huda', f: '' },
      { q: 'اجمالي 1', f: '' },
      { q: '300', f: '' },
      { q: 'SN10001', f: '' },
      { q: 'cod_mismatch', f: '' },
      { sort: 'type', f: '' },
      { sort: 'type', desc: '1', f: '', size: '25', page: '2' },
      { sort: 'created', f: '' },
      { g: 'type', f: '' },
    ];
    const alertsTotals: number[] = [];
    for (const q of queries) alertsTotals.push((await same('operations', 'alerts', q)).total);
    // Most addresses find something, so the comparison means something.
    expect(alertsTotals.filter((n) => n > 0).length).toBeGreaterThan(queries.length * 0.7);
    await same('operations', 'alerts', { f: '' }, { ...all, storeIds: [fx.store.id] });
    await same('operations', 'alerts', { f: '' }, { ...all, merchantIds: [fx.merchant.id] });
  });

  it('stock', async () => {
    const queries: ListQuery[] = [
      {},
      { f: 'in_stock' },
      { f: 'low_stock' },
      { f: 'out_of_stock,has_reserved' },
      { f: 'hubs' },
      { f: 'dark_stores', sort: 'available', desc: '1' },
      { v: `store:${fx.other.id}` },
      { v: `merchant:${other.id}` },
      { q: 'ab' },
      { q: 'صنف 1' },
      { q: '622' },
      { q: 'oth' },
      { sort: 'sku', desc: '1' },
      { sort: 'onHand' },
      { sort: 'reserved', desc: '1', size: '25' },
      { size: '25', page: '2' },
      { g: 'store' },
    ];
    const stockTotals: number[] = [];
    for (const q of queries) stockTotals.push((await same('inventory', 'stock', q)).total);
    // Most addresses find something, so the comparison means something.
    expect(stockTotals.filter((n) => n > 0).length).toBeGreaterThan(queries.length * 0.7);
    await same('inventory', 'stock', {}, { ...all, storeIds: [fx.other.id] });
  });
});

describe('ledger lines in the database answer as in memory', () => {
  it('counts, sums and pages the lines of a slice', async () => {
    await ensureDefaultAccounts(prisma);
    const r = rng(11);
    const orders = await prisma.order.findMany({ select: { id: true }, take: 10 });
    const kinds = ['order_fee', 'cod_collected', 'bank_deposit', 'expense', 'adjustment'];
    for (let i = 0; i < 70; i++) {
      const size = 100 + Math.floor(r() * 10_000);
      const amount = r() < 0.5 ? size : -size;
      const kind = kinds[i % kinds.length]!;
      await post(prisma, {
        kind,
        idempotencyKey: `ll-${i}`,
        // Groups of entries at the same moment, so ties are broken the same way.
        occurredAt: new Date(NOW.getTime() - Math.floor(i / 3) * 3 * 3600_000),
        darkStoreId: r() < 0.7 ? (r() < 0.5 ? fx.store.id : fx.other.id) : undefined,
        merchantId: fx.merchant.id,
        orderId: r() < 0.4 ? orders[i % orders.length]!.id : undefined,
        lines: [
          { account: { type: 'bank' }, amount },
          { account: { type: 'revenue' }, amount: 0 - amount },
        ],
      });
    }
    const bank = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
    const slices = [
      { account: bank.id },
      { set: 'income_costs' as const },
      { account: bank.id, store: fx.store.id },
      { set: 'money' as const, from: addDays(TODAY, -3), to: TODAY },
    ];
    const queries: ListQuery[] = [
      {},
      { f: 'debit' },
      { f: 'credit' },
      { f: 'deliveries,cash' },
      { f: 'debit,credit,manual' },
      { f: 'with_order' },
      { f: 'no_store,with_order' },
      { sort: 'day' },
      { sort: 'day', desc: '1', size: '25', page: '2' },
      { size: '25', page: '3' },
      { all: '1' },
      { all: '1', f: 'credit', sort: 'day' },
    ];
    const scope = all;
    for (const slice of slices)
      for (const q of queries) {
        const db = await ledgerLinesList(prisma, slice, q, scope, NOW);
        const memory = await ledgerLinesList(prisma, slice, q, scope, NOW, { memory: true });
        const view = (x: typeof db) => ({
          total: x.total,
          page: x.page,
          totals: x.totals,
          rows: x.rows,
          meta: x.meta,
        });
        expect(view(db), JSON.stringify([slice, q])).toEqual(view(memory));
      }
    const page = await ledgerLinesList(prisma, { account: bank.id }, { size: '25' }, scope, NOW);
    expect(page.total).toBe(70);
    expect(page.rows).toHaveLength(25);
  });
});

describe('lists past the newest rows', () => {
  it('pages, searches and sums every order, not only the newest 5,000', async () => {
    // 5,200 older orders, the oldest first.
    await prisma.$executeRaw`
      INSERT INTO orders (id, number, merchant_id, dark_store_id, customer_name, customer_phone,
        address_text, delivery_otp, tracking_token, payment_method, subtotal_piastres,
        cod_amount_piastres, placed_at, updated_at)
      SELECT 'old' || g, 'SN' || (200000 + g), ${fx.merchant.id}, ${fx.store.id}, 'Old ' || g,
        '+2011' || lpad(g::text, 8, '0'), 'x', '1', 'old' || g, 'cod', 100, 10,
        ${cairoDayStart('2025-01-01').toISOString()}::timestamptz AT TIME ZONE 'UTC'
          + g * interval '1 minute',
        now()
      FROM generate_series(1, 5200) g`;
    const scope = all;
    const total = 90 + 5200;
    const last = await queryAppList(prisma, 'operations', 'orders', { page: '106' }, scope, NOW);
    expect(last!.total).toBe(total);
    expect(last!.page).toBe(106);
    // The last page holds the oldest orders: 5,290 = 105 pages of 50 and 40 more.
    expect(last!.rows.map((r) => r.number)).toContain('SN200001');
    expect(last!.rows).toHaveLength(40);
    expect(last!.truncated).toBe(false);
    // Searching the oldest order finds it (the newest 5,000 alone would not hold it).
    const found = await queryAppList(prisma, 'operations', 'orders', { q: 'SN200001' }, scope, NOW);
    expect(found!.rows.map((r) => r.number)).toEqual(['SN200001']);
    const memory = await queryAppList(
      prisma,
      'operations',
      'orders',
      { q: 'SN200001' },
      scope,
      NOW,
      { memory: true },
    );
    expect(memory!.total).toBe(0);
    // Totals cover every order that passes.
    const cod = await queryAppList(
      prisma,
      'operations',
      'orders',
      { v: 'from:2025-01-01,to:2025-01-31' },
      scope,
      NOW,
    );
    expect(cod!.total).toBe(5200);
    expect(cod!.totals.cod).toBe(5200 * 10);
    // Grouped lists still run in memory on the newest rows, and say so.
    const grouped = await queryAppList(prisma, 'operations', 'orders', { g: 'status' }, scope, NOW);
    expect(grouped!.truncated).toBe(true);
    const narrowed = await queryAppList(
      prisma,
      'operations',
      'orders',
      { g: 'status', q: 'old 52' },
      scope,
      NOW,
    );
    expect(narrowed!.truncated).toBe(false);
    // Every old order whose number, name or phone (either form) holds "52".
    let expected = 0;
    for (let g = 1; g <= 5200; g++) {
      const phone = `+2011${String(g).padStart(8, '0')}`;
      const hay = [`SN${200000 + g}`, `Old ${g}`, phone, `0${phone.slice(3)}`].join(' ');
      if (hay.includes('52')) expected += 1;
    }
    expect(narrowed!.total).toBe(expected);
  });
});
