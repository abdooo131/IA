import { Prisma } from '@prisma/client';
import type { Db } from '../client';
import { getSetting } from '../settings';

// What we know about each person across every merchant. Purchases are the merchants' Shopify
// orders (not tests) plus our own manual delivery orders; a Shopify order we delivered is
// counted once, from Shopify. Cancelled orders are counted apart and never in spend.
//
//   shop_orders (customer_id) ──┐
//                               ├──▶ purchases ──▶ per customer: orders, spend, merchants,
//   orders without Shopify ─────┘                   first and last order ──▶ segment

const DAY = 86_400_000;
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

export const SEGMENTS = [
  'new',
  'vip',
  'loyal',
  'one_time',
  'at_risk',
  'lost',
  'no_orders',
] as const;
export type Segment = (typeof SEGMENTS)[number];

const PURCHASES = Prisma.sql`
  SELECT so.customer_id, so.merchant_id, so.created_at_shop AS at,
    (so.total_piastres - so.refunded_piastres) AS value, so.cancelled_at IS NOT NULL AS cancelled,
    so.units AS units
  FROM shop_orders so WHERE so.customer_id IS NOT NULL AND NOT so.test
  UNION ALL
  SELECT o.customer_id, o.merchant_id, o.placed_at,
    (o.subtotal_piastres + o.delivery_fee_piastres),
    o.status IN ('cancelled', 'failed', 'moved_to_standard'),
    (SELECT COALESCE(SUM(i.quantity - i.cancelled_qty), 0) FROM order_items i WHERE i.order_id = o.id)
  FROM orders o WHERE o.customer_id IS NOT NULL AND o.shopify_order_id IS NULL`;

async function rules(db: Db) {
  const [newDays, atRiskDays, lostDays, vipOrders] = await Promise.all([
    getSetting(db, 'customer.new_days'),
    getSetting(db, 'customer.at_risk_days'),
    getSetting(db, 'customer.lost_days'),
    getSetting(db, 'customer.vip_orders'),
  ]);
  return { newDays, atRiskDays, lostDays, vipOrders };
}

/** The SQL that names a customer's segment from the per customer totals `t`. */
function segmentSql(r: Awaited<ReturnType<typeof rules>>, now: Date) {
  const lost = new Date(now.getTime() - r.lostDays * DAY);
  const atRisk = new Date(now.getTime() - r.atRiskDays * DAY);
  const fresh = new Date(now.getTime() - r.newDays * DAY);
  return Prisma.sql`CASE
    WHEN t.orders = 0 THEN 'no_orders'
    WHEN t.last_at < ${lost} THEN 'lost'
    WHEN t.last_at < ${atRisk} THEN 'at_risk'
    WHEN t.orders >= ${r.vipOrders} THEN 'vip'
    WHEN t.first_at >= ${fresh} THEN 'new'
    WHEN t.orders >= 2 THEN 'loyal'
    ELSE 'one_time' END`;
}

const TOTALS = Prisma.sql`
  SELECT c.id,
    COUNT(p.customer_id) FILTER (WHERE NOT p.cancelled) AS orders,
    COUNT(p.customer_id) FILTER (WHERE p.cancelled) AS cancelled,
    COALESCE(SUM(p.value) FILTER (WHERE NOT p.cancelled), 0) AS spend,
    COUNT(DISTINCT p.merchant_id) AS merchants,
    MIN(p.at) FILTER (WHERE NOT p.cancelled) AS first_at,
    MAX(p.at) FILTER (WHERE NOT p.cancelled) AS last_at
  FROM customers c LEFT JOIN (${PURCHASES}) p ON p.customer_id = c.id
  GROUP BY c.id`;

type Row = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  governorate: string | null;
  city: string | null;
  orders: bigint;
  spend: bigint;
  merchants: bigint;
  last_at: Date | null;
  segment: Segment;
};

/** One page of customers, highest spend first, filtered by text, segment, place or merchant. */
export async function listCustomers(
  db: Db,
  filter: {
    q?: string;
    segment?: string;
    governorate?: string;
    merchantId?: string;
    page?: number;
  },
  now: Date = new Date(),
) {
  const r = await rules(db);
  const page = Math.max(1, filter.page ?? 1);
  const size = 50;
  const q = filter.q?.trim();
  const digits = q?.replace(/\D/g, '');
  const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    // 01001234567 and +201001234567 both find +201001234567.
    const phoneLike = digits && digits.length >= 4 ? `%${digits.replace(/^0/, '')}%` : null;
    where.push(
      phoneLike
        ? Prisma.sql`(LOWER(c.name) LIKE ${like} OR c.email LIKE ${like} OR c.phone LIKE ${phoneLike})`
        : Prisma.sql`(LOWER(c.name) LIKE ${like} OR c.email LIKE ${like})`,
    );
  }
  if (filter.governorate) where.push(Prisma.sql`c.governorate = ${filter.governorate}`);
  if (filter.merchantId)
    where.push(Prisma.sql`EXISTS (SELECT 1 FROM (${PURCHASES}) m
      WHERE m.customer_id = c.id AND m.merchant_id = ${filter.merchantId})`);
  const segment = SEGMENTS.includes(filter.segment as Segment) ? filter.segment : null;
  const rows = await db.$queryRaw<(Row & { total: bigint })[]>`
    SELECT * FROM (
      SELECT c.id, c.name, c.phone, c.email, c.governorate, c.city,
        t.orders, t.spend, t.merchants, t.last_at, ${segmentSql(r, now)} AS segment
      FROM customers c JOIN (${TOTALS}) t ON t.id = c.id
      WHERE ${Prisma.join(where, ' AND ')}
    ) x
    WHERE ${segment ? Prisma.sql`x.segment = ${segment}` : Prisma.sql`TRUE`}
    ORDER BY x.spend DESC, x.orders DESC, x.name
    LIMIT ${size + 1} OFFSET ${(page - 1) * size}`;
  return {
    page,
    more: rows.length > size,
    customers: rows.slice(0, size).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      governorate: c.governorate,
      city: c.city,
      orders: n(c.orders),
      spendPiastres: n(c.spend),
      merchants: n(c.merchants),
      lastOrderAt: c.last_at,
      segment: c.segment,
    })),
  };
}

/** The customer base as a whole: size, repeat buying, segments, places and shared shoppers. */
export async function customersOverview(db: Db, now: Date = new Date()) {
  const r = await rules(db);
  const [totals] = await db.$queryRaw<
    {
      customers: bigint;
      with_phone: bigint;
      with_email: bigint;
      buyers: bigint;
      repeat: bigint;
      multi: bigint;
      orders: bigint;
      spend: bigint;
    }[]
  >`
    SELECT COUNT(*) AS customers,
      COUNT(*) FILTER (WHERE c.phone IS NOT NULL) AS with_phone,
      COUNT(*) FILTER (WHERE c.email IS NOT NULL) AS with_email,
      COUNT(*) FILTER (WHERE t.orders >= 1) AS buyers,
      COUNT(*) FILTER (WHERE t.orders >= 2) AS repeat,
      COUNT(*) FILTER (WHERE t.merchants >= 2) AS multi,
      COALESCE(SUM(t.orders), 0) AS orders,
      COALESCE(SUM(t.spend), 0) AS spend
    FROM customers c JOIN (${TOTALS}) t ON t.id = c.id`;
  const segments = await db.$queryRaw<{ segment: Segment; customers: bigint; spend: bigint }[]>`
    SELECT ${segmentSql(r, now)} AS segment, COUNT(*) AS customers, COALESCE(SUM(t.spend), 0) AS spend
    FROM (${TOTALS}) t GROUP BY 1 ORDER BY 2 DESC`;
  const places = await db.$queryRaw<{ governorate: string; customers: bigint; spend: bigint }[]>`
    SELECT COALESCE(c.governorate, '') AS governorate, COUNT(*) AS customers,
      COALESCE(SUM(t.spend), 0) AS spend
    FROM customers c JOIN (${TOTALS}) t ON t.id = c.id
    GROUP BY 1 ORDER BY 2 DESC LIMIT 20`;
  // Which merchants share shoppers: the base for cross selling between them.
  const shared = await db.$queryRaw<
    { a: string; a_name: string; b: string; b_name: string; customers: bigint }[]
  >`
    WITH pm AS (SELECT DISTINCT customer_id, merchant_id FROM (${PURCHASES}) p WHERE NOT p.cancelled)
    SELECT x.merchant_id AS a, ma.name AS a_name, y.merchant_id AS b, mb.name AS b_name,
      COUNT(*) AS customers
    FROM pm x JOIN pm y ON y.customer_id = x.customer_id AND y.merchant_id > x.merchant_id
    JOIN merchants ma ON ma.id = x.merchant_id JOIN merchants mb ON mb.id = y.merchant_id
    GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC LIMIT 15`;
  const months = await db.$queryRaw<{ month: string; customers: bigint }[]>`
    SELECT to_char(date_trunc('month', first_seen_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM') AS month,
      COUNT(*) AS customers
    FROM customers WHERE first_seen_at >= ${new Date(now.getTime() - 366 * DAY)}
    GROUP BY 1 ORDER BY 1`;
  const buyers = n(totals?.buyers);
  return {
    rules: r,
    customers: n(totals?.customers),
    withPhone: n(totals?.with_phone),
    withEmail: n(totals?.with_email),
    buyers,
    repeatPct: buyers ? Math.round((n(totals?.repeat) * 1000) / buyers) / 10 : 0,
    multiMerchantPct: buyers ? Math.round((n(totals?.multi) * 1000) / buyers) / 10 : 0,
    averageOrders: buyers ? Math.round((n(totals?.orders) * 10) / buyers) / 10 : 0,
    averageSpendPiastres: buyers ? Math.round(n(totals?.spend) / buyers) : 0,
    segments: segments.map((s) => ({
      segment: s.segment,
      customers: n(s.customers),
      spendPiastres: n(s.spend),
    })),
    governorates: places.map((p) => ({
      governorate: p.governorate || null,
      customers: n(p.customers),
      spendPiastres: n(p.spend),
    })),
    sharedShoppers: shared.map((s) => ({
      a: { id: s.a, name: s.a_name },
      b: { id: s.b, name: s.b_name },
      customers: n(s.customers),
    })),
    newByMonth: months.map((m) => ({ month: m.month, customers: n(m.customers) })),
  };
}

/** Everything about one person: who, where, what they buy, from whom, when, and how they pay. */
export async function customerProfile(db: Db, id: string, now: Date = new Date()) {
  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) return null;
  const r = await rules(db);

  const [t] = await db.$queryRaw<
    {
      orders: bigint;
      cancelled: bigint;
      spend: bigint;
      merchants: bigint;
      first_at: Date | null;
      last_at: Date | null;
      units: bigint;
      segment: Segment;
    }[]
  >`
    SELECT t.orders, t.cancelled, t.spend, t.merchants, t.first_at, t.last_at,
      (SELECT COALESCE(SUM(p.units), 0) FROM (${PURCHASES}) p WHERE p.customer_id = t.id AND NOT p.cancelled) AS units,
      ${segmentSql(r, now)} AS segment
    FROM (${TOTALS}) t WHERE t.id = ${id}`;

  const merchants = await db.$queryRaw<
    { id: string; name: string; orders: bigint; spend: bigint; last_at: Date | null }[]
  >`
    SELECT m.id, m.name, COUNT(*) FILTER (WHERE NOT p.cancelled) AS orders,
      COALESCE(SUM(p.value) FILTER (WHERE NOT p.cancelled), 0) AS spend, MAX(p.at) AS last_at
    FROM (${PURCHASES}) p JOIN merchants m ON m.id = p.merchant_id
    WHERE p.customer_id = ${id} GROUP BY m.id, m.name ORDER BY 4 DESC`;

  const categories = await db.$queryRaw<{ category: string; units: bigint; spend: bigint }[]>`
    SELECT COALESCE(sp.category_top, 'Uncategorized') AS category,
      SUM(l.current_quantity) AS units, SUM(l.total_piastres) AS spend
    FROM shop_order_lines l JOIN shop_orders so ON so.shopify_id = l.order_shopify_id
    LEFT JOIN shop_products sp ON sp.shopify_id = l.product_shopify_id
    WHERE so.customer_id = ${id} AND NOT so.test AND so.cancelled_at IS NULL
    GROUP BY 1 ORDER BY 3 DESC`;

  const products = await db.$queryRaw<
    {
      title: string;
      image: string | null;
      merchant: string;
      units: bigint;
      spend: bigint;
      last_at: Date;
    }[]
  >`
    SELECT COALESCE(sp.title, l.title) AS title, MAX(sp.image_url) AS image, m.name AS merchant,
      SUM(l.current_quantity) AS units, SUM(l.total_piastres) AS spend, MAX(so.created_at_shop) AS last_at
    FROM shop_order_lines l JOIN shop_orders so ON so.shopify_id = l.order_shopify_id
    JOIN merchants m ON m.id = so.merchant_id
    LEFT JOIN shop_products sp ON sp.shopify_id = l.product_shopify_id
    WHERE so.customer_id = ${id} AND NOT so.test AND so.cancelled_at IS NULL
    GROUP BY 1, 3 ORDER BY 5 DESC LIMIT 20`;

  // When they buy, in Cairo time: weekday 0 is Sunday.
  const timing = await db.$queryRaw<{ dow: number; hour: number; orders: bigint }[]>`
    SELECT EXTRACT(DOW FROM p.at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::int AS dow,
      EXTRACT(HOUR FROM p.at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::int AS hour,
      COUNT(*) AS orders
    FROM (${PURCHASES}) p WHERE p.customer_id = ${id} AND NOT p.cancelled GROUP BY 1, 2`;

  const payments = await db.$queryRaw<{ method: string; orders: bigint }[]>`
    SELECT COALESCE(financial_status, 'UNKNOWN') AS method, COUNT(*) AS orders
    FROM shop_orders WHERE customer_id = ${id} AND NOT test GROUP BY 1
    UNION ALL
    SELECT 'shiply_' || payment_method::text, COUNT(*) FROM orders
    WHERE customer_id = ${id} AND shopify_order_id IS NULL GROUP BY 1`;

  const [deliveries] = await db.$queryRaw<
    {
      orders: bigint;
      delivered: bigint;
      failed: bigint;
      cancelled: bigint;
      cod: bigint;
      stars: number | null;
    }[]
  >`
    SELECT COUNT(*) AS orders,
      COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered,
      COUNT(*) FILTER (WHERE o.status IN ('failed', 'attempt_failed')) AS failed,
      COUNT(*) FILTER (WHERE o.status = 'cancelled') AS cancelled,
      COALESCE(SUM(o.cod_amount_piastres) FILTER (WHERE o.status = 'delivered'), 0) AS cod,
      AVG(r.stars)::float AS stars
    FROM orders o LEFT JOIN order_ratings r ON r.order_id = o.id WHERE o.customer_id = ${id}`;

  const recent = await db.$queryRaw<
    {
      source: string;
      ref: string;
      record_id: string;
      merchant: string;
      at: Date;
      value: bigint;
      status: string;
      units: bigint;
    }[]
  >`
    SELECT 'shopify' AS source, so.name AS ref, so.id AS record_id, m.name AS merchant,
      so.created_at_shop AS at, (so.total_piastres - so.refunded_piastres) AS value,
      CASE WHEN so.cancelled_at IS NOT NULL THEN 'CANCELLED' ELSE COALESCE(so.fulfillment_status, '') END AS status,
      so.units AS units
    FROM shop_orders so JOIN merchants m ON m.id = so.merchant_id
    WHERE so.customer_id = ${id} AND NOT so.test
    UNION ALL
    SELECT 'shiply', o.number, o.id, m.name, o.placed_at,
      (o.subtotal_piastres + o.delivery_fee_piastres), o.status::text,
      (SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i WHERE i.order_id = o.id)
    FROM orders o JOIN merchants m ON m.id = o.merchant_id WHERE o.customer_id = ${id}
    ORDER BY 5 DESC LIMIT 50`;

  const shopRecords = await db.shopCustomer.findMany({
    where: { customerId: id },
    orderBy: { createdAtShop: 'asc' },
  });
  const merchantNames = new Map(
    (
      await db.merchant.findMany({
        where: { id: { in: shopRecords.map((s) => s.merchantId) } },
        select: { id: true, name: true },
      })
    ).map((m) => [m.id, m.name]),
  );

  const orders = n(t?.orders);
  return {
    customer,
    segment: t?.segment ?? 'no_orders',
    totals: {
      orders,
      cancelled: n(t?.cancelled),
      spendPiastres: n(t?.spend),
      averageOrderPiastres: orders ? Math.round(n(t?.spend) / orders) : 0,
      units: n(t?.units),
      merchants: n(t?.merchants),
      firstOrderAt: t?.first_at ?? null,
      lastOrderAt: t?.last_at ?? null,
      // Average days between orders, once there are at least two.
      everyDays:
        orders >= 2 && t?.first_at && t.last_at
          ? Math.round((t.last_at.getTime() - t.first_at.getTime()) / DAY / (orders - 1))
          : null,
    },
    merchants: merchants.map((m) => ({
      id: m.id,
      name: m.name,
      orders: n(m.orders),
      spendPiastres: n(m.spend),
      lastOrderAt: m.last_at,
    })),
    categories: categories.map((c) => ({
      category: c.category,
      units: n(c.units),
      spendPiastres: n(c.spend),
    })),
    products: products.map((p) => ({
      title: p.title,
      imageUrl: p.image,
      merchant: p.merchant,
      units: n(p.units),
      spendPiastres: n(p.spend),
      lastAt: p.last_at,
    })),
    timing: timing.map((x) => ({ dow: x.dow, hour: x.hour, orders: n(x.orders) })),
    payments: payments.map((p) => ({ method: p.method, orders: n(p.orders) })),
    deliveries: {
      orders: n(deliveries?.orders),
      delivered: n(deliveries?.delivered),
      failed: n(deliveries?.failed),
      cancelled: n(deliveries?.cancelled),
      codPiastres: n(deliveries?.cod),
      averageStars: deliveries?.stars == null ? null : Math.round(deliveries.stars * 10) / 10,
    },
    shopRecords: shopRecords.map((s) => ({
      merchant: merchantNames.get(s.merchantId) ?? '',
      name: [s.firstName, s.lastName].filter(Boolean).join(' '),
      email: s.email,
      phone: s.phone,
      ordersCount: s.ordersCount,
      amountSpentPiastres: s.amountSpentPiastres,
      emailMarketing: s.emailMarketing,
      smsMarketing: s.smsMarketing,
      tags: s.tags,
      since: s.createdAtShop,
    })),
    recentOrders: recent.map((o) => ({
      source: o.source,
      ref: o.ref,
      recordId: o.record_id,
      merchant: o.merchant,
      at: o.at,
      valuePiastres: n(o.value),
      status: o.status,
      units: n(o.units),
    })),
  };
}
