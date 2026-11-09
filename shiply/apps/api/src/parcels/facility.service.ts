import { HttpException, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@shiply/db';
import { LocationService } from '../location';
import { DB, SettingsService } from '../platform';
import { GapsService } from './gaps.service';
import { ParcelsService } from './parcels.service';
import { registerStep } from './scan.service';

/** Inbound and sorting at the sorting facility. */
@Injectable()
export class FacilityService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(ParcelsService) private readonly parcels: ParcelsService,
    @Inject(GapsService) private readonly gaps: GapsService,
    @Inject(LocationService) private readonly location: LocationService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    registerStep('inbound', {
      site: true,
      handler: async (tx, { input, user, parcel: p }) => {
        const siteId = input.siteId!;
        if (p!.originFacilityId && p!.originFacilityId !== siteId) throw new HttpException({ error: 'other_facility' }, 409);
        const ctx = { userId: user.id, siteId, set: { originFacilityId: siteId } };
        if (p!.status === 'created') {
          // Never scanned at the merchant: received anyway, and flagged.
          await this.parcels.move(tx, p!.id, 'picked_up', { userId: user.id, siteId, note: 'not scanned at pickup' });
          await this.parcels.move(tx, p!.id, 'at_inbound', ctx);
          await this.gaps.open(tx, { siteId, kind: 'extra', step: 'inbound', parcelId: p!.id, lastScanById: null });
          return { ok: true, colour: 'amber', big: 'extra', reason: 'extra', small: p!.tracking, parcelId: p!.id };
        }
        if (p!.status !== 'picked_up') throw new HttpException({ error: 'wrong_status' }, 409);
        await this.parcels.move(tx, p!.id, 'at_inbound', ctx);
        const all = await tx.parcel.findMany({ where: { pickupId: p!.pickupId }, select: { status: true } });
        const received = all.filter((x) => x.status !== 'picked_up').length;
        return { ok: true, colour: 'green', big: `${received}/${all.length}`, small: p!.tracking, parcelId: p!.id };
      },
    });

    registerStep('sorting', {
      site: true,
      handler: async (tx, { input, user, parcel: p }) => {
        if (p!.status !== 'at_inbound') throw new HttpException({ error: 'wrong_status' }, 409);
        if (p!.originFacilityId !== input.siteId) throw new HttpException({ error: 'other_facility' }, 409);
        if (p!.direction === 'return') return { ok: true, colour: 'amber', big: 'return', reason: 'return_to_merchant', parcelId: p!.id };
        if (!p!.hubId) return { ok: true, colour: 'amber', big: '?', reason: 'no_route', small: p!.tracking, parcelId: p!.id };
        await this.parcels.move(tx, p!.id, 'sorted', { userId: user.id, siteId: input.siteId });
        const [sites, zones] = await Promise.all([this.location.sites(), this.location.zones()]);
        if (p!.price === null) return { ok: true, colour: 'amber', big: sites.find((s) => s.id === p!.hubId)?.code ?? '?', reason: 'no_price', parcelId: p!.id };
        return { ok: true, colour: 'green', big: sites.find((s) => s.id === p!.hubId)?.code ?? '?', small: zones.find((z) => z.id === p!.zoneId)?.code, parcelId: p!.id };
      },
    });
  }

  /** Cars on the way and arrived: expected against received, per car (pickup courier) and per merchant. */
  async inbound(siteId: string) {
    const pickups = await this.db.pickup.findMany({ where: { status: 'on_the_way' } });
    const parcels = await this.db.parcel.findMany({ where: { pickupId: { in: pickups.map((p) => p.id) }, OR: [{ originFacilityId: siteId }, { originFacilityId: null }] }, select: { pickupId: true, merchantId: true, status: true } });
    const cars = pickups
      .map((p) => {
        const mine = parcels.filter((x) => x.pickupId === p.id);
        return { pickupId: p.id, courierId: p.courierId, merchantId: p.merchantId, expected: mine.length, received: mine.filter((x) => x.status !== 'picked_up').length };
      })
      .filter((c) => c.expected > 0);
    const merchants = new Map<string, { merchantId: string; expected: number; received: number }>();
    for (const c of cars) {
      const m = merchants.get(c.merchantId) ?? { merchantId: c.merchantId, expected: 0, received: 0 };
      m.expected += c.expected;
      m.received += c.received;
      merchants.set(c.merchantId, m);
    }
    return { cars, merchants: [...merchants.values()], expected: cars.reduce((s, c) => s + c.expected, 0), received: cars.reduce((s, c) => s + c.received, 0) };
  }

  /** A car is fully unloaded: what it should have brought and did not becomes a missing gap. */
  closeInbound(siteId: string, pickupId: string) {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.pickup.updateMany({ where: { id: pickupId, status: 'on_the_way' }, data: { status: 'done' } });
      if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
      const missing = await tx.parcel.findMany({ where: { pickupId, status: 'picked_up' } });
      for (const p of missing) await this.gaps.open(tx, { siteId, kind: 'missing', step: 'inbound', parcelId: p.id, pickupId, lastScanById: await this.gaps.lastScanBy(tx, p.id) });
      return { missing: missing.length };
    });
  }

  /** Parcels waiting too long between two steps: received but not sorted, sorted but not bagged. */
  async stuck(siteId: string) {
    const minutes = await this.settings.get<number>('parcels.stuck_minutes');
    const before = new Date(Date.now() - minutes * 60_000);
    const rows = await this.db.parcel.findMany({ where: { originFacilityId: siteId, status: { in: ['at_inbound', 'sorted'] }, updatedAt: { lt: before } }, orderBy: { updatedAt: 'asc' }, take: 500 });
    return Promise.all(rows.map(async (p) => ({ parcelId: p.id, tracking: p.tracking, status: p.status, since: p.updatedAt, lastScanById: await this.gaps.lastScanBy(this.db, p.id) })));
  }
}
