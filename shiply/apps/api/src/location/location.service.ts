import { HttpException, Inject, Injectable } from '@nestjs/common';
import { normalizeText, parseAddress, type Status } from '@shiply/address';
import type { PrismaClient, Tx } from '@shiply/db';
import { normalizeEgyptMobile } from '@shiply/shared';
import { AuditService, DB, publish, SettingsService } from '../platform';
import { GEOCODER, type GeoAnswer, type Geocoder } from './geocoder/geocoder';
import { GazetteerCache } from './gazetteer.cache';

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
    const answer = await this.geocoder.lookup(text).catch(() => null);
    await tx.geocodeCache.createMany({ data: [{ normalized, answer: (answer ?? undefined) as never }], skipDuplicates: true });
    return answer;
  }

  /** Places an address or queues it for a person. Runs in the caller's transaction. */
  async resolve(tx: Tx, input: ResolveInput): Promise<ResolveResult> {
    const phone = input.phone ? normalizeEgyptMobile(input.phone) : null;
    const base = { service: input.service, refType: input.refType, refId: input.refId, input: input.text, phone };

    if (phone) {
      const memory = await tx.phoneMemory.findUnique({ where: { phone } });
      const place = memory ? await tx.place.findUnique({ where: { id: memory.placeId } }) : null;
      if (memory && place?.active) {
        const d = await tx.addressDecision.create({
          data: { ...base, status: 'sure', confidence: 100, placeId: memory.placeId, method: 'phone_memory', resolvedAt: new Date() },
        });
        return { decisionId: d.id, status: 'sure', placeId: memory.placeId, method: 'phone_memory' };
      }
    }

    const g = await this.cache.get();
    const r = parseAddress(input.text, g);
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
