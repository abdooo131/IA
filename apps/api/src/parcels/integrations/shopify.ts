// Talking to Shopify: app settings, Shopify's signatures, its Admin GraphQL API, and turning an
// order into a parcel. Kept apart from the service so it can be checked on its own.
import { normalizeEgyptPhone } from '@shiplynow/shared/parcels';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ShopifyConfig {
  apiKey: string;
  secret: string;
  appUrl: string;
  scopes: string;
  version: string;
}

/** The Shiply app's credentials from the Shopify Partner dashboard. Null until they are set. */
export function shopifyConfig(): ShopifyConfig | null {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const secret = process.env.SHOPIFY_API_SECRET;
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!apiKey || !secret || !appUrl) return null;
  return {
    apiKey,
    secret,
    appUrl: appUrl.replace(/\/$/, ''),
    scopes:
      process.env.SHOPIFY_SCOPES ??
      'read_orders,write_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders',
    version: process.env.SHOPIFY_API_VERSION ?? '2025-07',
  };
}

export const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normalizeShop(raw: string) {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const shop = s.includes('.') ? s : `${s}.myshopify.com`;
  return SHOP_DOMAIN.test(shop) ? shop : null;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The install redirect carries an hmac over its other query values. */
/** Shopify signs a list (the orders picked in a bulk action) as ids=["1", "2"]. */
export function verifyQueryHmac(query: Record<string, string | string[]>, secret: string) {
  const { hmac, signature: _s, ...rest } = query;
  if (typeof hmac !== 'string' || !hmac) return false;
  const value = (v: string | string[] | undefined) =>
    Array.isArray(v) ? `[${v.map((x) => `"${x}"`).join(', ')}]` : (v ?? '');
  // A list arrives as ids[]=1&ids[]=2 but is signed under the plain name.
  const pairs = Object.entries(rest).map(
    ([k, v]) =>
      [k.replace(/\[\]$/, ''), Array.isArray(v) || k.endsWith('[]') ? [v].flat() : v] as const,
  );
  const message = pairs
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${value(v)}`)
    .join('&');
  return safeEqual(createHmac('sha256', secret).update(message).digest('hex'), hmac);
}

/** Webhooks carry a base64 hmac of the raw body. */
export function verifyWebhookHmac(
  raw: Buffer | string,
  header: string | undefined,
  secret: string,
) {
  if (!header) return false;
  return safeEqual(createHmac('sha256', secret).update(raw).digest('base64'), header);
}

/** Shopify's address for a store. Tests point it at a local stand in. */
export function adminUrl(shop: string, path: string) {
  const base = process.env.SHOPIFY_ADMIN_BASE;
  return base ? `${base}/${shop}${path}` : `https://${shop}${path}`;
}

export async function exchangeCode(cfg: ShopifyConfig, shop: string, code: string) {
  const res = await fetch(adminUrl(shop, '/admin/oauth/access_token'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: cfg.apiKey, client_secret: cfg.secret, code }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Shopify refused the install (${res.status})`);
  const body = (await res.json()) as { access_token?: string; scope?: string };
  if (!body.access_token) throw new Error('Shopify sent no access token');
  return { token: body.access_token, scopes: body.scope ?? '' };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers type the answer they read
export async function graphql<T = any>(
  cfg: ShopifyConfig,
  shop: string,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(adminUrl(shop, `/admin/api/${cfg.version}/graphql.json`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403)
    throw new Error('Shopify no longer accepts our access. Connect the store again');
  if (!res.ok) throw new Error(`Shopify answered ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length)
    throw new Error(
      body.errors
        .map((e) => e.message)
        .join('; ')
        .slice(0, 300),
    );
  return body.data as T;
}

// ---------------------------------------------------------------- orders to parcels

/** Shopify's province codes for Egypt (ISO 3166 2), to our governorate codes. */
const PROVINCES: Record<string, string> = Object.fromEntries(
  [
    'C',
    'GZ',
    'ALX',
    'ASN',
    'AST',
    'BH',
    'BNS',
    'DK',
    'DT',
    'FYM',
    'GH',
    'IS',
    'KFS',
    'LX',
    'MNF',
    'MN',
    'MT',
    'SIN',
    'WAD',
    'PTS',
    'KB',
    'KN',
    'BA',
    'SHG',
    'SHR',
    'JS',
    'SUZ',
  ].map((c) => [c, `EG-${c}`]),
);
// Older Shopify codes for 6th of October and Helwan.
PROVINCES.SU = 'EG-GZ';
PROVINCES.HU = 'EG-C';

const ALIASES: Record<string, string> = {
  '6th of october': 'EG-GZ',
  october: 'EG-GZ',
  helwan: 'EG-C',
  asyut: 'EG-AST',
  'al jizah': 'EG-GZ',
  'al qahirah': 'EG-C',
  'el gouna': 'EG-BA',
  hurghada: 'EG-BA',
  'sharm el sheikh': 'EG-JS',
};

export function governorateFor(
  addr: { province_code?: string | null; province?: string | null; city?: string | null },
  govs: { code: string; nameEn: string; nameAr: string }[],
) {
  const code = (addr.province_code ?? '').toUpperCase().replace(/^EG-/, '');
  if (PROVINCES[code]) return PROVINCES[code]!;
  const clean = (v: string | null | undefined) =>
    (v ?? '')
      .toLowerCase()
      .replace(/governorate|محافظة/g, '')
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  for (const v of [clean(addr.province), clean(addr.city)]) {
    if (!v) continue;
    if (ALIASES[v]) return ALIASES[v]!;
    const g = govs.find((x) => clean(x.nameEn) === v || clean(x.nameAr) === v);
    if (g) return g.code;
  }
  return null;
}

type Address = {
  name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  province_code?: string | null;
  country_code?: string | null;
};
export interface ShopifyOrderPayload {
  id: number | string;
  name: string;
  phone?: string | null;
  note?: string | null;
  currency?: string;
  total_price?: string;
  total_outstanding?: string;
  financial_status?: string;
  payment_gateway_names?: string[];
  cancelled_at?: string | null;
  shipping_address?: Address | null;
  billing_address?: Address | null;
  customer?: { phone?: string | null; first_name?: string; last_name?: string } | null;
  line_items?: { title: string; quantity: number }[];
}

export interface OrderDraft {
  customerName: string;
  customerPhone: string;
  address: string;
  governorateCode: string;
  areaId: null;
  size: string;
  codAmount: number;
  description: string;
  notes: string;
  merchantRef: string;
}

/** Reads what a parcel needs from an order. Problems are listed so the merchant can fix them. */
export function draftFromOrder(
  o: ShopifyOrderPayload,
  size: string,
  govs: { code: string; nameEn: string; nameAr: string; served?: boolean }[],
): { draft: OrderDraft; problems: string[]; skip?: string } {
  const a = o.shipping_address;
  if (!a)
    return {
      draft: emptyDraft(o, size),
      problems: [],
      skip: 'No shipping address: nothing to deliver',
    };
  if (a.country_code && a.country_code !== 'EG')
    return {
      draft: emptyDraft(o, size),
      problems: [],
      skip: `Ships to ${a.country_code}, outside Egypt`,
    };
  const problems: string[] = [];
  const rawPhone = a.phone || o.phone || o.customer?.phone || o.billing_address?.phone || '';
  const phone = normalizeEgyptPhone(rawPhone);
  if (!phone)
    problems.push(
      rawPhone
        ? `The phone ${rawPhone} is not an Egyptian mobile number`
        : 'The order has no phone number',
    );
  const gov = governorateFor(a, govs);
  if (!gov) problems.push(`Could not tell the governorate from "${a.province ?? a.city ?? ''}"`);
  const g = govs.find((x) => x.code === gov);
  if (g && g.served === false) problems.push(`We do not deliver to ${g.nameEn} yet`);
  const cod =
    /cash on delivery|\bcod\b|الدفع عند الاستلام/i.test(
      (o.payment_gateway_names ?? []).join(' '),
    ) && ['pending', 'partially_paid', 'authorized'].includes(o.financial_status ?? '');
  if (o.currency && o.currency !== 'EGP') problems.push(`The order is in ${o.currency}, not EGP`);
  const amount = Math.round(parseFloat(o.total_outstanding ?? o.total_price ?? '0') * 100);
  const name = (
    a.name ||
    [a.first_name, a.last_name].filter(Boolean).join(' ') ||
    [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ')
  ).trim();
  if (name.length < 2) problems.push('The order has no customer name');
  const address = [a.address1, a.address2, a.city].filter(Boolean).join(', ').trim();
  if (address.length < 5) problems.push('The shipping address is too short');
  const items = (o.line_items ?? []).map((l) => `${l.quantity} x ${l.title}`).join(', ');
  return {
    draft: {
      customerName: name.slice(0, 120),
      customerPhone: phone ?? rawPhone,
      address: address.slice(0, 400),
      governorateCode: gov ?? '',
      areaId: null,
      size,
      codAmount: cod && Number.isFinite(amount) ? amount : 0,
      description: items.slice(0, 300),
      notes: (o.note ?? '').slice(0, 300),
      merchantRef: o.name.slice(0, 60),
    },
    problems,
  };
}

function emptyDraft(o: ShopifyOrderPayload, size: string): OrderDraft {
  return {
    customerName: '',
    customerPhone: '',
    address: '',
    governorateCode: '',
    areaId: null,
    size,
    codAmount: 0,
    description: '',
    notes: '',
    merchantRef: o.name,
  };
}

// ---------------------------------------------------------------- reading orders from Shopify

const ORDER_FIELDS = `id legacyResourceId name note phone currencyCode displayFinancialStatus displayFulfillmentStatus cancelledAt paymentGatewayNames
  totalPriceSet { shopMoney { amount } } totalOutstandingSet { shopMoney { amount } }
  customer { firstName lastName phone }
  shippingAddress { name firstName lastName phone address1 address2 city province provinceCode countryCodeV2 }
  billingAddress { phone }
  lineItems(first: 50) { nodes { title quantity } }`;

type GqlAddress = {
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  provinceCode?: string | null;
  countryCodeV2?: string | null;
} | null;
export interface GqlOrder {
  id: string;
  legacyResourceId: string;
  name: string;
  note: string | null;
  phone: string | null;
  currencyCode: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  cancelledAt: string | null;
  paymentGatewayNames: string[];
  totalPriceSet: { shopMoney: { amount: string } };
  totalOutstandingSet: { shopMoney: { amount: string } } | null;
  customer: { firstName?: string; lastName?: string; phone?: string | null } | null;
  shippingAddress: GqlAddress;
  billingAddress: { phone?: string | null } | null;
  lineItems: { nodes: { title: string; quantity: number }[] };
}

/** The Admin API's order, in the same shape the webhooks send. */
export function fromGraphql(o: GqlOrder): ShopifyOrderPayload {
  const a = o.shippingAddress;
  return {
    id: o.legacyResourceId,
    name: o.name,
    phone: o.phone,
    note: o.note,
    currency: o.currencyCode,
    total_price: o.totalPriceSet.shopMoney.amount,
    total_outstanding: o.totalOutstandingSet?.shopMoney.amount,
    financial_status: (o.displayFinancialStatus ?? '').toLowerCase(),
    payment_gateway_names: o.paymentGatewayNames,
    cancelled_at: o.cancelledAt,
    shipping_address: a
      ? {
          name: a.name,
          first_name: a.firstName,
          last_name: a.lastName,
          phone: a.phone,
          address1: a.address1,
          address2: a.address2,
          city: a.city,
          province: a.province,
          province_code: a.provinceCode,
          country_code: a.countryCodeV2,
        }
      : null,
    billing_address: o.billingAddress ? { phone: o.billingAddress.phone } : null,
    customer: o.customer
      ? {
          phone: o.customer.phone,
          first_name: o.customer.firstName,
          last_name: o.customer.lastName,
        }
      : null,
    line_items: o.lineItems.nodes,
  };
}

/** The orders a merchant picked in Shopify, by their numbers. */
export async function ordersByIds(cfg: ShopifyConfig, shop: string, token: string, ids: string[]) {
  const data = await graphql<{ nodes: (GqlOrder | null)[] }>(
    cfg,
    shop,
    token,
    `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { ${ORDER_FIELDS} } } }`,
    { ids: ids.map((i) => `gid://shopify/Order/${i}`) },
  );
  return data.nodes.filter((n): n is GqlOrder => !!n && !!n.legacyResourceId).map(fromGraphql);
}

/** Recent open orders not shipped yet, newest first, for picking in the Shiply panel. */
export async function openOrders(cfg: ShopifyConfig, shop: string, token: string, first = 50) {
  const data = await graphql<{ orders: { nodes: GqlOrder[] } }>(
    cfg,
    shop,
    token,
    `query($q: String!, $n: Int!) { orders(first: $n, sortKey: CREATED_AT, reverse: true, query: $q) { nodes { ${ORDER_FIELDS} } } }`,
    { q: 'status:open AND fulfillment_status:unshipped', n: first },
  );
  return data.orders.nodes.map(fromGraphql);
}
