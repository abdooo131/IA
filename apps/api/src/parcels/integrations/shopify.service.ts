// The Shopify connection: a merchant installs the Shiply app on their store, new orders become
// parcels (by themselves or with one press), and Shopify hears back when the order ships and
// when cash on delivery is collected.
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PARCEL_SIZES } from '@shiplynow/shared/parcels';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { assertMerchantRight, type SessionUser } from '../auth/auth';
import { DomainError, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { seal, unseal } from '../common/secrets';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { MerchantService } from '../merchant/merchant.service';
import {
  draftFromOrder, exchangeCode, graphql, normalizeShop, openOrders, ordersByIds, shopifyConfig, verifyQueryHmac, verifyWebhookHmac,
  type OrderDraft, type ShopifyConfig, type ShopifyOrderPayload,
} from './shopify';

const InstallInput = z.object({ shop: z.string().trim().min(3).max(120) });
const SettingsInput = z.object({ autoCreate: z.boolean(), defaultSize: z.enum(PARCEL_SIZES), pushUpdates: z.boolean() });
const FixInput = z.object({
  customerName: z.string().trim().min(2).max(120).optional(),
  customerPhone: z.string().trim().min(8).max(20).optional(),
  address: z.string().trim().min(5).max(400).optional(),
  governorateCode: z.string().trim().length(3).optional(),
  areaId: z.string().min(1).max(64).nullish(),
  size: z.enum(PARCEL_SIZES).optional(),
  codAmount: z.number().int().min(0).optional(),
});
const PickInput = z.object({ orders: z.array(z.object({ id: z.string().min(1).max(64), fix: FixInput.default({}) })).min(1).max(100) });
const TokenInput = z.object({ token: z.string().min(10) });
const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 720];
const TOPICS = ['ORDERS_CREATE', 'ORDERS_CANCELLED', 'APP_UNINSTALLED'];

@Injectable()
export class ShopifyService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly jwt: JwtService,
    private readonly merchants: MerchantService,
  ) {}

  onModuleInit() {
    if (process.env.SHIPLY_JOBS === 'off') return;
    this.timer = setInterval(() => void this.runTasks().catch((e) => console.error('shopify', e)), 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private cfg(): ShopifyConfig {
    const c = shopifyConfig();
    if (!c) throw new DomainError('not_configured', 'The Shopify connection is not set up on this Shiply server yet', 409);
    return c;
  }

  private merchantId(user: SessionUser) {
    assertMerchantRight(user, 'settings');
    return user.merchantId!;
  }

  // ---------------------------------------------------------------- connecting a store

  async view(user: SessionUser) {
    assertMerchantRight(user, 'orders');
    const store = await this.prisma.shopifyStore.findUnique({ where: { merchantId: user.merchantId! }, omit: { tokenEnc: true } });
    const orders = store ? await this.prisma.shopifyOrder.findMany({ where: { storeId: store.id }, orderBy: { createdAt: 'desc' }, take: 100 }) : [];
    const parcels = await this.prisma.shipment.findMany({ where: { id: { in: orders.map((o) => o.shipmentId).filter((x): x is string => !!x) } }, select: { id: true, trackingNumber: true, status: true } });
    return { configured: !!shopifyConfig(), store, orders: orders.map((o) => ({ ...o, parcel: parcels.find((p) => p.id === o.shipmentId) ?? null })) };
  }

  /** Where to send the merchant to approve the app on their store. */
  async installUrl(user: SessionUser, body: unknown) {
    const merchantId = this.merchantId(user);
    const cfg = this.cfg();
    const shop = normalizeShop(parse(InstallInput, body).shop);
    if (!shop) throw new DomainError('invalid_input', 'Enter your store address, like mystore.myshopify.com', 422);
    const other = await this.prisma.shopifyStore.findUnique({ where: { shop } });
    if (other && other.merchantId !== merchantId && other.active) throw new DomainError('duplicate', 'This store is connected to another Shiply account', 409);
    const state = await this.jwt.signAsync({ merchantId, shop, userId: user.id, nonce: randomBytes(8).toString('hex'), purpose: 'shopify' }, { expiresIn: '15m' });
    const q = new URLSearchParams({ client_id: cfg.apiKey, scope: cfg.scopes, redirect_uri: `${cfg.appUrl}/api/integrations/shopify/callback`, state });
    return { url: `https://${shop}/admin/oauth/authorize?${q}` };
  }

  /** Shopify sends the merchant back here with a code. Returns where to send the browser next. */
  async callback(query: Record<string, string>) {
    const cfg = this.cfg();
    const done = (q: string) => `${cfg.appUrl}/merchant/shopify?${q}`;
    if (!verifyQueryHmac(query, cfg.secret)) return done('error=signature');
    const shop = normalizeShop(query.shop ?? '');
    let state: { merchantId: string; shop: string; purpose: string; userId: string };
    try {
      state = await this.jwt.verifyAsync(query.state ?? '');
    } catch {
      return done('error=expired');
    }
    if (state.purpose !== 'shopify' || !shop || state.shop !== shop || !query.code) return done('error=mismatch');
    let token: { token: string; scopes: string };
    try {
      token = await exchangeCode(cfg, shop, query.code);
    } catch {
      return done('error=exchange');
    }
    const store = await this.prisma.shopifyStore.upsert({
      where: { shop },
      update: { merchantId: state.merchantId, tokenEnc: seal(token.token), scopes: token.scopes, active: true, uninstalledAt: null, installedAt: new Date() },
      create: { merchantId: state.merchantId, shop, tokenEnc: seal(token.token), scopes: token.scopes },
    });
    await this.prisma.auditLog.create({ data: { actorUserId: state.userId, action: 'SHOPIFY_CONNECTED', entityType: 'shopify_store', entityId: store.id, after: { shop } } });
    try {
      for (const topic of TOPICS) {
        await graphql(cfg, shop, token.token, 'mutation($topic: WebhookSubscriptionTopic!, $url: URL!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) { userErrors { message } } }', { topic, url: `${cfg.appUrl}/api/integrations/shopify/webhooks` });
      }
    } catch {
      return done('connected=1&warning=webhooks');
    }
    return done('connected=1');
  }

  async saveSettings(user: SessionUser, body: unknown) {
    const d = parse(SettingsInput, body);
    const r = await this.prisma.shopifyStore.updateMany({ where: { merchantId: this.merchantId(user) }, data: d });
    if (r.count !== 1) throw notFound('Store');
    return { message: 'Saved' };
  }

  /** Stops using the store. The merchant also removes the app in Shopify. */
  async disconnect(user: SessionUser) {
    const r = await this.prisma.shopifyStore.updateMany({ where: { merchantId: this.merchantId(user) }, data: { active: false, tokenEnc: '', uninstalledAt: new Date() } });
    if (r.count !== 1) throw notFound('Store');
    return { message: 'Disconnected. Remove the Shiply app from your Shopify admin too' };
  }

  // ---------------------------------------------------------------- orders

  private async owner(merchantId: string) {
    const u = await this.prisma.user.findFirst({ where: { merchantId, merchantRole: 'owner', isActive: true }, select: { id: true } });
    if (!u) throw new DomainError('invalid_input', 'This merchant has no active owner login', 409);
    return u.id;
  }

  /**
   * Keeps a Shopify order. With automatic parcels on (and nothing missing) the parcel is made at
   * once; otherwise it waits for the merchant to pick it. An order seen before is returned as is.
   */
  async importOrder(storeId: string, payload: ShopifyOrderPayload, opts: { auto?: boolean } = {}) {
    const store = await this.prisma.shopifyStore.findUniqueOrThrow({ where: { id: storeId } });
    const orderId = String(payload.id);
    const seen = await this.prisma.shopifyOrder.findUnique({ where: { storeId_orderId: { storeId, orderId } } });
    if (seen) return { row: seen, fresh: false };
    const govs = (await this.prisma.governorate.findMany({ select: { code: true, nameEn: true, nameAr: true, hubId: true } })).map((g) => ({ ...g, served: !!g.hubId }));
    const { draft, problems, skip } = draftFromOrder(payload, store.defaultSize, govs);
    const auto = opts.auto ?? store.autoCreate;
    const status = skip ? 'SKIPPED' : problems.length ? 'FAILED' : auto ? 'CREATING' : 'WAITING';
    let row;
    try {
      row = await this.prisma.shopifyOrder.create({ data: { storeId, orderId, orderName: payload.name, status, error: skip ?? problems.join('. '), draft: draft as never } });
    } catch {
      // The same order arrived twice at once.
      return { row: await this.prisma.shopifyOrder.findUniqueOrThrow({ where: { storeId_orderId: { storeId, orderId } } }), fresh: false };
    }
    if (status === 'CREATING') row = await this.create(row.id, draft, store.merchantId);
    return { row, fresh: true };
  }

  private async create(id: string, draft: OrderDraft, merchantId: string) {
    try {
      const s = await this.merchants.create(merchantId, draft, await this.owner(merchantId));
      return this.prisma.shopifyOrder.update({ where: { id }, data: { status: 'CREATED', error: '', shipmentId: s.id, draft: draft as never } });
    } catch (e) {
      return this.prisma.shopifyOrder.update({ where: { id }, data: { status: 'FAILED', error: e instanceof DomainError ? e.message : 'Could not create the parcel', draft: draft as never } });
    }
  }

  /** The merchant fixes what was missing (or just presses create) and the parcel is made. */
  async createFromOrder(user: SessionUser, id: string, body: unknown) {
    assertMerchantRight(user, 'orders');
    const r = await this.makeParcel(user.merchantId!, id, parse(FixInput, body));
    if (r.status !== 'CREATED') throw new DomainError('invalid_input', r.error, 422);
    return r;
  }

  private async makeParcel(merchantId: string, id: string, fix: z.infer<typeof FixInput>) {
    const o = await this.prisma.shopifyOrder.findUnique({ where: { id }, include: { store: { select: { merchantId: true } } } });
    if (!o || o.store.merchantId !== merchantId) throw notFound('Order');
    if (o.status === 'CREATED') return o;
    if (!['WAITING', 'FAILED', 'SKIPPED'].includes(o.status)) throw new DomainError('bad_status', 'This order is being handled', 409);
    const draft = { ...(o.draft as unknown as OrderDraft), ...Object.fromEntries(Object.entries(fix).filter(([, v]) => v !== undefined)) } as OrderDraft;
    const claimed = await this.prisma.shopifyOrder.updateMany({ where: { id, status: o.status }, data: { status: 'CREATING' } });
    if (claimed.count !== 1) throw new DomainError('conflict', 'This order is being handled. Try again', 409);
    return this.create(id, draft, merchantId);
  }

  /** Several picked orders at once: each one is made on its own and reported back. */
  private async makeMany(merchantId: string, picks: z.infer<typeof PickInput>['orders']) {
    const results = [];
    for (const p of picks) {
      try {
        const r = await this.makeParcel(merchantId, p.id, p.fix);
        results.push({ id: p.id, ok: r.status === 'CREATED', error: r.status === 'CREATED' ? '' : r.error, shipmentId: r.shipmentId });
      } catch (e) {
        results.push({ id: p.id, ok: false, error: e instanceof DomainError ? e.message : 'Could not create', shipmentId: null });
      }
    }
    const ids = results.map((r) => r.shipmentId).filter((x): x is string => !!x);
    return { created: ids.length, failed: results.length - ids.length, results, labels: await this.labels(ids) };
  }

  /** What to print on each label, so the merchant can print straight away. */
  private async labels(shipmentIds: string[]) {
    if (!shipmentIds.length) return [];
    const rows = await this.prisma.shipment.findMany({ where: { id: { in: shipmentIds } }, include: { merchant: { select: { name: true } } }, orderBy: { trackingNumber: 'asc' } });
    const hubs = new Map((await this.prisma.hub.findMany({ select: { id: true, code: true, name: true } })).map((h) => [h.id, h]));
    return rows.map((s) => {
      const hub = s.destinationHubId ? hubs.get(s.destinationHubId) : null;
      return {
        trackingNumber: s.trackingNumber, route: hub?.code ?? s.governorateCode, routeDetail: s.route.join(' > '), merchantName: s.merchant.name, customerName: s.customerName,
        customerPhone: s.customerPhone, address: s.address, codAmount: s.codAmount, size: s.size, allowOpen: s.allowOpen, merchantRef: s.merchantRef, description: s.description,
      };
    });
  }

  /** In the Shiply panel: make AWBs for the orders the merchant ticked. */
  async createPicked(user: SessionUser, body: unknown) {
    assertMerchantRight(user, 'orders');
    return this.makeMany(user.merchantId!, parse(PickInput, body).orders);
  }

  /** In the Shiply panel: brings in the store's open orders not shipped yet, to pick from. */
  async sync(user: SessionUser) {
    assertMerchantRight(user, 'orders');
    const cfg = this.cfg();
    const store = await this.prisma.shopifyStore.findUnique({ where: { merchantId: user.merchantId! } });
    if (!store?.active || !store.tokenEnc) throw new DomainError('not_connected', 'Connect your Shopify store first', 409);
    const orders = await openOrders(cfg, store.shop, unseal(store.tokenEnc));
    let added = 0;
    for (const o of orders) if ((await this.importOrder(store.id, o, { auto: false })).fresh) added++;
    return { found: orders.length, added };
  }

  // ---------------------------------------------------------------- picking orders inside Shopify

  /**
   * The merchant ticks orders in their Shopify admin and chooses "Ship with Shiply". Shopify opens
   * this address, signed, with the order numbers. We bring those orders in and open the page
   * where the merchant checks them and makes the AWBs. No Shiply sign in is needed: the signed
   * link proves it came from the store's own admin, and the page token lasts 30 minutes.
   */
  async pickedInShopify(query: Record<string, string | string[]>) {
    const cfg = this.cfg();
    const page = (q: string) => `${cfg.appUrl}/shopify/ship?${q}`;
    if (!verifyQueryHmac(query, cfg.secret)) return page('error=signature');
    if (Math.abs(Date.now() / 1000 - Number(query.timestamp)) > 600) return page('error=expired');
    const shop = normalizeShop(String(query.shop ?? ''));
    const store = shop ? await this.prisma.shopifyStore.findUnique({ where: { shop } }) : null;
    if (!store?.active || !store.tokenEnc) return page('error=not_connected');
    const raw = query.ids ?? query['ids[]'] ?? query.id ?? [];
    const ids = (Array.isArray(raw) ? raw : [raw]).map(String).filter((x) => /^\d{1,20}$/.test(x)).slice(0, 100);
    if (!ids.length) return page('error=no_orders');
    let orders: ShopifyOrderPayload[];
    try {
      orders = await ordersByIds(cfg, store.shop, unseal(store.tokenEnc), ids);
    } catch {
      return page('error=shopify');
    }
    const rows = [];
    for (const o of orders) rows.push((await this.importOrder(store.id, o, { auto: false })).row.id);
    const token = await this.jwt.signAsync({ purpose: 'shopify-ship', storeId: store.id, rows }, { expiresIn: '30m' });
    return page(`token=${encodeURIComponent(token)}`);
  }

  private async shipToken(token: string) {
    try {
      const t = await this.jwt.verifyAsync<{ purpose: string; storeId: string; rows: string[] }>(token);
      if (t.purpose !== 'shopify-ship') throw new Error('wrong token');
      const store = await this.prisma.shopifyStore.findUniqueOrThrow({ where: { id: t.storeId } });
      if (!store.active) throw new Error('store off');
      return { store, rows: t.rows };
    } catch {
      throw new DomainError('unauthenticated', 'This page has expired. Pick the orders in Shopify again', 401);
    }
  }

  async shipView(query: unknown) {
    const { token } = parse(TokenInput, query);
    const { store, rows } = await this.shipToken(token);
    const merchant = await this.prisma.merchant.findUniqueOrThrow({ where: { id: store.merchantId }, select: { name: true } });
    const orders = await this.prisma.shopifyOrder.findMany({ where: { id: { in: rows } }, orderBy: { orderName: 'asc' } });
    const parcels = await this.prisma.shipment.findMany({ where: { id: { in: orders.map((o) => o.shipmentId).filter((x): x is string => !!x) } }, select: { id: true, trackingNumber: true, status: true, route: true } });
    const govs = await this.prisma.governorate.findMany({ where: { hubId: { not: null } }, select: { code: true, nameEn: true, nameAr: true }, orderBy: { nameEn: 'asc' } });
    return { shop: store.shop, merchant: merchant.name, served: govs, orders: orders.map((o) => ({ ...o, parcel: parcels.find((p) => p.id === o.shipmentId) ?? null })) };
  }

  async shipCreate(body: unknown) {
    const { token } = parse(TokenInput, body);
    const { store, rows } = await this.shipToken(token);
    const picks = parse(PickInput, body).orders;
    if (picks.some((p) => !rows.includes(p.id))) throw new DomainError('forbidden', 'Only the orders picked in Shopify can be shipped from this page', 403);
    return this.makeMany(store.merchantId, picks);
  }

  async skip(user: SessionUser, id: string) {
    assertMerchantRight(user, 'orders');
    const o = await this.prisma.shopifyOrder.findUnique({ where: { id }, include: { store: { select: { merchantId: true } } } });
    if (!o || o.store.merchantId !== user.merchantId) throw notFound('Order');
    const r = await this.prisma.shopifyOrder.updateMany({ where: { id, status: { in: ['WAITING', 'FAILED'] } }, data: { status: 'SKIPPED', error: 'Skipped by the merchant' } });
    if (r.count !== 1) throw new DomainError('bad_status', 'This order cannot be skipped now', 409);
    return { message: 'Skipped' };
  }

  // ---------------------------------------------------------------- webhooks from Shopify

  async webhook(raw: Buffer | undefined, headers: Record<string, string | undefined>, body: unknown) {
    const cfg = this.cfg();
    if (!raw || !verifyWebhookHmac(raw, headers['x-shopify-hmac-sha256'], cfg.secret)) throw new DomainError('unauthenticated', 'Bad signature', 401);
    const topic = headers['x-shopify-topic'] ?? '';
    const shop = normalizeShop(headers['x-shopify-shop-domain'] ?? '');
    const store = shop ? await this.prisma.shopifyStore.findUnique({ where: { shop } }) : null;
    // The privacy requests Shopify requires every app to answer.
    if (topic === 'shop/redact') {
      if (store) await this.prisma.shopifyStore.delete({ where: { id: store.id } });
      return { ok: true };
    }
    if (topic.startsWith('customers/')) return { ok: true };
    if (!store) return { ok: true, ignored: 'unknown store' };
    if (topic === 'app/uninstalled') {
      await this.prisma.shopifyStore.update({ where: { id: store.id }, data: { active: false, tokenEnc: '', uninstalledAt: new Date() } });
      return { ok: true };
    }
    if (!store.active) return { ok: true, ignored: 'store disconnected' };
    const order = body as ShopifyOrderPayload;
    if (topic === 'orders/create') {
      await this.importOrder(store.id, order);
      return { ok: true };
    }
    if (topic === 'orders/cancelled') {
      const o = await this.prisma.shopifyOrder.findUnique({ where: { storeId_orderId: { storeId: store.id, orderId: String(order.id) } } });
      if (!o) return { ok: true };
      if (o.shipmentId) {
        // Cancelled in Shopify before we picked it up: cancel the parcel too. Later, the merchant decides.
        await this.merchants.cancel(store.merchantId, o.shipmentId, await this.owner(store.merchantId)).catch(() => undefined);
      }
      if (o.status !== 'CREATED') await this.prisma.shopifyOrder.update({ where: { id: o.id }, data: { status: 'CANCELLED', error: 'Cancelled in Shopify' } });
      return { ok: true };
    }
    return { ok: true, ignored: topic };
  }

  // ---------------------------------------------------------------- telling Shopify

  async runTasks(limit = 20) {
    const cfg = shopifyConfig();
    if (!cfg) return { due: 0, done: 0 };
    const due = await this.prisma.shopifyTask.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: 'asc' }, take: limit });
    let done = 0;
    for (const t of due) {
      try {
        await this.runTask(cfg, t.storeId, t.shipmentId, t.kind);
        await this.prisma.shopifyTask.update({ where: { id: t.id }, data: { status: 'DONE', attempts: t.attempts + 1, doneAt: new Date(), error: '' } });
        done++;
      } catch (e) {
        const attempts = t.attempts + 1;
        const wait = BACKOFF_MINUTES[attempts - 1];
        await this.prisma.shopifyTask.update({
          where: { id: t.id },
          data: { attempts, error: (e instanceof Error ? e.message : 'Failed').slice(0, 300), ...(wait === undefined ? { status: 'FAILED' } : { nextAttemptAt: new Date(Date.now() + wait * 60_000) }) },
        });
      }
    }
    return { due: due.length, done };
  }

  private async runTask(cfg: ShopifyConfig, storeId: string, shipmentId: string, kind: string) {
    const store = await this.prisma.shopifyStore.findUniqueOrThrow({ where: { id: storeId } });
    if (!store.active || !store.tokenEnc) throw new Error('The store is disconnected');
    const token = unseal(store.tokenEnc);
    const link = await this.prisma.shopifyOrder.findUniqueOrThrow({ where: { shipmentId } });
    const orderGid = `gid://shopify/Order/${link.orderId}`;
    if (kind === 'MARK_PAID') {
      const r = await graphql(cfg, store.shop, token, 'mutation($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { userErrors { message } } }', { input: { id: orderGid } });
      const errs = r?.orderMarkAsPaid?.userErrors ?? [];
      if (errs.length && !/already/i.test(errs[0].message)) throw new Error(errs.map((x: { message: string }) => x.message).join('; '));
      return;
    }
    const s = await this.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { trackingNumber: true } });
    const base = (await this.settings.all())['tracking.base_url'];
    const fo = await graphql(cfg, store.shop, token, 'query($id: ID!) { order(id: $id) { fulfillmentOrders(first: 10) { nodes { id status } } } }', { id: orderGid });
    const open = (fo?.order?.fulfillmentOrders?.nodes ?? []).filter((n: { status: string }) => ['OPEN', 'IN_PROGRESS', 'SCHEDULED'].includes(n.status));
    if (!open.length) return; // already fulfilled in Shopify, nothing to do
    const r = await graphql(cfg, store.shop, token, 'mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { message } } }', {
      f: { lineItemsByFulfillmentOrder: open.map((n: { id: string }) => ({ fulfillmentOrderId: n.id })), trackingInfo: { company: 'Shiply', number: s.trackingNumber, url: `${base}/${s.trackingNumber}` }, notifyCustomer: true },
    });
    const errs = r?.fulfillmentCreate?.userErrors ?? [];
    if (errs.length) throw new Error(errs.map((x: { message: string }) => x.message).join('; '));
  }
}
