import { Prisma } from '@prisma/client';
import { normalizeEgyptianPhone } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { inTransaction, type Db } from '../client';
import { DomainError } from '../domain-error';
import { resolveByAreas } from '../geo/engine';
import { getSetting } from '../settings';

// One person across every merchant: a Shopify customer, a Shopify order and our own delivery
// order all point at the same customers row when they share an Egyptian mobile (first) or an
// email, their own or one kept from a merged profile (customer_aliases). Matching only ever adds
// details; two people become one only when admin merges them.

export type CustomerFacts = {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  governorate?: string | null;
  city?: string | null;
  address?: string | null;
  /** A delivery point of our own order */
  latitude?: number | null;
  longitude?: number | null;
  seenAt: Date;
};

export function cleanEmail(email: string | null | undefined) {
  const e = email?.trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

const clean = (v: string | null | undefined) => v?.trim() || null;

/**
 * Finds or creates the person these facts describe and fills in what was missing. Returns the
 * customer id, or null when there is neither a valid Egyptian mobile nor an email to match on.
 */
export async function resolveCustomer(db: Db, facts: CustomerFacts): Promise<string | null> {
  const phone = facts.phone ? normalizeEgyptianPhone(facts.phone) : null;
  const email = cleanEmail(facts.email);
  if (!phone && !email) return null;
  for (let attempt = 0; ; attempt++) {
    try {
      return await resolveOnce(db, phone, email, facts);
    } catch (error) {
      // Two writers created the same phone or email at once: the second one finds it next time.
      const unique =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!unique || attempt >= 2) throw error;
    }
  }
}

/** The customer owning this phone or email, as their own or as an alias. */
async function ownerOf(db: Db, kind: 'phone' | 'email', value: string) {
  const own = await db.customer.findUnique({
    where: kind === 'phone' ? { phone: value } : { email: value },
  });
  if (own) return own;
  const alias = await db.customerAlias.findUnique({
    where: { kind_value: { kind, value } },
    include: { customer: true },
  });
  return alias?.customer ?? null;
}

async function resolveOnce(db: Db, phone: string | null, email: string | null, f: CustomerFacts) {
  const byPhone = phone ? await ownerOf(db, 'phone', phone) : null;
  const byEmail = !byPhone && email ? await ownerOf(db, 'email', email) : null;
  const found = byPhone ?? byEmail;
  const name = clean(f.name);
  if (!found) {
    const created = await db.customer.create({
      data: {
        phone,
        email,
        name: name ?? '',
        governorate: clean(f.governorate),
        city: clean(f.city),
        address: clean(f.address),
        latitude: f.latitude ?? null,
        longitude: f.longitude ?? null,
        firstSeenAt: f.seenAt,
        lastSeenAt: f.seenAt,
      },
    });
    return created.id;
  }
  const newer = f.seenAt >= found.lastSeenAt;
  const data: Prisma.CustomerUpdateInput = {};
  // A phone or email someone else already holds stays theirs.
  if (!found.phone && phone && !(await ownerOf(db, 'phone', phone))) data.phone = phone;
  if (!found.email && email && !(await ownerOf(db, 'email', email))) data.email = email;
  // The latest name and place win; older facts only fill gaps.
  if (name && name !== found.name && (newer || !found.name)) data.name = name;
  for (const key of ['governorate', 'city', 'address'] as const) {
    const v = clean(f[key]);
    if (v && v !== found[key] && (newer || !found[key])) data[key] = v;
  }
  if (f.latitude != null && f.longitude != null && (newer || found.latitude == null)) {
    if (f.latitude !== found.latitude) data.latitude = f.latitude;
    if (f.longitude !== found.longitude) data.longitude = f.longitude;
  }
  if (f.seenAt < found.firstSeenAt) data.firstSeenAt = f.seenAt;
  if (f.seenAt > found.lastSeenAt) data.lastSeenAt = f.seenAt;
  if (Object.keys(data).length) await db.customer.update({ where: { id: found.id }, data });
  return found.id;
}

type Line = Record<string, unknown> & { id?: string };
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const date = (v: unknown) => (typeof v === 'string' && v ? new Date(v) : null);

/** Shopify customers export rows. Returns how many were saved. */
export async function ingestCustomers(
  db: Db,
  shop: { id: string; merchantId: string },
  lines: Line[],
  toPiastres: (amount: string | null | undefined) => number,
) {
  let customers = 0;
  for (const l of lines) {
    if (!/gid:\/\/shopify\/Customer\//.test(l.id ?? '')) continue;
    const address = l.defaultAddress as {
      province?: string;
      city?: string;
      address1?: string;
      address2?: string;
      phone?: string;
    } | null;
    const firstName = str(l.firstName);
    const lastName = str(l.lastName);
    const emailRow = l.defaultEmailAddress as {
      emailAddress?: string;
      marketingState?: string;
    } | null;
    const phoneRow = l.defaultPhoneNumber as {
      phoneNumber?: string;
      marketingState?: string;
    } | null;
    const phone = str(phoneRow?.phoneNumber) ?? str(l.phone) ?? str(address?.phone);
    const email = str(emailRow?.emailAddress) ?? str(l.email);
    const seenAt = date(l.updatedAt) ?? date(l.createdAt) ?? new Date();
    const customerId = await resolveCustomer(db, {
      phone,
      email,
      name: [firstName, lastName].filter(Boolean).join(' '),
      governorate: address?.province,
      city: address?.city,
      address: [address?.address1, address?.address2].filter(Boolean).join(', '),
      seenAt,
    });
    const data = {
      shopId: shop.id,
      merchantId: shop.merchantId,
      customerId,
      firstName,
      lastName,
      email,
      phone,
      state: str(l.state),
      ordersCount: Number(l.numberOfOrders ?? 0) || 0,
      amountSpentPiastres: toPiastres(str((l.amountSpent as { amount?: string } | null)?.amount)),
      emailMarketing: str(emailRow?.marketingState),
      smsMarketing: str(phoneRow?.marketingState),
      province: str(address?.province),
      city: str(address?.city),
      tags: Array.isArray(l.tags) ? (l.tags as string[]) : [],
      createdAtShop: date(l.createdAt),
      updatedAtShop: date(l.updatedAt),
      raw: l as Prisma.InputJsonValue,
    };
    await db.shopCustomer.upsert({
      where: { shopifyId: l.id! },
      create: { shopifyId: l.id!, ...data },
      update: data,
    });
    customers++;
  }
  return { customers };
}

/**
 * Links our own delivery orders that have no customer yet (the jobs call it every 30 seconds).
 * Orders whose phone is not an Egyptian mobile (flagged) stay unlinked. A cash order still in
 * the store from a high risk customer raises one cod_risk_customer alert for admin.
 */
export async function linkDeliveryCustomers(db: Db, limit = 500) {
  const orders = await db.order.findMany({
    where: { customerId: null, phoneFlagged: false },
    select: {
      id: true,
      customerName: true,
      customerPhone: true,
      addressText: true,
      latitude: true,
      longitude: true,
      placedAt: true,
      paymentMethod: true,
      status: true,
      darkStoreId: true,
    },
    orderBy: { placedAt: 'asc' },
    take: limit,
  });
  let linked = 0;
  let alerted = 0;
  for (const o of orders) {
    const customerId = await resolveCustomer(db, {
      phone: o.customerPhone,
      name: o.customerName,
      address: o.addressText,
      latitude: o.latitude,
      longitude: o.longitude,
      seenAt: o.placedAt,
    });
    if (!customerId) continue;
    await db.order.update({ where: { id: o.id }, data: { customerId } });
    linked++;
    if (o.paymentMethod !== 'cod' || !IN_STORE.includes(o.status)) continue;
    const risk = await customerRisk(db, customerId);
    if (risk.level !== 'high') continue;
    // Unique by order, type and stage: linking again never raises a second alert.
    const created = await db.alert.createMany({
      data: [
        {
          type: 'cod_risk_customer',
          stage: 'customer',
          orderId: o.id,
          darkStoreId: o.darkStoreId,
          data: { customerId, ...risk },
        },
      ],
      skipDuplicates: true,
    });
    alerted += created.count;
  }
  return { looked: orders.length, linked, alerted };
}

/** Keys of a Shopify order export row that name or reach the buyer. */
const BUYER_KEYS = ['email', 'phone', 'customer', 'shippingAddress'];

async function dropOrphans(db: Db, ids: (string | null)[]) {
  const candidates = [...new Set(ids.filter((id): id is string => !!id))];
  if (!candidates.length) return 0;
  const { count } = await db.customer.deleteMany({
    where: {
      id: { in: candidates },
      shopCustomers: { none: {} },
      shopOrders: { none: {} },
      orders: { none: {} },
    },
  });
  return count;
}

/**
 * Shopify's customers/redact: forget one buyer of one shop. Their customer record and the
 * buyer details on the named orders go; order totals stay for the sales figures. The person
 * is deleted too unless another merchant or our own deliveries still know them.
 */
export async function redactShopCustomer(
  db: Db,
  shopId: string,
  customerGid: string | null,
  orderGids: string[],
) {
  const records = customerGid
    ? await db.shopCustomer.findMany({ where: { shopId, shopifyId: customerGid } })
    : [];
  const orders = await db.shopOrder.findMany({
    where: {
      shopId,
      OR: [
        { shopifyId: { in: orderGids } },
        ...(customerGid ? [{ customerShopifyId: customerGid }] : []),
      ],
    },
    select: { id: true, customerId: true },
  });
  await db.shopCustomer.deleteMany({ where: { id: { in: records.map((r) => r.id) } } });
  if (orders.length)
    await db.$executeRaw`
      UPDATE shop_orders SET customer_id = NULL, customer_shopify_id = NULL,
        raw = raw - ${BUYER_KEYS}::text[]
      WHERE id IN (${Prisma.join(orders.map((o) => o.id))})`;
  const removed = await dropOrphans(db, [
    ...records.map((r) => r.customerId),
    ...orders.map((o) => o.customerId),
  ]);
  return { records: records.length, orders: orders.length, customersRemoved: removed };
}

/** Shopify's shop/redact (48 hours after uninstall): forget every buyer of that shop. */
export async function redactShopCustomers(db: Db, shopId: string) {
  const linked = await db.$queryRaw<{ customer_id: string | null }[]>`
    SELECT customer_id FROM shop_customers WHERE shop_id = ${shopId}
    UNION SELECT customer_id FROM shop_orders WHERE shop_id = ${shopId}`;
  const records = await db.shopCustomer.deleteMany({ where: { shopId } });
  const orders = await db.$executeRaw`
    UPDATE shop_orders SET customer_id = NULL, customer_shopify_id = NULL,
      raw = raw - ${BUYER_KEYS}::text[]
    WHERE shop_id = ${shopId}`;
  const removed = await dropOrphans(
    db,
    linked.map((l) => l.customer_id),
  );
  return { records: records.count, orders, customersRemoved: removed };
}

const IN_STORE: string[] = ['new', 'accepted', 'picking', 'packed'];

export type RiskLevel = 'unknown' | 'low' | 'medium' | 'high';

/**
 * How safe cash on delivery is with this customer, from our own finished delivery attempts:
 * failed attempts (refusals count double) as a share of attempts, against the customer.risk_*
 * settings. Too few attempts give "unknown", or "medium" if they ever refused.
 */
export async function customerRisk(db: Db, customerId: string) {
  const [r] = await db.$queryRaw<
    { attempts: bigint; failed: bigint; refused: bigint; no_answer: bigint; short: bigint }[]
  >`
    SELECT COUNT(*) FILTER (WHERE d.status IN ('delivered', 'failed')) AS attempts,
      COUNT(*) FILTER (WHERE d.status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE d.failed_reason = 'refused') AS refused,
      COUNT(*) FILTER (WHERE d.failed_reason = 'no_answer') AS no_answer,
      COUNT(*) FILTER (WHERE d.status = 'delivered'
        AND COALESCE(d.cod_collected_piastres, d.cod_expected_piastres) < d.cod_expected_piastres) AS short
    FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE o.customer_id = ${customerId}`;
  const [minAttempts, mediumPct, highPct] = await Promise.all([
    getSetting(db, 'customer.risk_min_attempts'),
    getSetting(db, 'customer.risk_medium_pct'),
    getSetting(db, 'customer.risk_high_pct'),
  ]);
  const attempts = Number(r?.attempts ?? 0);
  const failed = Number(r?.failed ?? 0);
  const refused = Number(r?.refused ?? 0);
  const pct = attempts ? Math.min(100, Math.round(((failed + refused) * 100) / attempts)) : 0;
  const level: RiskLevel =
    attempts < minAttempts
      ? refused > 0
        ? 'medium'
        : 'unknown'
      : pct >= highPct
        ? 'high'
        : pct >= mediumPct
          ? 'medium'
          : 'low';
  return {
    level,
    pct,
    attempts,
    failed,
    refused,
    noAnswer: Number(r?.no_answer ?? 0),
    cashShort: Number(r?.short ?? 0),
  };
}

/**
 * Works out the district of customers not placed yet, or changed since: from the latest point
 * of our own orders, else by reading the address with the area engine. Returns how many it
 * placed. The jobs call it; a customer it cannot place is tried again only after a change.
 */
export async function locateCustomers(db: Db, limit = 100) {
  const pending = await db.$queryRaw<
    {
      id: string;
      latitude: number | null;
      longitude: number | null;
      address: string | null;
      city: string | null;
      governorate: string | null;
    }[]
  >`
    SELECT id, latitude, longitude, address, city, governorate FROM customers
    WHERE located_at IS NULL OR updated_at > located_at
    ORDER BY updated_at LIMIT ${limit}`;
  let placed = 0;
  for (const c of pending) {
    let districtId: string | null = null;
    if (c.latitude != null && c.longitude != null) {
      const [hit] = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM geo_areas WHERE level = 2 AND is_active
          AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(${c.longitude}, ${c.latitude}), 4326))
        LIMIT 1`;
      districtId = hit?.id ?? null;
    }
    const text = [c.address, c.city, c.governorate].filter(Boolean).join(', ');
    if (!districtId && text) {
      const found = await resolveByAreas(db, text);
      districtId = found.chain.find((a) => a.level === 2)?.id ?? null;
    }
    // Raw SQL so updated_at stays as it is (it is what marks a customer as changed).
    await db.$executeRaw`
      UPDATE customers SET district_id = ${districtId}, located_at = NOW() WHERE id = ${c.id}`;
    if (districtId) placed++;
  }
  return { looked: pending.length, placed };
}

/**
 * Admin joins two profiles of one person: everything of `mergeId` moves to `keepId`, its phone
 * and email are kept as aliases (so new orders with them still land here), then it is deleted.
 */
export async function mergeCustomers(
  db: Db,
  input: { keepId: string; mergeId: string; actorUserId: string },
) {
  if (input.keepId === input.mergeId) throw new DomainError('same_customer', 400);
  return inTransaction(db, async (tx) => {
    const [keep, merge] = await Promise.all(
      [input.keepId, input.mergeId].map((id) => tx.customer.findUnique({ where: { id } })),
    );
    if (!keep || !merge) throw new DomainError('customer_not_found', 404);
    await tx.shopCustomer.updateMany({
      where: { customerId: merge.id },
      data: { customerId: keep.id },
    });
    await tx.shopOrder.updateMany({
      where: { customerId: merge.id },
      data: { customerId: keep.id },
    });
    await tx.order.updateMany({ where: { customerId: merge.id }, data: { customerId: keep.id } });
    await tx.customerAlias.updateMany({
      where: { customerId: merge.id },
      data: { customerId: keep.id },
    });
    // Free the merged profile's phone and email before the kept one takes or aliases them.
    await tx.customer.update({ where: { id: merge.id }, data: { phone: null, email: null } });
    const data: Prisma.CustomerUpdateInput = {
      firstSeenAt: merge.firstSeenAt < keep.firstSeenAt ? merge.firstSeenAt : keep.firstSeenAt,
      lastSeenAt: merge.lastSeenAt > keep.lastSeenAt ? merge.lastSeenAt : keep.lastSeenAt,
      locatedAt: null,
    };
    const aliases: { kind: string; value: string }[] = [];
    if (merge.phone) {
      if (!keep.phone) data.phone = merge.phone;
      else if (merge.phone !== keep.phone) aliases.push({ kind: 'phone', value: merge.phone });
    }
    if (merge.email) {
      if (!keep.email) data.email = merge.email;
      else if (merge.email !== keep.email) aliases.push({ kind: 'email', value: merge.email });
    }
    for (const key of ['governorate', 'city', 'address'] as const)
      if (!keep[key] && merge[key]) data[key] = merge[key];
    if (!keep.name && merge.name) data.name = merge.name;
    if (keep.latitude == null && merge.latitude != null) {
      data.latitude = merge.latitude;
      data.longitude = merge.longitude;
    }
    if (aliases.length)
      await tx.customerAlias.createMany({
        data: aliases.map((a) => ({ ...a, customerId: keep.id })),
        skipDuplicates: true,
      });
    await tx.customer.delete({ where: { id: merge.id } });
    const after = await tx.customer.update({ where: { id: keep.id }, data });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'customer.merge',
      entityType: 'customer',
      entityId: keep.id,
      before: { keep, merged: merge } as unknown as Prisma.InputJsonValue,
      after: after as unknown as Prisma.InputJsonValue,
    });
    return after;
  });
}
