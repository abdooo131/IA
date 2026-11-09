import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, Tx } from '@shiply/db';
import { LocationService } from '../location';
import { MerchantsService } from '../merchants';
import { AuditService, DB, publish } from '../platform';
import { canMove, type Status } from './status';
import { newTracking } from './tracking';

export interface ParcelInput {
  merchantId: string;
  merchantRef?: string;
  customerName: string;
  phone: string;
  address: string;
  size: string;
  codAmount: number;
  openPackage: boolean;
  notes?: string;
}

export interface MoveContext {
  userId: string | null;
  siteId?: string | null;
  note?: string;
  /** extra fields to set on the parcel in the same update */
  set?: Record<string, unknown>;
}

@Injectable()
export class ParcelsService {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(LocationService) private readonly location: LocationService,
    @Inject(MerchantsService) private readonly merchants: MerchantsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(tx: Tx, input: ParcelInput, userId: string) {
    const terms = await this.merchants.parcelTerms(input.merchantId);
    if (!terms) throw new HttpException({ error: 'unknown_merchant' }, 400);
    const origin = terms.pickupPlaceId ? (await this.location.serviceFor(terms.pickupPlaceId)).facility : null;
    let parcel = await tx.parcel.create({
      data: {
        tracking: await this.freeTracking(tx),
        merchantId: input.merchantId,
        merchantRef: input.merchantRef ?? null,
        customerName: input.customerName,
        phone: input.phone,
        addressText: input.address,
        size: input.size,
        codAmount: input.codAmount,
        openPackage: input.openPackage,
        notes: input.notes ?? null,
        originFacilityId: origin?.id ?? null,
        createdById: userId,
      },
    });
    const decision = await this.location.resolve(tx, { service: 'shiply', refType: 'parcel', refId: parcel.id, text: input.address, phone: input.phone });
    parcel = await tx.parcel.update({ where: { id: parcel.id }, data: { decisionId: decision.decisionId } });
    if (decision.placeId && (decision.status === 'sure' || decision.status === 'likely')) parcel = await this.applyPlace(tx, parcel.id, decision.placeId);
    await tx.parcelEvent.create({ data: { parcelId: parcel.id, status: 'created', userId } });
    await this.audit.record(tx, { userId, action: 'parcel.created', entity: 'parcel', entityId: parcel.id, after: parcel });
    return parcel;
  }

  private async freeTracking(tx: Tx) {
    for (;;) {
      const t = newTracking();
      if (!(await tx.parcel.findUnique({ where: { tracking: t } }))) return t;
    }
  }

  /** The area is known: set the route (zone, hub, facility) from the map and the price from the contract. */
  async applyPlace(tx: Tx, parcelId: string, placeId: string) {
    const parcel = await tx.parcel.findUniqueOrThrow({ where: { id: parcelId } });
    const service = await this.location.serviceFor(placeId);
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthParcels = await tx.parcel.count({ where: { merchantId: parcel.merchantId, createdAt: { gte: start } } });
    const price = await this.merchants.parcelPrice(parcel.merchantId, { destinationPlaceId: placeId, size: parcel.size, monthParcels });
    const served = !service.notServed;
    return tx.parcel.update({
      where: { id: parcelId },
      data: {
        placeId,
        zoneId: served ? (service.zone?.id ?? null) : null,
        hubId: served ? (service.hub?.id ?? null) : null,
        facilityId: served ? (service.facility?.id ?? null) : null,
        price: 'price' in price ? price.price : null,
      },
    });
  }

  /** The one way a parcel changes status: checked against the allowed changes, written to the timeline, announced. */
  async move(tx: Tx, parcelId: string, to: Status, ctx: MoveContext) {
    const parcel = await tx.parcel.findUnique({ where: { id: parcelId } });
    if (!parcel) throw new HttpException({ error: 'not_found' }, 404);
    if (!canMove(parcel.status, to)) throw new HttpException({ error: 'wrong_status', status: parcel.status }, 409);
    const { count } = await tx.parcel.updateMany({ where: { id: parcelId, status: parcel.status }, data: { status: to, ...(ctx.set ?? {}) } });
    if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
    await tx.parcelEvent.create({ data: { parcelId, status: to, note: ctx.note ?? null, userId: ctx.userId, siteId: ctx.siteId ?? null } });
    await publish(tx, 'parcel.status_changed', { parcelId, merchantId: parcel.merchantId, from: parcel.status, to, courierId: (ctx.set?.courierId as string | undefined) ?? parcel.courierId }, `parcel.status_changed:${parcelId}:${parcel.status}:${to}:${Date.now()}`);
    return tx.parcel.findUniqueOrThrow({ where: { id: parcelId } });
  }

  find(key: string) {
    return this.db.parcel.findFirst({ where: { OR: [{ id: key }, { tracking: key.trim().toUpperCase() }] } });
  }
}
