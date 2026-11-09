import { HttpException, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@shiply/db';
import { LocationService } from '../location';
import { DB } from '../platform';
import { GapsService } from './gaps.service';
import { ParcelsService } from './parcels.service';
import { registerStep } from './scan.service';

type Parcel = NonNullable<Awaited<ReturnType<PrismaClient['parcel']['findUnique']>>>;

/** Where a parcel in a bag is going: its hub, or for a return the merchant's facility. */
const destination = (p: Parcel) => (p.direction === 'return' ? p.originFacilityId : p.hubId);

/** Receiving bags and parcels at the site the car brought them to, sorting by zone, dispatch and end of day. */
@Injectable()
export class HubService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(ParcelsService) private readonly parcels: ParcelsService,
    @Inject(GapsService) private readonly gaps: GapsService,
    @Inject(LocationService) private readonly location: LocationService,
  ) {}

  onModuleInit() {
    // Each bag seal first: every bag arrived, seal intact.
    registerStep('hub_bag', {
      site: true,
      codeIsBag: true,
      handler: async (tx, { input, user }) => {
        const bag = await tx.bag.findUnique({ where: { seal: input.code } });
        if (!bag) throw new HttpException({ error: 'not_found' }, 404);
        if (bag.toSiteId !== input.siteId) throw new HttpException({ error: 'other_hub' }, 409);
        if (bag.status === 'received' || bag.status === 'done') throw new HttpException({ error: 'already_received' }, 409);
        const neverLoaded = bag.status !== 'loaded';
        await tx.bag.update({ where: { id: bag.id }, data: { status: 'received', receivedById: user.id } });
        if (neverLoaded) await this.gaps.open(tx, { siteId: input.siteId!, kind: 'extra', step: 'hub_bag', bagId: bag.id, lastScanById: bag.closedById });
        if (bag.carId && !(await tx.bag.count({ where: { carId: bag.carId, status: 'loaded' } }))) {
          await tx.car.updateMany({ where: { id: bag.carId, status: 'departed' }, data: { status: 'arrived', arrivedAt: new Date() } });
        }
        return { ok: true, colour: neverLoaded ? 'amber' : 'green', big: String(bag.count), small: bag.seal, reason: neverLoaded ? 'never_loaded' : undefined, bagId: bag.id };
      },
    });

    // Then parcel by parcel out of the opened bag.
    registerStep('hub_receive', {
      site: true,
      handler: async (tx, { input, user, parcel: p }) => {
        const bag = input.bagSeal ? await tx.bag.findUnique({ where: { seal: input.bagSeal.trim().toUpperCase() } }) : null;
        if (!bag || bag.toSiteId !== input.siteId || bag.status !== 'received') throw new HttpException({ error: 'scan_the_bag_first' }, 409);
        if (p!.status !== 'in_transit') throw new HttpException({ error: 'wrong_status' }, 409);
        if (destination(p!) !== input.siteId) throw new HttpException({ error: 'other_hub' }, 409);
        await this.parcels.move(tx, p!.id, p!.direction === 'return' ? 'at_inbound' : 'at_hub', { userId: user.id, siteId: input.siteId });
        const scanned = await tx.scan.count({ where: { step: 'hub_receive', bagId: bag.id, ok: true } });
        const extra = p!.bagId !== bag.id;
        return { ok: true, colour: extra ? 'amber' : 'green', big: `${scanned + 1}/${bag.count}`, small: p!.tracking, reason: extra ? 'other_bag' : undefined, parcelId: p!.id, bagId: bag.id };
      },
    });

    // The zone and its shelf in big letters.
    registerStep('hub_sort', {
      site: true,
      handler: async (_tx, { input, parcel: p }) => {
        if (p!.status !== 'at_hub') throw new HttpException({ error: 'wrong_status' }, 409);
        if (p!.hubId !== input.siteId) throw new HttpException({ error: 'other_hub' }, 409);
        if (p!.direction === 'return') return { ok: true, colour: 'amber', big: 'return', reason: 'return_to_merchant', parcelId: p!.id };
        const zone = (await this.location.zones()).find((z) => z.id === p!.zoneId);
        return { ok: true, colour: 'green', big: zone?.code ?? '?', small: zone?.code, parcelId: p!.id };
      },
    });

    // The courier scans each parcel into his run.
    registerStep('dispatch', {
      site: true,
      handler: async (tx, { input, user, parcel: p }) => {
        const run = input.runId ? await tx.run.findUnique({ where: { id: input.runId } }) : null;
        if (!run || run.hubId !== input.siteId || run.status === 'closed') throw new HttpException({ error: 'no_run' }, 409);
        if (p!.hubId !== input.siteId) throw new HttpException({ error: 'other_hub' }, 409);
        if (p!.direction === 'return') throw new HttpException({ error: 'return_parcel' }, 409);
        if (p!.status !== 'at_hub' && p!.status !== 'attempt_failed') throw new HttpException({ error: 'wrong_status' }, 409);
        await this.parcels.move(tx, p!.id, 'out_for_delivery', { userId: user.id, siteId: input.siteId, set: { courierId: run.courierId, runId: run.id } });
        const stops = await tx.parcel.count({ where: { runId: run.id, status: 'out_for_delivery' } });
        return { ok: true, colour: 'green', big: String(stops), small: p!.tracking, parcelId: p!.id };
      },
    });

    // End of day: what the courier did not deliver comes back to the hub.
    registerStep('hub_return', {
      site: true,
      handler: async (tx, { input, user, parcel: p }) => {
        if (p!.hubId !== input.siteId) throw new HttpException({ error: 'other_hub' }, 409);
        if (p!.status === 'on_hold' && p!.courierId) {
          await tx.parcel.update({ where: { id: p!.id }, data: { courierId: null, runId: null } });
          return { ok: true, colour: 'amber', big: 'return', reason: 'return_to_merchant', parcelId: p!.id };
        }
        if (p!.status !== 'out_for_delivery' && p!.status !== 'attempt_failed') throw new HttpException({ error: 'wrong_status' }, 409);
        await this.parcels.move(tx, p!.id, 'at_hub', { userId: user.id, siteId: input.siteId, set: { courierId: null, runId: null } });
        return { ok: true, colour: 'green', big: 'back', small: p!.tracking, parcelId: p!.id };
      },
    });
  }

  /** The bag is empty: what it should have held and was not scanned is missing; what was scanned from it but belongs elsewhere is extra. */
  bagDone(seal: string) {
    return this.db.$transaction(async (tx) => {
      const bag = await tx.bag.findUnique({ where: { seal: seal.trim().toUpperCase() } });
      if (!bag) throw new HttpException({ error: 'not_found' }, 404);
      const { count } = await tx.bag.updateMany({ where: { id: bag.id, status: 'received' }, data: { status: 'done' } });
      if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
      const missing = await tx.parcel.findMany({ where: { bagId: bag.id, status: 'in_transit' } });
      for (const p of missing) await this.gaps.open(tx, { siteId: bag.toSiteId, kind: 'missing', step: 'hub_receive', parcelId: p.id, bagId: bag.id, lastScanById: await this.gaps.lastScanBy(tx, p.id) });
      const scans = await tx.scan.findMany({ where: { step: 'hub_receive', bagId: bag.id, ok: true }, select: { parcelId: true } });
      const scannedIds = scans.map((s) => s.parcelId!).filter(Boolean);
      const extra = await tx.parcel.findMany({ where: { id: { in: scannedIds }, NOT: { bagId: bag.id } } });
      for (const p of extra) await this.gaps.open(tx, { siteId: bag.toSiteId, kind: 'extra', step: 'hub_receive', parcelId: p.id, bagId: bag.id, lastScanById: await this.gaps.lastScanBy(tx, p.id) });
      return { missing: missing.length, extra: extra.length };
    });
  }
}
