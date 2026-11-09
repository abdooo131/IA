import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, Tx } from '@shiply/db';
import { DB, publish } from '../platform';

export interface GapInput {
  siteId: string;
  kind: 'missing' | 'extra' | 'not_handed_over' | 'seal_broken' | 'count_mismatch';
  step: string;
  parcelId?: string | null;
  bagId?: string | null;
  carId?: string | null;
  pickupId?: string | null;
  lastScanById?: string | null;
  note?: string;
}

/** Missing and extra parcels, broken seals and wrong counts. CS and QC turns them into cases later. */
@Injectable()
export class GapsService {
  constructor(@Inject(DB) private readonly db: PrismaClient) {}

  async open(tx: Tx, g: GapInput) {
    const gap = await tx.gap.create({ data: { ...g, note: g.note ?? null } });
    await publish(tx, 'parcel.gap_found', { gapId: gap.id, ...g }, `parcel.gap_found:${gap.id}`);
    return gap;
  }

  /** Who touched this parcel last: the person to ask. */
  async lastScanBy(tx: Tx | PrismaClient, parcelId: string) {
    return (await tx.scan.findFirst({ where: { parcelId, ok: true }, orderBy: { at: 'desc' } }))?.userId ?? null;
  }

  openCount() {
    return this.db.gap.count({ where: { open: true } });
  }
}
