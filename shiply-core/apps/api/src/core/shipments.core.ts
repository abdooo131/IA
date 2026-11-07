import { Injectable } from '@nestjs/common';
import type { Direction, Shipment, ShipmentStatus } from '@shiply/db';
import {
  STATUS_LABELS,
  canTransition,
  cairoClock,
  isValidTrackingNumber,
  nearest,
  nextHop,
  normalizeCode,
  promisedDate,
  type NetHub,
  type SettingValues,
} from '@shiply/shared';
import { DomainError, notFound } from '../common/errors';
import type { Tx } from '../common/prisma.service';
import { queueParcelMessage } from '../common/messages';

export interface EventInput {
  type: string;
  hubId?: string | null;
  userId?: string | null;
  note?: string;
}

/** What should physically happen to a parcel sitting in a hub. */
export type NextStep =
  | { kind: 'SEND'; hubId: string; hubCode: string; hubName: string }
  | { kind: 'DELIVER' }
  | { kind: 'RETURN_TO_MERCHANT'; merchantName?: string }
  | { kind: 'HOLD'; reason: string | null }
  | { kind: 'NONE' };

/**
 * The only place that changes a parcel's status. Each move checks the transitions table,
 * updates the row only if nobody changed it meanwhile, and writes the event in the same
 * transaction.
 */
@Injectable()
export class ShipmentsCore {
  async move(
    tx: Tx,
    shipment: Pick<Shipment, 'id' | 'status' | 'trackingNumber'>,
    to: ShipmentStatus,
    data: Partial<Omit<Shipment, 'id' | 'status'>>,
    event: EventInput,
  ): Promise<void> {
    if (!canTransition(shipment.status, to)) {
      throw new DomainError(
        'bad_status',
        `${shipment.trackingNumber} is ${STATUS_LABELS[shipment.status].toLowerCase()} and cannot become ${STATUS_LABELS[to].toLowerCase()}`,
        409,
      );
    }
    const result = await tx.shipment.updateMany({
      where: { id: shipment.id, status: shipment.status },
      data: { ...data, status: to },
    });
    if (result.count !== 1) {
      throw new DomainError('conflict', `${shipment.trackingNumber} was just changed by someone else. Scan it again`, 409);
    }
    // Tell the customer at the moments that matter to them.
    if (to === 'OUT_FOR_DELIVERY' || to === 'DELIVERED' || to === 'ATTEMPT_FAILED') {
      if (shipment.status !== to) await queueParcelMessage(tx, shipment.id, to);
    }
    await tx.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        type: event.type,
        fromStatus: shipment.status,
        toStatus: to,
        hubId: event.hubId ?? null,
        userId: event.userId ?? null,
        note: event.note ?? '',
      },
    });
  }

  /** Find a parcel by a scanned or typed tracking number. */
  async findByCode(tx: Tx, code: string, prefix: string): Promise<Shipment> {
    const value = normalizeCode(code);
    if (!isValidTrackingNumber(value, prefix)) {
      throw new DomainError('bad_code', `${value || 'That'} is not a valid tracking number`, 422);
    }
    const shipment = await tx.shipment.findUnique({ where: { trackingNumber: value } });
    if (!shipment) throw notFound(`Parcel ${value}`);
    return shipment;
  }

  /** Every hub and facility, for routing. */
  async network(tx: Tx): Promise<Map<string, NetHub & { code: string; name: string }>> {
    const hubs = await tx.hub.findMany({ select: { id: true, code: true, name: true, isSorting: true, parentId: true } });
    return new Map(hubs.map((h) => [h.id, h]));
  }

  /** The active sorting facility nearest to a point: where a merchant's pickups go. */
  async nearestFacility(tx: Tx, point: { lat: number; lng: number }) {
    const facilities = await tx.hub.findMany({ where: { isSorting: true, active: true } });
    const best = nearest(point, facilities);
    if (!best) throw new DomainError('no_facility', 'No active sorting facility is set up', 500);
    return best;
  }

  /** Map position of a merchant or customer address: the area's if known, else the governorate's. */
  async pointOf(tx: Tx, governorateCode: string, areaId: string | null) {
    const area = areaId ? await tx.area.findUnique({ where: { id: areaId } }) : null;
    if (area?.lat != null && area.lng != null) return { lat: area.lat, lng: area.lng };
    const gov = await tx.governorate.findUnique({ where: { code: governorateCode } });
    if (!gov) throw new DomainError('invalid_input', 'Unknown governorate', 422);
    return { lat: gov.lat, lng: gov.lng };
  }

  /** The hub that delivers to an address: the area's hub, else the governorate's. */
  async deliveryHubFor(tx: Tx, governorateCode: string, areaId: string | null) {
    const gov = await tx.governorate.findUnique({ where: { code: governorateCode }, include: { zone: true } });
    if (!gov) throw new DomainError('invalid_input', 'Unknown governorate', 422);
    let hubId = gov.hubId;
    if (areaId) {
      const area = await tx.area.findUnique({ where: { id: areaId } });
      if (!area || area.governorateCode !== governorateCode) {
        throw new DomainError('invalid_input', 'That area is not in the chosen governorate', 422);
      }
      hubId = area.hubId ?? hubId;
    }
    if (!hubId) throw new DomainError('not_served', `We do not deliver to ${gov.nameEn} yet`, 422);
    const hub = await tx.hub.findUnique({ where: { id: hubId } });
    if (!hub || !hub.active || hub.isSorting) throw new DomainError('not_served', `No active last mile hub delivers to ${gov.nameEn}`, 422);
    return { hubId, zone: gov.zone };
  }

  /** Promised delivery date, fixed when the parcel first enters our network. */
  async promiseFor(tx: Tx, shipment: Pick<Shipment, 'governorateCode'>, at: Date, settings: SettingValues) {
    const gov = await tx.governorate.findUniqueOrThrow({ where: { code: shipment.governorateCode }, include: { zone: true } });
    return promisedDate(at, gov.zone.transitDays, settings['promise.cutoff'], settings['promise.weekend_days']);
  }

  /** What should physically happen next to a parcel sitting in a hub or facility. */
  async nextStep(
    tx: Tx,
    s: Pick<Shipment, 'status' | 'direction' | 'currentHubId' | 'originHubId' | 'destinationHubId' | 'holdReason'>,
    net?: Map<string, NetHub & { code: string; name: string }>,
  ): Promise<NextStep> {
    if (s.status === 'ON_HOLD') return { kind: 'HOLD', reason: s.holdReason };
    if (!['AT_INBOUND', 'SORTED', 'AT_OUTBOUND', 'AT_HUB'].includes(s.status) || !s.currentHubId) return { kind: 'NONE' };
    const hubs = net ?? (await this.network(tx));
    const hop = nextHop(
      { direction: s.direction as Direction, currentHubId: s.currentHubId, originHubId: s.originHubId, destinationHubId: s.destinationHubId },
      hubs,
    );
    if (hop === null) return s.direction === 'FORWARD' ? { kind: 'DELIVER' } : { kind: 'RETURN_TO_MERCHANT' };
    const hub = hubs.get(hop)!;
    return { kind: 'SEND', hubId: hub.id, hubCode: hub.code, hubName: hub.name };
  }
}

export function todayInCairo(at = new Date()): string {
  return cairoClock(at).date;
}
