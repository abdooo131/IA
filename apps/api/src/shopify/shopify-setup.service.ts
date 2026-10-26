import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DomainError, recordAudit, type ShopifyShop } from '@shiplynow/db';
import {
  CARRIER_SERVICE_CREATE,
  FULFILLMENT_SERVICE_CREATE,
  LOCATION_EDIT,
  PRODUCT_VARIANTS,
} from './graphql';
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

/** The address2 line of a dark store's Shopify location, which names the store. */
export function storeMarker(code: string) {
  return `Shiply Now ${code}`;
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
      include: { governorate: true },
    });
    const existing = await this.prisma.shopifyLocation.findMany({ where: { shopId: shop.id } });
    const created: { store: string; locationId: string }[] = [];
    const failed: { store: string; error: string }[] = [];
    for (const store of stores) {
      const known = existing.find((l) => l.darkStoreId === store.id);
      if (known) {
        if (!known.addressSyncedAt)
          await this.setAddress(shop, known.id, known.locationId, store).catch((error: Error) =>
            failed.push({ store: store.code, error: error.message }),
          );
        continue;
      }
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
        await this.setAddress(shop, id, service.location.id, store);
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
   * Gives the location the dark store's address. Checkout rate requests name their origin
   * only by address, so address2 carries the store code that tells us which store it is.
   */
  private async setAddress(
    shop: ShopifyShop,
    rowId: string,
    locationGid: string,
    store: {
      code: string;
      nameEn: string;
      addressEn: string;
      governorate: { code: string; nameEn: string };
    },
  ) {
    const data = await this.shopify.call<{
      locationEdit: { userErrors: { message: string }[] };
    }>(shop, LOCATION_EDIT, {
      id: locationGid,
      input: {
        name: `Shiply Now ${store.nameEn}`,
        address: {
          address1: store.addressEn.slice(0, 255),
          address2: storeMarker(store.code),
          city: store.governorate.nameEn,
          // Shopify's Egyptian province codes are the ISO codes without the EG- prefix.
          provinceCode: store.governorate.code.replace(/^EG-/, ''),
          countryCode: 'EG',
        },
      },
    });
    assertNoUserErrors('locationEdit', data.locationEdit);
    await this.prisma.shopifyLocation.update({
      where: { id: rowId },
      data: { addressSyncedAt: new Date() },
    });
  }

  /**
   * Registers the checkout rate service for the shop (once). Shopify then asks us for rates
   * at checkout, and the 60 minute option appears only when we can really deliver it.
   */
  async registerCarrierService(shopId: string, actorUserId: string | null) {
    const shop = await this.activeShop(shopId);
    if (shop.carrierServiceId) return { carrierServiceId: shop.carrierServiceId, created: false };
    const data = await this.shopify.call<{
      carrierServiceCreate: {
        carrierService: { id: string } | null;
        userErrors: { message: string }[];
      };
    }>(shop, CARRIER_SERVICE_CREATE, {
      input: {
        name: 'Shiply Now 60 minutes',
        callbackUrl: this.shopify.ratesUrl(shop.id),
        active: true,
        supportsServiceDiscovery: true,
      },
    });
    try {
      assertNoUserErrors('carrierServiceCreate', data.carrierServiceCreate);
    } catch (error) {
      await this.shopify.record(shop.id, {
        direction: 'out',
        kind: 'carrier_service',
        ok: false,
        message: (error as Error).message,
      });
      throw error;
    }
    const id = data.carrierServiceCreate.carrierService!.id;
    await this.prisma.$transaction(async (tx) => {
      await tx.shopifyShop.update({ where: { id: shop.id }, data: { carrierServiceId: id } });
      await recordAudit(tx, {
        actorUserId,
        action: 'shopify.carrier_service',
        entityType: 'shopify_shop',
        entityId: shop.id,
        after: { carrierServiceId: id },
      });
    });
    await this.shopify.record(shop.id, {
      direction: 'out',
      kind: 'carrier_service',
      ok: true,
      message: id,
    });
    return { carrierServiceId: id, created: true };
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
