import { Prisma } from '@prisma/client';
import type { Db } from '../client';
import { getSetting } from '../settings';
import { customerRisk } from './customers';

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
  const [
    newDays,
    atRiskDays,
    lostDays,
    vipOrders,
    latePct,
    atRiskValuePct,
    budgetPct,
    premiumPct,
    riskMinAttempts,
  ] = await Promise.all([
    getSetting(db, 'customer.new_days'),
    getSetting(db, 'customer.at_risk_days'),
    getSetting(db, 'customer.lost_days'),
    getSetting(db, 'customer.vip_orders'),
    getSetting(db, 'customer.late_factor_pct'),
    getSetting(db, 'customer.at_risk_value_pct'),
    getSetting(db, 'customer.budget_index_pct'),
    getSetting(db, 'customer.premium_index_pct'),
    getSetting(db, 'customer.risk_min_attempts'),
  ]);
  return {
    newDays,
    atRiskDays,
    lostDays,
    vipOrders,
    latePct,
    atRiskValuePct,
    budgetPct,
    premiumPct,
    riskMinAttempts,
  };
}
type Rules = Awaited<ReturnType<typeof rules>>;

/** Days between orders of a repeat customer (null for fewer than two), from the totals `t`. */
const GAP = Prisma.sql`CASE WHEN t.orders >= 2 THEN GREATEST(
  EXTRACT(EPOCH FROM (t.last_at - t.first_at)) / 86400.0 / (t.orders - 1), 1) END`;

/**
 * Expected spend over the next 12 months, in piastres, from the totals `t`, the gap `gap`,
 * orders in the last year `o365` and the segment `segment`: orders a year (365 / gap, or last
 * year's count for single buyers) times the average order; at risk customers count at
 * customer.at_risk_value_pct, lost ones not at all.
 */
function forecastSql(r: Rules) {
  return Prisma.sql`CASE WHEN segment IN ('lost', 'no_orders') THEN 0 ELSE
    ROUND(COALESCE(365.0 / gap, o365) * spend / GREATEST(orders, 1)
      * CASE WHEN segment = 'at_risk' THEN ${r.atRiskValuePct} / 100.0 ELSE 1 END) END`;
}

/** True when a repeat customer is past customer.late_factor_pct of their usual gap. */
function dueSql(r: Rules, now: Date) {
  return Prisma.sql`(gap IS NOT NULL AND segment NOT IN ('lost')
    AND last_at + make_interval(secs => gap * 864 * ${r.latePct}) < ${now})`;
}

/** The SQL that names a customer's segment from the per customer totals `t`. */
function segmentSql(r: Rules, now: Date) {
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
    /** Only repeat customers who should have ordered again by now */
    due?: boolean;
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
  const rows = await db.$queryRaw<(Row & { gap: number | null })[]>`
    SELECT * FROM (
      SELECT c.id, c.name, c.phone, c.email, c.governorate, c.city,
        t.orders, t.spend, t.merchants, t.last_at, ${segmentSql(r, now)} AS segment, ${GAP} AS gap
      FROM customers c JOIN (${TOTALS}) t ON t.id = c.id
      WHERE ${Prisma.join(where, ' AND ')}
    ) x
    WHERE ${segment ? Prisma.sql`x.segment = ${segment}` : Prisma.sql`TRUE`}
      AND ${filter.due ? dueSql(r, now) : Prisma.sql`TRUE`}
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
      expectedAt: c.gap != null && c.last_at ? new Date(c.last_at.getTime() + c.gap * DAY) : null,
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
  const d90 = new Date(now.getTime() - 90 * DAY);
  const d365 = new Date(now.getTime() - 365 * DAY);
  const [value] = await db.$queryRaw<{ forecast: bigint | null; due: bigint }[]>`
    WITH t AS (${TOTALS}), v AS (
      SELECT t.*, ${segmentSql(r, now)} AS segment, ${GAP} AS gap,
        (SELECT COUNT(*) FROM (${PURCHASES}) p
          WHERE p.customer_id = t.id AND NOT p.cancelled AND p.at >= ${d365}) AS o365
      FROM t)
    SELECT SUM(${forecastSql(r)})::bigint AS forecast, COUNT(*) FILTER (WHERE ${dueSql(r, now)}) AS due
    FROM v`;
  const [consent] = await db.$queryRaw<{ email: bigint; sms: bigint }[]>`
    SELECT COUNT(DISTINCT customer_id) FILTER (WHERE email_marketing = 'SUBSCRIBED') AS email,
      COUNT(DISTINCT customer_id) FILTER (WHERE sms_marketing = 'SUBSCRIBED') AS sms
    FROM shop_customers WHERE customer_id IS NOT NULL`;
  // When the customer base buys, Cairo time, over the last year (weekday 0 is Sunday).
  const timing = await db.$queryRaw<{ dow: number; hour: number; orders: bigint }[]>`
    SELECT EXTRACT(DOW FROM p.at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::int AS dow,
      EXTRACT(HOUR FROM p.at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::int AS hour,
      COUNT(*) AS orders
    FROM (${PURCHASES}) p WHERE NOT p.cancelled AND p.at >= ${d365} GROUP BY 1, 2`;
  // Our own orders per store and hour over 90 days: the busiest hours to staff and stock for.
  const storeHours = await db.$queryRaw<
    { id: string; name_en: string; name_ar: string; hour: number; orders: bigint }[]
  >`
    SELECT s.id, s.name_en, s.name_ar,
      EXTRACT(HOUR FROM o.placed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::int AS hour,
      COUNT(*) AS orders
    FROM orders o JOIN dark_stores s ON s.id = o.dark_store_id
    WHERE o.placed_at >= ${d90} GROUP BY 1, 2, 3, 4`;
  const stores = new Map<
    string,
    {
      id: string;
      nameEn: string;
      nameAr: string;
      orders: number;
      hours: { hour: number; orders: number }[];
    }
  >();
  for (const h of storeHours) {
    const s = stores.get(h.id) ?? {
      id: h.id,
      nameEn: h.name_en,
      nameAr: h.name_ar,
      orders: 0,
      hours: [],
    };
    s.orders += n(h.orders);
    s.hours.push({ hour: h.hour, orders: n(h.orders) });
    stores.set(h.id, s);
  }
  // Categories bought by the same people: lift above 1 means they go together more than chance.
  const pairs = await db.$queryRaw<
    { a: string; b: string; both: bigint; ka: bigint; kb: bigint; total: bigint }[]
  >`
    WITH cc AS (
      SELECT DISTINCT so.customer_id, COALESCE(sp.category_top, 'Uncategorized') AS cat
      FROM shop_order_lines l JOIN shop_orders so ON so.shopify_id = l.order_shopify_id
      LEFT JOIN shop_products sp ON sp.shopify_id = l.product_shopify_id
      WHERE so.customer_id IS NOT NULL AND NOT so.test AND so.cancelled_at IS NULL),
    total AS (SELECT COUNT(DISTINCT customer_id) AS total FROM cc),
    k AS (SELECT cat, COUNT(*) AS k FROM cc GROUP BY cat)
    SELECT x.cat AS a, y.cat AS b, COUNT(*) AS both, ka.k AS ka, kb.k AS kb, total.total
    FROM cc x JOIN cc y ON y.customer_id = x.customer_id AND y.cat > x.cat
    JOIN k ka ON ka.cat = x.cat JOIN k kb ON kb.cat = y.cat CROSS JOIN total
    GROUP BY x.cat, y.cat, ka.k, kb.k, total.total ORDER BY 3 DESC LIMIT 15`;
  const risky = await db.$queryRaw<
    {
      id: string;
      name: string;
      phone: string | null;
      attempts: bigint;
      failed: bigint;
      refused: bigint;
    }[]
  >`
    SELECT c.id, c.name, c.phone,
      COUNT(*) FILTER (WHERE d.status IN ('delivered', 'failed')) AS attempts,
      COUNT(*) FILTER (WHERE d.status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE d.failed_reason = 'refused') AS refused
    FROM customers c JOIN orders o ON o.customer_id = c.id JOIN deliveries d ON d.order_id = o.id
    GROUP BY c.id, c.name, c.phone
    HAVING COUNT(*) FILTER (WHERE d.status = 'failed') > 0
    ORDER BY (COUNT(*) FILTER (WHERE d.status = 'failed') + COUNT(*) FILTER (WHERE d.failed_reason = 'refused'))::float
      / GREATEST(COUNT(*) FILTER (WHERE d.status IN ('delivered', 'failed')), 1) DESC, 4 DESC
    LIMIT 20`;
  const buyers = n(totals?.buyers);
  return {
    rules: r,
    forecastPiastres: n(value?.forecast),
    dueToReorder: n(value?.due),
    emailSubscribers: n(consent?.email),
    smsSubscribers: n(consent?.sms),
    timing: timing.map((x) => ({ dow: x.dow, hour: x.hour, orders: n(x.orders) })),
    storePeaks: [...stores.values()]
      .sort((a, b) => b.orders - a.orders)
      .map((s) => ({
        ...s,
        hours: s.hours.sort((a, b) => b.orders - a.orders || a.hour - b.hour).slice(0, 3),
      })),
    categoryPairs: pairs.map((p) => ({
      a: p.a,
      b: p.b,
      customers: n(p.both),
      lift: Math.round(((n(p.both) * n(p.total)) / (n(p.ka) * n(p.kb) || 1)) * 10) / 10,
    })),
    riskyCustomers: risky.map((c) => {
      const attempts = n(c.attempts);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        attempts,
        failed: n(c.failed),
        refused: n(c.refused),
        pct: attempts
          ? Math.min(100, Math.round(((n(c.failed) + n(c.refused)) * 100) / attempts))
          : 0,
      };
    }),
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

  const d30 = new Date(now.getTime() - 30 * DAY);
  const d90 = new Date(now.getTime() - 90 * DAY);
  const d365 = new Date(now.getTime() - 365 * DAY);
  const [recentSpend] = await db.$queryRaw<
    { s30: bigint; s90: bigint; s365: bigint; o365: bigint }[]
  >`
    SELECT COALESCE(SUM(value) FILTER (WHERE at >= ${d30}), 0) AS s30,
      COALESCE(SUM(value) FILTER (WHERE at >= ${d90}), 0) AS s90,
      COALESCE(SUM(value) FILTER (WHERE at >= ${d365}), 0) AS s365,
      COUNT(*) FILTER (WHERE at >= ${d365}) AS o365
    FROM (${PURCHASES}) p WHERE p.customer_id = ${id} AND NOT p.cancelled`;
  const monthly = await db.$queryRaw<{ month: string; spend: bigint; orders: bigint }[]>`
    SELECT to_char(date_trunc('month', p.at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM') AS month,
      SUM(p.value) AS spend, COUNT(*) AS orders
    FROM (${PURCHASES}) p WHERE p.customer_id = ${id} AND NOT p.cancelled AND p.at >= ${d365}
    GROUP BY 1 ORDER BY 1`;
  // Price level: what they pay against the usual (median) price of the same category across
  // every merchant, weighted by units. 100 is the usual price.
  const [price] = await db.$queryRaw<{ idx: number | null }[]>`
    WITH usual AS (
      SELECT COALESCE(sp.category_top, 'Uncategorized') AS cat,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY l.unit_price_piastres) AS median
      FROM shop_order_lines l LEFT JOIN shop_products sp ON sp.shopify_id = l.product_shopify_id
      WHERE l.unit_price_piastres > 0 GROUP BY 1)
    SELECT SUM(l.unit_price_piastres / u.median * l.current_quantity) * 100
      / NULLIF(SUM(l.current_quantity), 0) AS idx
    FROM shop_order_lines l JOIN shop_orders so ON so.shopify_id = l.order_shopify_id
    LEFT JOIN shop_products sp ON sp.shopify_id = l.product_shopify_id
    JOIN usual u ON u.cat = COALESCE(sp.category_top, 'Uncategorized') AND u.median > 0
    WHERE so.customer_id = ${id} AND NOT so.test AND so.cancelled_at IS NULL
      AND l.unit_price_piastres > 0 AND l.current_quantity > 0`;
  const risk = await customerRisk(db, id);
  const district = customer.districtId
    ? await db.geoArea.findUnique({
        where: { id: customer.districtId },
        select: { id: true, nameEn: true, nameAr: true },
      })
    : null;
  // Other people at the same address: one household, or a shared office.
  const household = customer.address
    ? await db.$queryRaw<{ id: string; name: string; phone: string | null }[]>`
        SELECT id, name, phone FROM customers
        WHERE id <> ${id} AND LOWER(REGEXP_REPLACE(address, '\s+', ' ', 'g'))
          = LOWER(REGEXP_REPLACE(${customer.address}, '\s+', ' ', 'g'))
        LIMIT 10`
    : [];
  const aliases = await db.customerAlias.findMany({
    where: { customerId: id },
    select: { kind: true, value: true },
    orderBy: { createdAt: 'asc' },
  });

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
  const spend = n(t?.spend);
  const segment = t?.segment ?? 'no_orders';
  const gap =
    orders >= 2 && t?.first_at && t.last_at
      ? Math.max(1, (t.last_at.getTime() - t.first_at.getTime()) / DAY / (orders - 1))
      : null;
  const o365 = n(recentSpend?.o365);
  const perYear = gap ? 365 / gap : o365;
  const keep =
    segment === 'lost' || segment === 'no_orders'
      ? 0
      : segment === 'at_risk'
        ? r.atRiskValuePct / 100
        : 1;
  const expectedAt = gap && t?.last_at ? new Date(t.last_at.getTime() + gap * DAY) : null;
  const priceIndex = price?.idx == null ? null : Math.round(price.idx);
  return {
    customer,
    segment,
    district,
    household,
    aliases,
    risk,
    value: {
      spend30Piastres: n(recentSpend?.s30),
      spend90Piastres: n(recentSpend?.s90),
      spend365Piastres: n(recentSpend?.s365),
      monthly: monthly.map((m) => ({
        month: m.month,
        spendPiastres: n(m.spend),
        orders: n(m.orders),
      })),
      expectedAt,
      due:
        !!gap &&
        !!t?.last_at &&
        segment !== 'lost' &&
        now.getTime() > t.last_at.getTime() + ((gap * r.latePct) / 100) * DAY,
      forecastPiastres: Math.round(perYear * (orders ? spend / orders : 0) * keep),
      priceIndex,
      priceTier:
        priceIndex === null
          ? null
          : priceIndex < r.budgetPct
            ? 'budget'
            : priceIndex > r.premiumPct
              ? 'premium'
              : 'mid',
    },
    totals: {
      orders,
      cancelled: n(t?.cancelled),
      spendPiastres: n(t?.spend),
      averageOrderPiastres: orders ? Math.round(spend / orders) : 0,
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

/**
 * Where the customer base lives, by district, against our zones: customers, buyers and spend
 * of the last 12 months, and how much of the district our active zones already cover. The
 * districts with the most spend and the least coverage are where a new dark store pays.
 */
export async function districtDemand(db: Db, now: Date = new Date()) {
  const d365 = new Date(now.getTime() - 365 * DAY);
  const rows = await db.$queryRaw<
    {
      id: string;
      name_en: string;
      name_ar: string;
      gov_en: string | null;
      gov_ar: string | null;
      customers: bigint;
      buyers: bigint;
      orders: bigint;
      spend: bigint;
      covered: number | null;
    }[]
  >`
    WITH y AS (
      SELECT customer_id, COUNT(*) AS orders, SUM(value) AS spend
      FROM (${PURCHASES}) p WHERE NOT p.cancelled AND p.at >= ${d365} GROUP BY 1),
    d AS (
      SELECT c.district_id, COUNT(*) AS customers, COUNT(y.customer_id) AS buyers,
        COALESCE(SUM(y.orders), 0) AS orders, COALESCE(SUM(y.spend), 0) AS spend
      FROM customers c LEFT JOIN y ON y.customer_id = c.id
      WHERE c.district_id IS NOT NULL GROUP BY 1)
    SELECT a.id, a.name_en, a.name_ar, g.name_en AS gov_en, g.name_ar AS gov_ar,
      d.customers, d.buyers, d.orders, d.spend,
      LEAST(1, COALESCE((
        SELECT SUM(ST_Area(ST_Intersection(z.area, a.geom))) FROM zones z
        JOIN dark_stores s ON s.id = z.dark_store_id AND s.is_active AND s.kind = 'dark_store'
        WHERE z.is_active AND z.area IS NOT NULL AND ST_Intersects(z.area, a.geom)
      ), 0) / NULLIF(ST_Area(a.geom), 0)) AS covered
    FROM d JOIN geo_areas a ON a.id = d.district_id
    LEFT JOIN geo_areas g ON g.id = a.parent_id
    ORDER BY d.spend DESC, d.customers DESC`;
  const [placed] = await db.$queryRaw<{ placed: bigint; unplaced: bigint }[]>`
    SELECT COUNT(*) FILTER (WHERE district_id IS NOT NULL) AS placed,
      COUNT(*) FILTER (WHERE district_id IS NULL) AS unplaced
    FROM customers`;
  const districts = rows.map((r) => ({
    id: r.id,
    nameEn: r.name_en,
    nameAr: r.name_ar,
    governorateEn: r.gov_en,
    governorateAr: r.gov_ar,
    customers: n(r.customers),
    buyers: n(r.buyers),
    orders: n(r.orders),
    spendPiastres: n(r.spend),
    coveredPct: Math.round((r.covered ?? 0) * 100),
  }));
  return {
    placed: n(placed?.placed),
    unplaced: n(placed?.unplaced),
    spendOutsidePiastres: districts
      .filter((d) => d.coveredPct < 50)
      .reduce((sum, d) => sum + d.spendPiastres, 0),
    districts,
  };
}

/**
 * What one merchant's customers buy at other merchants, in categories this merchant does not
 * sell: the gaps a merchant could fill, or a partner merchant could serve. Admin only.
 */
export async function merchantCategoryGaps(db: Db, merchantId: string) {
  const [shared] = await db.$queryRaw<{ customers: bigint; elsewhere: bigint }[]>`
    WITH mine AS (SELECT DISTINCT customer_id FROM (${PURCHASES}) p
      WHERE p.merchant_id = ${merchantId} AND NOT p.cancelled)
    SELECT COUNT(*) AS customers,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM (${PURCHASES}) q
        WHERE q.customer_id = mine.customer_id AND q.merchant_id <> ${merchantId} AND NOT q.cancelled)) AS elsewhere
    FROM mine`;
  const gaps = await db.$queryRaw<
    { category: string; customers: bigint; spend: bigint; merchants: bigint }[]
  >`
    WITH mine AS (SELECT DISTINCT customer_id FROM (${PURCHASES}) p
      WHERE p.merchant_id = ${merchantId} AND NOT p.cancelled),
    sold AS (SELECT DISTINCT category_top FROM shop_products
      WHERE merchant_id = ${merchantId} AND category_top IS NOT NULL)
    SELECT COALESCE(sp.category_top, 'Uncategorized') AS category,
      COUNT(DISTINCT so.customer_id) AS customers, SUM(l.total_piastres) AS spend,
      COUNT(DISTINCT so.merchant_id) AS merchants
    FROM shop_order_lines l JOIN shop_orders so ON so.shopify_id = l.order_shopify_id
    LEFT JOIN shop_products sp ON sp.shopify_id = l.product_shopify_id
    WHERE so.customer_id IN (SELECT customer_id FROM mine) AND so.merchant_id <> ${merchantId}
      AND NOT so.test AND so.cancelled_at IS NULL
      AND COALESCE(sp.category_top, 'Uncategorized') NOT IN (SELECT category_top FROM sold)
    GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 15`;
  return {
    customers: n(shared?.customers),
    alsoBuyElsewhere: n(shared?.elsewhere),
    gaps: gaps.map((g) => ({
      category: g.category,
      customers: n(g.customers),
      spendPiastres: n(g.spend),
      merchants: n(g.merchants),
    })),
  };
}
