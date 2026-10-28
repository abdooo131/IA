import { Injectable, Logger } from '@nestjs/common';
import { learnFromPoint, resolveByAreas } from '@shiplynow/db';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import { Geocoder } from './geocoding';

/** Addresses no one could place are tried again after a day; found ones are kept. */
const NOT_FOUND_TTL_MS = 24 * 60 * 60_000;

export type Located =
  | {
      kind: 'point';
      latitude: number;
      longitude: number;
      method: string;
      /** The lookup's own wording of the address, when the lookup answered */
      formattedAddress?: string;
    }
  /** The area engine knows the address lies outside every delivery zone */
  | { kind: 'outside'; method: 'engine' }
  | { kind: 'not_found' };

/**
 * Turns an address into a map point, paying for a lookup only when nothing else knows it:
 *
 *   saved answer ──▶ area engine (decides the zone from the area names) ──▶ Google
 *                                                                           └─ teaches the engine
 *
 * `exact` asks for the door rather than the zone (orders the rider will drive to): Google comes
 * before the engine then, and the engine is the fallback.
 */
@Injectable()
export class AddressLocator {
  private readonly log = new Logger('AddressLocator');

  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoder: Geocoder,
    private readonly clock: Clock,
  ) {}

  async locate(address: string, options: { exact?: boolean } = {}): Promise<Located> {
    const text = address.trim();
    if (!text) return { kind: 'not_found' };
    const key = `${text}, EG`.toLowerCase().replace(/\s+/g, ' ');
    const now = this.clock.now().getTime();

    const cached = await this.prisma.geocodeCache.findUnique({ where: { addressKey: key } });
    const fresh =
      cached && (cached.latitude != null || now - cached.createdAt.getTime() < NOT_FOUND_TTL_MS);
    if (fresh && (!options.exact || cached.method !== 'engine')) {
      return cached.latitude != null && cached.longitude != null
        ? { kind: 'point', latitude: cached.latitude, longitude: cached.longitude, method: 'cache' }
        : { kind: 'not_found' };
    }

    const engine = await resolveByAreas(this.prisma, text);
    if (!options.exact) {
      if (engine.status === 'outside') return { kind: 'outside', method: 'engine' };
      if (engine.status === 'zone') {
        await this.save(key, engine.latitude, engine.longitude, 'engine', now);
        return {
          kind: 'point',
          latitude: engine.latitude,
          longitude: engine.longitude,
          method: 'engine',
        };
      }
    }

    let found = null;
    try {
      found = await this.geocoder.geocode(
        text.toLowerCase().includes('egypt') ? text : `${text}, Egypt`,
      );
    } catch (error) {
      // No paid lookup available: an exact request can still use the engine's answer.
      if (options.exact && engine.status === 'zone')
        return {
          kind: 'point',
          latitude: engine.latitude,
          longitude: engine.longitude,
          method: 'engine',
        };
      if (options.exact && engine.status === 'outside')
        return { kind: 'outside', method: 'engine' };
      throw error;
    }
    await this.save(key, found?.latitude ?? null, found?.longitude ?? null, 'google', now);
    if (!found) return { kind: 'not_found' };
    // Teach the engine the words it did not know, for admin to approve.
    await learnFromPoint(this.prisma, text, found).catch((error: unknown) =>
      this.log.warn(`Could not record a suggestion: ${String(error)}`),
    );
    return {
      kind: 'point',
      latitude: found.latitude,
      longitude: found.longitude,
      method: 'google',
      formattedAddress: found.formattedAddress,
    };
  }

  private async save(
    key: string,
    latitude: number | null,
    longitude: number | null,
    method: string,
    now: number,
  ) {
    const row = { latitude, longitude, method, createdAt: new Date(now) };
    await this.prisma.geocodeCache.upsert({
      where: { addressKey: key },
      create: { addressKey: key, ...row },
      update: row,
    });
  }
}
