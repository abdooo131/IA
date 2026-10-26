import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DomainError, recordAudit, type ShopifyShop } from '@shiplynow/db';
import { FULFILLMENT_SERVICE_CREATE, PRODUCT_VARIANTS } from './graphql';
import { assertNoUserErrors, moneyToPiastres } from './shopify-admin';
import { ShopifyService } from './shopify.service';

interface Variant {
  id: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  title: string;
  inventoryItem: { id: string } | null;
  product: { id: string; title: string; status: string };
}

export interface CatalogSyncResult {
  linked: number;
  created: number;
  alreadyLinked: number;
  notInCatalog: { sku: string; title: string }[];
  withoutSku: number;
}

@Injectable()
export class ShopifySetupService {
  constructor(private readonly shopify: ShopifyService) {}

  private get prisma() {
    return this.shopify.prisma;
  }

  private async activeShop(shopId: string) {
    const shop = await this.prisma.shopifyShop.findUnique({ where: { id: shopId } });
    if (!shop) throw new DomainError('shop_not_found', 404);
    if (shop.status !== 'active') throw new DomainError('shop_not_installed');
    return shop;
  }

  /**
   * Creates one fulfillment service (and so one Shopify location) per active dark store
   * that does not have one yet for this shop. Safe to run again.
   */
  async registerLocations(shopId: string, actorUserId: string | null) {
    const shop = await this.activeShop(shopId);
    const stores = await this.prisma.darkStore.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    const existing = await this.prisma.shopifyLocation.findMany({ where: { shopId: shop.id } });
    const created: { store: string; locationId: string }[] = [];
    const failed: { store: string; error: string }[] = [];
    for (const store of stores) {
      if (existing.some((l) => l.darkStoreId === store.id)) continue;
      // The row id is part of the callback address, so it is chosen before calling Shopify.
      const id = randomUUID();
      try {
        const data = await this.shopify.call<{
          fulfillmentServiceCreate: {
            fulfillmentService: { id: string; location: { id: string } | null } | null;
            userErrors: { message: string }[];
          };
        }>(shop, FULFILLMENT_SERVICE_CREATE, {
          name: `Shiply Now ${store.nameEn}`,
          callbackUrl: this.shopify.callbackUrl(id),
        });
        assertNoUserErrors('fulfillmentServiceCreate', data.fulfillmentServiceCreate);
        const service = data.fulfillmentServiceCreate.fulfillmentService;
        if (!service?.location) throw new Error('Shopify returned no location');
        await this.prisma.shopifyLocation.create({
          data: {
            id,
            shopId: shop.id,
            darkStoreId: store.id,
            fulfillmentServiceId: service.id,
            locationId: service.location.id,
          },
        });
        created.push({ store: store.code, locationId: service.location.id });
      } catch (error) {
        failed.push({ store: store.code, error: (error as Error).message });
      }
    }
    await this.shopify.record(shop.id, {
      direction: 'out',
      kind: 'register_locations',
      ok: failed.length === 0,
      message: failed.map((f) => `${f.store}: ${f.error}`).join('; ') || undefined,
      data: { created, failed },
    });
    if (created.length)
      await this.prisma.$transaction((tx) =>
        recordAudit(tx, {
          actorUserId,
          action: 'shopify.register_locations',
          entityType: 'shopify_shop',
          entityId: shop.id,
          after: { created },
        }),
      );
    return { created, failed };
  }

  /**
   * Matches the shop's variants to the merchant's products by SKU and stores their Shopify
   * ids. With createMissing, variants whose SKU is not in our catalog are added as products
   * (English title in both languages until the merchant adds Arabic).
   */
  async syncCatalog(
    shopId: string,
    options: { createMissing: boolean },
    actorUserId: string | null,
  ) {
    const shop = await this.activeShop(shopId);
    const result: CatalogSyncResult = {
      linked: 0,
      created: 0,
      alreadyLinked: 0,
      notInCatalog: [],
      withoutSku: 0,
    };
    let after: string | null = null;
    do {
      const page: {
        productVariants: {
          nodes: Variant[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } = await this.shopify.call(shop, PRODUCT_VARIANTS, { after });
      for (const v of page.productVariants.nodes) await this.syncVariant(shop, v, options, result);
      after = page.productVariants.pageInfo.hasNextPage
        ? page.productVariants.pageInfo.endCursor
        : null;
    } while (after);

    await this.shopify.record(shop.id, {
      direction: 'in',
      kind: 'catalog_sync',
      ok: true,
      message: `${result.linked} linked, ${result.created} created, ${result.notInCatalog.length} not in catalog, ${result.withoutSku} without SKU`,
    });
    await this.prisma.$transaction((tx) =>
      recordAudit(tx, {
        actorUserId,
        action: 'shopify.catalog_sync',
        entityType: 'shopify_shop',
        entityId: shop.id,
        after: { ...result, notInCatalog: result.notInCatalog.length },
      }),
    );
    return result;
  }

  private async syncVariant(
    shop: ShopifyShop,
    v: Variant,
    options: { createMissing: boolean },
    result: CatalogSyncResult,
  ) {
    const code = v.sku?.trim();
    if (!code) {
      result.withoutSku++;
      return;
    }
    const links = {
      shopifyVariantId: v.id,
      shopifyProductId: v.product.id,
      shopifyInventoryItemId: v.inventoryItem?.id ?? null,
    };
    const ours = await this.prisma.sku.findUnique({
      where: { merchantId_sku: { merchantId: shop.merchantId, sku: code } },
    });
    if (ours) {
      if (
        ours.shopifyVariantId === v.id &&
        ours.shopifyInventoryItemId === links.shopifyInventoryItemId
      ) {
        result.alreadyLinked++;
        return;
      }
      // A variant id belongs to one product; free it if an older product held it.
      await this.prisma.sku.updateMany({
        where: { shopifyVariantId: v.id, id: { not: ours.id } },
        data: { shopifyVariantId: null },
      });
      await this.prisma.sku.update({ where: { id: ours.id }, data: links });
      result.linked++;
      return;
    }
    if (!options.createMissing || v.product.status === 'ARCHIVED') {
      result.notInCatalog.push({ sku: code, title: v.product.title });
      return;
    }
    const title =
      v.title && v.title !== 'Default Title' ? `${v.product.title} / ${v.title}` : v.product.title;
    const barcodeTaken = v.barcode
      ? await this.prisma.sku.findFirst({ where: { barcode: v.barcode.trim() } })
      : null;
    await this.prisma.sku.updateMany({
      where: { shopifyVariantId: v.id },
      data: { shopifyVariantId: null },
    });
    await this.prisma.sku.create({
      data: {
        merchantId: shop.merchantId,
        sku: code,
        barcode: v.barcode && !barcodeTaken ? v.barcode.trim() : null,
        titleEn: title.slice(0, 200),
        titleAr: title.slice(0, 200),
        pricePiastres: moneyToPiastres(v.price),
        ...links,
      },
    });
    result.created++;
  }
}
