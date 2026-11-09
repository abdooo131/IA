import type { PrismaClient } from '@shiply/db';

type Parcel = NonNullable<Awaited<ReturnType<PrismaClient['parcel']['findUnique']>>>;

export type WhereNow =
  | { kind: 'merchant'; merchantId: string }
  | { kind: 'courier'; userId: string | null }
  | { kind: 'site'; siteId: string | null; bagSeal?: string }
  | { kind: 'car'; carId: string | null; fromSiteId: string | null; toSiteId: string | null; bagSeal?: string }
  | { kind: 'customer' }
  | { kind: 'none' };

/** Where each parcel physically is now, from its status, its bag and car, and its last scan. */
export async function whereNow(db: PrismaClient, parcels: Parcel[]): Promise<Map<string, WhereNow>> {
  const bagIds = [...new Set(parcels.map((p) => p.bagId).filter((x): x is string => !!x))];
  const bags = bagIds.length ? await db.bag.findMany({ where: { id: { in: bagIds } } }) : [];
  const carIds = [...new Set(bags.map((b) => b.carId).filter((x): x is string => !!x))];
  const cars = carIds.length ? await db.car.findMany({ where: { id: { in: carIds } } }) : [];
  const pickedUp = parcels.filter((p) => p.status === 'picked_up').map((p) => p.id);
  const pickupScans = pickedUp.length ? await db.scan.findMany({ where: { parcelId: { in: pickedUp }, step: 'pickup', ok: true }, orderBy: { at: 'desc' } }) : [];
  const out = new Map<string, WhereNow>();
  for (const p of parcels) {
    const bag = bags.find((b) => b.id === p.bagId);
    const car = cars.find((c) => c.id === bag?.carId);
    let w: WhereNow;
    switch (p.status) {
      case 'created':
      case 'returned':
        w = { kind: 'merchant', merchantId: p.merchantId };
        break;
      case 'picked_up':
        w = { kind: 'courier', userId: pickupScans.find((s) => s.parcelId === p.id)?.userId ?? null };
        break;
      case 'at_inbound':
      case 'sorted':
        w = { kind: 'site', siteId: p.originFacilityId };
        break;
      case 'at_outbound':
        w = { kind: 'site', siteId: bag?.fromSiteId ?? p.originFacilityId, bagSeal: bag?.seal };
        break;
      case 'in_transit':
        w = { kind: 'car', carId: car?.id ?? null, fromSiteId: bag?.fromSiteId ?? null, toSiteId: bag?.toSiteId ?? null, bagSeal: bag?.seal };
        break;
      case 'out_for_delivery':
        w = { kind: 'courier', userId: p.courierId };
        break;
      case 'attempt_failed':
      case 'on_hold':
        w = p.courierId ? { kind: 'courier', userId: p.courierId } : { kind: 'site', siteId: p.hubId };
        break;
      case 'at_hub':
        w = { kind: 'site', siteId: p.hubId };
        break;
      case 'delivered':
        w = { kind: 'customer' };
        break;
      default:
        w = { kind: 'none' };
    }
    out.set(p.id, w);
  }
  return out;
}
