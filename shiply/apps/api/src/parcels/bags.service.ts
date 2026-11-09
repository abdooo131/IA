import { HttpException, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient, Tx } from '@shiply/db';
import { LocationService } from '../location';
import { DB, SettingsService } from '../platform';
import { ParcelsService } from './parcels.service';
import { registerStep } from './scan.service';

type Parcel = NonNullable<Awaited<ReturnType<PrismaClient['parcel']['findUnique']>>>;

/** Outbound bags (pre printed serial seals) and the night car. */
@Injectable()
export class BagsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(ParcelsService) private readonly parcels: ParcelsService,
    @Inject(LocationService) private readonly location: LocationService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Where a parcel leaves from and goes to in a bag: forward from its facility to its hub, a return from its hub to the merchant's facility. */
  route(p: Parcel): { from: string | null; to: string | null } | null {
    if (p.direction === 'forward' && p.status === 'sorted') return { from: p.originFacilityId, to: p.hubId };
    if (p.direction === 'return' && (p.status === 'at_hub' || p.status === 'on_hold')) return { from: p.hubId, to: p.originFacilityId };
    return null;
  }

  private async code(siteId: string | null) {
    return (await this.location.sites()).find((s) => s.id === siteId)?.code ?? '?';
  }

  onModuleInit() {
    registerStep('outbound', {
      site: true,
      handler: async (tx, { input, user, parcel: p }) => {
        const r = this.route(p!);
        if (!r) throw new HttpException({ error: 'wrong_status' }, 409);
        if (r.from !== input.siteId) throw new HttpException({ error: 'other_facility' }, 409);
        if (!r.to) throw new HttpException({ error: 'no_route' }, 409);
        if (!input.bagSeal) throw new HttpException({ error: 'scan_the_seal' }, 400);
        const seal = input.bagSeal.trim().toUpperCase();
        let bag = await tx.bag.findUnique({ where: { seal } });
        bag ??= await tx.bag.create({ data: { seal, fromSiteId: input.siteId!, toSiteId: r.to, direction: p!.direction } });
        if (bag.status !== 'open') throw new HttpException({ error: 'bag_closed' }, 409);
        if (bag.fromSiteId !== input.siteId || bag.toSiteId !== r.to) throw new HttpException({ error: 'other_hub' }, 409);
        const capacity = await this.settings.get<number>('parcels.bag_capacity');
        const { count } = await tx.bag.updateMany({ where: { id: bag.id, status: 'open', count: { lt: capacity } }, data: { count: { increment: 1 } } });
        if (!count) throw new HttpException({ error: 'bag_full' }, 409);
        await this.parcels.move(tx, p!.id, 'at_outbound', { userId: user.id, siteId: input.siteId, set: { bagId: bag.id } });
        const now = await tx.bag.findUniqueOrThrow({ where: { id: bag.id } });
        return { ok: true, colour: 'green', big: String(now.count), small: await this.code(r.to), parcelId: p!.id, bagId: bag.id };
      },
    });

    registerStep('car_load', {
      site: true,
      codeIsBag: true,
      handler: async (tx, { input }) => {
        const bag = await tx.bag.findUnique({ where: { seal: input.code } });
        if (!bag) throw new HttpException({ error: 'not_found' }, 404);
        if (input.carId) await tx.$executeRaw`SELECT id FROM parcels.cars WHERE id = ${input.carId} FOR UPDATE`;
        const car = input.carId ? await tx.car.findUnique({ where: { id: input.carId } }) : null;
        if (!car || car.status !== 'loading' || car.fromSiteId !== input.siteId) throw new HttpException({ error: 'no_car' }, 409);
        if (bag.fromSiteId !== input.siteId || bag.toSiteId !== car.toSiteId) throw new HttpException({ error: 'other_hub' }, 409);
        const { count } = await tx.bag.updateMany({ where: { id: bag.id, status: 'closed' }, data: { status: 'loaded', carId: car.id } });
        if (!count) throw new HttpException({ error: bag.status === 'open' ? 'bag_open' : 'wrong_status' }, 409);
        const loaded = await tx.bag.count({ where: { carId: car.id, status: 'loaded' } });
        return { ok: true, colour: 'green', big: String(loaded), small: bag.seal, bagId: bag.id };
      },
    });
  }

  async close(seal: string, userId: string) {
    const { count } = await this.db.bag.updateMany({ where: { seal: seal.trim().toUpperCase(), status: 'open', count: { gt: 0 } }, data: { status: 'closed', closedById: userId } });
    if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
    return this.db.bag.findUniqueOrThrow({ where: { seal: seal.trim().toUpperCase() } });
  }

  /** A parcel too big for a bag travels alone, as a bag of one. */
  single(parcelId: string, seal: string, siteId: string, userId: string) {
    return this.db.$transaction(async (tx) => {
      const p = await tx.parcel.findUnique({ where: { id: parcelId } });
      if (!p) throw new HttpException({ error: 'not_found' }, 404);
      const r = this.route(p);
      if (!r || r.from !== siteId || !r.to) throw new HttpException({ error: 'wrong_status' }, 409);
      const bag = await tx.bag.create({ data: { seal: seal.trim().toUpperCase(), fromSiteId: siteId, toSiteId: r.to, direction: p.direction, single: true, status: 'closed', count: 1, closedById: userId } });
      await this.parcels.move(tx, p.id, 'at_outbound', { userId, siteId, set: { bagId: bag.id } });
      return bag;
    });
  }

  /** The driver confirms the bag count; only a matching count lets the car leave. */
  depart(carId: string, driverCount: number, userId: string) {
    return this.db.$transaction(async (tx) => {
      // Loading and leaving wait for each other, so no bag is loaded on a car that already left.
      await tx.$executeRaw`SELECT id FROM parcels.cars WHERE id = ${carId} FOR UPDATE`;
      const car = await tx.car.findUnique({ where: { id: carId } });
      if (!car) throw new HttpException({ error: 'not_found' }, 404);
      const bags = await tx.bag.findMany({ where: { carId, status: 'loaded' } });
      if (bags.length !== driverCount) throw new HttpException({ error: 'count_mismatch', loaded: bags.length }, 409);
      const { count } = await tx.car.updateMany({ where: { id: carId, status: 'loading' }, data: { status: 'departed', driverCount, departedAt: new Date() } });
      if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
      const parcels = await tx.parcel.findMany({ where: { bagId: { in: bags.map((b) => b.id) }, status: 'at_outbound' } });
      for (const p of parcels) await this.parcels.move(tx, p.id, 'in_transit', { userId, siteId: car.fromSiteId });
      return { ...car, status: 'departed', parcels: parcels.length };
    });
  }

  carSite(carId: string) {
    return this.db.car.findUnique({ where: { id: carId } });
  }

  bagBySeal(tx: Tx | PrismaClient, seal: string) {
    return tx.bag.findUnique({ where: { seal: seal.trim().toUpperCase() } });
  }
}
