import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type ShopifyOutboxKind = 'fulfill' | 'delivered' | 'failed' | 'cancel_items';

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
