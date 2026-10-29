import { Controller, Get, Query, Res, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { getSetting } from '@shiplynow/db';
import { Public } from '../auth/decorators';
import { CoverageService } from '../coverage/coverage.service';
import { StoreStatusService } from '../coverage/store-status.service';
import type { Response } from 'express';
import { verifyProxySignature } from './security';
import { type PageLocale, renderNoArea, renderStorePage } from './store-page';
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

  /**
   * The area landing page (/apps/shiplynow/store?zone=...): every product of this merchant in
   * stock at the dark store serving the area, rendered inside the merchant's theme (Shopify
   * renders an application/liquid answer in the store layout). Checkout still decides.
   */
  @Get('store')
  async storePage(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const shop = await this.shopOf(query);
    const locale: PageLocale = query.lang === 'ar' ? 'ar' : 'en';
    res.type('application/liquid');
    const zone = await this.prisma.zone.findFirst({
      where: { id: String(query.zone ?? ''), isActive: true, darkStore: { isActive: true } },
      include: { darkStore: true },
    });
    const served = zone
      ? await this.prisma.shopifyLocation.findFirst({
          where: { shopId: shop.id, darkStoreId: zone.darkStoreId, isActive: true },
        })
      : null;
    if (!zone || !served) return res.send(renderNoArea(locale));

    const [state, available, promiseMinutes] = await Promise.all([
      this.status.statusOf([zone.darkStoreId]).then((m) => m.get(zone.darkStoreId)!),
      this.sync.availableAt(zone.darkStoreId, shop.merchantId),
      getSetting(this.prisma, 'sla.promise_minutes', zone.darkStoreId),
    ]);
    const inStock = [...available].filter(([, units]) => units > 0).map(([skuId]) => skuId);
    const skus = inStock.length
      ? await this.prisma.sku.findMany({
          where: {
            id: { in: inStock },
            isActive: true,
            shopifyVariantId: { not: null },
            shopifyProductId: { not: null },
          },
          select: {
            titleEn: true,
            titleAr: true,
            pricePiastres: true,
            shopifyVariantId: true,
            shopifyProductId: true,
          },
        })
      : [];
    // The product's handle and picture come from the store's own catalogue (Shopify data).
    const products = await this.prisma.shopProduct.findMany({
      where: { shopId: shop.id, shopifyId: { in: skus.map((s) => s.shopifyProductId!) } },
      select: { shopifyId: true, handle: true, imageUrl: true, status: true },
    });
    const byId = new Map(products.map((p) => [p.shopifyId, p]));
    const list = skus
      .map((s) => ({ sku: s, product: byId.get(s.shopifyProductId!) }))
      .filter((x) => x.product?.handle && x.product.status === 'ACTIVE')
      .map((x) => ({
        title: (locale === 'ar' ? x.sku.titleAr : x.sku.titleEn) || x.sku.titleEn,
        handle: x.product!.handle!,
        variantId: x.sku.shopifyVariantId!.split('/').pop() ?? null,
        imageUrl: x.product!.imageUrl,
        pricePiastres: x.sku.pricePiastres,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
    const nextOpen = state.nextOpenAt
      ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Cairo',
        }).format(state.nextOpenAt)
      : null;
    return res.send(
      renderStorePage({
        locale,
        area: locale === 'ar' ? zone.nameAr : zone.nameEn,
        store: locale === 'ar' ? zone.darkStore.nameAr : zone.darkStore.nameEn,
        status: !state.openNow ? 'closed' : state.atCapacity ? 'at_capacity' : 'open',
        nextOpen,
        promiseMinutes,
        offered: shop.merchant.expressPricePiastres != null,
        currency: 'EGP',
        products: list,
      }),
    );
  }
}
