// The Shopify connection: a merchant installs the Shiply app on their store, new orders become
// parcels (by themselves or with one press), and Shopify hears back when the order ships and
// when cash on delivery is collected.
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PARCEL_SIZES } from '@shiply/shared';
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
  draftFromOrder, exchangeCode, graphql, normalizeShop, shopifyConfig, verifyQueryHmac, verifyWebhookHmac,
  type OrderDraft, type ShopifyConfig, type ShopifyOrderPayload,
} from './shopify';

const InstallInput = z.object({ shop: z.string().trim().min(3).max(120) });
const SettingsInput = z.object({ autoCreate: z.boolean(), defaultSize: z.enum(PARCEL_SIZES), pushUpdates: z.boolean() });
const FixInput = z.object({
  customerName: z.string().trim().min(2).max(120).optional(),
  customerPhone: z.string().trim().min(8).max(20).optional(),
  address: z.string().trim().min(5).max(400).optional(),
  governorateCode: z.string().trim().length(3).optional(),
  areaId: z.string().uuid().nullish(),
  size: z.enum(PARCEL_SIZES).optional(),
  codAmount: z.number().int().min(0).optional(),
});
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
    await this.prisma.auditLog.create({ data: { userId: state.userId, action: 'SHOPIFY_CONNECTED', entity: 'shopify_store', entityId: store.id, data: { shop } } });
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
    const u = await this.prisma.user.findFirst({ where: { merchantId, merchantOwner: true, active: true }, select: { id: true } });
    if (!u) throw new DomainError('invalid_input', 'This merchant has no active owner login', 409);
    return u.id;
  }

  /** A new order: kept, and turned into a parcel now when the store says so and nothing is missing. */
  async importOrder(storeId: string, payload: ShopifyOrderPayload) {
    const store = await this.prisma.shopifyStore.findUniqueOrThrow({ where: { id: storeId } });
    const orderId = String(payload.id);
    if (await this.prisma.shopifyOrder.findUnique({ where: { storeId_orderId: { storeId, orderId } } })) return null;
    const govs = await this.prisma.governorate.findMany({ select: { code: true, nameEn: true, nameAr: true } });
    const { draft, problems, skip } = draftFromOrder(payload, store.defaultSize, govs);
    const status = skip ? 'SKIPPED' : problems.length ? 'FAILED' : store.autoCreate ? 'CREATING' : 'WAITING';
    let row;
    try {
      row = await this.prisma.shopifyOrder.create({ data: { storeId, orderId, orderName: payload.name, status, error: skip ?? problems.join('. '), draft: draft as never } });
    } catch {
      return null; // the same order arrived twice at once
    }
    if (status === 'CREATING') return this.create(row.id, draft, store.merchantId);
    return row;
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
    const fix = parse(FixInput, body);
    const o = await this.prisma.shopifyOrder.findUnique({ where: { id }, include: { store: { select: { merchantId: true } } } });
    if (!o || o.store.merchantId !== user.merchantId) throw notFound('Order');
    if (!['WAITING', 'FAILED', 'SKIPPED'].includes(o.status)) throw new DomainError('bad_status', 'A parcel was already made for this order', 409);
    const draft = { ...(o.draft as unknown as OrderDraft), ...Object.fromEntries(Object.entries(fix).filter(([, v]) => v !== undefined)) } as OrderDraft;
    const claimed = await this.prisma.shopifyOrder.updateMany({ where: { id, status: o.status }, data: { status: 'CREATING' } });
    if (claimed.count !== 1) throw new DomainError('conflict', 'This order is being handled. Try again', 409);
    const r = await this.create(id, draft, o.store.merchantId);
    if (r.status !== 'CREATED') throw new DomainError('invalid_input', r.error, 422);
    return r;
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
