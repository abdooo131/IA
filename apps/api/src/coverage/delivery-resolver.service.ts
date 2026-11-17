import { Injectable, Logger } from '@nestjs/common';
import {
  type DeliveryDecision,
  geocodeKey,
  learnFromPoint,
  type ResolveDeliveryInput,
  resolveDelivery,
} from '@shiplynow/db';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import { Geocoder } from './geocoding';

/** Addresses no one could place are tried again after a day; found ones are kept. */
const NOT_FOUND_TTL_MS = 24 * 60 * 60_000;

export type DeliveryRequest = Omit<ResolveDeliveryInput, 'geocode'>;

/**
 * Every entry point asks here which store delivers (docs/ZONES.md section 2). It is
 * resolveDelivery with the paid lookup plugged in when one is configured: the lookup runs after
 * a pin, a learned point, a saved answer and the customer's choice, and before the area engine.
 * Its answers are saved (not found ones for a day) and teach the engine new names.
 */
@Injectable()
export class DeliveryResolver {
  private readonly log = new Logger('DeliveryResolver');

  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoder: Geocoder,
    private readonly clock: Clock,
  ) {}

  resolve(input: DeliveryRequest, options: { lookup?: boolean } = {}): Promise<DeliveryDecision> {
    const lookup = (options.lookup ?? true) && this.geocoder.configured;
    return resolveDelivery(this.prisma, {
      ...input,
      ...(lookup && { geocode: (text: string) => this.lookUp(text) }),
    });
  }

  private async lookUp(text: string) {
    const key = geocodeKey(text);
    const now = this.clock.now().getTime();
    const cached = await this.prisma.geocodeCache.findUnique({ where: { addressKey: key } });
    // A recent "not found" is not asked again (found answers never reach here: they are read
    // as saved points first).
    if (
      cached &&
      cached.method !== 'engine' &&
      cached.latitude == null &&
      now - cached.createdAt.getTime() < NOT_FOUND_TTL_MS
    )
      return null;
    let found;
    try {
      found = await this.geocoder.geocode(
        text.toLowerCase().includes('egypt') ? text : `${text}, Egypt`,
      );
    } catch (error) {
      this.log.warn(`Address lookup failed: ${String(error)}`);
      throw error;
    }
    const row = {
      latitude: found?.latitude ?? null,
      longitude: found?.longitude ?? null,
      method: 'google',
      createdAt: new Date(now),
    };
    await this.prisma.geocodeCache.upsert({
      where: { addressKey: key },
      create: { addressKey: key, ...row },
      update: row,
    });
    if (!found) return null;
    // Teach the engine the words it did not know, for admin to approve.
    await learnFromPoint(this.prisma, text, found).catch((error: unknown) =>
      this.log.warn(`Could not record a suggestion: ${String(error)}`),
    );
    return { latitude: found.latitude, longitude: found.longitude };
  }
}
