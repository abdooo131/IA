// When a parcel made from a Shopify order moves, Shopify is told: fulfilled once we pick it up,
// paid once the courier collects the cash. Written in the same transaction, sent by a job.
import type { Tx } from '../common/prisma.service';

export async function queueShopifyTasks(tx: Tx, shipmentId: string, to: string) {
  if (to !== 'PICKED_UP' && to !== 'DELIVERED') return;
  const link = await tx.shopifyOrder.findUnique({ where: { shipmentId }, select: { storeId: true, store: { select: { pushUpdates: true, active: true } } } });
  if (!link || !link.store.active || !link.store.pushUpdates) return;
  const kind = to === 'PICKED_UP' ? 'FULFILL' : 'MARK_PAID';
  if (kind === 'MARK_PAID') {
    const s = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { codAmount: true } });
    if (!s || s.codAmount === 0) return;
  }
  await tx.shopifyTask.upsert({ where: { shipmentId_kind: { shipmentId, kind } }, update: {}, create: { storeId: link.storeId, shipmentId, kind } });
}
