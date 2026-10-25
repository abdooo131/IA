import type { Prisma } from '@prisma/client';

export type NotificationType =
  | 'stock_count_adjusted'
  | 'manifest_received'
  | 'order_items_cancelled'
  | 'order_moved_to_standard'
  | 'order_delivered'
  | 'order_failed'
  | 'order_cancelled';

/**
 * Records a notification for a merchant, shown in the merchant panel. This is the one
 * place to add other channels (email, WhatsApp) later; callers do not change.
 */
export function notifyMerchant(
  tx: Prisma.TransactionClient,
  merchantId: string,
  type: NotificationType,
  data: Prisma.InputJsonValue,
) {
  return tx.notification.create({ data: { merchantId, type, data } });
}
