import { HttpException, Inject, Injectable } from '@nestjs/common';
import { chainOf, normalizeText, parseAddress, type Status } from '@shiply/address';
import type { PrismaClient, Tx } from '@shiply/db';
import { normalizeEgyptMobile } from '@shiply/shared';
import { AuditService, DB, publish, SettingsService } from '../platform';
import { GEOCODER, type GeoAnswer, type Geocoder } from './geocoder/geocoder';
import { GazetteerCache } from './gazetteer.cache';
import { resolveService, type AreaServiceAnswer } from './service-chain';

export interface ResolveInput {
  service: 'shiply' | 'shiply_now' | 'finder';
  refType: string;
  refId: string;
  text: string;
  phone?: string;
}

export interface ResolveResult {
  decisionId: string;
  status: Status;
  placeId: string | null;
  method: 'engine' | 'phone_memory' | 'geocoder';
}

/** Statuses that place an address; anything else waits in the queue (except outside). */
const PLACED: Status[] = ['sure', 'likely'];
const QUEUED: Status[] = ['unsure', 'partial', 'not_found'];

/** The one place that decides where an address is, for both services. */
@Injectable()
export class LocationService {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(GazetteerCache) private readonly cache: GazetteerCache,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(GEOCODER) private readonly geocoder: Geocoder | null,
  ) {}

  /**
   * Google Maps, only for what the engine could not place, only when switched on and under the
   * month's cap. Each address text is looked up once, ever; the answer is saved.
   */
  private async geocode(tx: Tx, text: string): Promise<GeoAnswer | null> {
    if (!this.geocoder || !(await this.settings.get<boolean>('location.geocoder_enabled'))) return null;
    const normalized = normalizeText(text);
    const cached = await tx.geocodeCache.findUnique({ where: { normalized } });
    if (cached) return cached.answer as GeoAnswer | null;
    const cap = await this.settings.get<number>('location.geocoder_monthly_cap');
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    if ((await tx.geocodeCache.count({ where: { at: { gte: monthStart } } })) >= cap) return null;
    let answer: GeoAnswer | null;
    try {
      answer = await this.geocoder.lookup(text);
    } catch (err) {
      // Not saved, so the next address asks again. The message never carries the key.
      console.warn(`Google Maps lookup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return null;
    }
    await tx.geocodeCache.createMany({ data: [{ normalized, answer: (answer ?? undefined) as never }], skipDuplicates: true });
    return answer;
  }

  /** Places an address or queues it for a person. Runs in the caller's transaction. */
  async resolve(tx: Tx, input: ResolveInput): Promise<ResolveResult> {
    const phone = input.phone ? normalizeEgyptMobile(input.phone) : null;
    const base = { service: input.service, refType: input.refType, refId: input.refId, input: input.text, phone };

    const g = await this.cache.get();
    const r = parseAddress(input.text, g);
    if (phone) {
      const memory = await tx.phoneMemory.findUnique({ where: { phone } });
      const place = memory ? await tx.place.findUnique({ where: { id: memory.placeId } }) : null;
      // A clear new address that names another area wins: the customer moved. One that only names
      // a bigger area around the remembered one (Maadi for Degla) keeps the memory.
      const remembered = memory ? chainOf(g, memory.placeId).map((p) => p.id) : [];
      const moved = memory && r.status === 'sure' && r.area && !remembered.includes(r.area.id);
      if (moved && memory) {
        await tx.phoneMemory.update({ where: { phone }, data: { placeId: r.area!.id, confirmedAt: new Date(), source: 'address' } });
      } else if (memory && place?.active) {
        const d = await tx.addressDecision.create({
          data: { ...base, status: 'sure', confidence: 100, placeId: memory.placeId, method: 'phone_memory', resolvedAt: new Date() },
        });
        return { decisionId: d.id, status: 'sure', placeId: memory.placeId, method: 'phone_memory' };
      }
    }

    if (QUEUED.includes(r.status)) {
      const answer = await this.geocode(tx, input.text);
      if (answer) {
        // Google never decides alone: its area names must point to one of our places, clearly.
        const check = parseAddress(answer.names.join('، '), g);
        const point = { lat: answer.lat, lng: answer.lng };
        if (answer.precise && check.status === 'sure' && check.area) {
          const d = await tx.addressDecision.create({
            data: { ...base, ...point, status: 'likely', confidence: 70, placeId: check.area.id, method: 'geocoder', candidates: r.candidates as never, resolvedAt: new Date() },
          });
          return { decisionId: d.id, status: 'likely', placeId: check.area.id, method: 'geocoder' };
        }
        const d = await tx.addressDecision.create({
          data: { ...base, ...point, status: r.status, confidence: r.confidence, placeId: null, method: 'engine', candidates: r.candidates as never },
        });
        return { decisionId: d.id, status: r.status, placeId: null, method: 'engine' };
      }
    }
    const placed = PLACED.includes(r.status) || r.status === 'outside';
    const d = await tx.addressDecision.create({
      data: {
        ...base,
        status: r.status,
        confidence: r.confidence,
        placeId: placed ? (r.area?.id ?? null) : null,
        method: 'engine',
        candidates: r.candidates as never,
        resolvedAt: placed ? new Date() : null,
      },
    });
    return { decisionId: d.id, status: r.status, placeId: d.placeId, method: 'engine' };
  }

  /**
   * Who serves a place: its own setting, or the nearest area above it that has one (a
   * neighbourhood follows its district). An area marked not served stops the search.
   */
  async serviceFor(placeId: string): Promise<AreaServiceAnswer> {
    const [places, services, zones, sites] = await Promise.all([
      this.db.place.findMany({ select: { id: true, parentId: true } }),
      this.db.areaService.findMany(),
      this.db.deliveryZone.findMany({ where: { active: true } }),
      this.db.site.findMany({ where: { active: true } }),
    ]);
    return resolveService(placeId, new Map(places.map((p) => [p.id, p.parentId])), new Map(services.map((s) => [s.placeId, s])), zones, sites);
  }

  /** A place's kind and whether it is in use, for other modules that store place ids. */
  /** Every site (facilities, hubs, dark stores), for other modules to show codes and names. */
  sites(): Promise<{ id: string; kind: string; code: string; nameEn: string; nameAr: string; sortingFacilityId: string | null; active: boolean }[]> {
    return this.db.site.findMany({ orderBy: { code: 'asc' } });
  }

  /** Every delivery zone with its hub. */
  zones(): Promise<{ id: string; hubId: string; code: string; nameEn: string; nameAr: string; active: boolean }[]> {
    return this.db.deliveryZone.findMany({ orderBy: { code: 'asc' } });
  }

  async placeInfo(placeId: string): Promise<{ id: string; kind: string; active: boolean } | null> {
    return this.db.place.findUnique({ where: { id: placeId }, select: { id: true, kind: true, active: true } });
  }

  /** A place's family names, biggest first (Cairo › Maadi › New Maadi). */
  async pathOf(placeId: string): Promise<{ id: string; nameEn: string; nameAr: string }[]> {
    const places = new Map((await this.db.place.findMany({ select: { id: true, parentId: true, nameEn: true, nameAr: true } })).map((p) => [p.id, p]));
    const out: { id: string; nameEn: string; nameAr: string }[] = [];
    const seen = new Set<string>();
    for (let cur = places.get(placeId); cur && !seen.has(cur.id); cur = cur.parentId ? places.get(cur.parentId) : undefined) {
      seen.add(cur.id);
      out.unshift({ id: cur.id, nameEn: cur.nameEn, nameAr: cur.nameAr });
    }
    return out;
  }

  /** The governorate a place sits in (itself when it is one), or null. */
  async governorateOf(placeId: string): Promise<string | null> {
    const places = new Map((await this.db.place.findMany({ select: { id: true, parentId: true, kind: true } })).map((p) => [p.id, p]));
    const seen = new Set<string>();
    for (let cur = places.get(placeId); cur && !seen.has(cur.id); cur = cur.parentId ? places.get(cur.parentId) : undefined) {
      seen.add(cur.id);
      if (cur.kind === 'governorate') return cur.id;
    }
    return null;
  }

  async openCount(): Promise<number> {
    return this.db.addressDecision.count({ where: { resolvedAt: null, status: { in: QUEUED } } });
  }

  async queue(page: number) {
    const where = { resolvedAt: null, status: { in: QUEUED } };
    const [rows, total] = await Promise.all([
      this.db.addressDecision.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (page - 1) * 50, take: 50 }),
      this.db.addressDecision.count({ where }),
    ]);
    const now = Date.now();
    return {
      rows: rows.map((d) => ({ ...d, ageMinutes: Math.floor((now - d.createdAt.getTime()) / 60_000) })),
      total,
      page,
      pageSize: 50,
    };
  }

  /** A person picks the area. Only the first pick counts; the phone is remembered. */
  async pick(decisionId: string, placeId: string, userId: string) {
    const place = await this.db.place.findUnique({ where: { id: placeId } });
    if (!place?.active) throw new HttpException({ error: 'unknown_place' }, 400);
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.addressDecision.updateMany({
        where: { id: decisionId, resolvedAt: null },
        data: { placeId, method: 'manual', resolvedById: userId, resolvedAt: new Date() },
      });
      if (count === 0) {
        const exists = await tx.addressDecision.findUnique({ where: { id: decisionId } });
        throw new HttpException({ error: exists ? 'already_resolved' : 'not_found' }, exists ? 409 : 404);
      }
      const d = await tx.addressDecision.findUniqueOrThrow({ where: { id: decisionId } });
      if (d.phone) {
        await tx.phoneMemory.upsert({
          where: { phone: d.phone },
          update: { placeId, confirmedAt: new Date(), source: 'manual' },
          create: { phone: d.phone, placeId, source: 'manual' },
        });
      }
      await publish(tx, 'location.resolved', { decisionId, service: d.service, refType: d.refType, refId: d.refId, placeId }, `location.resolved:${decisionId}`);
      await this.audit.record(tx, { userId, action: 'location.picked', entity: 'address_decision', entityId: decisionId, after: { placeId } });
      return { ok: true, placeId };
    });
  }
}
