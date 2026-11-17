import type { Prisma } from '@prisma/client';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { getSetting } from '../settings';

type Tx = Prisma.TransactionClient;

/**
 * fulfill: the rider left (fulfillment with tracking). delivered, failed: fulfillment events.
 * cancel_items: units the store lacks come off the Shopify order. close: we cancelled our order,
 * so the fulfillment order goes back to the merchant (closed, or its request refused).
 */
export type ShopifyOutboxKind = 'fulfill' | 'delivered' | 'failed' | 'cancel_items' | 'close';

/** After this many failed tries an outbox call stops and raises an alert for admin. */
export const SHOPIFY_OUTBOX_MAX_ATTEMPTS = 10;

/**
 * Records a call Shopify must receive about an order, in the same transaction as the
 * change behind it. Orders that did not come from Shopify, or whose store is not connected,
 * are skipped. The same key twice queues one call.
 */
export async function queueShopify(
  tx: Tx,
  order: {
    id: string;
    merchantId: string;
    source: string;
    shopifyFulfillmentOrderId: string | null;
  },
  kind: ShopifyOutboxKind,
  key: string,
  payload: Prisma.InputJsonValue = {},
) {
  if (order.source !== 'shopify' || !order.shopifyFulfillmentOrderId) return;
  const shop = await tx.shopifyShop.findUnique({ where: { merchantId: order.merchantId } });
  if (!shop || shop.status !== 'active') return;
  await tx.shopifyOutbox.createMany({
    data: [{ shopId: shop.id, orderId: order.id, kind, idempotencyKey: key, payload }],
    skipDuplicates: true,
  });
}

/**
 * A closed order (cancelled or moved to standard) gives up its Shopify fulfillment order, so
 * the request Shopify sends again for it becomes a new order. Only while the order is still
 * closed and still holds that fulfillment order; audited.
 */
export async function releaseFulfillmentOrder(
  db: Db,
  input: { orderId: string; fulfillmentOrderId: string; why: string },
) {
  return inTransaction(db, async (tx) => {
    const { count } = await tx.order.updateMany({
      where: {
        id: input.orderId,
        shopifyFulfillmentOrderId: input.fulfillmentOrderId,
        status: { in: ['cancelled', 'moved_to_standard'] },
      },
      data: { shopifyFulfillmentOrderId: null },
    });
    if (count)
      await recordAudit(tx, {
        actorUserId: null,
        action: 'order.shopify_request_released',
        entityType: 'order',
        entityId: input.orderId,
        before: { shopifyFulfillmentOrderId: input.fulfillmentOrderId },
        after: { shopifyFulfillmentOrderId: null, why: input.why },
      });
    return count > 0;
  });
}

/**
 * The daily clean up: Shopify log rows older than shopify.log_retention_days, and outbox calls
 * that finished (sent, or given up after the last try) longer than
 * shopify.outbox_retention_days ago. Deleting twice deletes nothing more.
 */
export async function pruneShopifyRecords(db: Db, now: Date = new Date()) {
  const logDays = await getSetting(db, 'shopify.log_retention_days');
  const outboxDays = await getSetting(db, 'shopify.outbox_retention_days');
  const day = 24 * 3600_000;
  const logs = await db.shopifyLog.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - logDays * day) } },
  });
  const before = new Date(now.getTime() - outboxDays * day);
  const outbox = await db.shopifyOutbox.deleteMany({
    where: {
      OR: [
        { doneAt: { lt: before } },
        { doneAt: null, attempts: { gte: SHOPIFY_OUTBOX_MAX_ATTEMPTS }, createdAt: { lt: before } },
      ],
    },
  });
  return { logs: logs.count, outbox: outbox.count };
}
