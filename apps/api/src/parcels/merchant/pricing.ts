import { parcelTermsAt, type ParcelSize, type PricingZone } from '@shiplynow/db';
import { quote, type SettingValues } from '@shiplynow/shared/parcels';
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

/** Regions outside Greater Cairo from nearest to farthest: a route takes the farther end. */
const REGION_ORDER = ['GC', 'ALX', 'DELTA', 'CANAL', 'UPPER', 'REMOTE'];

/**
 * The price zone of a route (owner, 2026-11-08): seven zones from the pickup city to the delivery
 * city. The same governorate is Same city; two Greater Cairo governorates are Greater Cairo; any
 * other route takes the region of its end outside Greater Cairo, or the farther region when both
 * ends are outside it (so Cairo to Alexandria costs what Alexandria to Cairo costs). Without a
 * pickup governorate the delivery governorate's region decides, as before.
 */
export async function routeZoneFor(
  db: Tx | PrismaService,
  originGov: string | null,
  destination: { governorateCode: string; zone: PricingZone },
) {
  if (!originGov) return destination.zone;
  if (originGov === destination.governorateCode) {
    const same = await db.pricingZone.findUnique({ where: { code: 'SAME' } });
    return same ?? destination.zone;
  }
  const origin = await db.governorate.findUnique({
    where: { code: originGov },
    select: { zoneCode: true },
  });
  const from = origin?.zoneCode ?? null;
  const to = destination.zone.code;
  if (!from || from === to) return destination.zone;
  const pick =
    from === 'GC'
      ? to
      : to === 'GC'
        ? from
        : REGION_ORDER.indexOf(from) > REGION_ORDER.indexOf(to)
          ? from
          : to;
  if (pick === to) return destination.zone;
  return (await db.pricingZone.findUnique({ where: { code: pick } })) ?? destination.zone;
}

/** The merchant's price for one parcel: agreed price, else list price less their discount or tier. */
export async function priceFor(
  db: Tx | PrismaService,
  core: ShipmentsCore,
  s: SettingValues,
  a: {
    merchantId: string;
    discountBp: number;
    governorateCode: string;
    areaId: string | null;
    size: ParcelSize;
    allowOpen: boolean;
    exchange: boolean;
  },
) {
  const { hubId, zone: destinationZone } = await core.deliveryHubFor(
    db as Tx,
    a.governorateCode,
    a.areaId,
  );
  const merchant = await db.merchant.findUnique({
    where: { id: a.merchantId },
    select: { governorateCode: true },
  });
  const zone = await routeZoneFor(db, merchant?.governorateCode ?? null, {
    governorateCode: a.governorateCode,
    zone: destinationZone,
  });
  // The merchant's contract (one for both services) decides first: a fixed price for the zone
  // and size, else its discount; then the older per merchant prices and discount, then the tier.
  const terms = await parcelTermsAt(db as never, a.merchantId, todayInCairo());
  const contractPrice = terms.priceOf(zone.code, a.size);
  const agreed =
    contractPrice !== null
      ? { price: contractPrice }
      : await db.merchantPrice.findUnique({
          where: {
            merchantId_zoneCode_size: {
              merchantId: a.merchantId,
              zoneCode: zone.code,
              size: a.size,
            },
          },
        });
  const discountBp =
    terms.discountBp ??
    (a.discountBp > 0 ? a.discountBp : ((await tierFor(db, a.merchantId)).tier?.discountBp ?? 0));
  const q = quote({
    zone,
    size: a.size,
    agreedPrice: agreed?.price ?? null,
    discountBp,
    allowOpen: a.allowOpen,
    openFee: s['fees.open_package'],
    exchange: a.exchange,
    exchangeBp: s['fees.exchange_bp'],
  });
  return { hubId, zone, discountBp, agreed: !!agreed, ...q };
}

/** The merchant's cash collection and return fees: their contract's, else the network's settings. */
export async function parcelFees(db: Tx | PrismaService, merchantId: string, s: SettingValues) {
  const terms = await parcelTermsAt(db as never, merchantId, todayInCairo());
  return {
    codFeeBp: terms.codFeeBp ?? s['fees.cod_fee_bp'],
    codFreeAmount: s['fees.cod_free_amount'],
    returnFeeBp: terms.returnFeeBp ?? s['fees.return_fee_bp'],
  };
}
