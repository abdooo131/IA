import { Prisma } from '@prisma/client';
import { normalizeEgyptianPhone } from '@shiplynow/shared';
import type { Db } from '../client';

// One person across every merchant: a Shopify customer, a Shopify order and our own delivery
// order all point at the same customers row when they share an Egyptian mobile (first) or an
// email. Rows only ever gain details; nothing here deletes or merges two people.

export type CustomerFacts = {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  governorate?: string | null;
  city?: string | null;
  address?: string | null;
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

async function resolveOnce(db: Db, phone: string | null, email: string | null, f: CustomerFacts) {
  const byPhone = phone ? await db.customer.findUnique({ where: { phone } }) : null;
  const byEmail = !byPhone && email ? await db.customer.findUnique({ where: { email } }) : null;
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
        firstSeenAt: f.seenAt,
        lastSeenAt: f.seenAt,
      },
    });
    return created.id;
  }
  const newer = f.seenAt >= found.lastSeenAt;
  const data: Prisma.CustomerUpdateInput = {};
  if (!found.phone && phone) data.phone = phone;
  if (!found.email && email && !(await db.customer.findUnique({ where: { email } })))
    data.email = email;
  // The latest name and place win; older facts only fill gaps.
  if (name && name !== found.name && (newer || !found.name)) data.name = name;
  for (const key of ['governorate', 'city', 'address'] as const) {
    const v = clean(f[key]);
    if (v && v !== found[key] && (newer || !found[key])) data[key] = v;
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
 * Orders whose phone is not an Egyptian mobile (flagged) stay unlinked and are skipped. Returns how many it looked at.
 */
export async function linkDeliveryCustomers(db: Db, limit = 500) {
  const orders = await db.order.findMany({
    where: { customerId: null, phoneFlagged: false },
    select: {
      id: true,
      customerName: true,
      customerPhone: true,
      addressText: true,
      placedAt: true,
    },
    orderBy: { placedAt: 'asc' },
    take: limit,
  });
  let linked = 0;
  for (const o of orders) {
    const customerId = await resolveCustomer(db, {
      phone: o.customerPhone,
      name: o.customerName,
      address: o.addressText,
      seenAt: o.placedAt,
    });
    if (customerId) {
      await db.order.update({ where: { id: o.id }, data: { customerId } });
      linked++;
    }
  }
  return { looked: orders.length, linked };
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
