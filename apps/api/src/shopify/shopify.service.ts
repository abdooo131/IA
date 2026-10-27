import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, ShopifyShop } from '@shiplynow/db';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { openToken } from './security';
import { ShopifyAdmin } from './shopify-admin';

/** Permissions the app asks for when a merchant installs it. */
export const SHOPIFY_SCOPES = [
  'read_products',
  'read_inventory',
  'write_inventory',
  'read_locations',
  'read_orders',
  'write_order_edits',
  'read_fulfillments',
  'write_fulfillments',
  'read_assigned_fulfillment_orders',
  'write_assigned_fulfillment_orders',
  'write_shipping',
].join(',');

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

  /** Runs GraphQL for an installed shop. */
  async call<T = Record<string, unknown>>(
    shop: ShopifyShop,
    query: string,
    variables?: Record<string, unknown>,
  ) {
    if (shop.status !== 'active' || !shop.accessTokenEnc)
      throw new Error(`shop ${shop.shopDomain} is not installed`);
    return this.admin.graphql<T>(
      shop.shopDomain,
      openToken(shop.accessTokenEnc, this.secret),
      query,
      variables,
    );
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
