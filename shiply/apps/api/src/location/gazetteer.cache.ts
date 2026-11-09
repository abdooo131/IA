import { Inject, Injectable } from '@nestjs/common';
import { buildGazetteer, type Gazetteer, type Kind, type Place } from '@shiply/address';
import type { PrismaClient } from '@shiply/db';
import { DB } from '../platform';

/** The engine's lookup tables, built from the places and taught names in the database. */
@Injectable()
export class GazetteerCache {
  private current: Promise<Gazetteer> | null = null;
  constructor(@Inject(DB) private readonly db: PrismaClient) {}

  get(): Promise<Gazetteer> {
    this.current ??= this.build().catch((err) => {
      this.current = null;
      throw err;
    });
    return this.current;
  }

  /** Call after any change to places or taught names: the next address uses the change. */
  invalidate() {
    this.current = null;
  }

  private async build(): Promise<Gazetteer> {
    const [rows, taught] = await Promise.all([
      this.db.place.findMany({ where: { active: true } }),
      this.db.taughtName.findMany({ select: { name: true, placeId: true } }),
    ]);
    const places: Place[] = rows.map((p) => ({
      id: p.id,
      kind: p.kind as Kind,
      parent: p.parentId ?? undefined,
      en: p.nameEn,
      ar: p.nameAr,
      names: p.names,
      needsParent: p.needsParent,
      served: p.served,
    }));
    return buildGazetteer(places, taught);
  }
}
