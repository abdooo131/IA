import { Injectable } from '@nestjs/common';
import {
  cancelOrder,
  createOrder,
  DomainError,
  queueShopify,
  releaseFulfillmentOrder,
  SHOPIFY_OUTBOX_MAX_ATTEMPTS,
  type ShopifyLocation,
  type ShopifyShop,
} from '@shiplynow/db';
import { parsePinAttribute } from '@shiplynow/shared';
import { DeliveryResolver } from '../coverage/delivery-resolver.service';
import { StoreStatusService } from '../coverage/store-status.service';
import {
  ACCEPT_CANCELLATION_REQUEST,
  ACCEPT_FULFILLMENT_REQUEST,
  ASSIGNED_FULFILLMENT_ORDERS,
  FULFILLMENT_ORDER_STATE,
  REJECT_CANCELLATION_REQUEST,
  REJECT_FULFILLMENT_REQUEST,
} from './graphql';
import { assertNoUserErrors, moneyToPiastres, ShopifyApiError } from './shopify-admin';
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
    /** Cart attributes the storefront widget set: _shiplynow_zone, _shiplynow_area, _shiplynow_pin */
    customAttributes?: { key: string; value: string | null }[] | null;
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
/** Request states that mean Shopify has the fulfillment order accepted by us. */
const ACCEPTED = ['ACCEPTED', 'CANCELLATION_REQUESTED', 'CANCELLATION_REJECTED'];
/** The system user for actions Shopify triggers */
const SYSTEM = null;

@Injectable()
export class ShopifyOrdersService {
  constructor(
    private readonly shopify: ShopifyService,
    private readonly status: StoreStatusService,
    private readonly resolver: DeliveryResolver,
  ) {}

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
   * One fulfillment request. Unknown products, and an address the delivery decision finds
   * outside, unsure, or served by another store, are refused, so the merchant ships the order
   * normally (never accepted without a zone). Otherwise the order is created (units
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
    if (existing?.status === 'moved_to_standard') {
      // Our refusal never reached Shopify (once it does, the order lets go of the request).
      await this.reject(shop, fo, 'INVENTORY_OUT_OF_STOCK', 'Not in stock at the dark store');
      await releaseFulfillmentOrder(this.prisma, {
        orderId: existing.id,
        fulfillmentOrderId: fo.id,
        why: 'refused_no_stock',
      });
      return { kind: 'already', orderId: existing.id };
    }
    if (existing?.status === 'cancelled') {
      // The outbox is still handing it back to the merchant: that answer comes first.
      const closing = await this.prisma.shopifyOutbox.count({
        where: {
          orderId: existing.id,
          kind: 'close',
          doneAt: null,
          attempts: { lt: SHOPIFY_OUTBOX_MAX_ATTEMPTS },
        },
      });
      if (closing) return { kind: 'skipped', reason: 'closing' };
      if (!existing.shopifyAcceptedAt) {
        // Never accepted (Shopify would not let us, or we cancelled first): this is still the
        // first request, handed back to the merchant. Once Shopify hears it, the order lets go.
        await this.reject(shop, fo, 'OTHER', 'Cancelled at the dark store; ship it normally');
        await releaseFulfillmentOrder(this.prisma, {
          orderId: existing.id,
          fulfillmentOrderId: fo.id,
          why: 'refused_cancelled',
        });
        return { kind: 'already', orderId: existing.id };
      }
      // The merchant asked again for an order we cancelled: a new request, so a new order.
      await releaseFulfillmentOrder(this.prisma, {
        orderId: existing.id,
        fulfillmentOrderId: fo.id,
        why: 'requested_again',
      });
    } else if (existing) {
      // We already took it; Shopify did not hear our answer, so answer again.
      await this.acceptOrHandBack(shop, fo, existing.id, `Shiply Now order ${existing.number}`);
      return { kind: 'already', orderId: existing.id };
    }

    const lines = new Map<string, { skuId: string; quantity: number; unitPricePiastres: number }>();
    const unknown: string[] = [];
    for (const li of fo.lineItems.nodes) {
      if (li.remainingQuantity <= 0) continue;
      const code = (li.sku ?? li.lineItem.sku ?? '').trim();
      const sku = await this.shopify.findSku(shop.merchantId, li.variant?.id ?? null, code);
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
    const dest = fo.destination;
    const addressText =
      [
        address?.address1 ?? dest?.address1,
        address?.address2 ?? dest?.address2,
        address?.city ?? dest?.city,
        address?.province ?? dest?.province,
      ]
        .filter((p) => p && p.trim())
        .join(', ') || 'No address on the Shopify order';

    // The decision the cart carried first (the customer's pin, area or zone from the widget),
    // then Shopify's own point, then the address (docs/ZONES.md section 2).
    const attribute = (key: string) =>
      fo.order.customAttributes?.find((a) => a.key === key)?.value?.trim() || null;
    const pin = parsePinAttribute(attribute('_shiplynow_pin'));
    const shopifyPoint =
      address?.latitude != null && address.longitude != null
        ? { latitude: address.latitude, longitude: address.longitude }
        : null;
    const decision = await this.resolver.resolve({
      point: pin
        ? { ...pin, source: 'pin' }
        : shopifyPoint
          ? { ...shopifyPoint, source: 'shopify' }
          : null,
      areaId: attribute('_shiplynow_area'),
      zoneId: attribute('_shiplynow_zone'),
      addressText,
    });
    if (decision.status !== 'served' || !decision.zone || !decision.store) {
      // Outside every zone, or not sure where it is: the merchant ships it normally.
      await this.reject(
        shop,
        fo,
        'UNDELIVERABLE_DESTINATION',
        decision.status === 'unsure'
          ? 'Could not place the address with confidence; ship it normally'
          : 'Outside the 60 minute delivery zones',
      );
      if (decision.status === 'unsure')
        await this.alert(location.darkStoreId, 'shopify_rejected', {
          order: fo.order.name,
          reason: `address_unsure:${decision.reason}`,
        });
      await this.shopify.record(shop.id, {
        direction: 'in',
        kind: 'fulfillment_request',
        ok: true,
        message: `${fo.order.name} handed back: ${decision.status} (${decision.reason})`,
      });
      return {
        kind: 'rejected',
        reason: decision.status === 'unsure' ? 'address_unsure' : 'outside_zones',
      };
    }
    const servingHere =
      decision.store.id === location.darkStoreId
        ? decision.zone
        : (decision.alternatives.find((a) => a.store.id === location.darkStoreId)?.zone ?? null);
    if (!servingHere) {
      // Another store serves this address; Shopify chose this one. Never sent across the city.
      await this.alert(location.darkStoreId, 'shopify_wrong_store', {
        order: fo.order.name,
        servedBy: decision.store.code,
        location: location.darkStoreId,
      });
      await this.reject(
        shop,
        fo,
        'UNDELIVERABLE_DESTINATION',
        'Another Shiply Now store serves this address; ship it normally',
      );
      return { kind: 'rejected', reason: 'wrong_store' };
    }

    const store = (await this.status.statusOf([location.darkStoreId])).get(location.darkStoreId);
    const queuedUntil = store && !store.openNow ? store.nextOpenAt : null;
    const name =
      address?.name?.trim() ||
      [dest?.firstName, dest?.lastName].filter(Boolean).join(' ').trim() ||
      fo.order.name;
    const outstanding = moneyToPiastres(fo.order.totalOutstandingSet?.shopMoney.amount);
    const fee = fo.order.shippingLines.nodes.reduce(
      (sum, l) => sum + moneyToPiastres(l.discountedPriceSet?.shopMoney.amount),
      0,
    );

    let created;
    try {
      created = await createOrder(this.prisma, {
        merchantId: shop.merchantId,
        darkStoreId: location.darkStoreId,
        zoneId: servingHere.id,
        geoAreaId: decision.area?.id ?? null,
        resolvedBy: decision.confidence,
        locationSource: decision.pointSource,
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
        latitude: decision.doorPoint?.latitude,
        longitude: decision.doorPoint?.longitude,
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
      // Shopify heard it: a request sent again for this fulfillment order is a new one.
      await releaseFulfillmentOrder(this.prisma, {
        orderId: created.id,
        fulfillmentOrderId: fo.id,
        why: 'refused_no_stock',
      });
      return { kind: 'rejected', reason: 'no_stock' };
    }
    const taken = await this.acceptOrHandBack(
      shop,
      fo,
      created.id,
      `Shiply Now order ${created.number}`,
    );
    if (!taken) return { kind: 'rejected', reason: 'accept_failed' };

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    if (!queuedUntil && store?.atCapacity)
      await this.alert(location.darkStoreId, 'over_capacity', { order: order.number }, order.id);
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
        tellShopify: false,
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

  /**
   * Accepts the request for an order we created. When Shopify answers no (the merchant
   * withdrew the request or cancelled the order meanwhile), our order is cancelled at once so
   * its stock is free and nobody picks it. When the answer is lost, the order waits: the next
   * sweep asks again while the request is still open, and reconcileAccepts looks at it later.
   * True when Shopify has it accepted.
   */
  private async acceptOrHandBack(
    shop: ShopifyShop,
    fo: FulfillmentOrder,
    orderId: string,
    message: string,
  ) {
    try {
      await this.accept(shop, fo, message);
    } catch (error) {
      if (!(error instanceof ShopifyApiError) || error.retryable) throw error;
      // Answered no; it may still be ours if an earlier accept went through unheard.
      const state = await this.fulfillmentOrderState(shop, fo.id);
      if (!state || !ACCEPTED.includes(state.requestStatus)) {
        await this.handBack(shop, orderId, fo.order.name, error.message);
        return false;
      }
    }
    await this.afterAccept(orderId);
    return true;
  }

  /**
   * What follows Shopify's acceptance, in one transaction and safe to run again: the time is
   * kept, units the store lacked come off the Shopify order (outbox, one key) and an order
   * waiting for the store to open says so on its timeline.
   */
  private afterAccept(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { events: { where: { type: { in: ['items_cancelled', 'queued_until_open'] } } } },
      });
      if (!order.shopifyAcceptedAt)
        await tx.order.update({ where: { id: order.id }, data: { shopifyAcceptedAt: new Date() } });
      const intake = order.events.find(
        (e) =>
          e.type === 'items_cancelled' && (e.data as { reason?: string })?.reason === 'no_stock',
      );
      if (intake)
        await queueShopify(tx, order, 'cancel_items', `order:${order.id}:intake_cancel`, {
          lines: (intake.data as { lines: { sku: string; quantity: number }[] }).lines,
        });
      if (order.slaStartsAt && !order.events.some((e) => e.type === 'queued_until_open'))
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'queued_until_open',
            data: { until: order.slaStartsAt.toISOString() },
          },
        });
    });
  }

  /** Shopify did not let us take the order: ours is cancelled (stock freed), admin is told. */
  private async handBack(shop: ShopifyShop, orderId: string, name: string, why: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (CANCELLABLE.includes(order.status))
      await cancelOrder(this.prisma, {
        orderId,
        reason: 'shopify_accept_failed',
        actorUserId: SYSTEM,
        tellShopify: false,
      }).catch((error) => {
        if (!(error instanceof DomainError)) throw error;
      });
    await this.alert(
      order.darkStoreId,
      'shopify_rejected',
      { order: name, reason: `accept_failed: ${why}`.slice(0, 300) },
      orderId,
    );
    await this.shopify.record(shop.id, {
      direction: 'in',
      kind: 'fulfillment_request',
      ok: false,
      message: `${name}: accept failed, ${order.number} cancelled: ${why}`,
    });
  }

  /**
   * Orders whose acceptance we never heard back about (a lost answer, a restart between the
   * order and the call) and whose request is no longer open: Shopify has them accepted (the
   * follow up steps run) or not (ours is cancelled). Run after each sweep.
   */
  async reconcileAccepts(shop: ShopifyShop, now: Date = new Date()) {
    const waiting = await this.prisma.order.findMany({
      where: {
        merchantId: shop.merchantId,
        source: 'shopify',
        shopifyAcceptedAt: null,
        shopifyFulfillmentOrderId: { not: null },
        status: { in: ['new', 'accepted', 'picking', 'packed'] },
        createdAt: { lt: new Date(now.getTime() - 60_000) },
      },
      take: 20,
    });
    let settled = 0;
    for (const order of waiting) {
      const state = await this.fulfillmentOrderState(shop, order.shopifyFulfillmentOrderId!);
      if (state?.requestStatus === 'SUBMITTED') continue; // the sweep answers it
      if (state && (ACCEPTED.includes(state.requestStatus) || state.status === 'IN_PROGRESS'))
        await this.afterAccept(order.id);
      else
        await this.handBack(
          shop,
          order.id,
          order.number,
          `request ${state?.requestStatus ?? 'gone'}`,
        );
      settled++;
    }
    return { settled };
  }

  private async fulfillmentOrderState(shop: ShopifyShop, id: string) {
    const data = await this.shopify.call<{
      fulfillmentOrder: { id: string; status: string; requestStatus: string } | null;
    }>(shop, FULFILLMENT_ORDER_STATE, { id });
    return data.fulfillmentOrder;
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
