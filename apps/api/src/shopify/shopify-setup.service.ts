import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DomainError, recordAudit, type ShopifyShop } from '@shiplynow/db';
import {
  CARRIER_SERVICE_CREATE,
  CARRIER_SERVICE_DELETE,
  DELIVERY_PROFILE_UPDATE,
  DELIVERY_ZONES,
  FULFILLMENT_SERVICE_CREATE,
  FULFILLMENT_SERVICE_DELETE,
  FULFILLMENT_SERVICE_UPDATE,
  FULFILLMENT_SERVICES,
  LOCATION_EDIT,
  PRODUCT_VARIANTS,
  WEBHOOK_SUBSCRIPTION_CREATE,
  WEBHOOK_SUBSCRIPTION_UPDATE,
  WEBHOOK_SUBSCRIPTIONS,
} from './graphql';
import { assertNoUserErrors, moneyToPiastres, type OfflineToken } from './shopify-admin';
import { ShopifyService } from './shopify.service';

/** The name our checkout rate carries in the shop's shipping settings. */
export const RATE_NAME = 'Shiply Now 60 minutes';

interface ZonesData {
  deliveryProfiles: {
    nodes: {
      id: string;
      profileLocationGroups: {
        locationGroup: { id: string };
        locationGroupZones: {
          nodes: {
            zone: {
              id: string;
              name: string;
              countries: { code: { countryCode: string | null; restOfWorld: boolean } }[];
            };
            methodDefinitions: {
              nodes: { id: string; rateProvider: { carrierService?: { id: string } | null } }[];
            };
          }[];
        };
      }[];
    }[];
  };
}

interface Variant {
  id: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  title: string;
  inventoryItem: { id: string } | null;
  product: { id: string; title: string; status: string };
}

/** The parts of a products/create or products/update webhook body we use. */
export interface WebhookProduct {
  id: number | string;
  admin_graphql_api_id?: string;
  title?: string;
  status?: string;
  variants?: {
    id: number | string;
    admin_graphql_api_id?: string;
    sku?: string | null;
    barcode?: string | null;
    price?: string | number;
    title?: string;
    inventory_item_id?: number | string | null;
  }[];
}

/**
 * Webhooks each shop gets from us at install. The legacy install flow does not allow them in
 * shopify.app.toml (only the compliance topics stay there), so they are registered per shop.
 */
export const SHOP_WEBHOOK_TOPICS = [
  'APP_UNINSTALLED',
  'PRODUCTS_CREATE',
  'PRODUCTS_UPDATE',
  'PRODUCTS_DELETE',
] as const;

/**
 * Webhooks that carry protected customer data: Shopify refuses them until the app's protected
 * customer data access is approved, and the customer ones also need read_customers. Each is
 * registered only when the shop granted its scope, and a refusal is logged, never fatal.
 */
export const OPTIONAL_WEBHOOK_TOPICS = [
  { topic: 'ORDERS_CREATE', scope: 'read_orders' },
  { topic: 'ORDERS_UPDATED', scope: 'read_orders' },
  { topic: 'CUSTOMERS_CREATE', scope: 'read_customers' },
  { topic: 'CUSTOMERS_UPDATE', scope: 'read_customers' },
] as const;

/** The address2 line of a dark store's Shopify location, which names the store. */
export function storeMarker(code: string) {
  return `Shiply Now ${code}`;
}

export interface CatalogSyncResult {
  linked: number;
  /** Prices changed in Shopify and copied to our catalog (automatic sync only) */
  repriced?: number;
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
    // Hubs never sell, so only dark stores become Shopify locations.
    const stores = await this.prisma.darkStore.findMany({
      where: { isActive: true, kind: 'dark_store' },
      orderBy: { code: 'asc' },
      include: { governorate: true },
    });
    const existing = await this.prisma.shopifyLocation.findMany({ where: { shopId: shop.id } });
    const created: { store: string; locationId: string }[] = [];
    const failed: { store: string; error: string }[] = [];
    let services: Awaited<ReturnType<typeof this.fulfillmentServices>> | undefined;
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
      const name = `Shiply Now ${store.nameEn}`;
      try {
        // A service of ours with this name may already exist (an earlier install of the app,
        // or another server): take it over and point it here instead of creating a duplicate.
        services ??= await this.fulfillmentServices(shop).catch(() => []);
        const mine = services.find((s) => s.serviceName === name && s.location);
        if (mine) {
          const updated = await this.shopify.call<{
            fulfillmentServiceUpdate: { userErrors: { message: string }[] };
          }>(shop, FULFILLMENT_SERVICE_UPDATE, {
            id: mine.id,
            callbackUrl: this.shopify.callbackUrl(id),
          });
          assertNoUserErrors('fulfillmentServiceUpdate', updated.fulfillmentServiceUpdate);
          await this.prisma.shopifyLocation.create({
            data: {
              id,
              shopId: shop.id,
              darkStoreId: store.id,
              fulfillmentServiceId: mine.id,
              locationId: mine.location!.id,
            },
          });
          created.push({ store: store.code, locationId: mine.location!.id });
          await this.setAddress(shop, id, mine.location!.id, store);
          continue;
        }
        const data = await this.shopify.call<{
          fulfillmentServiceCreate: {
            fulfillmentService: { id: string; location: { id: string } | null } | null;
            userErrors: { message: string }[];
          };
        }>(shop, FULFILLMENT_SERVICE_CREATE, {
          name,
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

  private async fulfillmentServices(shop: ShopifyShop) {
    const data = await this.shopify.call<{
      shop: {
        fulfillmentServices: {
          id: string;
          serviceName: string;
          callbackUrl: string | null;
          location: { id: string } | null;
        }[];
      };
    }>(shop, FULFILLMENT_SERVICES, {});
    return data.shop.fulfillmentServices;
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
   * Subscribes the shop to the webhooks we handle, pointing at this deployment. Safe to run
   * again: existing subscriptions are kept, and moved when the public address changed.
   */
  async registerWebhooks(shopId: string) {
    const shop = await this.activeShop(shopId);
    const uri = this.shopify.webhooksUrl();
    const existing = await this.shopify.call<{
      webhookSubscriptions: { nodes: { id: string; topic: string; uri: string }[] };
    }>(shop, WEBHOOK_SUBSCRIPTIONS);
    const changed: string[] = [];
    try {
      for (const topic of SHOP_WEBHOOK_TOPICS) {
        const found = existing.webhookSubscriptions.nodes.find((n) => n.topic === topic);
        if (found?.uri === uri) continue;
        if (found) {
          const data = await this.shopify.call<{
            webhookSubscriptionUpdate: { userErrors: { message: string }[] };
          }>(shop, WEBHOOK_SUBSCRIPTION_UPDATE, { id: found.id, webhookSubscription: { uri } });
          assertNoUserErrors('webhookSubscriptionUpdate', data.webhookSubscriptionUpdate);
        } else {
          const data = await this.shopify.call<{
            webhookSubscriptionCreate: { userErrors: { message: string }[] };
          }>(shop, WEBHOOK_SUBSCRIPTION_CREATE, {
            topic,
            webhookSubscription: { uri, format: 'JSON' },
          });
          assertNoUserErrors('webhookSubscriptionCreate', data.webhookSubscriptionCreate);
        }
        changed.push(topic);
      }
    } catch (error) {
      await this.shopify.record(shop.id, {
        direction: 'out',
        kind: 'webhooks',
        ok: false,
        message: (error as Error).message,
      });
      throw error;
    }
    const granted = new Set((shop.scopes ?? '').split(','));
    for (const { topic, scope } of OPTIONAL_WEBHOOK_TOPICS) {
      if (!granted.has(scope)) continue;
      const found = existing.webhookSubscriptions.nodes.find((n) => n.topic === topic);
      if (found?.uri === uri) continue;
      try {
        if (found) {
          const data = await this.shopify.call<{
            webhookSubscriptionUpdate: { userErrors: { message: string }[] };
          }>(shop, WEBHOOK_SUBSCRIPTION_UPDATE, { id: found.id, webhookSubscription: { uri } });
          assertNoUserErrors('webhookSubscriptionUpdate', data.webhookSubscriptionUpdate);
        } else {
          const data = await this.shopify.call<{
            webhookSubscriptionCreate: { userErrors: { message: string }[] };
          }>(shop, WEBHOOK_SUBSCRIPTION_CREATE, {
            topic,
            webhookSubscription: { uri, format: 'JSON' },
          });
          assertNoUserErrors('webhookSubscriptionCreate', data.webhookSubscriptionCreate);
        }
        changed.push(topic);
      } catch (error) {
        // Shopify has not approved customer data for the app yet: the daily export still runs.
        await this.shopify.record(shop.id, {
          direction: 'out',
          kind: 'webhooks',
          ok: false,
          message: `${topic}: ${(error as Error).message}`,
        });
      }
    }
    if (changed.length)
      await this.shopify.record(shop.id, {
        direction: 'out',
        kind: 'webhooks',
        ok: true,
        message: changed.join(','),
      });
    return { changed };
  }

  /**
   * What a store needs before 60 minute orders can reach us, in the order it is usually done:
   * connected, products linked (by SKU), stock in a dark store, the merchant's 60 minute
   * price and the rate service. Plus the last request Shopify sent and the last order made.
   */
  async readiness(s: {
    id: string;
    merchantId: string;
    status: string;
    carrierServiceId: string | null;
    merchant: { expressPricePiastres: number | null };
  }) {
    const [variants] = await this.prisma.$queryRaw<{ total: bigint; no_sku: bigint }[]>`
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE COALESCE(TRIM(sku), '') = '') AS no_sku
      FROM shop_variants WHERE shop_id = ${s.id}`;
    const [stock] = await this.prisma.$queryRaw<{ units: bigint | null }[]>`
      SELECT SUM(l.on_hand - l.reserved) AS units FROM stock_levels l
      JOIN skus k ON k.id = l.sku_id WHERE k.merchant_id = ${s.merchantId}`;
    const lastRequest = await this.prisma.shopifyLog.findFirst({
      where: { shopId: s.id, kind: 'fulfillment_request' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, ok: true, message: true },
    });
    const lastOrder = await this.prisma.order.findFirst({
      where: { merchantId: s.merchantId, shopifyOrderId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, number: true },
    });
    return {
      connected: s.status === 'active',
      shopifyVariants: Number(variants?.total ?? 0),
      variantsWithoutSku: Number(variants?.no_sku ?? 0),
      unitsWithUs: Number(stock?.units ?? 0),
      priceSet: s.merchant.expressPricePiastres != null,
      rateService: s.carrierServiceId != null,
      lastRequest,
      lastOrder,
    };
  }

  /**
   * Links a merchant to their Shopify store through the main app (appId null) or one of our
   * custom apps. Linking another store, or the same store through another app, starts clean:
   * nothing from the old connection may be used against the new one.
   */
  async linkShop(body: {
    merchantId: string;
    shopDomain: string;
    appId: string | null;
    actorUserId: string;
  }): Promise<ShopifyShop> {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: body.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const taken = await this.prisma.shopifyShop.findUnique({
      where: { shopDomain: body.shopDomain },
    });
    if (taken && taken.merchantId !== merchant.id)
      throw new DomainError('shop_linked_to_other_merchant');
    const appId = body.appId;
    if (appId && !(await this.prisma.shopifyApp.findUnique({ where: { id: appId } })))
      throw new DomainError('app_not_found', 404);
    const shop = await this.prisma.$transaction(async (tx) => {
      const before = await tx.shopifyShop.findUnique({ where: { merchantId: merchant.id } });
      // Another store, or the same store through another app: the old access is useless.
      const moved =
        before !== null && (before.shopDomain !== body.shopDomain || before.appId !== appId);
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
        create: { merchantId: merchant.id, shopDomain: body.shopDomain, appId },
        update: moved
          ? {
              shopDomain: body.shopDomain,
              appId,
              status: 'pending',
              accessTokenEnc: null,
              accessTokenExpiresAt: null,
              refreshTokenEnc: null,
              refreshTokenExpiresAt: null,
              scopes: null,
              installedAt: null,
              uninstalledAt: null,
              carrierServiceId: null,
            }
          : {},
      });
      await recordAudit(tx, {
        actorUserId: body.actorUserId,
        action: 'shopify.link',
        entityType: 'shopify_shop',
        entityId: row.id,
        before: before
          ? { shopDomain: before.shopDomain, status: before.status, appId: before.appId }
          : undefined,
        after: { merchantId: merchant.id, shopDomain: body.shopDomain, appId },
      });
      return row;
    });
    return shop;
  }

  /**
   * Registers the checkout rate service for the shop (once). Shopify then asks us for rates
   * at checkout, and the 60 minute option appears only when we can really deliver it.
   */
  async registerCarrierService(shopId: string, actorUserId: string | null) {
    const shop = await this.activeShop(shopId);
    if (shop.carrierServiceId) {
      await this.ensureShippingZones(shop.id).catch(() => undefined);
      return { carrierServiceId: shop.carrierServiceId, created: false };
    }
    const data = await this.shopify.call<{
      carrierServiceCreate: {
        carrierService: { id: string } | null;
        userErrors: { message: string }[];
      };
    }>(shop, CARRIER_SERVICE_CREATE, {
      input: {
        name: RATE_NAME,
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
    await this.ensureShippingZones(shop.id).catch(() => undefined);
    return { carrierServiceId: id, created: true };
  }

  /**
   * Adds our checkout rate to every shipping zone that covers Egypt (or, when no zone names
   * Egypt, to the rest of world zones), so the merchant never has to do it by hand. Zones that
   * already carry our rate are left alone, so running it again changes nothing. Shopify still
   * shows the rate only on plans with carrier calculated shipping.
   */
  async ensureShippingZones(shopId: string) {
    const shop = await this.activeShop(shopId);
    if (!shop.carrierServiceId) return { added: 0, zones: 0 };
    const carrierServiceId = shop.carrierServiceId;
    try {
      const data = await this.shopify.call<ZonesData>(shop, DELIVERY_ZONES, {});
      const zones = data.deliveryProfiles.nodes.flatMap((profile) =>
        profile.profileLocationGroups.flatMap((group) =>
          group.locationGroupZones.nodes.map((z) => ({
            profileId: profile.id,
            groupId: group.locationGroup.id,
            zoneId: z.zone.id,
            egypt: z.zone.countries.some((c) => c.code.countryCode === 'EG'),
            restOfWorld: z.zone.countries.some((c) => c.code.restOfWorld),
            ours: z.methodDefinitions.nodes.some(
              (m) => m.rateProvider?.carrierService?.id === carrierServiceId,
            ),
          })),
        ),
      );
      const covering = zones.some((z) => z.egypt)
        ? zones.filter((z) => z.egypt)
        : zones.filter((z) => z.restOfWorld);
      const missing = covering.filter((z) => !z.ours);
      const byProfile = new Map<string, Map<string, string[]>>();
      for (const z of missing) {
        const groups = byProfile.get(z.profileId) ?? new Map<string, string[]>();
        groups.set(z.groupId, [...(groups.get(z.groupId) ?? []), z.zoneId]);
        byProfile.set(z.profileId, groups);
      }
      for (const [profileId, groups] of byProfile) {
        const result = await this.shopify.call<{
          deliveryProfileUpdate: { userErrors: { message: string }[] };
        }>(shop, DELIVERY_PROFILE_UPDATE, {
          id: profileId,
          profile: {
            locationGroupsToUpdate: [...groups].map(([groupId, zoneIds]) => ({
              id: groupId,
              zonesToUpdate: zoneIds.map((zoneId) => ({
                id: zoneId,
                methodDefinitionsToCreate: [
                  {
                    name: RATE_NAME,
                    active: true,
                    participant: { carrierServiceId, adaptToNewServices: true },
                  },
                ],
              })),
            })),
          },
        });
        assertNoUserErrors('deliveryProfileUpdate', result.deliveryProfileUpdate);
      }
      await this.shopify.record(shop.id, {
        direction: 'out',
        kind: 'shipping_zone',
        ok: covering.length > 0,
        message:
          covering.length === 0
            ? 'no shipping zone covers Egypt'
            : `rate added to ${missing.length} of ${covering.length} zones`,
      });
      return { added: missing.length, zones: covering.length };
    } catch (error) {
      await this.shopify.record(shop.id, {
        direction: 'out',
        kind: 'shipping_zone',
        ok: false,
        message: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Ends the link between a merchant and their Shopify store. While we still have access, our
   * locations and rate service are removed from the shop first (best effort: a refusal is
   * logged and the link is ended anyway). Then everything we keep for the shop goes: its
   * locations, pending calls, product links and the shop row, so the merchant can be linked
   * to another store and the old one can be linked to anyone.
   */
  /**
   * Marks a store connected with a fresh token, then sets it up in the background: webhooks,
   * a location per dark store, the rate service and the catalog links.
   */
  async activate(
    shopId: string,
    token: OfflineToken,
    how: 'install' | 'direct',
  ): Promise<{ id: string; status: string }> {
    const active = await this.prisma.shopifyShop.update({
      where: { id: shopId },
      data: {
        status: 'active',
        ...this.shopify.tokenFields(token),
        scopes: token.scope,
        installedAt: new Date(),
        uninstalledAt: null,
      },
    });
    await this.prisma.merchant.update({
      where: { id: active.merchantId },
      data: { shopifyShopDomain: active.shopDomain },
    });
    await this.shopify.record(active.id, {
      direction: 'in',
      kind: how === 'install' ? 'install' : 'connect_direct',
      ok: true,
      message: token.scope,
    });
    void (async () => {
      await this.registerWebhooks(active.id).catch(() => undefined);
      await this.registerLocations(active.id, null).catch(() => undefined);
      await this.registerCarrierService(active.id, null).catch(() => undefined);
      await this.syncCatalog(active.id, { createMissing: false }, null).catch(() => undefined);
    })();
    return { id: active.id, status: active.status };
  }

  /**
   * Connects a store through its custom app's own credentials (client credentials grant),
   * which works when the app belongs to the store's organization and is installed there: no
   * merchant redirect at all. Refused when Shopify does not allow it; then the install link
   * (merchant approval) remains.
   */
  async connectDirect(shopId: string, actorUserId: string | null) {
    const shop = await this.prisma.shopifyShop.findUnique({ where: { id: shopId } });
    if (!shop) throw new DomainError('shop_not_found', 404);
    if (!shop.appId) throw new DomainError('main_app_needs_install');
    let token: OfflineToken;
    try {
      token = await this.shopify.directToken(shop);
    } catch (error) {
      await this.shopify.record(shop.id, {
        direction: 'out',
        kind: 'connect_direct',
        ok: false,
        message: (error as Error).message,
      });
      throw new DomainError('direct_connect_refused');
    }
    const active = await this.activate(shop.id, token, 'direct');
    if (actorUserId)
      await recordAudit(this.prisma, {
        actorUserId,
        action: 'shopify.connect_direct',
        entityType: 'shopify_shop',
        entityId: shop.id,
      });
    return { status: active.status };
  }

  async disconnect(shopId: string, actorUserId: string) {
    const shop = await this.prisma.shopifyShop.findUnique({
      where: { id: shopId },
      include: { locations: true },
    });
    if (!shop) throw new DomainError('shop_not_found', 404);
    const notRemoved: string[] = [];
    if (shop.status === 'active' && shop.accessTokenEnc) {
      const remove = async (id: string, query: string, field: string) => {
        try {
          const data = await this.shopify.call<
            Record<string, { userErrors: { message: string }[] }>
          >(shop, query, { id });
          assertNoUserErrors(field, data[field]!);
        } catch (error) {
          notRemoved.push(id);
          await this.shopify.record(null, {
            direction: 'out',
            kind: 'disconnect',
            ok: false,
            message: `${shop.shopDomain} ${id}: ${(error as Error).message}`,
          });
        }
      };
      for (const l of shop.locations)
        await remove(
          l.fulfillmentServiceId,
          FULFILLMENT_SERVICE_DELETE,
          'fulfillmentServiceDelete',
        );
      if (shop.carrierServiceId)
        await remove(shop.carrierServiceId, CARRIER_SERVICE_DELETE, 'carrierServiceDelete');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.shopifyLocation.deleteMany({ where: { shopId } });
      await tx.shopifyOutbox.deleteMany({ where: { shopId } });
      await tx.shopifyLog.updateMany({ where: { shopId }, data: { shopId: null } });
      await tx.sku.updateMany({
        where: { merchantId: shop.merchantId },
        data: { shopifyVariantId: null, shopifyProductId: null, shopifyInventoryItemId: null },
      });
      await tx.merchant.update({
        where: { id: shop.merchantId },
        data: { shopifyShopDomain: null },
      });
      await tx.shopifyShop.delete({ where: { id: shopId } });
      await recordAudit(tx, {
        actorUserId,
        action: 'shopify.disconnect',
        entityType: 'shopify_shop',
        entityId: shopId,
        before: {
          merchantId: shop.merchantId,
          shopDomain: shop.shopDomain,
          status: shop.status,
          locations: shop.locations.length,
          carrierServiceId: shop.carrierServiceId,
        },
        after: { notRemovedInShopify: notRemoved },
      });
    });
    await this.shopify.record(null, {
      direction: 'out',
      kind: 'disconnect',
      ok: true,
      message: shop.shopDomain,
    });
    return { disconnected: true, notRemovedInShopify: notRemoved.length };
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

  /**
   * A product created or changed in Shopify (products/create and products/update webhooks):
   * its variants are linked to our products by SKU, new SKUs are added to the catalog and
   * prices follow Shopify. Safe to run twice; a repeat changes nothing.
   */
  async syncProductWebhook(shop: ShopifyShop, product: WebhookProduct) {
    const result: CatalogSyncResult = {
      linked: 0,
      created: 0,
      alreadyLinked: 0,
      notInCatalog: [],
      withoutSku: 0,
    };
    const productGid = product.admin_graphql_api_id ?? `gid://shopify/Product/${product.id}`;
    for (const v of product.variants ?? []) {
      await this.syncVariant(
        shop,
        {
          id: v.admin_graphql_api_id ?? `gid://shopify/ProductVariant/${v.id}`,
          sku: v.sku ?? null,
          barcode: v.barcode ?? null,
          price: String(v.price ?? '0'),
          title: v.title ?? '',
          inventoryItem: v.inventory_item_id
            ? { id: `gid://shopify/InventoryItem/${v.inventory_item_id}` }
            : null,
          product: {
            id: productGid,
            title: product.title ?? '',
            status: String(product.status ?? 'active').toUpperCase(),
          },
        },
        { createMissing: true, updatePrice: true },
        result,
      );
    }
    const changed = result.linked + result.created + (result.repriced ?? 0);
    await this.shopify.record(shop.id, {
      direction: 'in',
      kind: 'product_sync',
      ok: true,
      message: `${product.title ?? productGid}: ${result.linked} linked, ${result.created} added, ${result.repriced ?? 0} repriced`,
    });
    if (changed)
      await this.prisma.$transaction((tx) =>
        recordAudit(tx, {
          actorUserId: null,
          action: 'shopify.product_sync',
          entityType: 'shopify_shop',
          entityId: shop.id,
          after: { product: productGid, ...result, notInCatalog: result.notInCatalog.length },
        }),
      );
    return result;
  }

  /** A product deleted in Shopify: our products stay (they may hold stock) but lose the link. */
  async unlinkProductWebhook(shop: ShopifyShop, productId: number | string) {
    const gid = `gid://shopify/Product/${productId}`;
    const { count } = await this.prisma.sku.updateMany({
      where: { merchantId: shop.merchantId, shopifyProductId: gid },
      data: { shopifyVariantId: null, shopifyProductId: null, shopifyInventoryItemId: null },
    });
    await this.shopify.record(shop.id, {
      direction: 'in',
      kind: 'product_sync',
      ok: true,
      message: `${gid} deleted in Shopify: ${count} unlinked`,
    });
    if (count)
      await this.prisma.$transaction((tx) =>
        recordAudit(tx, {
          actorUserId: null,
          action: 'shopify.product_unlink',
          entityType: 'shopify_shop',
          entityId: shop.id,
          after: { product: gid, unlinked: count },
        }),
      );
    return { unlinked: count };
  }

  private async syncVariant(
    shop: ShopifyShop,
    v: Variant,
    options: { createMissing: boolean; updatePrice?: boolean },
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
      // Shopify is where the merchant sets prices; the automatic sync keeps ours in step.
      const price = moneyToPiastres(v.price);
      if (options.updatePrice && ours.pricePiastres !== price) {
        await this.prisma.sku.update({ where: { id: ours.id }, data: { pricePiastres: price } });
        result.repriced = (result.repriced ?? 0) + 1;
      }
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
