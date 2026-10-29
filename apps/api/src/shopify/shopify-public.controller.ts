import { randomBytes } from 'node:crypto';
import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { redactShopCustomer, redactShopCustomers } from '@shiplynow/db';
import { Public } from '../auth/decorators';
import { isShopDomain, verifyBodyHmac, verifyQueryHmac } from './security';
import { ShopDataService } from './shop-data.service';
import { ShopifyAdmin } from './shopify-admin';
import { ShopifyJobsService } from './shopify-jobs.service';
import {
  type RateRequest,
  RatesUnavailableError,
  ShopifyRatesService,
} from './shopify-rates.service';
import { ShopifySetupService, type WebhookProduct } from './shopify-setup.service';
import { ShopifySyncService } from './shopify-sync.service';
import { ShopifyService } from './shopify.service';

const STATE_COOKIE = 'shopify_oauth_state';

/** Everything Shopify (or a merchant coming from Shopify) calls. No Shiply login here. */
@ApiExcludeController()
@Public()
@Controller('shopify')
export class ShopifyPublicController {
  constructor(
    private readonly shopify: ShopifyService,
    private readonly admin: ShopifyAdmin,
    private readonly jobs: ShopifyJobsService,
    private readonly setup: ShopifySetupService,
    private readonly sync: ShopifySyncService,
    private readonly rates: ShopifyRatesService,
    private readonly shopData: ShopDataService,
  ) {}

  private get prisma() {
    return this.shopify.prisma;
  }

  private done(res: Response, params: Record<string, string>) {
    res.redirect(302, `${this.shopify.publicUrl}/shopify/installed?${new URLSearchParams(params)}`);
  }

  /**
   * True when `check` passes with the secret of the app this store installed, or, for a store
   * we have no row for (removed already), with any app secret we hold.
   */
  private async signed(shop: { appId: string | null } | null, check: (secret: string) => boolean) {
    if (shop) return check((await this.shopify.credentialsFor(shop)).secret);
    return (await this.shopify.allSecrets()).some(check);
  }

  /** Starts installation for a shop that admin linked to a merchant. */
  @Get('install')
  async install(@Query('shop') shop: string, @Res() res: Response) {
    if (!this.shopify.configured) return this.done(res, { error: 'not_configured' });
    if (!isShopDomain(shop)) return this.done(res, { error: 'invalid_shop' });
    const linked = await this.prisma.shopifyShop.findUnique({ where: { shopDomain: shop } });
    if (!linked) return this.done(res, { error: 'shop_not_linked', shop });
    // A custom app made by the store's own organization connects with its credentials alone;
    // when Shopify refuses that, the merchant approves on Shopify's page as usual.
    if (linked.appId) {
      const direct = await this.setup.connectDirect(linked.id, null).catch(() => null);
      if (direct) return this.done(res, { shop });
    }
    const state = randomBytes(16).toString('hex');
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.shopify.publicUrl.startsWith('https://'),
      maxAge: 10 * 60_000,
      path: '/',
    });
    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.searchParams.set('client_id', (await this.shopify.credentialsFor(linked)).clientId);
    url.searchParams.set('scope', this.shopify.scopes);
    url.searchParams.set('redirect_uri', `${this.shopify.publicUrl}/api/shopify/callback`);
    url.searchParams.set('state', state);
    res.redirect(302, url.toString());
  }

  /** Shopify sends the merchant back here after they approve the app. */
  @Get('callback')
  async callback(
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const shop = query.shop;
    if (!isShopDomain(shop)) return this.done(res, { error: 'invalid_request' });
    const linked = await this.prisma.shopifyShop.findUnique({ where: { shopDomain: shop } });
    if (!(await this.signed(linked, (secret) => verifyQueryHmac(query, secret))))
      return this.done(res, { error: 'invalid_request' });
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    if (!query.state || cookies[STATE_COOKIE] !== query.state)
      return this.done(res, { error: 'expired', shop });
    res.clearCookie(STATE_COOKIE, { path: '/' });
    if (!linked) return this.done(res, { error: 'shop_not_linked', shop });
    try {
      const token = await this.admin.exchangeCode(
        shop,
        query.code ?? '',
        await this.shopify.credentialsFor(linked),
      );
      await this.setup.activate(linked.id, token, 'install');
      return this.done(res, { shop });
    } catch (error) {
      await this.shopify.record(linked.id, {
        direction: 'in',
        kind: 'install',
        ok: false,
        message: (error as Error).message,
      });
      return this.done(res, { error: 'install_failed', shop });
    }
  }

  /** The app address in Shopify admin: installed shops see their status, others install. */
  @Get('app')
  async app(@Query() query: Record<string, string>, @Res() res: Response) {
    const shop = query.shop;
    if (!isShopDomain(shop)) return this.done(res, { error: 'invalid_request' });
    const linked = await this.prisma.shopifyShop.findUnique({ where: { shopDomain: shop } });
    const signer = await this.shopify.signerOf((secret) => verifyQueryHmac(query, secret));
    if (signer === undefined) return this.done(res, { error: 'invalid_request' });
    if (linked && signer !== linked.appId) {
      // The merchant opened one of our apps that is not the one this store was linked with
      // (often: linked first, custom app added after). A store not connected yet simply
      // follows the app it opened; a connected store keeps its app.
      if (linked.status === 'active') {
        await this.shopify.record(linked.id, {
          direction: 'in',
          kind: 'app_open',
          ok: false,
          message: 'opened from another of our apps than the one this store is connected with',
        });
        return this.done(res, { error: 'invalid_request' });
      }
      await this.prisma.shopifyShop.update({
        where: { id: linked.id },
        data: { appId: signer },
      });
      await this.shopify.record(linked.id, {
        direction: 'in',
        kind: 'app_open',
        ok: true,
        message: signer ? 'store follows the custom app it opened' : 'store follows the main app',
      });
    }
    if (linked?.status === 'active') return this.done(res, { shop });
    res.redirect(
      302,
      `${this.shopify.publicUrl}/api/shopify/install?shop=${encodeURIComponent(shop)}`,
    );
  }

  // ─── fulfillment service callbacks (one address per dark store location) ──────

  @Post('fs/:id/fulfillment_order_notification')
  @HttpCode(200)
  async notification(
    @Param('id') id: string,
    @Req() req: Request,
    @Headers('x-shopify-hmac-sha256') hmac?: string,
  ) {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const location = await this.prisma.shopifyLocation.findUnique({
      where: { id },
      include: { shop: true },
    });
    if (!(await this.signed(location?.shop ?? null, (secret) => verifyBodyHmac(raw, hmac, secret))))
      throw new UnauthorizedException({ error: 'invalid_hmac' });
    if (!location) return { ok: false };
    let kind = 'unknown';
    try {
      kind = (JSON.parse(raw.toString('utf8')) as { kind?: string }).kind ?? 'unknown';
    } catch {
      // A body we cannot read still triggers a sweep, which finds the request itself.
    }
    await this.shopify.record(location.shopId, {
      direction: 'in',
      kind: 'notification',
      ok: true,
      message: kind,
    });
    // Answer at once; the sweep asks Shopify for the actual requests.
    void this.jobs.runShop(location.shop);
    return { ok: true };
  }

  /** Shopify asks how many units we have: one SKU, or all of them hourly. */
  @Get(['fs/:id/fetch_stock', 'fs/:id/fetch_stock.json'])
  async fetchStock(
    @Param('id') id: string,
    @Query('shop') shop?: string,
    @Query('sku') sku?: string,
  ) {
    const location = await this.prisma.shopifyLocation.findUnique({
      where: { id },
      include: { shop: true },
    });
    if (!location || (shop && shop !== location.shop.shopDomain)) return {};
    const available = await this.sync.availableAt(location.darkStoreId, location.shop.merchantId);
    const skus = await this.prisma.sku.findMany({
      where: { merchantId: location.shop.merchantId, ...(sku ? { sku } : {}) },
      select: { id: true, sku: true },
    });
    return Object.fromEntries(skus.map((s) => [s.sku, available.get(s.id) ?? 0]));
  }

  /** Tracking is sent with each fulfillment already, so there is nothing extra to report. */
  @Get(['fs/:id/fetch_tracking_numbers', 'fs/:id/fetch_tracking_numbers.json'])
  trackingNumbers() {
    return {
      tracking_numbers: {},
      message: 'Tracking is sent with each fulfillment',
      success: true,
    };
  }

  // ─── checkout rates ──────────────────────────────────────────────────────────

  /**
   * Shopify asks for shipping rates while the customer is at checkout. An empty list means
   * no 60 minute option, and Shopify keeps that answer for 15 minutes. When we cannot decide
   * (geocoding down) we answer 503, which Shopify retries after 30 seconds.
   */
  @Post('rates/:shopId')
  @HttpCode(200)
  async checkoutRates(
    @Param('shopId') shopId: string,
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-shopify-hmac-sha256') hmac?: string,
  ) {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const rateShop = await this.prisma.shopifyShop.findUnique({ where: { id: shopId } });
    if (!(await this.signed(rateShop, (secret) => verifyBodyHmac(raw, hmac, secret))))
      return res.status(401).send();
    let body: RateRequest;
    try {
      body = JSON.parse(raw.toString('utf8')) as RateRequest;
    } catch {
      return res.status(400).json({ error: 'invalid_body' });
    }
    try {
      const { rates, reason } = await this.rates.quote(shopId, body);
      void this.shopify.record(reason === 'shop_not_active' ? null : shopId, {
        direction: 'in',
        kind: 'checkout_rate',
        ok: true,
        message: reason,
      });
      return res.status(200).json({ rates });
    } catch (error) {
      void this.shopify.record(null, {
        direction: 'in',
        kind: 'checkout_rate',
        ok: false,
        message: (error as Error).message,
      });
      return res
        .status(error instanceof RatesUnavailableError ? 503 : 500)
        .json({ error: 'rates_unavailable' });
    }
  }

  // ─── webhooks ────────────────────────────────────────────────────────────────

  @Post('webhooks')
  @HttpCode(200)
  async webhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-shopify-hmac-sha256') hmac?: string,
    @Headers('x-shopify-topic') topic?: string,
    @Headers('x-shopify-shop-domain') shopDomain?: string,
  ) {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const shop = shopDomain
      ? await this.prisma.shopifyShop.findUnique({ where: { shopDomain } })
      : null;
    if (!(await this.signed(shop, (secret) => verifyBodyHmac(raw, hmac, secret))))
      return res.status(401).send();
    if (topic === 'app/uninstalled' && shop) {
      await this.prisma.shopifyShop.update({
        where: { id: shop.id },
        data: {
          status: 'uninstalled',
          accessTokenEnc: null,
          accessTokenExpiresAt: null,
          refreshTokenEnc: null,
          refreshTokenExpiresAt: null,
          uninstalledAt: new Date(),
        },
      });
    }
    if (shop?.status === 'active' && topic?.startsWith('products/')) {
      try {
        const body = JSON.parse(raw.toString('utf8')) as WebhookProduct;
        if (topic === 'products/delete') await this.setup.unlinkProductWebhook(shop, body.id);
        else await this.setup.syncProductWebhook(shop, body);
      } catch (error) {
        await this.shopify.record(shop.id, {
          direction: 'in',
          kind: 'product_sync',
          ok: false,
          message: (error as Error).message,
        });
        // Shopify retries a failed delivery, so the product is picked up again.
        return res.status(500).send();
      }
      return res.status(200).send();
    }
    if (
      shop?.status === 'active' &&
      (topic === 'customers/create' || topic === 'customers/update')
    ) {
      try {
        const body = JSON.parse(raw.toString('utf8')) as { admin_graphql_api_id?: string };
        if (body.admin_graphql_api_id)
          await this.shopData.customerWebhook(shop, body.admin_graphql_api_id);
      } catch (error) {
        await this.shopify.record(shop.id, {
          direction: 'in',
          kind: 'data_customer',
          ok: false,
          message: (error as Error).message,
        });
        return res.status(500).send();
      }
      return res.status(200).send();
    }
    if (shop?.status === 'active' && (topic === 'orders/create' || topic === 'orders/updated')) {
      try {
        const body = JSON.parse(raw.toString('utf8')) as { admin_graphql_api_id?: string };
        if (body.admin_graphql_api_id)
          await this.shopData.orderWebhook(shop, body.admin_graphql_api_id);
      } catch (error) {
        await this.shopify.record(shop.id, {
          direction: 'in',
          kind: 'data_order',
          ok: false,
          message: (error as Error).message,
        });
        return res.status(500).send();
      }
      return res.status(200).send();
    }
    // Privacy requests: customers/redact and shop/redact delete the buyer details we keep
    // (order totals stay for the sales figures); customers/data_request is logged for the team
    // to answer from the customer's profile.
    let message: string | undefined;
    if (shop && (topic === 'customers/redact' || topic === 'shop/redact')) {
      const body = JSON.parse(raw.toString('utf8')) as {
        customer?: { id?: number | string };
        orders_to_redact?: (number | string)[];
      };
      const result =
        topic === 'shop/redact'
          ? await redactShopCustomers(this.prisma, shop.id)
          : await redactShopCustomer(
              this.prisma,
              shop.id,
              body.customer?.id ? `gid://shopify/Customer/${body.customer.id}` : null,
              (body.orders_to_redact ?? []).map((id) => `gid://shopify/Order/${id}`),
            );
      message = JSON.stringify(result);
    }
    await this.shopify.record(shop?.id ?? null, {
      direction: 'in',
      kind: `webhook:${topic ?? 'unknown'}`,
      ok: true,
      message,
    });
    return res.status(200).send();
  }
}
