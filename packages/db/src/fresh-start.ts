import type { Prisma, PrismaClient } from '@prisma/client';
import { DEMO_OFFICE } from './demo/data';

type Tx = Prisma.TransactionClient;

/** The word the owner types (FRESH_START) to confirm the wipe. */
export const FRESH_START_CONFIRMATION = 'WIPE-DEMO-2026-11-07';

/** The merchant that stays: found by name or by its Shopify store. */
const KEPT_MERCHANT_NAME = 'nabta';
const KEPT_SHOP_DOMAIN = 'getnabta.myshopify.com';

/**
 * Tables whose append only (or fixed) triggers refuse DELETE. They are emptied entirely, so
 * their user triggers are switched off for the delete and on again before commit.
 */
const GUARDED_TABLES = [
  'audit_log',
  'ledger_entries',
  'ledger_lines',
  'order_events',
  'punches',
  'stock_movements',
  'tax_invoices',
  'tax_invoice_lines',
  'ticket_messages',
];

export type TableCounts = Record<string, number>;

export interface FreshStartResult {
  status: 'done';
  keptMerchants: string[];
  keptUsers: number;
  before: TableCounts;
  after: TableCounts;
}

/** True once the fresh start ran on this database (the seed and the demo loader check it). */
export async function freshStartDone(db: PrismaClient | Tx): Promise<boolean> {
  const rows = await db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM fresh_starts`;
  return (rows[0]?.n ?? 0) > 0;
}

async function countTables(tx: Tx): Promise<TableCounts> {
  const tables = await tx.$queryRaw<{ name: string }[]>`
    SELECT tablename AS name FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')
    ORDER BY tablename`;
  const counts: TableCounts = {};
  for (const { name } of tables) {
    const rows = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "${name}"`,
    );
    counts[name] = rows[0]!.n;
  }
  return counts;
}

/**
 * The one time "fresh start" (docs/DEPLOY.md): wipes every piece of activity (orders, stock,
 * money, HR attendance, tickets, alerts, audit history...) and the sample merchants and
 * people, and keeps the setup: places and the area map, settings, the HR structure, the
 * chart of accounts and company profile, the admins and the merchant Nabta with its
 * Shopify connection, catalog and Shopify data. Everything happens in one transaction, so a
 * failure leaves the data untouched. It refuses without the confirmation word and when it
 * already ran (a row in fresh_starts).
 */
export async function freshStart(
  db: PrismaClient,
  options: { confirm: string; log?: (message: string) => void },
): Promise<FreshStartResult> {
  if (options.confirm !== FRESH_START_CONFIRMATION) throw new Error('fresh_start_not_confirmed');
  const log = options.log ?? (() => undefined);

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fresh_start'))`;
      if (await freshStartDone(tx)) throw new Error('fresh_start_already_done');

      const before = await countTables(tx);
      const run = async (label: string, sql: string) => {
        const n = await tx.$executeRawUnsafe(sql);
        if (n > 0) log(`${label}: ${n}`);
      };

      // What stays: Nabta, its users and Shopify rows, admins (not the demo office team),
      // their employee files, and the customers Nabta's Shopify data links to.
      const demoOffice = DEMO_OFFICE.map((o) => `'${o.email.replace(/'/g, "''")}'`).join(', ');
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE fs_merchants ON COMMIT DROP AS
        SELECT id FROM merchants
        WHERE lower(btrim(name)) = '${KEPT_MERCHANT_NAME}'
           OR id IN (SELECT merchant_id FROM shopify_shops WHERE shop_domain = '${KEPT_SHOP_DOMAIN}')`);
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE fs_users ON COMMIT DROP AS
        SELECT id FROM users
        WHERE (role = 'admin' AND email NOT IN (${demoOffice}))
           OR merchant_id IN (SELECT id FROM fs_merchants)`);
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE fs_shops ON COMMIT DROP AS
        SELECT id FROM shopify_shops WHERE merchant_id IN (SELECT id FROM fs_merchants)`);
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE fs_employees ON COMMIT DROP AS
        SELECT id FROM employees WHERE user_id IN (SELECT id FROM fs_users)`);
      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE fs_customers ON COMMIT DROP AS
        SELECT customer_id AS id FROM shop_customers
          WHERE customer_id IS NOT NULL AND shop_id IN (SELECT id FROM fs_shops)
        UNION
        SELECT customer_id FROM shop_orders
          WHERE customer_id IS NOT NULL AND shop_id IN (SELECT id FROM fs_shops)`);

      const keptMerchants = (
        await tx.$queryRaw<{ name: string }[]>`
          SELECT name FROM merchants WHERE id IN (SELECT id FROM fs_merchants) ORDER BY name`
      ).map((r) => r.name);
      const [{ n: keptUsers }] = (await tx.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM fs_users`) as [{ n: number }];
      log(`Keeping merchants: ${keptMerchants.join(', ') || 'none'}; users: ${keptUsers}`);

      for (const table of GUARDED_TABLES) {
        await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
      }

      const gone = (column: string, keep: string) =>
        `${column} IS NOT NULL AND ${column} NOT IN (SELECT id FROM ${keep})`;

      // Money: statements, receipts, requests, documents, then the ledger itself.
      await run('bank statement lines', 'DELETE FROM bank_statement_lines');
      await run('bank statements', 'DELETE FROM bank_statements');
      await run('finance receipts', 'DELETE FROM finance_receipts');
      await run('finance requests', 'DELETE FROM finance_requests');
      await run('tax invoice lines', 'DELETE FROM tax_invoice_lines');
      await run('credit notes', 'DELETE FROM tax_invoices WHERE original_id IS NOT NULL');
      await run('tax invoices', 'DELETE FROM tax_invoices');
      await run('bills', 'DELETE FROM bills');
      await run('prepayments', 'DELETE FROM prepayments');
      await run('fixed assets', 'DELETE FROM fixed_assets');
      await run('recurring entries', 'DELETE FROM recurring_entries');
      await run('budgets', 'DELETE FROM budgets');
      await run('payouts', 'DELETE FROM payouts');
      await run('cash handovers', 'DELETE FROM cash_handovers');
      await run('ledger lines', 'DELETE FROM ledger_lines');
      await run('ledger entries', 'DELETE FROM ledger_entries');
      await run('books lock', 'DELETE FROM books_lock');

      // Stock and orders.
      await run('damage reports', 'DELETE FROM damage_reports');
      await run('stock movements', 'DELETE FROM stock_movements');
      await run('shopify outbox', 'DELETE FROM shopify_outbox');
      await run('shopify logs', 'DELETE FROM shopify_logs');
      await run('order ratings', 'DELETE FROM order_ratings');
      await run('deliveries', 'DELETE FROM deliveries');
      await run('order events', 'DELETE FROM order_events');
      await run('order items', 'DELETE FROM order_items');
      await run('delivered points', 'DELETE FROM delivered_points');
      await run('alerts', 'DELETE FROM alerts');
      await run('orders', 'DELETE FROM orders');
      await run('photos', 'DELETE FROM photos');
      await run('count lines', 'DELETE FROM stock_count_lines');
      await run('counts', 'DELETE FROM stock_counts');
      await run('manifest lines', 'DELETE FROM inbound_manifest_lines');
      await run('manifests', 'DELETE FROM inbound_manifests');
      await run('return lines', 'DELETE FROM merchant_return_lines');
      await run('returns', 'DELETE FROM merchant_returns');
      await run('transfer lines', 'DELETE FROM transfer_lines');
      await run('transfers', 'DELETE FROM transfers');
      await run('stock targets', 'DELETE FROM stock_targets');
      await run('bin stock', 'DELETE FROM bin_stock');
      await run('stock levels', 'DELETE FROM stock_levels');

      // Communication, history and attendance.
      await run('ticket messages', 'DELETE FROM ticket_messages');
      await run('tickets', 'DELETE FROM tickets');
      await run('notifications', 'DELETE FROM notifications');
      await run('push sent', 'DELETE FROM push_sent');
      await run('audit log', 'DELETE FROM audit_log');
      await run('geo suggestions', 'DELETE FROM geo_suggestions');
      await run('punches', 'DELETE FROM punches');
      await run('attendance days', 'DELETE FROM attendance_days');
      await run('roster days', 'DELETE FROM roster_days');

      // Party wallets of everyone who goes (all riders and suppliers), then riders.
      await run(
        'party wallets',
        `DELETE FROM ledger_accounts WHERE rider_id IS NOT NULL OR supplier_id IS NOT NULL
           OR (${gone('merchant_id', 'fs_merchants')}) OR (${gone('user_id', 'fs_users')})`,
      );
      await run('riders', 'DELETE FROM riders');

      // People: kept files lose links to people who go, then the rest of the files go.
      const ownUser = '(SELECT e.user_id FROM employees e WHERE e.id = employee_id)';
      await run(
        'kept documents re-signed',
        `UPDATE employee_documents SET uploaded_by_id = ${ownUser}
         WHERE employee_id IN (SELECT id FROM fs_employees) AND ${gone('uploaded_by_id', 'fs_users')}`,
      );
      await run(
        'kept documents reviewer',
        `UPDATE employee_documents SET reviewed_by_id = ${ownUser}
         WHERE employee_id IN (SELECT id FROM fs_employees) AND ${gone('reviewed_by_id', 'fs_users')}`,
      );
      await run(
        'kept salary packages',
        `UPDATE salary_packages SET created_by_id = ${ownUser}
         WHERE employee_id IN (SELECT id FROM fs_employees) AND ${gone('created_by_id', 'fs_users')}`,
      );
      await run(
        'kept checklists',
        `UPDATE employee_checklists SET created_by_id = ${ownUser}
         WHERE employee_id IN (SELECT id FROM fs_employees) AND ${gone('created_by_id', 'fs_users')}`,
      );
      await run(
        'kept checklist tasks',
        `UPDATE employee_checklist_tasks SET done_by_id = NULL WHERE ${gone('done_by_id', 'fs_users')}`,
      );
      await run(
        'salary packages',
        'DELETE FROM salary_packages WHERE employee_id NOT IN (SELECT id FROM fs_employees)',
      );
      await run(
        'kept files leave their outsourcing company',
        `UPDATE employees SET staffing_supplier_id = NULL, employment = 'employee'
         WHERE staffing_supplier_id IS NOT NULL`,
      );
      await run('suppliers', 'DELETE FROM suppliers');
      await run(
        'employee files',
        'DELETE FROM employees WHERE id NOT IN (SELECT id FROM fs_employees)',
      );

      // Setup rows keep working without the people who go.
      await run(
        'settings of removed merchants',
        `DELETE FROM settings WHERE scope LIKE 'merchant:%'
           AND substr(scope, 10) NOT IN (SELECT id FROM fs_merchants)`,
      );
      for (const [table, column] of [
        ['settings', 'updated_by_id'],
        ['store_areas', 'created_by_id'],
        ['merchants', 'account_manager_id'],
        ['holidays', 'created_by_id'],
        ['ledger_accounts', 'created_by_id'],
        ['company_profile', 'updated_by_id'],
      ] as const) {
        await run(
          `${table}.${column} cleared`,
          `UPDATE ${table} SET ${column} = NULL WHERE ${gone(column, 'fs_users')}`,
        );
      }

      // Shopify and customer data of the merchants who go.
      const otherShop = 'shop_id NOT IN (SELECT id FROM fs_shops)';
      await run('shop orders', `DELETE FROM shop_orders WHERE ${otherShop}`);
      await run('shop customers', `DELETE FROM shop_customers WHERE ${otherShop}`);
      await run('shop variants', `DELETE FROM shop_variants WHERE ${otherShop}`);
      await run('shop products', `DELETE FROM shop_products WHERE ${otherShop}`);
      await run('shop stock', `DELETE FROM shop_inventory_levels WHERE ${otherShop}`);
      await run(
        'stock sync rows',
        `DELETE FROM shopify_stock_sync WHERE sku_id NOT IN
           (SELECT id FROM skus WHERE merchant_id IN (SELECT id FROM fs_merchants))`,
      );
      await run('shopify locations', `DELETE FROM shopify_locations WHERE ${otherShop}`);
      await run(
        'shopify shops',
        'DELETE FROM shopify_shops WHERE id NOT IN (SELECT id FROM fs_shops)',
      );
      await run(
        'shopify apps',
        'DELETE FROM shopify_apps WHERE id NOT IN (SELECT app_id FROM shopify_shops WHERE app_id IS NOT NULL)',
      );
      await run('customers', 'DELETE FROM customers WHERE id NOT IN (SELECT id FROM fs_customers)');

      // Catalog, accounts and merchants.
      await run('skus', 'DELETE FROM skus WHERE merchant_id NOT IN (SELECT id FROM fs_merchants)');
      await run('users', 'DELETE FROM users WHERE id NOT IN (SELECT id FROM fs_users)');
      await run('merchants', 'DELETE FROM merchants WHERE id NOT IN (SELECT id FROM fs_merchants)');

      for (const table of GUARDED_TABLES) {
        await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
      }

      // Numbering starts again. Documents (JV, PAY, CH, TCK, BILL, BS, INV, CN, RET) and
      // account codes take MAX + 1 of their own rows, so the deletes already reset them;
      // order numbers come from a sequence, and EMP numbers continue after the kept files.
      await tx.$executeRawUnsafe('ALTER SEQUENCE order_number_seq RESTART');
      const [{ max }] = (await tx.$queryRaw<{ max: number | null }[]>`
        SELECT MAX(number)::int AS max FROM employees`) as [{ max: number | null }];
      await tx.$executeRawUnsafe(
        `ALTER SEQUENCE ${await serialSequence(tx, 'employees', 'number')} RESTART WITH ${(max ?? 0) + 1}`,
      );

      const after = await countTables(tx);
      await tx.freshStart.create({
        data: { keptMerchants, counts: { before, after } as Prisma.InputJsonValue },
      });
      return { status: 'done' as const, keptMerchants, keptUsers, before, after };
    },
    { maxWait: 30_000, timeout: 15 * 60_000 },
  );
}

async function serialSequence(tx: Tx, table: string, column: string): Promise<string> {
  const [{ name }] = (await tx.$queryRaw<{ name: string }[]>`
    SELECT pg_get_serial_sequence(${table}, ${column}) AS name`) as [{ name: string }];
  return name;
}
