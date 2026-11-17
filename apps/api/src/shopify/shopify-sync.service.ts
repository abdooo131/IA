import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  getSetting,
  SHOPIFY_OUTBOX_MAX_ATTEMPTS,
  type Order,
  type ShopifyLocation,
  type ShopifyOutbox,
  type ShopifyShop,
} from '@shiplynow/db';
import {
  FULFILLMENT_CREATE,
  FULFILLMENT_EVENT_CREATE,
  FULFILLMENT_EVENTS,
  FULFILLMENT_ORDER_CLOSE,
  FULFILLMENT_ORDER_STATE,
  INVENTORY_ACTIVATE,
  INVENTORY_SET_QUANTITIES,
  ORDER_EDIT_BEGIN,
  ORDER_EDIT_COMMIT,
  ORDER_EDIT_SET_QUANTITY,
  REJECT_FULFILLMENT_REQUEST,
} from './graphql';
import { assertNoUserErrors, ShopifyApiError } from './shopify-admin';
import { ShopifyService } from './shopify.service';

/** Shopify accepts up to 250 quantities in one inventorySetQuantities call. */
const BATCH = 250;
/** How many outbox calls one run sends for a shop. */
const OUTBOX_PER_RUN = 50;

type Errors = { userErrors: { message: string }[] };
type Change = { skuId: string; sku: string; inventoryItemId: string; quantity: number };

export interface FulfillmentOrderState {
  id: string;
  status: string;
  requestStatus: string;
  fulfillments: { nodes: { id: string; status: string }[] };
}

/** Shopify answered and said no (user errors, a bad id): sending the same again will not help. */
function refusedByShopify(error: unknown) {
  return error instanceof ShopifyApiError && !error.retryable;
}

@Injectable()
export class ShopifySyncService {
  constructor(private readonly shopify: ShopifyService) {}

  private get prisma() {
    return this.shopify.prisma;
  }

  // ─── stock ───────────────────────────────────────────────────────────────────

  /** What Shopify may sell of each product at a dark store: on hand minus reserved minus the buffer. */
  async availableAt(darkStoreId: string, merchantId: string) {
    const [levels, buffer] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where: { darkStoreId, sku: { merchantId } },
        select: { skuId: true, onHand: true, reserved: true },
      }),
      getSetting(this.prisma, 'stock.buffer_units', darkStoreId),
    ]);
    return new Map(levels.map((l) => [l.skuId, Math.max(0, l.onHand - l.reserved - buffer)]));
  }

  /**
   * Pushes every changed quantity of a shop's linked products to its dark store locations.
   * Products are activated at a location the first time they have stock there. Runs every
   * few seconds, so Shopify hears about a change well within a minute. A product Shopify
   * refuses (a variant deleted there, tracking switched off) never holds back the others: the
   * batch is sent again one product at a time, and the refused one waits with a growing pause
   * (logged and alerted once until it goes through again).
   */
  async pushStock(shop: ShopifyShop, now: Date = new Date()) {
    const locations = await this.prisma.shopifyLocation.findMany({
      where: { shopId: shop.id, isActive: true },
    });
    if (locations.length === 0) return { pushed: 0 };
    const skus = await this.prisma.sku.findMany({
      where: { merchantId: shop.merchantId, shopifyInventoryItemId: { not: null } },
      select: { id: true, sku: true, shopifyInventoryItemId: true },
    });
    let pushed = 0;
    for (const location of locations) {
      const [available, synced] = await Promise.all([
        this.availableAt(location.darkStoreId, shop.merchantId),
        this.prisma.shopifyStockSync.findMany({ where: { locationId: location.id } }),
      ]);
      const rows = new Map(synced.map((s) => [s.skuId, s]));
      const changes: Change[] = [];
      for (const sku of skus) {
        const row = rows.get(sku.id);
        const quantity = available.get(sku.id) ?? 0;
        // Products the store never stocked stay off the location until they first arrive.
        if (!row && !available.has(sku.id)) continue;
        // A product Shopify refused waits for its next try.
        if (row?.retryAt && row.retryAt > now) continue;
        const change = {
          skuId: sku.id,
          sku: sku.sku,
          inventoryItemId: sku.shopifyInventoryItemId!,
          quantity,
        };
        if (!row || !row.activated) {
          if (await this.activate(shop, location, change, now)) pushed++;
        } else if (row.lastPushedQty !== quantity) changes.push(change);
      }
      for (let i = 0; i < changes.length; i += BATCH)
        pushed += await this.pushBatch(shop, location, changes.slice(i, i + BATCH), now);
    }
    return { pushed };
  }

  /** One batch; when Shopify refuses it, each product again on its own. Returns how many went. */
  private async pushBatch(
    shop: ShopifyShop,
    location: ShopifyLocation,
    batch: Change[],
    now: Date,
  ) {
    try {
      await this.setQuantities(shop, location, batch);
      return batch.length;
    } catch (error) {
      if (!refusedByShopify(error)) {
        await this.failedPush(shop, error as Error);
        return 0;
      }
      if (batch.length === 1) {
        await this.refused(shop, location, batch[0]!, error as Error, now);
        return 0;
      }
    }
    let pushed = 0;
    for (const change of batch) {
      try {
        await this.setQuantities(shop, location, [change]);
        pushed++;
      } catch (error) {
        if (!refusedByShopify(error)) {
          // Shopify is unreachable or throttling: the rest waits for the next run.
          await this.failedPush(shop, error as Error);
          break;
        }
        await this.refused(shop, location, change, error as Error, now);
      }
    }
    return pushed;
  }

  private failedPush(shop: ShopifyShop, error: Error) {
    return this.shopify.record(shop.id, {
      direction: 'out',
      kind: 'stock_push',
      ok: false,
      message: error.message,
    });
  }

  /** One inventorySetQuantities call (its own @idempotent key), then the rows it set. */
  private async setQuantities(shop: ShopifyShop, location: ShopifyLocation, batch: Change[]) {
    const data = await this.shopify.call<{ inventorySetQuantities: Errors }>(
      shop,
      INVENTORY_SET_QUANTITIES,
      {
        key: randomUUID(),
        input: {
          name: 'available',
          reason: 'correction',
          referenceDocumentUri: `shiplynow://dark-store/${location.darkStoreId}`,
          // We are the source of truth for these locations, so no compare and swap.
          quantities: batch.map((c) => ({
            inventoryItemId: c.inventoryItemId,
            locationId: location.locationId,
            quantity: c.quantity,
            changeFromQuantity: null,
          })),
        },
      },
    );
    assertNoUserErrors('inventorySetQuantities', data.inventorySetQuantities);
    const pushedAt = new Date();
    for (const c of batch)
      await this.prisma.shopifyStockSync.update({
        where: { locationId_skuId: { locationId: location.id, skuId: c.skuId } },
        data: { lastPushedQty: c.quantity, pushedAt, lastError: null, failures: 0, retryAt: null },
      });
  }

  private async activate(shop: ShopifyShop, location: ShopifyLocation, change: Change, now: Date) {
    try {
      const data = await this.shopify.call<{ inventoryActivate: Errors }>(
        shop,
        INVENTORY_ACTIVATE,
        {
          key: `activate:${location.id}:${change.skuId}`,
          inventoryItemId: change.inventoryItemId,
          locationId: location.locationId,
          available: change.quantity,
        },
      );
      assertNoUserErrors('inventoryActivate', data.inventoryActivate);
      const done = {
        activated: true,
        lastPushedQty: change.quantity,
        pushedAt: new Date(),
        lastError: null,
        failures: 0,
        retryAt: null,
      };
      await this.prisma.shopifyStockSync.upsert({
        where: { locationId_skuId: { locationId: location.id, skuId: change.skuId } },
        create: { locationId: location.id, skuId: change.skuId, ...done },
        update: done,
      });
      return true;
    } catch (error) {
      await this.refused(shop, location, change, error as Error, now);
      return false;
    }
  }

  /**
   * One product could not be set at one location: it waits 30 s, then 1, 2, 4 ... minutes (at
   * most an hour) before the next try. The first failure in a row is logged and alerted once.
   */
  private async refused(
    shop: ShopifyShop,
    location: ShopifyLocation,
    change: Change,
    error: Error,
    now: Date,
  ) {
    const message = error.message.slice(0, 500);
    const key = { locationId_skuId: { locationId: location.id, skuId: change.skuId } };
    const before = await this.prisma.shopifyStockSync.findUnique({ where: key });
    const failures = (before?.failures ?? 0) + 1;
    const retryAt = new Date(now.getTime() + Math.min(30_000 * 2 ** (failures - 1), 3_600_000));
    await this.prisma.shopifyStockSync.upsert({
      where: key,
      create: {
        locationId: location.id,
        skuId: change.skuId,
        lastError: message,
        failures,
        retryAt,
      },
      update: { lastError: message, failures, retryAt },
    });
    if (failures > 1) return;
    await this.shopify.record(shop.id, {
      direction: 'out',
      kind: 'stock_push',
      ok: false,
      message: `${change.sku}: ${message}`,
    });
    await this.prisma.alert.create({
      data: {
        type: 'shopify_sync_failed',
        darkStoreId: location.darkStoreId,
        data: { kind: 'stock_push', error: `${change.sku}: ${message}`.slice(0, 300) },
      },
    });
  }

  // ─── outbox ──────────────────────────────────────────────────────────────────

  /**
   * Sends due outbox calls for a shop, oldest first, retrying failures with growing waits.
   * Calls about one order go in order: while an earlier one waits, the later ones wait too.
   */
  async processOutbox(shop: ShopifyShop, now = new Date()) {
    const open = await this.prisma.shopifyOutbox.findMany({
      where: { shopId: shop.id, doneAt: null, attempts: { lt: SHOPIFY_OUTBOX_MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const waiting = new Set<string>();
    let done = 0;
    let tried = 0;
    for (const item of open) {
      if (item.orderId && waiting.has(item.orderId)) continue;
      if (item.nextAttemptAt > now) {
        if (item.orderId) waiting.add(item.orderId);
        continue;
      }
      if (tried >= OUTBOX_PER_RUN) break;
      tried++;
      try {
        await this.send(shop, item);
        await this.prisma.shopifyOutbox.update({
          where: { id: item.id },
          data: { doneAt: new Date(), lastError: null },
        });
        await this.shopify.record(shop.id, {
          direction: 'out',
          kind: item.kind,
          ok: true,
          message: item.orderId ?? undefined,
        });
        done++;
      } catch (error) {
        if (item.orderId) waiting.add(item.orderId);
        const attempts = item.attempts + 1;
        // 30 s, 1 min, 2 min ... capped at one hour.
        const wait = Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);
        await this.prisma.shopifyOutbox.update({
          where: { id: item.id },
          data: {
            attempts,
            lastError: (error as Error).message.slice(0, 500),
            nextAttemptAt: new Date(Date.now() + wait),
          },
        });
        await this.shopify.record(shop.id, {
          direction: 'out',
          kind: item.kind,
          ok: false,
          message: (error as Error).message,
        });
        if (attempts >= SHOPIFY_OUTBOX_MAX_ATTEMPTS) {
          const order = item.orderId
            ? await this.prisma.order.findUnique({ where: { id: item.orderId } })
            : null;
          await this.prisma.alert.create({
            data: {
              type: 'shopify_sync_failed',
              orderId: item.orderId,
              darkStoreId: order?.darkStoreId,
              data: { kind: item.kind, error: (error as Error).message.slice(0, 300) },
            },
          });
        }
      }
    }
    return { done, pending: tried - done };
  }

  /**
   * One outbox call. Every kind first reads what Shopify already has, so a call whose answer
   * was lost (Shopify applied it, we never heard) is never made a second time.
   */
  private async send(shop: ShopifyShop, item: ShopifyOutbox) {
    if (!item.orderId) return;
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: item.orderId } });
    const payload = (item.payload ?? {}) as Record<string, unknown>;
    switch (item.kind) {
      case 'fulfill':
        return this.fulfill(shop, order, payload);
      case 'delivered':
      case 'failed': {
        // The fulfillment is created when the rider leaves; wait for it if that call is still pending.
        if (!order.shopifyFulfillmentId)
          throw new ShopifyApiError('waiting for the fulfillment to be created', true);
        const status = item.kind === 'delivered' ? 'DELIVERED' : 'FAILURE';
        const at = typeof payload.at === 'string' ? payload.at : undefined;
        if (await this.hasEvent(shop, order.shopifyFulfillmentId, status, at)) return;
        const data = await this.shopify.call<{ fulfillmentEventCreate: Errors }>(
          shop,
          FULFILLMENT_EVENT_CREATE,
          {
            fulfillmentEvent: {
              fulfillmentId: order.shopifyFulfillmentId,
              status,
              happenedAt: at,
              message:
                item.kind === 'failed'
                  ? `Delivery failed: ${String(payload.reason ?? '')}`
                  : undefined,
            },
          },
        );
        assertNoUserErrors('fulfillmentEventCreate', data.fulfillmentEventCreate);
        return;
      }
      case 'cancel_items':
        return this.cancelItems(shop, item, order.shopifyOrderId!, order.number);
      case 'close':
        return this.close(shop, order);
      default:
        throw new ShopifyApiError(`unknown outbox kind ${item.kind}`, false);
    }
  }

  /** Where a fulfillment order stands now, or null when Shopify no longer has it. */
  async fulfillmentOrderState(shop: ShopifyShop, id: string) {
    const data = await this.shopify.call<{ fulfillmentOrder: FulfillmentOrderState | null }>(
      shop,
      FULFILLMENT_ORDER_STATE,
      { id },
    );
    return data.fulfillmentOrder;
  }

  /** The rider left: one fulfillment with tracking. One that already exists is adopted. */
  private async fulfill(shop: ShopifyShop, order: Order, payload: Record<string, unknown>) {
    if (order.shopifyFulfillmentId || !order.shopifyFulfillmentOrderId) return;
    const state = await this.fulfillmentOrderState(shop, order.shopifyFulfillmentOrderId);
    const existing = state?.fulfillments.nodes.find(
      (f) => !['CANCELLED', 'ERROR', 'FAILURE'].includes(f.status),
    );
    let fulfillmentId = existing?.id ?? null;
    if (!fulfillmentId) {
      const data = await this.shopify.call<{
        fulfillmentCreate: Errors & { fulfillment: { id: string } | null };
      }>(shop, FULFILLMENT_CREATE, {
        fulfillment: {
          lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: order.shopifyFulfillmentOrderId }],
          notifyCustomer: true,
          trackingInfo: {
            company: 'Shiply Now',
            number: String(payload.trackingNumber ?? order.number),
            url: this.shopify.trackingUrl(order.trackingToken),
          },
        },
      });
      assertNoUserErrors('fulfillmentCreate', data.fulfillmentCreate);
      fulfillmentId = data.fulfillmentCreate.fulfillment?.id ?? null;
    }
    await this.prisma.order.update({
      where: { id: order.id },
      data: { shopifyFulfillmentId: fulfillmentId },
    });
  }

  /** Whether the fulfillment already carries this event (same status, same second). */
  private async hasEvent(shop: ShopifyShop, fulfillmentId: string, status: string, at?: string) {
    const data = await this.shopify.call<{
      fulfillment: { events: { nodes: { status: string; happenedAt: string | null }[] } } | null;
    }>(shop, FULFILLMENT_EVENTS, { id: fulfillmentId });
    const second = (iso: string | null | undefined) =>
      iso ? Math.floor(new Date(iso).getTime() / 1000) : null;
    return (data.fulfillment?.events.nodes ?? []).some(
      (e) => e.status === status && (!at || second(e.happenedAt) === second(at)),
    );
  }

  /**
   * We cancelled the order: the fulfillment order goes back to the merchant. A request we
   * never accepted is refused; an accepted one is closed as incomplete. Anything else (already
   * closed, cancelled in Shopify, fulfilled) needs nothing.
   */
  private async close(shop: ShopifyShop, order: Order) {
    if (!order.shopifyFulfillmentOrderId) return;
    const state = await this.fulfillmentOrderState(shop, order.shopifyFulfillmentOrderId);
    if (!state) return;
    if (state.requestStatus === 'SUBMITTED') {
      const data = await this.shopify.call<{ fulfillmentOrderRejectFulfillmentRequest: Errors }>(
        shop,
        REJECT_FULFILLMENT_REQUEST,
        {
          id: state.id,
          reason: 'OTHER',
          message: `Shiply Now ${order.number} was cancelled; ship it normally`,
        },
      );
      assertNoUserErrors('rejectFulfillmentRequest', data.fulfillmentOrderRejectFulfillmentRequest);
      return;
    }
    if (
      ['ACCEPTED', 'CANCELLATION_REJECTED'].includes(state.requestStatus) &&
      ['OPEN', 'IN_PROGRESS'].includes(state.status)
    ) {
      const data = await this.shopify.call<{ fulfillmentOrderClose: Errors }>(
        shop,
        FULFILLMENT_ORDER_CLOSE,
        { id: state.id, message: `Shiply Now ${order.number} was cancelled; ship it normally` },
      );
      assertNoUserErrors('fulfillmentOrderClose', data.fulfillmentOrderClose);
    }
  }

  /**
   * Lowers the quantities of lines the dark store could not supply, through an order edit.
   * The first try writes the quantity each product must end at (targets) into the call, so
   * a later try sets that same quantity instead of taking the units off twice; a product
   * already at or under its target is left alone, and when nothing is left to change the
   * edit is not committed.
   */
  private async cancelItems(
    shop: ShopifyShop,
    item: ShopifyOutbox,
    shopifyOrderId: string,
    number: string,
  ) {
    const payload = (item.payload ?? {}) as {
      lines?: { sku: string; quantity: number }[];
      targets?: { sku: string; quantity: number }[];
    };
    const begin = await this.shopify.call<{
      orderEditBegin: Errors & {
        calculatedOrder: {
          id: string;
          lineItems: { nodes: { id: string; sku: string | null; quantity: number }[] };
        } | null;
      };
    }>(shop, ORDER_EDIT_BEGIN, { id: shopifyOrderId });
    assertNoUserErrors('orderEditBegin', begin.orderEditBegin);
    const calculated = begin.orderEditBegin.calculatedOrder!;
    const linesOf = (sku: string) =>
      calculated.lineItems.nodes.filter((n) => n.sku?.trim() === sku && n.quantity > 0);
    const totalOf = (sku: string) => linesOf(sku).reduce((sum, n) => sum + n.quantity, 0);

    let targets = payload.targets;
    if (!targets) {
      const short = new Map<string, number>();
      for (const line of payload.lines ?? [])
        short.set(line.sku, (short.get(line.sku) ?? 0) + line.quantity);
      targets = [...short].map(([sku, quantity]) => ({
        sku,
        quantity: Math.max(0, totalOf(sku) - quantity),
      }));
      await this.prisma.shopifyOutbox.update({
        where: { id: item.id },
        data: { payload: { ...payload, targets } },
      });
    }

    let changed = 0;
    for (const target of targets) {
      let excess = totalOf(target.sku) - target.quantity;
      for (const line of linesOf(target.sku)) {
        if (excess <= 0) break;
        const cut = Math.min(line.quantity, excess);
        const data = await this.shopify.call<{ orderEditSetQuantity: Errors }>(
          shop,
          ORDER_EDIT_SET_QUANTITY,
          { id: calculated.id, lineItemId: line.id, quantity: line.quantity - cut },
        );
        assertNoUserErrors('orderEditSetQuantity', data.orderEditSetQuantity);
        excess -= cut;
        changed++;
      }
    }
    // Every product is already where it should be: an earlier try's edit went through.
    if (changed === 0) return;
    const commit = await this.shopify.call<{ orderEditCommit: Errors }>(shop, ORDER_EDIT_COMMIT, {
      id: calculated.id,
      staffNote: `Shiply Now ${number}: not in stock at the dark store`,
    });
    assertNoUserErrors('orderEditCommit', commit.orderEditCommit);
  }
}
