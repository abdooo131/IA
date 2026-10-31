import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { sealToken } from './security';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DomainError, recordAudit } from '@shiplynow/db';
import type { AccessTokenClaims } from '@shiplynow/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { shopDomainSchema } from './security';

const appSchema = z.object({
  name: z.string().trim().min(2).max(80),
  clientId: z.string().trim().min(10).max(100),
  clientSecret: z.string().trim().min(10).max(200),
});
import { ShopifyJobsService } from './shopify-jobs.service';
import { ShopifySetupService } from './shopify-setup.service';
import { missingScopes, ShopifyService } from './shopify.service';

const linkSchema = z.object({
  merchantId: z.string().min(1).max(64),
  /** The custom app made for this merchant; null or missing is the main app */
  appId: z.string().min(1).max(64).nullable().optional(),
  shopDomain: shopDomainSchema,
});
const catalogSchema = z.object({ createMissing: z.boolean().default(false) });

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/shopify')
export class ShopifyAdminController {
  constructor(
    private readonly shopify: ShopifyService,
    private readonly setup: ShopifySetupService,
    private readonly jobs: ShopifyJobsService,
  ) {}

  private get prisma() {
    return this.shopify.prisma;
  }

  /** Every linked shop with its locations, product links, pending calls and recent log. */
  @Get()
  async overview() {
    const shops = await this.prisma.shopifyShop.findMany({
      include: {
        merchant: { select: { id: true, name: true, expressPricePiastres: true } },
        locations: {
          include: { darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const apps = await this.prisma.shopifyApp.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { shops: true } } },
    });
    return {
      configured: this.shopify.configured,
      publicUrl: this.shopify.publicUrl,
      // What to paste when creating a custom app for a merchant in the Partner Dashboard.
      setup: this.shopify.appSetupValues(),
      // Never the secrets: only who uses which app.
      apps: apps.map((a) => ({
        id: a.id,
        name: a.name,
        clientId: a.clientId,
        shops: a._count.shops,
      })),
      shops: await Promise.all(
        shops.map(async (s) => ({
          id: s.id,
          merchant: { id: s.merchant.id, name: s.merchant.name },
          shopDomain: s.shopDomain,
          appId: s.appId,
          // The merchant sets this price; admin only sees it.
          expressPricePiastres: s.merchant.expressPricePiastres,
          carrierServiceId: s.carrierServiceId,
          ratesUrl: this.shopify.ratesUrl(s.id),
          status: s.status,
          scopes: s.scopes,
          // Asked for but not granted (a store connected before we asked for more): the
          // merchant opens the install link again to approve them.
          missingScopes: missingScopes(this.shopify.scopes, s.scopes),
          installedAt: s.installedAt,
          installUrl: this.shopify.installUrl(s.shopDomain),
          readiness: await this.setup.readiness(s),
          locations: s.locations.map((l) => ({
            id: l.id,
            darkStore: l.darkStore,
            locationId: l.locationId,
            isActive: l.isActive,
            addressSynced: l.addressSyncedAt != null,
            callbackUrl: this.shopify.callbackUrl(l.id),
          })),
          linkedProducts: await this.prisma.sku.count({
            where: { merchantId: s.merchantId, shopifyVariantId: { not: null } },
          }),
          products: await this.prisma.sku.count({ where: { merchantId: s.merchantId } }),
          pendingCalls: await this.prisma.shopifyOutbox.count({
            where: { shopId: s.id, doneAt: null },
          }),
          failedCalls: await this.prisma.shopifyOutbox.count({
            where: { shopId: s.id, doneAt: null, attempts: { gte: 10 } },
          }),
          logs: (
            await this.prisma.shopifyLog.findMany({
              where: { shopId: s.id },
              orderBy: { createdAt: 'desc' },
              take: 30,
            })
          ).map((l) => ({
            id: l.id,
            at: l.createdAt,
            direction: l.direction,
            kind: l.kind,
            ok: l.ok,
            message: l.message,
          })),
        })),
      ),
    };
  }

  /** Links a merchant to their Shopify store; they then install the app from the link. */
  @Post('link')
  async link(
    @Body(new ZodValidationPipe(linkSchema)) body: z.infer<typeof linkSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const shop = await this.setup.linkShop({
      merchantId: body.merchantId,
      shopDomain: body.shopDomain,
      appId: body.appId ?? null,
      actorUserId: user.sub,
    });
    return { id: shop.id, installUrl: this.shopify.installUrl(shop.shopDomain) };
  }

  /**
   * Adds a custom app made in the Partner Dashboard for one merchant (custom distribution, no
   * App Store review). The client secret is stored sealed and never shown again.
   */
  @Post('apps')
  async addApp(
    @Body(new ZodValidationPipe(appSchema)) body: z.infer<typeof appSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    if (body.clientId === this.shopify.apiKey) throw new DomainError('app_is_main_app');
    if (await this.prisma.shopifyApp.findUnique({ where: { clientId: body.clientId } }))
      throw new DomainError('app_exists');
    const app = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shopifyApp.create({
        data: {
          name: body.name,
          clientId: body.clientId,
          clientSecretEnc: sealToken(body.clientSecret, this.shopify.secret),
        },
      });
      await recordAudit(tx, {
        actorUserId: user.sub,
        action: 'shopify.app_add',
        entityType: 'shopify_app',
        entityId: created.id,
        after: { name: created.name, clientId: created.clientId },
      });
      return created;
    });
    return { id: app.id, name: app.name, clientId: app.clientId };
  }

  /** Removes a custom app no store uses any more. */
  @Post('apps/:appId/remove')
  async removeApp(@Param('appId') appId: string, @CurrentUser() user: AccessTokenClaims) {
    const app = await this.prisma.shopifyApp.findUnique({
      where: { id: appId },
      include: { _count: { select: { shops: true } } },
    });
    if (!app) throw new DomainError('app_not_found', 404);
    if (app._count.shops > 0) throw new DomainError('app_in_use');
    await this.prisma.$transaction(async (tx) => {
      await tx.shopifyApp.delete({ where: { id: appId } });
      await recordAudit(tx, {
        actorUserId: user.sub,
        action: 'shopify.app_remove',
        entityType: 'shopify_app',
        entityId: appId,
        before: { name: app.name, clientId: app.clientId },
      });
    });
    return { removed: true };
  }

  /** Connects a store through its custom app's own credentials, with no merchant step. */
  @Post(':id/connect')
  connect(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return this.setup.connectDirect(id, user.sub);
  }

  /** Also refreshes the shop's webhooks, so a new public address reaches Shopify. */
  @Post(':id/register-locations')
  async registerLocations(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    await this.setup.registerWebhooks(id);
    return this.setup.registerLocations(id, user.sub);
  }

  @Post(':id/carrier-service')
  registerCarrierService(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return this.setup.registerCarrierService(id, user.sub);
  }

  @Post(':id/sync-catalog')
  syncCatalog(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(catalogSchema)) body: z.infer<typeof catalogSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.setup.syncCatalog(id, body, user.sub);
  }

  /** Ends the link with this Shopify store (our locations and rate service are removed there). */
  @Post(':id/disconnect')
  disconnect(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return this.setup.disconnect(id, user.sub);
  }

  /** Runs the sync now instead of waiting for the next timer tick. */
  @Post(':id/sync-now')
  async syncNow(@Param('id') id: string) {
    const shop = await this.prisma.shopifyShop.findUnique({ where: { id } });
    if (!shop) throw new DomainError('shop_not_found', 404);
    if (shop.status !== 'active') throw new DomainError('shop_not_installed');
    return (await this.jobs.runShop(shop)) ?? { busy: true };
  }
}
