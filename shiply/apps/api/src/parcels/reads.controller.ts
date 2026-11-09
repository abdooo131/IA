import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { PrismaClient } from '@shiply/db';
import { LocationService } from '../location';
import { MerchantsService } from '../merchants';
import { DB, NeedAccess, peopleOfKind } from '../platform';

const DONE = ['delivered', 'returned', 'cancelled', 'lost'];

/** What the Shiply screens read besides parcels: names for pickers, the overview, failed attempts. */
@Controller('parcels')
export class ReadsController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(LocationService) private readonly location: LocationService,
    @Inject(MerchantsService) private readonly merchants: MerchantsService,
  ) {}

  @Get('lookups')
  @NeedAccess('shiply', 'view')
  async lookups() {
    const [sites, zones, merchants, couriers] = await Promise.all([this.location.sites(), this.location.zones(), this.merchants.forService('shiply'), peopleOfKind(this.db, 'agent_person')]);
    return { sites: sites.filter((s) => s.active && s.kind !== 'dark_store'), zones: zones.filter((z) => z.active), merchants, couriers };
  }

  /** Today's flow by status, parcels past their deadline (two days), failure rate per hub (last 7 days). */
  @Get('overview')
  @NeedAccess('shiply', 'view')
  async overview() {
    const day = new Date(new Date().toISOString().slice(0, 10));
    const week = new Date(Date.now() - 7 * 86_400_000);
    const [open, today, late, attempts] = await Promise.all([
      this.db.parcel.groupBy({ by: ['status'], where: { status: { notIn: DONE } }, _count: true }),
      this.db.parcel.groupBy({ by: ['status'], where: { status: { in: DONE }, updatedAt: { gte: day } }, _count: true }),
      this.db.parcel.count({ where: { status: { notIn: DONE }, createdAt: { lt: new Date(Date.now() - 2 * 86_400_000) } } }),
      this.db.attempt.findMany({ where: { at: { gte: week } }, select: { result: true, runId: true } }),
    ]);
    const runs = await this.db.run.findMany({ where: { id: { in: [...new Set(attempts.map((a) => a.runId))] } }, select: { id: true, hubId: true } });
    const byHub = new Map<string, { hubId: string; attempts: number; failed: number; rate: number }>();
    for (const a of attempts) {
      const hubId = runs.find((r) => r.id === a.runId)?.hubId;
      if (!hubId) continue;
      const h = byHub.get(hubId) ?? { hubId, attempts: 0, failed: 0, rate: 0 };
      h.attempts += 1;
      if (a.result === 'failed') h.failed += 1;
      h.rate = Math.round((h.failed * 10_000) / h.attempts);
      byHub.set(hubId, h);
    }
    return { byStatus: Object.fromEntries([...open, ...today].map((g) => [g.status, g._count])), late, failureByHub: [...byHub.values()] };
  }

  @Get('attempts')
  @NeedAccess('shiply', 'view')
  async attempts(@Query('result') result?: string) {
    const rows = await this.db.attempt.findMany({ where: result ? { result } : {}, orderBy: { at: 'desc' }, take: 500 });
    const parcels = await this.db.parcel.findMany({ where: { id: { in: rows.map((r) => r.parcelId) } }, select: { id: true, tracking: true, status: true, merchantId: true, hubId: true } });
    return rows.map((r) => {
      const p = parcels.find((x) => x.id === r.parcelId);
      return { ...r, tracking: p?.tracking, parcelStatus: p?.status, merchantId: p?.merchantId, hubId: p?.hubId };
    });
  }
}
