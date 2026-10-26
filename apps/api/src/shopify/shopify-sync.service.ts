import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { getSetting, type ShopifyOutbox, type ShopifyShop } from '@shiplynow/db';
import {
  FULFILLMENT_CREATE,
  FULFILLMENT_EVENT_CREATE,
  INVENTORY_ACTIVATE,
  INVENTORY_SET_QUANTITIES,
  ORDER_EDIT_BEGIN,
  ORDER_EDIT_COMMIT,
  ORDER_EDIT_SET_QUANTITY,
} from './graphql';
import { assertNoUserErrors, ShopifyApiError } from './shopify-admin';
import { ShopifyService } from './shopify.service';

/** After this many failed tries an outbox call stops and raises an alert for admin. */
const MAX_ATTEMPTS = 10;
/** Shopify accepts up to 250 quantities in one inventorySetQuantities call. */
const BATCH = 250;

type Errors = { userErrors: { message: string }[] };

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
   * few seconds, so Shopify hears about a change well within a minute.
   */
  async pushStock(shop: ShopifyShop) {
    const locations = await this.prisma.shopifyLocation.findMany({
      where: { shopId: shop.id, isActive: true },
    });
    let pushed = 0;
    for (const location of locations) {
      const [available, skus, synced] = await Promise.all([
        this.availableAt(location.darkStoreId, shop.merchantId),
        this.prisma.sku.findMany({
          where: { merchantId: shop.merchantId, shopifyInventoryItemId: { not: null } },
          select: { id: true, shopifyInventoryItemId: true },
        }),
        this.prisma.shopifyStockSync.findMany({ where: { locationId: location.id } }),
      ]);
      const changes: { skuId: string; inventoryItemId: string; quantity: number }[] = [];
      for (const sku of skus) {
        const row = synced.find((s) => s.skuId === sku.id);
        const quantity = available.get(sku.id) ?? 0;
        // Products the store never stocked stay off the location until they first arrive.
        if (!row && !available.has(sku.id)) continue;
        if (!row || !row.activated) {
          await this.activate(
            shop,
            location.id,
            location.locationId,
            sku.id,
            sku.shopifyInventoryItemId!,
            quantity,
          );
          pushed++;
        } else if (row.lastPushedQty !== quantity) {
          changes.push({ skuId: sku.id, inventoryItemId: sku.shopifyInventoryItemId!, quantity });
        }
      }
      for (let i = 0; i < changes.length; i += BATCH) {
        const batch = changes.slice(i, i + BATCH);
        try {
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
          const now = new Date();
          for (const c of batch)
            await this.prisma.shopifyStockSync.update({
              where: { locationId_skuId: { locationId: location.id, skuId: c.skuId } },
              data: { lastPushedQty: c.quantity, pushedAt: now, lastError: null },
            });
          pushed += batch.length;
        } catch (error) {
          await this.shopify.record(shop.id, {
            direction: 'out',
            kind: 'stock_push',
            ok: false,
            message: (error as Error).message,
          });
        }
      }
    }
    return { pushed };
  }

  private async activate(
    shop: ShopifyShop,
    locationRowId: string,
    locationGid: string,
    skuId: string,
    inventoryItemId: string,
    quantity: number,
  ) {
    try {
      const data = await this.shopify.call<{ inventoryActivate: Errors }>(
        shop,
        INVENTORY_ACTIVATE,
        {
          key: `activate:${locationRowId}:${skuId}`,
          inventoryItemId,
          locationId: locationGid,
          available: quantity,
        },
      );
      assertNoUserErrors('inventoryActivate', data.inventoryActivate);
      await this.prisma.shopifyStockSync.upsert({
        where: { locationId_skuId: { locationId: locationRowId, skuId } },
        create: {
          locationId: locationRowId,
          skuId,
          activated: true,
          lastPushedQty: quantity,
          pushedAt: new Date(),
        },
        update: { activated: true, lastPushedQty: quantity, pushedAt: new Date(), lastError: null },
      });
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      await this.prisma.shopifyStockSync.upsert({
        where: { locationId_skuId: { locationId: locationRowId, skuId } },
        create: { locationId: locationRowId, skuId, lastError: message },
        update: { lastError: message },
      });
    }
  }

  // ─── outbox ──────────────────────────────────────────────────────────────────

  /** Sends due outbox calls for a shop, oldest first, retrying failures with growing waits. */
  async processOutbox(shop: ShopifyShop, now = new Date()) {
    const due = await this.prisma.shopifyOutbox.findMany({
      where: {
        shopId: shop.id,
        doneAt: null,
        nextAttemptAt: { lte: now },
        attempts: { lt: MAX_ATTEMPTS },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    let done = 0;
    for (const item of due) {
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
        if (attempts >= MAX_ATTEMPTS) {
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
    return { done, pending: due.length - done };
  }

  private async send(shop: ShopifyShop, item: ShopifyOutbox) {
    if (!item.orderId) return;
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: item.orderId } });
    const payload = (item.payload ?? {}) as Record<string, unknown>;
    switch (item.kind) {
      case 'fulfill': {
        if (order.shopifyFulfillmentId) return;
        const data = await this.shopify.call<{
          fulfillmentCreate: Errors & { fulfillment: { id: string } | null };
        }>(shop, FULFILLMENT_CREATE, {
          fulfillment: {
            lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: order.shopifyFulfillmentOrderId }],
            notifyCustomer: true,
            trackingInfo: {
              company: 'Shiply Now',
              number: String(payload.trackingNumber ?? order.number),
            },
          },
        });
        assertNoUserErrors('fulfillmentCreate', data.fulfillmentCreate);
        await this.prisma.order.update({
          where: { id: order.id },
          data: { shopifyFulfillmentId: data.fulfillmentCreate.fulfillment?.id ?? null },
        });
        return;
      }
      case 'delivered':
      case 'failed': {
        // The fulfillment is created when the rider leaves; wait for it if that call is still pending.
        if (!order.shopifyFulfillmentId)
          throw new ShopifyApiError('waiting for the fulfillment to be created', true);
        const data = await this.shopify.call<{ fulfillmentEventCreate: Errors }>(
          shop,
          FULFILLMENT_EVENT_CREATE,
          {
            fulfillmentEvent: {
              fulfillmentId: order.shopifyFulfillmentId,
              status: item.kind === 'delivered' ? 'DELIVERED' : 'FAILURE',
              happenedAt: typeof payload.at === 'string' ? payload.at : undefined,
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
        return this.cancelItems(
          shop,
          order.shopifyOrderId!,
          payload.lines as { sku: string; quantity: number }[],
          order.number,
        );
      default:
        throw new ShopifyApiError(`unknown outbox kind ${item.kind}`, false);
    }
  }

  /** Lowers the quantities of lines the dark store could not supply, through an order edit. */
  private async cancelItems(
    shop: ShopifyShop,
    shopifyOrderId: string,
    lines: { sku: string; quantity: number }[],
    number: string,
  ) {
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
    for (const line of lines) {
      const target = calculated.lineItems.nodes.find(
        (n) => n.sku?.trim() === line.sku && n.quantity > 0,
      );
      if (!target) continue;
      const data = await this.shopify.call<{ orderEditSetQuantity: Errors }>(
        shop,
        ORDER_EDIT_SET_QUANTITY,
        {
          id: calculated.id,
          lineItemId: target.id,
          quantity: Math.max(0, target.quantity - line.quantity),
        },
      );
      assertNoUserErrors('orderEditSetQuantity', data.orderEditSetQuantity);
    }
    const commit = await this.shopify.call<{ orderEditCommit: Errors }>(shop, ORDER_EDIT_COMMIT, {
      id: calculated.id,
      staffNote: `Shiply Now ${number}: not in stock at the dark store`,
    });
    assertNoUserErrors('orderEditCommit', commit.orderEditCommit);
  }
}
