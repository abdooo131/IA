import { Controller, Get, Query, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { getSetting } from '@shiplynow/db';
import { Public } from '../auth/decorators';
import { CoverageService } from '../coverage/coverage.service';
import { StoreStatusService } from '../coverage/store-status.service';
import { verifyProxySignature } from './security';
import { ShopifySyncService } from './shopify-sync.service';
import { ShopifyService } from './shopify.service';

/** The storefront asks about at most this many variants at once. */
const MAX_VARIANTS = 250;

/**
 * What the storefront widget asks, through the shop's app proxy (/apps/shiplynow/...).
 * Shopify signs every proxied request, so only real storefront traffic gets answers.
 */
@ApiExcludeController()
@Public()
@Controller('shopify/proxy')
export class ShopifyStorefrontController {
  constructor(
    private readonly shopify: ShopifyService,
    private readonly coverage: CoverageService,
    private readonly status: StoreStatusService,
    private readonly sync: ShopifySyncService,
  ) {}

  private get prisma() {
    return this.shopify.prisma;
  }

  private async shopOf(query: Record<string, unknown>) {
    const shop = await this.prisma.shopifyShop.findUnique({
      where: { shopDomain: String(query.shop ?? '') },
      include: { merchant: true },
    });
    // Signed with the secret of the app this store installed (custom app or the main one).
    const secrets = shop
      ? [(await this.shopify.credentialsFor(shop)).secret]
      : await this.shopify.allSecrets();
    if (!secrets.some((secret) => verifyProxySignature(query, secret)))
      throw new UnauthorizedException({ error: 'invalid_signature' });
    if (!shop || shop.status !== 'active')
      throw new UnauthorizedException({ error: 'shop_not_installed' });
    return shop;
  }

  /** The covered areas the customer can pick from. */
  @Get('areas')
  async areas(@Query() query: Record<string, unknown>) {
    const shop = await this.shopOf(query);
    const stores = await this.prisma.shopifyLocation.findMany({
      where: { shopId: shop.id, isActive: true },
      select: { darkStoreId: true },
    });
    const served = new Set(stores.map((s) => s.darkStoreId));
    const areas = await this.coverage.areas();
    return areas
      .filter((a) => served.has(a.darkStore.id))
      .map((a) => ({
        zoneId: a.zoneId,
        nameEn: a.nameEn,
        nameAr: a.nameAr,
        store: { code: a.darkStore.code, nameEn: a.darkStore.nameEn, nameAr: a.darkStore.nameAr },
      }));
  }

  /**
   * For the chosen area: is its store taking orders now, and which of these variants it has
   * in stock. The answer is a hint for browsing; checkout checks everything again.
   */
  @Get('availability')
  async availability(@Query() query: Record<string, unknown>) {
    const shop = await this.shopOf(query);
    const zone = await this.prisma.zone.findFirst({
      where: { id: String(query.zone ?? ''), isActive: true, darkStore: { isActive: true } },
      include: { darkStore: true },
    });
    const served = zone
      ? await this.prisma.shopifyLocation.findFirst({
          where: { shopId: shop.id, darkStoreId: zone.darkStoreId, isActive: true },
        })
      : null;
    if (!zone || !served) return { zone: null };

    const ids = String(query.variants ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => /^\d+$/.test(v))
      .slice(0, MAX_VARIANTS);
    const [state, available, promiseMinutes, skus] = await Promise.all([
      this.status.statusOf([zone.darkStoreId]).then((m) => m.get(zone.darkStoreId)!),
      this.sync.availableAt(zone.darkStoreId, shop.merchantId),
      getSetting(this.prisma, 'sla.promise_minutes', zone.darkStoreId),
      ids.length
        ? this.prisma.sku.findMany({
            where: {
              merchantId: shop.merchantId,
              isActive: true,
              shopifyVariantId: { in: ids.map((id) => `gid://shopify/ProductVariant/${id}`) },
            },
            select: { id: true, shopifyVariantId: true },
          })
        : [],
    ]);
    const inStock = new Set(
      skus
        .filter((s) => (available.get(s.id) ?? 0) > 0)
        .map((s) => s.shopifyVariantId!.split('/').pop()),
    );
    return {
      zone: { id: zone.id, nameEn: zone.nameEn, nameAr: zone.nameAr },
      store: {
        code: zone.darkStore.code,
        nameEn: zone.darkStore.nameEn,
        nameAr: zone.darkStore.nameAr,
      },
      offered: shop.merchant.expressPricePiastres != null,
      status: !state.openNow ? 'closed' : state.atCapacity ? 'at_capacity' : 'open',
      nextOpenAt: state.nextOpenAt?.toISOString() ?? null,
      promiseMinutes,
      variants: Object.fromEntries(ids.map((id) => [id, inStock.has(id)])),
    };
  }
}
