import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, ShopifyShop } from '@shiplynow/db';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { openToken, sealToken } from './security';
import { type AppCredentials, type OfflineToken, ShopifyAdmin } from './shopify-admin';

/** Permissions the app asks for when a merchant installs it. */
export const SHOPIFY_SCOPES = [
  'read_products',
  'read_inventory',
  'write_inventory',
  'read_locations',
  'read_orders',
  // Orders older than 60 days. Apps a store makes in its own Dev Dashboard get it without
  // Shopify approval; the main app (Partner organization) would need approval first.
  'read_all_orders',
  'read_customers',
  'write_order_edits',
  'read_fulfillments',
  'write_fulfillments',
  'read_assigned_fulfillment_orders',
  'write_assigned_fulfillment_orders',
  'write_shipping',
].join(',');

/**
 * Permissions we ask for that a shop has not granted. A write permission includes its read
 * one, and Shopify reports only the write one, so read_x counts as granted with write_x.
 */
export function missingScopes(wanted: string, granted: string | null) {
  const have = new Set((granted ?? '').split(',').map((s) => s.trim()));
  return wanted
    .split(',')
    .filter(
      (s) => s && !have.has(s) && !(s.startsWith('read_') && have.has(`write_${s.slice(5)}`)),
    );
}

/** Shared plumbing for the Shopify services: config, a shop's client and the sync log. */
@Injectable()
export class ShopifyService {
  private readonly log = new Logger('Shopify');

  constructor(
    readonly prisma: PrismaService,
    private readonly admin: ShopifyAdmin,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get configured() {
    return (
      !!this.config.get('SHOPIFY_API_KEY', { infer: true }) &&
      !!this.config.get('SHOPIFY_API_SECRET', { infer: true })
    );
  }

  get apiKey() {
    return this.config.get('SHOPIFY_API_KEY', { infer: true }) ?? '';
  }

  get secret() {
    return this.config.get('SHOPIFY_API_SECRET', { infer: true }) ?? '';
  }

  /**
   * Permissions asked at install: ours plus SHOPIFY_EXTRA_SCOPES (for example read_all_orders,
   * which Shopify must approve first, and which then brings every order instead of 60 days).
   */
  get scopes() {
    const extra = (this.config.get('SHOPIFY_EXTRA_SCOPES', { infer: true }) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[a-z_]+$/.test(s));
    return [...new Set([...SHOPIFY_SCOPES.split(','), ...extra])].join(',');
  }

  /** The public https address of this deployment (Render sets it), without a trailing slash. */
  get publicUrl() {
    return this.config.get('WEB_ORIGIN', { infer: true }).replace(/\/$/, '');
  }

  /** Where Shopify calls a fulfillment service. The web app forwards /api to this API. */
  callbackUrl(locationRowId: string) {
    return `${this.publicUrl}/api/shopify/fs/${locationRowId}`;
  }

  /** The customer's tracking page, linked from Shopify's shipping email and order status page. */
  trackingUrl(token: string) {
    return `${this.publicUrl}/t/${token}`;
  }

  /** Where Shopify sends the shop's webhooks. */
  webhooksUrl() {
    return `${this.publicUrl}/api/shopify/webhooks`;
  }

  /** Where Shopify asks for checkout rates for one shop. */
  ratesUrl(shopId: string) {
    return `${this.publicUrl}/api/shopify/rates/${shopId}`;
  }

  /** The link a merchant opens to approve the app on their store (or reconnect it). */
  installUrl(shopDomain: string) {
    return `${this.publicUrl}/api/shopify/install?shop=${shopDomain}`;
  }

  /** What to paste when creating a custom app for a store (Partner Dashboard or Dev Dashboard). */
  appSetupValues() {
    return {
      appUrl: `${this.publicUrl}/api/shopify/app`,
      redirectUrl: `${this.publicUrl}/api/shopify/callback`,
      webhooksUrl: this.webhooksUrl(),
      proxyUrl: `${this.publicUrl}/api/shopify/proxy`,
      scopes: this.scopes,
    };
  }

  /** Runs GraphQL for an installed shop, with a token that is valid now. */
  async call<T = Record<string, unknown>>(
    shop: ShopifyShop,
    query: string,
    variables?: Record<string, unknown>,
  ) {
    if (shop.status !== 'active' || !shop.accessTokenEnc)
      throw new Error(`shop ${shop.shopDomain} is not installed`);
    return this.admin.graphql<T>(shop.shopDomain, await this.tokenFor(shop.id), query, variables);
  }

  /** The main app's credentials (SHOPIFY_API_KEY and SHOPIFY_API_SECRET). */
  mainCredentials(): AppCredentials {
    return { clientId: this.apiKey, secret: this.secret };
  }

  /** The credentials of the app a store installed: its custom app, or the main one. */
  async credentialsFor(shop: { appId: string | null }): Promise<AppCredentials> {
    if (!shop.appId) return this.mainCredentials();
    const app = await this.prisma.shopifyApp.findUniqueOrThrow({ where: { id: shop.appId } });
    return { clientId: app.clientId, secret: openToken(app.clientSecretEnc, this.secret) };
  }

  /**
   * Which of our apps signed a request: the main app (null), a custom app's id, or undefined
   * when none of them did.
   */
  async signerOf(check: (secret: string) => boolean): Promise<string | null | undefined> {
    if (this.secret && check(this.secret)) return null;
    for (const app of await this.prisma.shopifyApp.findMany())
      if (check(openToken(app.clientSecretEnc, this.secret))) return app.id;
    return undefined;
  }

  /** Every app secret we hold, for signed calls about a store we no longer have a row for. */
  async allSecrets() {
    const apps = await this.prisma.shopifyApp.findMany();
    return [this.secret, ...apps.map((a) => openToken(a.clientSecretEnc, this.secret))].filter(
      Boolean,
    );
  }

  /** A token from the custom app's own credentials (apps made by the store's organization). */
  async directToken(shop: { shopDomain: string; appId: string | null }) {
    return this.admin.clientCredentials(shop.shopDomain, await this.credentialsFor(shop));
  }

  /** The fields that store a shop's tokens, sealed, from an answer of Shopify's token endpoint. */
  tokenFields(token: OfflineToken, now: Date = new Date()) {
    const at = (seconds?: number) => (seconds ? new Date(now.getTime() + seconds * 1000) : null);
    return {
      accessTokenEnc: sealToken(token.accessToken, this.secret),
      accessTokenExpiresAt: at(token.expiresIn),
      refreshTokenEnc: token.refreshToken ? sealToken(token.refreshToken, this.secret) : null,
      refreshTokenExpiresAt: at(token.refreshTokenExpiresIn),
    };
  }

  private renewing = new Map<string, Promise<string>>();

  /**
   * The shop's access token, read fresh from the database (another call may have renewed it).
   * An expiring token is renewed five minutes before it runs out; a shop still on an old non
   * expiring token is moved to an expiring one once. Concurrent calls share one renewal, since
   * Shopify retires a refresh token once it has been used.
   */
  async tokenFor(shopId: string): Promise<string> {
    const row = await this.prisma.shopifyShop.findUniqueOrThrow({ where: { id: shopId } });
    if (!row.accessTokenEnc) throw new Error(`shop ${row.shopDomain} is not installed`);
    const fresh =
      row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() > Date.now() + 5 * 60_000;
    if (fresh) return openToken(row.accessTokenEnc, this.secret);
    const running = this.renewing.get(shopId);
    if (running) return running;
    const renewal = this.renew(shopId).finally(() => this.renewing.delete(shopId));
    this.renewing.set(shopId, renewal);
    return renewal;
  }

  private async renew(shopId: string) {
    const row = await this.prisma.shopifyShop.findUniqueOrThrow({ where: { id: shopId } });
    // No refresh token but an expiry: connected with client credentials, which are simply
    // asked again. No refresh token and no expiry: an old non expiring token to move over.
    const direct = !row.refreshTokenEnc && !!row.accessTokenExpiresAt && !!row.appId;
    const legacy = !row.refreshTokenEnc && !direct;
    try {
      const app = await this.credentialsFor(row);
      const token = direct
        ? await this.admin.clientCredentials(row.shopDomain, app)
        : legacy
          ? await this.admin.migrateToken(
              row.shopDomain,
              openToken(row.accessTokenEnc!, this.secret),
              app,
            )
          : await this.admin.refreshToken(
              row.shopDomain,
              openToken(row.refreshTokenEnc!, this.secret),
              app,
            );
      await this.prisma.shopifyShop.update({
        where: { id: shopId },
        data: { ...this.tokenFields(token), ...(token.scope ? { scopes: token.scope } : {}) },
      });
      if (legacy) await this.record(shopId, { direction: 'out', kind: 'token_migrated', ok: true });
      return token.accessToken;
    } catch (error) {
      // A refused refresh (refresh token past 90 days, app removed): the merchant reconnects.
      await this.record(shopId, {
        direction: 'out',
        kind: legacy ? 'token_migrated' : 'token_refresh',
        ok: false,
        message: (error as Error).message,
      });
      throw error;
    }
  }

  activeShops() {
    return this.prisma.shopifyShop.findMany({ where: { status: 'active' } });
  }

  async record(
    shopId: string | null,
    entry: {
      direction: 'in' | 'out';
      kind: string;
      ok: boolean;
      message?: string;
      data?: Prisma.InputJsonValue;
    },
  ) {
    if (!entry.ok) this.log.warn(`${entry.kind}: ${entry.message ?? ''}`);
    await this.prisma.shopifyLog.create({ data: { shopId, ...entry } }).catch(() => undefined);
  }
}
