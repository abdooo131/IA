import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDemo } from '../src/demo';
import { post } from '../src/finance';
import { freshStart, freshStartDone, FRESH_START_CONFIRMATION } from '../src/fresh-start';
import { createOrder } from '../src/orders';
import { verifyPassword } from '../src/password';
import { seed } from '../src/seed';
import { move, receive } from '../src/stock';
import { createTicket } from '../src/tickets';
import { createNabta } from './nabta-fixture';
import { prisma, resetDatabase } from './helpers';

const options = {
  areas: false,
  admin: { email: 'admin@test.eg', password: 'admin-password-1', name: 'Admin' },
  demoPassword: 'demo-password-1',
};

// The demo loader runs long transactions under its simulated clock.
const slow = new PrismaClient({ transactionOptions: { maxWait: 20_000, timeout: 60_000 } });

/** What must survive, as comparable values. */
async function kept() {
  const q = async (sql: string) =>
    JSON.stringify(await prisma.$queryRawUnsafe(sql), (_k, v) =>
      typeof v === 'bigint' ? Number(v) : v,
    );
  const nabtaShop = `(SELECT id FROM shopify_shops WHERE shop_domain = 'getnabta.myshopify.com')`;
  const nabta = `(SELECT id FROM merchants WHERE name = 'Nabta')`;
  return {
    stores: await q('SELECT id, code, kind FROM dark_stores ORDER BY id'),
    bins: await q('SELECT id, code FROM bins ORDER BY id'),
    hours: await q('SELECT COUNT(*) FROM store_hours'),
    zones: await q('SELECT id, md5(ST_AsText(area)) FROM zones ORDER BY id'),
    storeAreas: await q('SELECT COUNT(*) FROM store_areas'),
    geoAreas: await q('SELECT COUNT(*) FROM geo_areas'),
    settings: await q(
      `SELECT key, scope, value FROM settings WHERE scope NOT LIKE 'merchant:%'
         OR scope = 'merchant:' || ${nabta} ORDER BY key, scope`,
    ),
    hr: await q(
      `SELECT (SELECT COUNT(*) FROM departments) d, (SELECT COUNT(*) FROM grades) g,
         (SELECT COUNT(*) FROM job_positions) p, (SELECT COUNT(*) FROM employee_document_types) t,
         (SELECT COUNT(*) FROM checklist_templates) c, (SELECT COUNT(*) FROM checklist_template_tasks) ct,
         (SELECT COUNT(*) FROM shifts) s, (SELECT COUNT(*) FROM holidays) h`,
    ),
    companyAccounts: await q(
      `SELECT code, key FROM ledger_accounts WHERE merchant_id IS NULL AND rider_id IS NULL
         AND supplier_id IS NULL AND user_id IS NULL ORDER BY code`,
    ),
    nabtaWallet: await q(`SELECT code FROM ledger_accounts WHERE merchant_id = ${nabta}`),
    companyProfile: await q('SELECT COUNT(*) FROM company_profile'),
    admin: await q(
      `SELECT u.email, a.job_role, e.number FROM users u
         LEFT JOIN user_access a ON a.user_id = u.id LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.email = 'admin@test.eg'`,
    ),
    nabta: await q(
      `SELECT (SELECT COUNT(*) FROM users WHERE merchant_id = ${nabta}) u,
         (SELECT COUNT(*) FROM skus WHERE merchant_id = ${nabta}) s,
         (SELECT COUNT(*) FROM shopify_apps WHERE id IN (SELECT app_id FROM shopify_shops WHERE id = ${nabtaShop})) a,
         (SELECT COUNT(*) FROM shopify_locations WHERE shop_id = ${nabtaShop}) l,
         (SELECT COUNT(*) FROM shopify_stock_sync) ss,
         (SELECT COUNT(*) FROM shop_data_syncs WHERE shop_id = ${nabtaShop}) ds,
         (SELECT COUNT(*) FROM shop_products WHERE shop_id = ${nabtaShop}) sp,
         (SELECT COUNT(*) FROM shop_variants WHERE shop_id = ${nabtaShop}) sv,
         (SELECT COUNT(*) FROM shop_inventory_levels WHERE shop_id = ${nabtaShop}) si,
         (SELECT COUNT(*) FROM shop_orders WHERE shop_id = ${nabtaShop}) so,
         (SELECT COUNT(*) FROM shop_customers WHERE shop_id = ${nabtaShop}) sc`,
    ),
    customers: await q(
      `SELECT c.phone, (SELECT COUNT(*) FROM customer_aliases a WHERE a.customer_id = c.id) aliases
       FROM customers c WHERE c.id IN (SELECT customer_id FROM shop_customers WHERE shop_id = ${nabtaShop})
       ORDER BY c.phone`,
    ),
  };
}

let before: Awaited<ReturnType<typeof kept>>;
let adminId: string;
let nabtaSkuId: string;
let nabtaId: string;
let storeId: string;

beforeAll(async () => {
  await resetDatabase();
  const seeded = await seed(prisma, options);
  adminId = seeded.adminId;
  process.env.DEMO_LOAD = 'true';
  const demo = await loadDemo(slow, { demoPassword: 'demo-password-1', days: 2, ordersPerDay: 8 });
  expect(demo.status).toBe('loaded');

  // A Shopify store and a fee for a merchant who goes, a ticket between two team members.
  const eve = await prisma.merchant.findFirstOrThrow({ where: { name: 'Eve Chantelle' } });
  await prisma.shopifyShop.create({
    data: { merchantId: eve.id, shopDomain: 'eve.myshopify.com', status: 'active' },
  });
  await prisma.setting.create({
    data: { key: 'fee.order_fixed_piastres', scope: `merchant:${eve.id}`, value: 900 },
  });
  const staff = await prisma.user.findFirstOrThrow({ where: { role: 'store_staff' } });
  await createTicket(prisma, {
    title: 'Shelf broken',
    body: 'A-02 is loose',
    assigneeId: adminId,
    priority: 'normal',
    actorUserId: staff.id,
  });

  const nabta = await createNabta(prisma, adminId, 'nabta-password-1');
  nabtaId = nabta.merchant.id;
  nabtaSkuId = nabta.sku.id;
  storeId = nabta.store.id;
  before = await kept();
}, 300_000);

afterAll(async () => {
  delete process.env.DEMO_LOAD;
  await slow.$disconnect();
  await prisma.$disconnect();
});

describe('fresh start', () => {
  it('refuses without the confirmation word', async () => {
    await expect(freshStart(prisma, { confirm: 'yes' })).rejects.toThrow(
      'fresh_start_not_confirmed',
    );
    expect(await prisma.order.count()).toBeGreaterThan(0);
  });

  it('changes nothing when a step fails', async () => {
    const orders = await prisma.order.count();
    const audit = await prisma.auditLog.count();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_merchant_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'blocked for the test'; END $$`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER block_merchant_delete BEFORE DELETE ON merchants
      FOR EACH ROW EXECUTE FUNCTION fail_merchant_delete()`);
    try {
      await expect(freshStart(prisma, { confirm: FRESH_START_CONFIRMATION })).rejects.toThrow(
        /blocked for the test/,
      );
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER block_merchant_delete ON merchants');
      await prisma.$executeRawUnsafe('DROP FUNCTION fail_merchant_delete()');
    }
    expect(await prisma.order.count()).toBe(orders);
    expect(await prisma.auditLog.count()).toBe(audit);
    expect(await freshStartDone(prisma)).toBe(false);
    const off = await prisma.$queryRaw<{ name: string }[]>`
      SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'O'`;
    expect(off).toEqual([]);
    expect(await kept()).toEqual(before);
  });

  it('wipes the activity and keeps the setup', async () => {
    expect(await prisma.merchant.count()).toBeGreaterThan(2);
    const result = await freshStart(prisma, { confirm: FRESH_START_CONFIRMATION });
    expect(result.keptMerchants).toEqual(['Nabta']);
    expect(result.before.orders).toBeGreaterThan(0);
    expect(result.before.ledger_lines).toBeGreaterThan(0);
    expect(result.before.audit_log).toBeGreaterThan(0);

    expect(await kept()).toEqual(before);

    const empty = [
      'orders',
      'order_items',
      'order_events',
      'order_ratings',
      'deliveries',
      'delivered_points',
      'photos',
      'stock_levels',
      'bin_stock',
      'stock_movements',
      'inbound_manifests',
      'inbound_manifest_lines',
      'stock_counts',
      'stock_count_lines',
      'transfers',
      'transfer_lines',
      'stock_targets',
      'merchant_returns',
      'merchant_return_lines',
      'damage_reports',
      'ledger_entries',
      'ledger_lines',
      'cash_handovers',
      'rider_withdrawals',
      'payouts',
      'finance_requests',
      'finance_receipts',
      'bills',
      'suppliers',
      'tax_invoices',
      'tax_invoice_lines',
      'bank_statements',
      'bank_statement_lines',
      'budgets',
      'prepayments',
      'fixed_assets',
      'recurring_entries',
      'books_lock',
      'riders',
      'punches',
      'attendance_days',
      'roster_days',
      'tickets',
      'ticket_messages',
      'alerts',
      'notifications',
      'audit_log',
      'push_sent',
      'shopify_outbox',
      'shopify_logs',
      'geo_suggestions',
    ];
    for (const table of empty) expect([table, result.after[table]]).toEqual([table, 0]);

    // Only the admin (no demo office) and Nabta's owner stay; one employee file.
    const users = await prisma.user.findMany({ orderBy: { email: 'asc' } });
    expect(users.map((u) => u.email)).toEqual(['admin@test.eg', 'owner@getnabta.example']);
    expect(await prisma.employee.count()).toBe(1);
    expect(await prisma.salaryPackage.count()).toBe(0);
    expect((await prisma.merchant.findMany()).map((m) => m.name)).toEqual(['Nabta']);
    expect(await prisma.sku.count()).toBe(1);
    expect(await prisma.shopifyShop.count()).toBe(1);
    expect(await prisma.setting.count({ where: { scope: { startsWith: 'merchant:' } } })).toBe(1);
    expect(
      await prisma.ledgerAccount.count({
        where: {
          OR: [
            { riderId: { not: null } },
            { supplierId: { not: null } },
            { userId: { not: null } },
          ],
        },
      }),
    ).toBe(0);

    // The admin can still sign in.
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.eg' } });
    expect(await verifyPassword(admin.passwordHash, 'admin-password-1')).toBe(true);
  });

  it('leaves every trigger switched on', async () => {
    const off = await prisma.$queryRaw<{ name: string }[]>`
      SELECT t.tgname AS name FROM pg_trigger t
      WHERE NOT t.tgisinternal AND t.tgenabled <> 'O'`;
    expect(off).toEqual([]);
    await receive(prisma, {
      skuId: nabtaSkuId,
      binId: (
        await prisma.bin.findFirstOrThrow({ where: { darkStoreId: storeId, type: 'receiving' } })
      ).id,
      quantity: 3,
      actorUserId: adminId,
      reason: 'opening_stock',
      idempotencyKey: 'after:receive',
    });
    await expect(prisma.$executeRaw`UPDATE stock_movements SET quantity = 9`).rejects.toThrow(
      /append only/i,
    );
    await expect(
      post(prisma, {
        kind: 'test',
        idempotencyKey: 'after:unbalanced',
        lines: [
          { account: { type: 'bank' }, amount: 100 },
          { account: { type: 'revenue' }, amount: -99 },
        ],
      }),
    ).rejects.toThrow(/unbalanced/);
    // The database itself still refuses an unbalanced entry.
    await expect(
      prisma.$transaction(async (tx) => {
        const bank = await tx.ledgerAccount.findFirstOrThrow({ where: { groupCode: 1100 } });
        const entry = await tx.ledgerEntry.create({
          data: { number: 99, kind: 'test', idempotencyKey: 'raw', occurredAt: new Date() },
        });
        await tx.ledgerLine.create({
          data: {
            entryId: entry.id,
            accountId: bank.id,
            amountPiastres: 5,
            occurredAt: new Date(),
          },
        });
      }),
    ).rejects.toThrow(/does not balance/);
  });

  it('starts numbering again for orders and journal entries', async () => {
    const bin = (type: 'receiving' | 'pickable') =>
      prisma.bin.findFirstOrThrow({
        where: { darkStoreId: storeId, type },
        orderBy: { code: 'asc' },
      });
    await move(prisma, {
      skuId: nabtaSkuId,
      fromBinId: (await bin('receiving')).id,
      toBinId: (await bin('pickable')).id,
      quantity: 3,
      actorUserId: adminId,
      reason: 'put_away',
      idempotencyKey: 'after:putaway',
    });
    const order = await createOrder(prisma, {
      merchantId: nabtaId,
      darkStoreId: storeId,
      source: 'manual',
      customerName: 'First real customer',
      customerPhone: '01000009009',
      addressText: 'Street 1',
      paymentMethod: 'cod',
      deliveryFeePiastres: 3000,
      items: [{ skuId: nabtaSkuId, quantity: 1 }],
      actorUserId: adminId,
    });
    expect(order.number).toBe('SN100001');
    const entry = await post(prisma, {
      kind: 'test',
      idempotencyKey: 'after:balanced',
      lines: [
        { account: { type: 'merchant', merchantId: nabtaId }, amount: -100 },
        { account: { type: 'revenue' }, amount: 100 },
      ],
    });
    expect(entry?.number).toBe(1);
    const wallet = await prisma.ledgerAccount.count({ where: { merchantId: nabtaId } });
    expect(wallet).toBe(1);
  });

  it('runs once, and the seed and the demo loader add no samples afterwards', async () => {
    expect(await freshStartDone(prisma)).toBe(true);
    await expect(freshStart(prisma, { confirm: FRESH_START_CONFIRMATION })).rejects.toThrow(
      'fresh_start_already_done',
    );
    const result = await seed(prisma, options);
    expect(result.merchantId).toBeNull();
    expect((await prisma.merchant.findMany()).map((m) => m.name)).toEqual(['Nabta']);
    expect(await prisma.user.count()).toBe(2);
    expect(await prisma.rider.count()).toBe(0);
    expect(await prisma.sku.count()).toBe(1);
    expect(await loadDemo(slow, { demoPassword: 'demo-password-1', days: 1 })).toEqual({
      status: 'fresh_start_done',
    });
    expect(await prisma.merchant.count()).toBe(1);
  });
});
