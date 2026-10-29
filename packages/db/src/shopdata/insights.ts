import type { Db } from '../client';

// What the collected Shopify data says, per merchant and across all merchants. Sales count
// orders that are not tests and not cancelled; money is net of refunds, in piastres.

const DAY = 86_400_000;
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

/** One merchant: catalogue, stock, sales over time, what sells, what does not, and where. */
export async function merchantInsights(db: Db, merchantId: string, now: Date = new Date()) {
  const d30 = new Date(now.getTime() - 30 * DAY);
  const d90 = new Date(now.getTime() - 90 * DAY);
  const shop = await db.shopifyShop.findUnique({
    where: { merchantId },
    include: { dataSyncs: { orderBy: { startedAt: 'desc' }, take: 6 } },
  });

  const [catalogue] = await db.$queryRaw<
    {
      products: bigint;
      active: bigint;
      draft: bigint;
      archived: bigint;
      variants: bigint;
      categories: bigint;
    }[]
  >`
    SELECT COUNT(*) AS products,
      COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active,
      COUNT(*) FILTER (WHERE status = 'DRAFT') AS draft,
      COUNT(*) FILTER (WHERE status = 'ARCHIVED') AS archived,
      (SELECT COUNT(*) FROM shop_variants v JOIN shop_products p2 ON p2.shopify_id = v.product_shopify_id
         WHERE p2.merchant_id = ${merchantId}) AS variants,
      COUNT(DISTINCT category_top) AS categories
    FROM shop_products WHERE merchant_id = ${merchantId}`;

  const [stock] = await db.$queryRaw<
    { own: bigint; ours: bigint; locations: bigint; value: bigint }[]
  >`
    SELECT COALESCE(SUM(l.available) FILTER (WHERE NOT l.ours), 0) AS own,
      COALESCE(SUM(l.available) FILTER (WHERE l.ours), 0) AS ours,
      COUNT(DISTINCT l.location_id) FILTER (WHERE NOT l.ours) AS locations,
      COALESCE(SUM(GREATEST(l.available, 0) * v.price_piastres), 0) AS value
    FROM shop_inventory_levels l
    JOIN shop_variants v ON v.inventory_item_id = l.inventory_item_id
    JOIN shop_products p ON p.shopify_id = v.product_shopify_id
    WHERE p.merchant_id = ${merchantId}`;

  const [sales] = await db.$queryRaw<
    {
      orders: bigint;
      revenue: bigint;
      units: bigint;
      discounts: bigint;
      subtotal: bigint;
      first: Date | null;
      last: Date | null;
      orders30: bigint;
      revenue30: bigint;
    }[]
  >`
    SELECT COUNT(*) AS orders,
      COALESCE(SUM(total_piastres - refunded_piastres), 0) AS revenue,
      COALESCE(SUM(units), 0) AS units,
      COALESCE(SUM(discounts_piastres), 0) AS discounts,
      COALESCE(SUM(subtotal_piastres + discounts_piastres), 0) AS subtotal,
      MIN(created_at_shop) AS first, MAX(created_at_shop) AS last,
      COUNT(*) FILTER (WHERE created_at_shop >= ${d30}) AS orders30,
      COALESCE(SUM(total_piastres - refunded_piastres) FILTER (WHERE created_at_shop >= ${d30}), 0) AS revenue30
    FROM shop_orders WHERE merchant_id = ${merchantId} AND NOT test AND cancelled_at IS NULL`;

  const monthly = await db.$queryRaw<
    { month: string; orders: bigint; revenue: bigint; units: bigint }[]
  >`
    SELECT to_char(date_trunc('month', created_at_shop AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM') AS month,
      COUNT(*) AS orders, SUM(total_piastres - refunded_piastres) AS revenue, SUM(units) AS units
    FROM shop_orders WHERE merchant_id = ${merchantId} AND NOT test AND cancelled_at IS NULL
      AND created_at_shop >= now() - interval '24 months'
    GROUP BY 1 ORDER BY 1`;

  /** Products with sales, stock and how many days the stock lasts at the last 30 days' pace. */
  const products = await db.$queryRaw<
    {
      shopify_id: string;
      title: string;
      status: string;
      category_top: string | null;
      image_url: string | null;
      units90: bigint;
      revenue90: bigint;
      units30: bigint;
      revenue_all: bigint;
      stock: bigint;
      last_sold: Date | null;
    }[]
  >`
    WITH sold AS (
      SELECT li.product_shopify_id AS pid,
        SUM(li.current_quantity) FILTER (WHERE o.created_at_shop >= ${d90}) AS units90,
        SUM(li.total_piastres) FILTER (WHERE o.created_at_shop >= ${d90}) AS revenue90,
        SUM(li.current_quantity) FILTER (WHERE o.created_at_shop >= ${d30}) AS units30,
        SUM(li.total_piastres) AS revenue_all,
        MAX(o.created_at_shop) AS last_sold
      FROM shop_order_lines li JOIN shop_orders o ON o.shopify_id = li.order_shopify_id
      WHERE o.merchant_id = ${merchantId} AND NOT o.test AND o.cancelled_at IS NULL
      GROUP BY 1),
    stock AS (
      SELECT v.product_shopify_id AS pid, SUM(GREATEST(l.available, 0)) AS stock
      FROM shop_inventory_levels l JOIN shop_variants v ON v.inventory_item_id = l.inventory_item_id
      GROUP BY 1)
    SELECT p.shopify_id, p.title, p.status, p.category_top, p.image_url,
      COALESCE(s.units90, 0) AS units90, COALESCE(s.revenue90, 0) AS revenue90,
      COALESCE(s.units30, 0) AS units30, COALESCE(s.revenue_all, 0) AS revenue_all,
      COALESCE(st.stock, p.total_inventory) AS stock, s.last_sold
    FROM shop_products p
    LEFT JOIN sold s ON s.pid = p.shopify_id
    LEFT JOIN stock st ON st.pid = p.shopify_id
    WHERE p.merchant_id = ${merchantId}`;

  const rows = products.map((p) => {
    const perDay = n(p.units30) / 30;
    return {
      id: p.shopify_id,
      title: p.title,
      status: p.status,
      category: p.category_top,
      imageUrl: p.image_url,
      units90: n(p.units90),
      revenue90: n(p.revenue90),
      revenueAll: n(p.revenue_all),
      stock: n(p.stock),
      /** Days the stock lasts at the last 30 days' pace; null when nothing sold */
      coverDays: perDay > 0 ? Math.round(n(p.stock) / perDay) : null,
      lastSold: p.last_sold,
    };
  });
  const byRevenue = [...rows].sort((a, b) => b.revenue90 - a.revenue90);
  const total90 = rows.reduce((s, r) => s + r.revenue90, 0);
  // ABC: A makes the first 80% of the last 90 days' sales, B the next 15%, C the rest.
  let running = 0;
  const abc = { A: 0, B: 0, C: 0 };
  for (const r of byRevenue) {
    if (r.revenue90 === 0) {
      abc.C++;
      continue;
    }
    running += r.revenue90;
    const share = total90 ? running / total90 : 1;
    abc[share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C']++;
  }

  const categories = await db.$queryRaw<
    { category: string; products: bigint; revenue90: bigint; units90: bigint }[]
  >`
    SELECT COALESCE(p.category_top, 'Uncategorized') AS category, COUNT(DISTINCT p.id) AS products,
      COALESCE(SUM(li.total_piastres) FILTER (WHERE o.created_at_shop >= ${d90}), 0) AS revenue90,
      COALESCE(SUM(li.current_quantity) FILTER (WHERE o.created_at_shop >= ${d90}), 0) AS units90
    FROM shop_products p
    LEFT JOIN shop_order_lines li ON li.product_shopify_id = p.shopify_id
    LEFT JOIN shop_orders o ON o.shopify_id = li.order_shopify_id AND NOT o.test AND o.cancelled_at IS NULL
    WHERE p.merchant_id = ${merchantId}
    GROUP BY 1 ORDER BY revenue90 DESC`;

  const regions = await db.$queryRaw<{ province: string; orders: bigint; revenue: bigint }[]>`
    SELECT COALESCE(province, 'Unknown') AS province, COUNT(*) AS orders,
      SUM(total_piastres - refunded_piastres) AS revenue
    FROM shop_orders WHERE merchant_id = ${merchantId} AND NOT test AND cancelled_at IS NULL
      AND created_at_shop >= ${d90}
    GROUP BY 1 ORDER BY revenue DESC LIMIT 15`;

  const channels = await db.$queryRaw<{ source: string; orders: bigint; revenue: bigint }[]>`
    SELECT COALESCE(source_name, 'unknown') AS source, COUNT(*) AS orders,
      SUM(total_piastres - refunded_piastres) AS revenue
    FROM shop_orders WHERE merchant_id = ${merchantId} AND NOT test AND cancelled_at IS NULL
    GROUP BY 1 ORDER BY revenue DESC`;

  const orders = n(sales?.orders);
  return {
    shop: shop
      ? {
          domain: shop.shopDomain,
          profile: shop.profile as unknown,
          dataSyncedAt: shop.dataSyncedAt,
          syncs: shop.dataSyncs.map((s) => ({
            kind: s.kind,
            status: s.status,
            objectCount: s.objectCount,
            limited: s.limited,
            error: s.error,
            startedAt: s.startedAt,
            finishedAt: s.finishedAt,
          })),
        }
      : null,
    catalogue: {
      products: n(catalogue?.products),
      active: n(catalogue?.active),
      draft: n(catalogue?.draft),
      archived: n(catalogue?.archived),
      variants: n(catalogue?.variants),
      categories: n(catalogue?.categories),
    },
    stock: {
      ownWarehouses: n(stock?.own),
      inOurStores: n(stock?.ours),
      warehouses: n(stock?.locations),
      valuePiastres: n(stock?.value),
    },
    sales: {
      orders,
      revenuePiastres: n(sales?.revenue),
      units: n(sales?.units),
      averageOrderPiastres: orders ? Math.round(n(sales?.revenue) / orders) : 0,
      /** Share of the list price given away in discounts, in basis points */
      discountRateBp: n(sales?.subtotal)
        ? Math.round((n(sales?.discounts) * 10_000) / n(sales?.subtotal))
        : 0,
      firstOrderAt: sales?.first ?? null,
      lastOrderAt: sales?.last ?? null,
      orders30: n(sales?.orders30),
      revenue30Piastres: n(sales?.revenue30),
    },
    monthly: monthly.map((m) => ({
      month: m.month,
      orders: n(m.orders),
      revenuePiastres: n(m.revenue),
      units: n(m.units),
    })),
    abc,
    topProducts: byRevenue.filter((r) => r.revenue90 > 0).slice(0, 15),
    runningOut: rows
      .filter((r) => r.coverDays !== null && r.coverDays < 14 && r.status === 'ACTIVE')
      .sort((a, b) => a.coverDays! - b.coverDays!)
      .slice(0, 15),
    deadStock: rows
      .filter(
        (r) =>
          r.stock > 0 &&
          r.status === 'ACTIVE' &&
          (!r.lastSold || r.lastSold.getTime() < d90.getTime()),
      )
      .sort((a, b) => b.stock - a.stock)
      .slice(0, 15),
    categories: categories.map((c) => ({
      category: c.category,
      products: n(c.products),
      revenue90Piastres: n(c.revenue90),
      units90: n(c.units90),
    })),
    regions: regions.map((r) => ({
      province: r.province,
      orders: n(r.orders),
      revenuePiastres: n(r.revenue),
    })),
    channels: channels.map((c) => ({
      source: c.source,
      orders: n(c.orders),
      revenuePiastres: n(c.revenue),
    })),
  };
}

/** Every merchant together: which categories sell, grow and where, and each merchant's place. */
export async function marketInsights(db: Db, now: Date = new Date()) {
  const d90 = new Date(now.getTime() - 90 * DAY);
  const d180 = new Date(now.getTime() - 180 * DAY);
  const categories = await db.$queryRaw<
    {
      category: string;
      merchants: bigint;
      products: bigint;
      revenue90: bigint;
      revenue_prev: bigint;
      units90: bigint;
      orders90: bigint;
    }[]
  >`
    SELECT COALESCE(p.category_top, 'Uncategorized') AS category,
      COUNT(DISTINCT p.merchant_id) AS merchants, COUNT(DISTINCT p.id) AS products,
      COALESCE(SUM(li.total_piastres) FILTER (WHERE o.created_at_shop >= ${d90}), 0) AS revenue90,
      COALESCE(SUM(li.total_piastres) FILTER (WHERE o.created_at_shop >= ${d180} AND o.created_at_shop < ${d90}), 0) AS revenue_prev,
      COALESCE(SUM(li.current_quantity) FILTER (WHERE o.created_at_shop >= ${d90}), 0) AS units90,
      COUNT(DISTINCT o.id) FILTER (WHERE o.created_at_shop >= ${d90}) AS orders90
    FROM shop_products p
    LEFT JOIN shop_order_lines li ON li.product_shopify_id = p.shopify_id
    LEFT JOIN shop_orders o ON o.shopify_id = li.order_shopify_id AND NOT o.test AND o.cancelled_at IS NULL
    GROUP BY 1 ORDER BY revenue90 DESC`;
  const total90 = categories.reduce((s, c) => s + n(c.revenue90), 0);

  const monthly = await db.$queryRaw<
    { month: string; orders: bigint; revenue: bigint; merchants: bigint }[]
  >`
    SELECT to_char(date_trunc('month', created_at_shop AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM') AS month,
      COUNT(*) AS orders, SUM(total_piastres - refunded_piastres) AS revenue,
      COUNT(DISTINCT merchant_id) AS merchants
    FROM shop_orders WHERE NOT test AND cancelled_at IS NULL AND created_at_shop >= now() - interval '24 months'
    GROUP BY 1 ORDER BY 1`;

  const regions = await db.$queryRaw<
    { province: string; orders: bigint; revenue: bigint; merchants: bigint }[]
  >`
    SELECT COALESCE(province, 'Unknown') AS province, COUNT(*) AS orders,
      SUM(total_piastres - refunded_piastres) AS revenue, COUNT(DISTINCT merchant_id) AS merchants
    FROM shop_orders WHERE NOT test AND cancelled_at IS NULL AND created_at_shop >= ${d90}
    GROUP BY 1 ORDER BY revenue DESC LIMIT 20`;

  const merchants = await db.$queryRaw<
    {
      merchant_id: string;
      name: string;
      orders90: bigint;
      revenue90: bigint;
      products: bigint;
      top_category: string | null;
    }[]
  >`
    SELECT m.id AS merchant_id, m.name,
      (SELECT COUNT(*) FROM shop_orders o WHERE o.merchant_id = m.id AND NOT o.test AND o.cancelled_at IS NULL AND o.created_at_shop >= ${d90}) AS orders90,
      (SELECT COALESCE(SUM(o.total_piastres - o.refunded_piastres), 0) FROM shop_orders o WHERE o.merchant_id = m.id AND NOT o.test AND o.cancelled_at IS NULL AND o.created_at_shop >= ${d90}) AS revenue90,
      (SELECT COUNT(*) FROM shop_products p WHERE p.merchant_id = m.id) AS products,
      (SELECT p.category_top FROM shop_products p WHERE p.merchant_id = m.id GROUP BY p.category_top ORDER BY COUNT(*) DESC LIMIT 1) AS top_category
    FROM merchants m
    WHERE EXISTS (SELECT 1 FROM shop_products p WHERE p.merchant_id = m.id)
       OR EXISTS (SELECT 1 FROM shopify_shops s WHERE s.merchant_id = m.id)
    ORDER BY revenue90 DESC, m.name`;

  return {
    categories: categories.map((c) => ({
      category: c.category,
      merchants: n(c.merchants),
      products: n(c.products),
      revenue90Piastres: n(c.revenue90),
      sharePct: total90 ? Math.round((n(c.revenue90) * 1000) / total90) / 10 : 0,
      /** Growth against the 90 days before, in percent; null when there was nothing before */
      growthPct: n(c.revenue_prev)
        ? Math.round(((n(c.revenue90) - n(c.revenue_prev)) * 1000) / n(c.revenue_prev)) / 10
        : null,
      units90: n(c.units90),
      averageLinePiastres: n(c.units90) ? Math.round(n(c.revenue90) / n(c.units90)) : 0,
      orders90: n(c.orders90),
    })),
    monthly: monthly.map((m) => ({
      month: m.month,
      orders: n(m.orders),
      revenuePiastres: n(m.revenue),
      merchants: n(m.merchants),
    })),
    regions: regions.map((r) => ({
      province: r.province,
      orders: n(r.orders),
      revenuePiastres: n(r.revenue),
      merchants: n(r.merchants),
    })),
    merchants: merchants.map((m) => ({
      id: m.merchant_id,
      name: m.name,
      orders90: n(m.orders90),
      revenue90Piastres: n(m.revenue90),
      products: n(m.products),
      topCategory: m.top_category,
    })),
  };
}
