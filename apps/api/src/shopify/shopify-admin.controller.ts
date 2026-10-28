import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DomainError, recordAudit } from '@shiplynow/db';
import type { AccessTokenClaims } from '@shiplynow/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { isShopDomain } from './security';
import { ShopifyJobsService } from './shopify-jobs.service';
import { ShopifySetupService } from './shopify-setup.service';
import { ShopifyService } from './shopify.service';

const linkSchema = z.object({
  merchantId: z.string().min(1).max(64),
  /** "evechantelle" or "evechantelle.myshopify.com" */
  shopDomain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => (v.endsWith('.myshopify.com') ? v : `${v}.myshopify.com`))
    .refine(isShopDomain, 'invalid_shop'),
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
    return {
      configured: this.shopify.configured,
      publicUrl: this.shopify.publicUrl,
      shops: await Promise.all(
        shops.map(async (s) => ({
          id: s.id,
          merchant: { id: s.merchant.id, name: s.merchant.name },
          shopDomain: s.shopDomain,
          // The merchant sets this price; admin only sees it.
          expressPricePiastres: s.merchant.expressPricePiastres,
          carrierServiceId: s.carrierServiceId,
          ratesUrl: this.shopify.ratesUrl(s.id),
          status: s.status,
          scopes: s.scopes,
          installedAt: s.installedAt,
          installUrl: `${this.shopify.publicUrl}/api/shopify/install?shop=${s.shopDomain}`,
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
    const merchant = await this.prisma.merchant.findUnique({ where: { id: body.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const taken = await this.prisma.shopifyShop.findUnique({
      where: { shopDomain: body.shopDomain },
    });
    if (taken && taken.merchantId !== merchant.id)
      throw new DomainError('shop_linked_to_other_merchant');
    const shop = await this.prisma.$transaction(async (tx) => {
      const before = await tx.shopifyShop.findUnique({ where: { merchantId: merchant.id } });
      const moved = before !== null && before.shopDomain !== body.shopDomain;
      if (moved) {
        // A different store: nothing from the old one (access, locations, rate service,
        // product links, pending calls) may be used against the new one.
        await tx.shopifyLocation.deleteMany({ where: { shopId: before.id } });
        await tx.shopifyOutbox.updateMany({
          where: { shopId: before.id, doneAt: null },
          data: { doneAt: new Date(), lastError: 'shop_changed' },
        });
        await tx.sku.updateMany({
          where: { merchantId: merchant.id },
          data: { shopifyVariantId: null, shopifyProductId: null, shopifyInventoryItemId: null },
        });
        await tx.merchant.update({
          where: { id: merchant.id },
          data: { shopifyShopDomain: null },
        });
      }
      const row = await tx.shopifyShop.upsert({
        where: { merchantId: merchant.id },
        create: { merchantId: merchant.id, shopDomain: body.shopDomain },
        update: moved
          ? {
              shopDomain: body.shopDomain,
              status: 'pending',
              accessTokenEnc: null,
              scopes: null,
              installedAt: null,
              uninstalledAt: null,
              carrierServiceId: null,
            }
          : {},
      });
      await recordAudit(tx, {
        actorUserId: user.sub,
        action: 'shopify.link',
        entityType: 'shopify_shop',
        entityId: row.id,
        before: before ? { shopDomain: before.shopDomain, status: before.status } : undefined,
        after: { merchantId: merchant.id, shopDomain: body.shopDomain },
      });
      return row;
    });
    return {
      id: shop.id,
      installUrl: `${this.shopify.publicUrl}/api/shopify/install?shop=${shop.shopDomain}`,
    };
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
