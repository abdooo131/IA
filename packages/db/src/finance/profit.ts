import type { Db } from '../client';

// Profit by where and for whom it was made. Every ledger line carries its dark store,
// merchant and rider (worked out when it is posted), so income and costs add up per tag.
// Lines with no tag are company wide (head office rent, software...).

export type ProfitDimension = 'store' | 'merchant' | 'rider';

const COLUMN: Record<ProfitDimension, string> = {
  store: 'dark_store_id',
  merchant: 'merchant_id',
  rider: 'rider_id',
};

/**
 * Income (fees and other income) and costs per store, merchant or rider between two
 * moments, highest profit first, with the untagged part as one company wide row.
 */
export async function profitBy(db: Db, input: { from: Date; to: Date; by: ProfitDimension }) {
  const column = COLUMN[input.by];
  // Dark stores and riders are Shiply Now's, so their profit (and its company wide row) counts
  // only Shiply Now's lines; a merchant's profit counts both services. Shiply's hubs are read
  // per cost center on the profit and loss page.
  const companyOnly = input.by === 'merchant' ? '' : `AND l.company = 'shiply_now'`;
  const rows = await db.$queryRawUnsafe<{ tag: string | null; income: bigint; costs: bigint }[]>(
    `SELECT l.${column} AS tag,
       COALESCE(-SUM(l.amount_piastres) FILTER (WHERE a.category = 'revenue'), 0) AS income,
       COALESCE(SUM(l.amount_piastres) FILTER (WHERE a.category = 'expense'), 0) AS costs
     FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id
       JOIN ledger_entries e ON e.id = l.entry_id
     WHERE l.occurred_at >= $1 AND l.occurred_at < $2 AND a.category IN ('revenue', 'expense')
       AND e.kind <> 'year_close' ${companyOnly}
     GROUP BY l.${column}`,
    input.from,
    input.to,
  );
  const names = await namesFor(db, input.by);
  const result = rows.map((r) => {
    const income = Number(r.income);
    const costs = Number(r.costs);
    return {
      id: r.tag,
      name: r.tag ? (names.get(r.tag) ?? r.tag) : null,
      incomePiastres: income,
      costsPiastres: costs,
      profitPiastres: income - costs,
    };
  });
  result.sort((a, b) =>
    a.id === null ? 1 : b.id === null ? -1 : b.profitPiastres - a.profitPiastres,
  );
  const total = result.reduce(
    (t, r) => ({
      incomePiastres: t.incomePiastres + r.incomePiastres,
      costsPiastres: t.costsPiastres + r.costsPiastres,
      profitPiastres: t.profitPiastres + r.profitPiastres,
    }),
    { incomePiastres: 0, costsPiastres: 0, profitPiastres: 0 },
  );
  return { by: input.by, rows: result, total };
}

async function namesFor(db: Db, by: ProfitDimension) {
  if (by === 'store') {
    const stores = await db.darkStore.findMany({ select: { id: true, nameEn: true, code: true } });
    return new Map(stores.map((s) => [s.id, `${s.nameEn} (${s.code})`]));
  }
  if (by === 'merchant') {
    const merchants = await db.merchant.findMany({ select: { id: true, name: true } });
    return new Map(merchants.map((m) => [m.id, m.name]));
  }
  const riders = await db.rider.findMany({
    select: { id: true, badgeCode: true, user: { select: { name: true } } },
  });
  return new Map(riders.map((r) => [r.id, `${r.user.name} (${r.badgeCode})`]));
}

/**
 * What one delivered order costs and earns per dark store: fees earned and the store's own
 * costs divided by its delivered orders, then with the company wide costs shared out by
 * each store's part of all delivered orders (the fully loaded cost).
 */
export async function costPerOrder(db: Db, input: { from: Date; to: Date }) {
  const delivered = await db.order.groupBy({
    by: ['darkStoreId'],
    where: { status: 'delivered', deliveredAt: { gte: input.from, lt: input.to } },
    _count: { _all: true },
  });
  const profit = await profitBy(db, { ...input, by: 'store' });
  const companyCosts = profit.rows.find((r) => r.id === null)?.costsPiastres ?? 0;
  const allOrders = delivered.reduce((s, d) => s + d._count._all, 0);
  const stores = await db.darkStore.findMany({
    where: { kind: 'dark_store' },
    select: { id: true, code: true, nameEn: true, nameAr: true },
  });
  const per = (amount: number, orders: number) => (orders > 0 ? Math.round(amount / orders) : null);
  const rows = stores.map((s) => {
    const orders = delivered.find((d) => d.darkStoreId === s.id)?._count._all ?? 0;
    const row = profit.rows.find((r) => r.id === s.id);
    const income = row?.incomePiastres ?? 0;
    const direct = row?.costsPiastres ?? 0;
    // The store's part of company wide costs, by its part of all delivered orders.
    const shared = allOrders > 0 ? Math.round((companyCosts * orders) / allOrders) : 0;
    return {
      store: s,
      deliveredOrders: orders,
      incomePiastres: income,
      directCostsPiastres: direct,
      sharedCostsPiastres: shared,
      incomePerOrderPiastres: per(income, orders),
      directCostPerOrderPiastres: per(direct, orders),
      fullCostPerOrderPiastres: per(direct + shared, orders),
      profitPerOrderPiastres: per(income - direct - shared, orders),
    };
  });
  return { deliveredOrders: allOrders, companyCostsPiastres: companyCosts, rows };
}
