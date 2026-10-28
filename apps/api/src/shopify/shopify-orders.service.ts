import { Injectable } from '@nestjs/common';
import {
  cancelOrder,
  createOrder,
  DomainError,
  queueShopify,
  type ShopifyLocation,
  type ShopifyShop,
  zonesContaining,
} from '@shiplynow/db';
import { AddressLocator } from '../coverage/address-locator.service';
import { StoreStatusService } from '../coverage/store-status.service';
import {
  ACCEPT_CANCELLATION_REQUEST,
  ACCEPT_FULFILLMENT_REQUEST,
  ASSIGNED_FULFILLMENT_ORDERS,
  REJECT_CANCELLATION_REQUEST,
  REJECT_FULFILLMENT_REQUEST,
} from './graphql';
import { assertNoUserErrors, moneyToPiastres } from './shopify-admin';
import { RATE_CODE_PREFIX } from './shopify-rates.service';
import { ShopifyService } from './shopify.service';

type Money = { shopMoney: { amount: string } } | null;

export interface FulfillmentOrder {
  id: string;
  status: string;
  requestStatus: string;
  assignedLocation: { location: { id: string } | null };
  destination: {
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
  } | null;
  order: {
    id: string;
    name: string;
    phone: string | null;
    note: string | null;
    totalOutstandingSet: Money;
    shippingAddress: {
      name: string | null;
      phone: string | null;
      address1: string | null;
      address2: string | null;
      city: string | null;
      province: string | null;
      latitude: number | null;
      longitude: number | null;
    } | null;
    shippingLines: { nodes: { title: string; code: string | null; discountedPriceSet: Money }[] };
  };
  lineItems: {
    nodes: {
      id: string;
      sku: string | null;
      remainingQuantity: number;
      totalQuantity: number;
      variant: { id: string } | null;
      lineItem: { id: string; sku: string | null; discountedUnitPriceAfterAllDiscountsSet: Money };
    }[];
  };
}

type Outcome =
  | {
      kind: 'accepted';
      orderId: string;
      number: string;
      queuedUntil: Date | null;
      cancelled: number;
    }
  | { kind: 'rejected'; reason: string }
  | { kind: 'already'; orderId: string }
  | { kind: 'skipped'; reason: string };

/** Orders waiting at the store can still be cancelled; once a rider has them it is too late. */
const CANCELLABLE = ['new', 'accepted', 'picking', 'packed'];
/** The system user for actions Shopify triggers */
const SYSTEM = null;

@Injectable()
export class ShopifyOrdersService {
  constructor(
    private readonly shopify: ShopifyService,
    private readonly status: StoreStatusService,
    private readonly locator: AddressLocator,
  ) {}

  /**
   * The rider's door for an order Shopify sent without coordinates. Returns null when the
   * address cannot be placed (or no lookup is set up), and the order is then taken as before.
   */
  private async lookUp(
    address:
      | {
          address1?: string | null;
          address2?: string | null;
          city?: string | null;
          province?: string | null;
        }
      | null
      | undefined,
  ) {
    const text = [address?.address1, address?.address2, address?.city, address?.province]
      .filter((p) => p && p.trim())
      .join(', ');
    if (!text) return null;
    try {
      const found = await this.locator.locate(text, { exact: true });
      return found.kind === 'point'
        ? { latitude: found.latitude, longitude: found.longitude }
        : null;
    } catch {
      return null;
    }
  }

  private get prisma() {
    return this.shopify.prisma;
  }

  /**
   * Handles every pending fulfillment and cancellation request for a shop. Called when
   * Shopify notifies us and on a timer, so a lost notification is picked up anyway.
   */
  async sweep(shop: ShopifyShop) {
    const locations = await this.prisma.shopifyLocation.findMany({
      where: { shopId: shop.id, isActive: true },
    });
    if (locations.length === 0) return { requests: 0, cancellations: 0 };
    const locationIds = locations.map((l) => l.locationId);
    let requests = 0;
    let cancellations = 0;
    for (const fo of await this.fetch(shop, 'FULFILLMENT_REQUESTED', locationIds)) {
      const location = locations.find((l) => l.locationId === fo.assignedLocation.location?.id);
      if (!location) continue;
      requests++;
      await this.handleRequest(shop, location, fo).catch((error: Error) =>
        this.shopify.record(shop.id, {
          direction: 'in',
          kind: 'fulfillment_request',
          ok: false,
          message: `${fo.order.name}: ${error.message}`,
        }),
      );
    }
    for (const fo of await this.fetch(shop, 'CANCELLATION_REQUESTED', locationIds)) {
      cancellations++;
      await this.handleCancellation(shop, fo).catch((error: Error) =>
        this.shopify.record(shop.id, {
          direction: 'in',
          kind: 'cancellation_request',
          ok: false,
          message: `${fo.order.name}: ${error.message}`,
        }),
      );
    }
    return { requests, cancellations };
  }

  private async fetch(shop: ShopifyShop, status: string, locationIds: string[]) {
    const all: FulfillmentOrder[] = [];
    let after: string | null = null;
    do {
      const data: {
        assignedFulfillmentOrders: {
          nodes: FulfillmentOrder[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } = await this.shopify.call(shop, ASSIGNED_FULFILLMENT_ORDERS, {
        status,
        locationIds,
        after,
      });
      all.push(...data.assignedFulfillmentOrders.nodes);
      after = data.assignedFulfillmentOrders.pageInfo.hasNextPage
        ? data.assignedFulfillmentOrders.pageInfo.endCursor
        : null;
    } while (after);
    return all;
  }

  /**
   * One fulfillment request. Unknown products or an address outside the store's zones are
   * refused, so the merchant ships the order normally. Otherwise the order is created (units
   * the store lacks are cancelled on the Shopify order) and the request is accepted. A closed
   * store still accepts: the order waits and its clock starts when the store opens.
   */
  async handleRequest(
    shop: ShopifyShop,
    location: ShopifyLocation,
    fo: FulfillmentOrder,
  ): Promise<Outcome> {
    const existing = await this.prisma.order.findUnique({
      where: { shopifyFulfillmentOrderId: fo.id },
    });
    if (existing) {
      // We already took it; Shopify did not hear our answer, so answer again.
      if (existing.status === 'moved_to_standard')
        await this.reject(shop, fo, 'INVENTORY_OUT_OF_STOCK', 'Not in stock at the dark store');
      else await this.accept(shop, fo, `Shiply Now order ${existing.number}`);
      return { kind: 'already', orderId: existing.id };
    }

    const lines = new Map<string, { skuId: string; quantity: number; unitPricePiastres: number }>();
    const unknown: string[] = [];
    for (const li of fo.lineItems.nodes) {
      if (li.remainingQuantity <= 0) continue;
      const code = (li.sku ?? li.lineItem.sku ?? '').trim();
      const sku = await this.prisma.sku.findFirst({
        where: {
          merchantId: shop.merchantId,
          isActive: true,
          OR: [
            ...(li.variant ? [{ shopifyVariantId: li.variant.id }] : []),
            ...(code ? [{ sku: code }] : []),
          ],
        },
      });
      if (!sku) {
        unknown.push(code || li.id);
        continue;
      }
      const line = lines.get(sku.id) ?? {
        skuId: sku.id,
        quantity: 0,
        unitPricePiastres: moneyToPiastres(
          li.lineItem.discountedUnitPriceAfterAllDiscountsSet?.shopMoney.amount,
        ),
      };
      line.quantity += li.remainingQuantity;
      lines.set(sku.id, line);
    }
    if (unknown.length || lines.size === 0) {
      const message = unknown.length
        ? `Products not in the Shiply Now catalog: ${unknown.join(', ')}`
        : 'Nothing to fulfill';
      await this.reject(shop, fo, 'INVALID_SKU', message);
      await this.alert(location.darkStoreId, 'shopify_rejected', {
        order: fo.order.name,
        reason: message,
      });
      return { kind: 'rejected', reason: 'unknown_products' };
    }

    // With the checkout rate in place, only orders that chose it are ours. Next day orders go
    // back to the merchant, who ships them normally.
    if (shop.carrierServiceId) {
      const express = fo.order.shippingLines.nodes.find((l) =>
        (l.code ?? '').startsWith(RATE_CODE_PREFIX),
      );
      if (!express) {
        await this.reject(shop, fo, 'OTHER', 'Not a 60 minute order; ship it normally');
        await this.shopify.record(shop.id, {
          direction: 'in',
          kind: 'fulfillment_request',
          ok: true,
          message: `${fo.order.name} handed back: not a 60 minute order`,
        });
        return { kind: 'rejected', reason: 'not_express' };
      }
      const store = await this.prisma.darkStore.findUniqueOrThrow({
        where: { id: location.darkStoreId },
      });
      // Checkout only offers the rate from the right store, so this should never happen.
      if (express.code !== `${RATE_CODE_PREFIX}${store.code}`)
        await this.alert(location.darkStoreId, 'shopify_wrong_store', {
          order: fo.order.name,
          rate: express.code ?? '',
          store: store.code,
        });
    }

    const address = fo.order.shippingAddress;
    // Shopify's own coordinates first; without them the rider's door is looked up.
    const point =
      address?.latitude != null && address.longitude != null
        ? { latitude: address.latitude, longitude: address.longitude }
        : await this.lookUp(address ?? fo.destination);
    let zoneId: string | null = null;
    if (point) {
      const zones = (await zonesContaining(this.prisma, point)).filter(
        (z) => z.darkStoreId === location.darkStoreId,
      );
      if (zones.length === 0) {
        await this.reject(
          shop,
          fo,
          'UNDELIVERABLE_DESTINATION',
          'Outside the 60 minute delivery zones',
        );
        return { kind: 'rejected', reason: 'outside_zones' };
      }
      zoneId = zones[0]!.id;
    }

    const store = (await this.status.statusOf([location.darkStoreId])).get(location.darkStoreId);
    const queuedUntil = store && !store.openNow ? store.nextOpenAt : null;
    const dest = fo.destination;
    const name =
      address?.name?.trim() ||
      [dest?.firstName, dest?.lastName].filter(Boolean).join(' ').trim() ||
      fo.order.name;
    const outstanding = moneyToPiastres(fo.order.totalOutstandingSet?.shopMoney.amount);
    const fee = fo.order.shippingLines.nodes.reduce(
      (sum, l) => sum + moneyToPiastres(l.discountedPriceSet?.shopMoney.amount),
      0,
    );
    const addressText =
      [
        address?.address1 ?? dest?.address1,
        address?.address2 ?? dest?.address2,
        address?.city ?? dest?.city,
        address?.province ?? dest?.province,
      ]
        .filter((p) => p && p.trim())
        .join(', ') || 'No address on the Shopify order';

    let created;
    try {
      created = await createOrder(this.prisma, {
        merchantId: shop.merchantId,
        darkStoreId: location.darkStoreId,
        zoneId,
        source: 'shopify',
        shopifyOrderId: fo.order.id,
        shopifyFulfillmentOrderId: fo.id,
        customerName: name.slice(0, 120),
        customerPhone: address?.phone ?? dest?.phone ?? fo.order.phone ?? '',
        addressText: addressText.slice(0, 500),
        customerNote: [`Shopify ${fo.order.name}`, fo.order.note]
          .filter(Boolean)
          .join(' · ')
          .slice(0, 500),
        latitude: point?.latitude,
        longitude: point?.longitude,
        paymentMethod: outstanding > 0 ? 'cod' : 'prepaid',
        deliveryFeePiastres: fee,
        codAmountPiastres: outstanding,
        items: [...lines.values()],
        slaStartsAt: queuedUntil ?? undefined,
        actorUserId: SYSTEM,
      });
    } catch (error) {
      // Two sweeps raced: the other one created it first.
      if ((error as { code?: string }).code === 'P2002') {
        const again = await this.prisma.order.findUnique({
          where: { shopifyFulfillmentOrderId: fo.id },
        });
        if (again) return { kind: 'already', orderId: again.id };
      }
      throw error;
    }

    if (created.status === 'moved_to_standard') {
      await this.reject(shop, fo, 'INVENTORY_OUT_OF_STOCK', 'Not in stock at the dark store');
      return { kind: 'rejected', reason: 'no_stock' };
    }
    await this.accept(shop, fo, `Shiply Now order ${created.number}`);

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    if (created.cancelled.length > 0) {
      await this.prisma.$transaction((tx) =>
        queueShopify(tx, order, 'cancel_items', `order:${order.id}:intake_cancel`, {
          lines: created.cancelled,
        }),
      );
    }
    if (queuedUntil) {
      await this.prisma.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'queued_until_open',
          data: { until: queuedUntil.toISOString() },
        },
      });
    } else if (store?.atCapacity) {
      await this.alert(location.darkStoreId, 'over_capacity', { order: order.number }, order.id);
    }
    await this.shopify.record(shop.id, {
      direction: 'in',
      kind: 'fulfillment_request',
      ok: true,
      message: `${fo.order.name} accepted as ${created.number}${queuedUntil ? `, queued until ${queuedUntil.toISOString()}` : ''}${created.cancelled.length ? `, ${created.cancelled.length} lines short` : ''}`,
    });
    return {
      kind: 'accepted',
      orderId: created.id,
      number: created.number,
      queuedUntil,
      cancelled: created.cancelled.length,
    };
  }

  /** The merchant cancelled in Shopify. Granted while the order is still in the store. */
  async handleCancellation(shop: ShopifyShop, fo: FulfillmentOrder) {
    const order = await this.prisma.order.findUnique({
      where: { shopifyFulfillmentOrderId: fo.id },
    });
    if (order && CANCELLABLE.includes(order.status)) {
      await cancelOrder(this.prisma, {
        orderId: order.id,
        reason: 'shopify_cancellation',
        actorUserId: SYSTEM,
      }).catch((error) => {
        if (!(error instanceof DomainError)) throw error;
      });
    }
    const after = order ? await this.prisma.order.findUnique({ where: { id: order.id } }) : null;
    if (!after || ['cancelled', 'moved_to_standard'].includes(after.status)) {
      const data = await this.shopify.call<{
        fulfillmentOrderAcceptCancellationRequest: { userErrors: { message: string }[] };
      }>(shop, ACCEPT_CANCELLATION_REQUEST, { id: fo.id, message: 'Cancelled at the dark store' });
      assertNoUserErrors('acceptCancellation', data.fulfillmentOrderAcceptCancellationRequest);
      await this.shopify.record(shop.id, {
        direction: 'in',
        kind: 'cancellation_request',
        ok: true,
        message: `${fo.order.name} cancelled`,
      });
      return 'accepted';
    }
    const data = await this.shopify.call<{
      fulfillmentOrderRejectCancellationRequest: { userErrors: { message: string }[] };
    }>(shop, REJECT_CANCELLATION_REQUEST, {
      id: fo.id,
      message: 'The order already left the dark store with a rider',
    });
    assertNoUserErrors('rejectCancellation', data.fulfillmentOrderRejectCancellationRequest);
    await this.shopify.record(shop.id, {
      direction: 'in',
      kind: 'cancellation_request',
      ok: true,
      message: `${fo.order.name} could not be cancelled: ${after.status}`,
    });
    return 'rejected';
  }

  private async accept(shop: ShopifyShop, fo: FulfillmentOrder, message: string) {
    const data = await this.shopify.call<{
      fulfillmentOrderAcceptFulfillmentRequest: { userErrors: { message: string }[] };
    }>(shop, ACCEPT_FULFILLMENT_REQUEST, { id: fo.id, message });
    assertNoUserErrors('acceptFulfillmentRequest', data.fulfillmentOrderAcceptFulfillmentRequest);
  }

  private async reject(shop: ShopifyShop, fo: FulfillmentOrder, reason: string, message: string) {
    const data = await this.shopify.call<{
      fulfillmentOrderRejectFulfillmentRequest: { userErrors: { message: string }[] };
    }>(shop, REJECT_FULFILLMENT_REQUEST, { id: fo.id, reason, message });
    assertNoUserErrors('rejectFulfillmentRequest', data.fulfillmentOrderRejectFulfillmentRequest);
    await this.shopify.record(shop.id, {
      direction: 'in',
      kind: 'fulfillment_request',
      ok: true,
      message: `${fo.order.name} refused: ${message}`,
    });
  }

  private alert(darkStoreId: string, type: string, data: Record<string, string>, orderId?: string) {
    return this.prisma.alert.create({ data: { type, darkStoreId, orderId, data } });
  }
}
