import type { ParcelSize } from '@shiply/db';
import { quote, type SettingValues } from '@shiply/shared';
import type { PrismaService, Tx } from '../common/prisma.service';
import type { ShipmentsCore } from '../core/shipments.core';
import { todayInCairo } from '../core/shipments.core';

/** First and last day of the month before the one containing `date`. */
function lastMonthRange(date: string) {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 2, 1));
  const end = new Date(Date.UTC(y, m - 1, 1));
  return { gte: new Date(start.getTime() - 3 * 3600e3), lt: new Date(end.getTime() - 2 * 3600e3) };
}

/** The volume tier a merchant earned with last month's parcels. */
export async function tierFor(db: Tx | PrismaService, merchantId: string) {
  const [count, tiers] = await Promise.all([
    db.shipment.count({ where: { merchantId, createdAt: lastMonthRange(todayInCairo()) } }),
    db.priceTier.findMany({ orderBy: { minParcels: 'desc' } }),
  ]);
  const tier = tiers.find((t) => count >= t.minParcels) ?? null;
  return { lastMonthParcels: count, tier };
}

/** The merchant's price for one parcel: agreed price, else list price less their discount or tier. */
export async function priceFor(
  db: Tx | PrismaService,
  core: ShipmentsCore,
  s: SettingValues,
  a: { merchantId: string; discountBp: number; governorateCode: string; areaId: string | null; size: ParcelSize; allowOpen: boolean; exchange: boolean },
) {
  const { hubId, zone } = await core.deliveryHubFor(db as Tx, a.governorateCode, a.areaId);
  const agreed = await db.merchantPrice.findUnique({ where: { merchantId_zoneCode_size: { merchantId: a.merchantId, zoneCode: zone.code, size: a.size } } });
  const discountBp = a.discountBp > 0 ? a.discountBp : (await tierFor(db, a.merchantId)).tier?.discountBp ?? 0;
  const q = quote({ zone, size: a.size, agreedPrice: agreed?.price ?? null, discountBp, allowOpen: a.allowOpen, openFee: s['fees.open_package'], exchange: a.exchange, exchangeBp: s['fees.exchange_bp'] });
  return { hubId, zone, discountBp, agreed: !!agreed, ...q };
}
