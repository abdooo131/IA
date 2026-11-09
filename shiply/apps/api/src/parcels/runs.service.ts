import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@shiply/db';
import { DB, peopleOfKind } from '../platform';

const today = () => new Date(new Date().toISOString().slice(0, 10));

/** Couriers' zones, the suggestion at dispatch, and runs. */
@Injectable()
export class RunsService {
  constructor(@Inject(DB) private readonly db: PrismaClient) {}

  async couriers() {
    const [people, zones] = await Promise.all([peopleOfKind(this.db, 'agent_person'), this.db.courierZone.findMany()]);
    return people.map((p) => ({ ...p, zoneIds: zones.filter((z) => z.userId === p.id).map((z) => z.zoneId) }));
  }

  async setZones(userId: string, zoneIds: string[]) {
    const person = (await peopleOfKind(this.db, 'agent_person')).find((p) => p.id === userId);
    if (!person) throw new HttpException({ error: 'not_a_courier' }, 400);
    await this.db.$transaction([this.db.courierZone.deleteMany({ where: { userId } }), this.db.courierZone.createMany({ data: [...new Set(zoneIds)].map((zoneId) => ({ userId, zoneId })) })]);
    return { userId, zoneIds };
  }

  /** Couriers who usually cover the zone, the least loaded first. */
  async suggest(zoneId: string) {
    const covering = await this.db.courierZone.findMany({ where: { zoneId } });
    const people = (await peopleOfKind(this.db, 'agent_person')).filter((p) => p.active && covering.some((c) => c.userId === p.id));
    const load = await this.db.parcel.groupBy({ by: ['courierId'], where: { courierId: { in: people.map((p) => p.id) }, status: 'out_for_delivery' }, _count: true });
    return people
      .map((p) => ({ courierId: p.id, name: p.name, nameAr: p.nameAr, openParcels: load.find((l) => l.courierId === p.id)?._count ?? 0 }))
      .sort((a, b) => a.openParcels - b.openParcels);
  }

  async create(hubId: string, courierId: string, userId: string) {
    const person = (await peopleOfKind(this.db, 'agent_person')).find((p) => p.id === courierId && p.active);
    if (!person) throw new HttpException({ error: 'not_a_courier' }, 400);
    if (await this.db.run.findUnique({ where: { courierId_date: { courierId, date: today() } } })) throw new HttpException({ error: 'run_exists' }, 409);
    return this.db.run.create({ data: { hubId, courierId, date: today(), confirmedById: userId } });
  }

  async out(id: string) {
    const { count } = await this.db.run.updateMany({ where: { id, status: 'open' }, data: { status: 'out' } });
    if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
    return this.db.run.findUniqueOrThrow({ where: { id } });
  }

  /** Closed only once every parcel the courier took is delivered or scanned back. */
  async close(id: string) {
    const out = await this.db.parcel.count({ where: { runId: id, OR: [{ status: { in: ['out_for_delivery', 'attempt_failed'] } }, { status: 'on_hold', courierId: { not: null } }] } });
    if (out) throw new HttpException({ error: 'parcels_not_back', count: out }, 409);
    const { count } = await this.db.run.updateMany({ where: { id, status: { in: ['open', 'out'] } }, data: { status: 'closed' } });
    if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
    return { ok: true };
  }

  async mine(courierId: string) {
    const run = await this.db.run.findUnique({ where: { courierId_date: { courierId, date: today() } } });
    if (!run) return { run: null, stops: [] };
    const stops = await this.db.parcel.findMany({
      where: { runId: run.id },
      orderBy: { updatedAt: 'asc' },
      select: { id: true, tracking: true, customerName: true, phone: true, addressText: true, codAmount: true, openPackage: true, notes: true, status: true, attempts: true },
    });
    return { run, stops };
  }
}
