import { Body, Controller, ForbiddenException, Get, Post, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DomainError, recordAudit } from '@shiplynow/db';
import type { AccessTokenClaims } from '@shiplynow/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { sealToken, shopDomainSchema } from './security';
import { ShopifySetupService } from './shopify-setup.service';
import { missingScopes, ShopifyService } from './shopify.service';
import { kitFiles, kitSlug, shopifyAppDir, zip } from './widget-kit';

const connectSchema = z.object({
  shopDomain: shopDomainSchema,
  clientId: z.string().trim().min(10).max(100),
  clientSecret: z.string().trim().min(10).max(200),
});

/**
 * The merchant connects their own Shopify store without us: they make a custom app for their
 * store, paste its client id and secret here, download the kit that gives the app our settings
 * and the widget, and switch the widget on. Checkout rates, locations, webhooks and the
 * shipping zone are then set up by us on their store.
 */
@ApiTags('merchant')
@ApiBearerAuth()
@Roles('merchant')
@Controller('merchant/shopify')
export class MerchantShopifyController {
  constructor(
    private readonly shopify: ShopifyService,
    private readonly setup: ShopifySetupService,
  ) {}

  private get prisma() {
    return this.shopify.prisma;
  }

  private async merchantOf(user: AccessTokenClaims) {
    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: { merchant: true },
    });
    if (!me?.merchant) throw new ForbiddenException({ error: 'no_merchant' });
    return me.merchant;
  }

  private shopOf(merchantId: string) {
    return this.prisma.shopifyShop.findUnique({
      where: { merchantId },
      include: { app: true, merchant: { select: { expressPricePiastres: true } } },
    });
  }

  /** Where the merchant stands, with the values to paste into their app. */
  @Get()
  async status(@CurrentUser() user: AccessTokenClaims) {
    const merchant = await this.merchantOf(user);
    const shop = await this.shopOf(merchant.id);
    const clientId = shop?.app?.clientId ?? (shop ? this.shopify.apiKey : null);
    return {
      configured: this.shopify.configured,
      setup: this.shopify.appSetupValues(),
      shop: shop && {
        shopDomain: shop.shopDomain,
        status: shop.status,
        ownApp: shop.appId != null,
        clientId: shop.app?.clientId ?? null,
        installedAt: shop.installedAt,
        missingScopes: missingScopes(this.shopify.scopes, shop.scopes),
        installUrl: this.shopify.installUrl(shop.shopDomain),
        // Opens the theme editor with our widget ready to switch on.
        themeEditorUrl: clientId
          ? `https://${shop.shopDomain}/admin/themes/current/editor?context=apps&activateAppId=${clientId}/zone-embed`
          : null,
        readiness: await this.setup.readiness(shop),
        linkedProducts: await this.prisma.sku.count({
          where: { merchantId: merchant.id, shopifyVariantId: { not: null } },
        }),
      },
    };
  }

  /**
   * Saves the merchant's own app and links their store to it, then connects at once when
   * Shopify allows it (an app made by the store itself); otherwise the answer carries the
   * link where the merchant approves the app on Shopify.
   */
  @Post('connect')
  async connect(
    @Body(new ZodValidationPipe(connectSchema)) body: z.infer<typeof connectSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const merchant = await this.merchantOf(user);
    if (body.clientId === this.shopify.apiKey) throw new DomainError('app_is_main_app');
    const taken = await this.prisma.shopifyShop.findUnique({
      where: { shopDomain: body.shopDomain },
    });
    if (taken && taken.merchantId !== merchant.id)
      throw new DomainError('shop_linked_to_other_merchant');
    const existing = await this.prisma.shopifyApp.findUnique({
      where: { clientId: body.clientId },
      include: { shops: { select: { merchantId: true } } },
    });
    if (existing?.shops.some((s) => s.merchantId !== merchant.id))
      throw new DomainError('app_used_by_other_merchant');
    const app = await this.prisma.$transaction(async (tx) => {
      const sealed = sealToken(body.clientSecret, this.shopify.secret);
      const saved = existing
        ? await tx.shopifyApp.update({
            where: { id: existing.id },
            data: { clientSecretEnc: sealed },
          })
        : await tx.shopifyApp.create({
            data: { name: merchant.name, clientId: body.clientId, clientSecretEnc: sealed },
          });
      await recordAudit(tx, {
        actorUserId: user.sub,
        action: existing ? 'shopify.app_secret' : 'shopify.app_add',
        entityType: 'shopify_app',
        entityId: saved.id,
        after: { name: saved.name, clientId: saved.clientId, merchantId: merchant.id },
      });
      return saved;
    });
    const shop = await this.setup.linkShop({
      merchantId: merchant.id,
      shopDomain: body.shopDomain,
      appId: app.id,
      actorUserId: user.sub,
    });
    if (shop.status === 'active' && shop.accessTokenEnc) return { status: 'active' };
    try {
      await this.setup.connectDirect(shop.id, user.sub);
      return { status: 'active' };
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return { status: 'approve', installUrl: this.shopify.installUrl(shop.shopDomain) };
    }
  }

  /**
   * Checks again: connects a store still waiting when Shopify allows it, and on a connected
   * store makes sure the rate service and the shipping zone are in place.
   */
  @Post('check')
  async check(@CurrentUser() user: AccessTokenClaims) {
    const merchant = await this.merchantOf(user);
    const shop = await this.shopOf(merchant.id);
    if (!shop) throw new DomainError('shop_not_linked', 404);
    if (shop.status !== 'active') {
      if (!shop.appId)
        return { status: 'approve', installUrl: this.shopify.installUrl(shop.shopDomain) };
      try {
        await this.setup.connectDirect(shop.id, user.sub);
        return { status: 'active' };
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        return { status: 'approve', installUrl: this.shopify.installUrl(shop.shopDomain) };
      }
    }
    await this.setup.registerCarrierService(shop.id, user.sub).catch(() => undefined);
    return { status: 'active' };
  }

  /** The kit that gives the merchant's app our settings and the storefront widget. */
  @Get('kit')
  async kit(@CurrentUser() user: AccessTokenClaims) {
    const merchant = await this.merchantOf(user);
    const shop = await this.shopOf(merchant.id);
    if (!shop?.app) throw new DomainError('own_app_needed');
    const dir = shopifyAppDir();
    if (!dir) throw new DomainError('kit_unavailable', 404);
    const name = `Shiply Now ${merchant.name}`.slice(0, 30);
    const data = zip(
      kitFiles(dir, { clientId: shop.app.clientId, name, publicUrl: this.shopify.publicUrl }),
    );
    return new StreamableFile(data, {
      type: 'application/zip',
      disposition: `attachment; filename="shiplynow-${kitSlug(merchant.name)}.zip"`,
    });
  }
}
