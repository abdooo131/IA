import { Injectable } from '@nestjs/common';
import type { Shipment } from '@shiply/db';
import { FAIL_REASONS, normalizeCode, type FailReason } from '@shiply/shared';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth';
import { nextCode } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { ShipmentsCore, todayInCairo, type NextStep } from '../core/shipments.core';

const Code = z.object({ code: z.string().trim().min(3).max(40) });
const TripInput = z.object({
  destinationHubId: z.string().uuid(),
  vehicle: z.string().trim().max(40).default(''),
  driverName: z.string().trim().max(80).default(''),
});
const RunInput = z.object({ courierId: z.string().uuid() });
const CloseRunInput = z.object({ cashReceived: z.number().int().min(0) });
const AssignInput = z.object({ courierId: z.string().uuid() });

export interface ScanResult {
  trackingNumber: string;
  status: Shipment['status'];
  direction: Shipment['direction'];
  message: string;
  next: NextStep;
  warning?: string;
}

@Injectable()
export class HubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly core: ShipmentsCore,
  ) {}

  // ---------------------------------------------------------------- receiving

  /**
   * Scan anything that arrives at the hub: a merchant drop off, a pickup courier's parcels,
   * parcels from a line haul bag, or parcels a delivery courier brings back.
   */
  async inbound(hubId: string, body: unknown, user: SessionUser): Promise<ScanResult> {
    const { code } = parse(Code, body);
    return this.prisma.tx(async (tx) => {
      const settings = await this.settings.all(tx);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      const ev = { hubId, userId: user.id };
      const now = new Date();
      let message = 'Received';
      let warning: string | undefined;

      switch (s.status) {
        case 'CREATED': {
          const promised = await this.core.promiseFor(tx, s, now, settings);
          await this.core.move(tx, s, 'AT_HUB', { currentHubId: hubId, enteredAt: now, promisedDate: promised }, { ...ev, type: 'DROPPED_OFF', note: 'Merchant dropped off at hub' });
          message = 'Merchant drop off received';
          break;
        }
        case 'PICKED_UP': {
          await this.core.move(tx, s, 'AT_HUB', { currentHubId: hubId }, { ...ev, type: 'RECEIVED_FROM_PICKUP' });
          if (s.pickupId) await this.completePickupIfDone(tx, s.pickupId);
          message = 'Received from pickup courier';
          break;
        }
        case 'IN_TRANSIT': {
          const bag = s.bagId ? await tx.bag.findUnique({ where: { id: s.bagId } }) : null;
          if (bag && bag.destinationHubId !== hubId) warning = `This parcel was in bag ${bag.code} for another hub`;
          await this.core.move(tx, s, 'AT_HUB', { currentHubId: hubId, bagId: null }, { ...ev, type: 'RECEIVED_FROM_TRANSFER', note: warning ?? '' });
          if (bag) await this.completeBagIfEmpty(tx, bag.id);
          message = 'Received from line haul';
          break;
        }
        case 'ATTEMPT_FAILED': {
          message = await this.courierBroughtBack(tx, s, hubId, user, settings['delivery.max_attempts']);
          break;
        }
        case 'OUT_FOR_DELIVERY': {
          // The courier came back without trying this parcel. No attempt is counted.
          const item = await this.openRunItem(tx, s);
          const run = await tx.run.findUniqueOrThrow({ where: { id: item.runId } });
          if (run.hubId !== hubId) throw new DomainError('wrong_hub', 'Return this parcel to the hub its courier run started from', 409);
          await tx.runItem.update({ where: { id: item.id }, data: { result: 'FAILED', failReason: 'NOT_ATTEMPTED', backAtHub: true, resolvedAt: now } });
          await this.core.move(tx, s, 'AT_HUB', { currentHubId: hubId, runId: null }, { ...ev, type: 'NOT_ATTEMPTED', note: 'Courier brought it back without an attempt' });
          message = 'Back from courier, not attempted';
          break;
        }
        case 'LOST': {
          await this.core.move(tx, s, 'AT_HUB', { currentHubId: hubId, bagId: null, runId: null }, { ...ev, type: 'FOUND' });
          message = 'Lost parcel found';
          break;
        }
        case 'AT_HUB':
        case 'ON_HOLD': {
          if (s.currentHubId === hubId) {
            message = 'Already in this hub';
            break;
          }
          if (s.runId) throw new DomainError('bad_status', 'This parcel is loaded on a courier run in another hub', 409);
          if (s.bagId) {
            const bag = await tx.bag.findUniqueOrThrow({ where: { id: s.bagId } });
            if (bag.status === 'OPEN' || bag.status === 'SEALED') {
              throw new DomainError('bad_status', `This parcel is in bag ${bag.code} at another hub. Remove it from that bag first`, 409);
            }
          }
          warning = 'The system had this parcel in another hub';
          await this.core.move(tx, s, s.status, { currentHubId: hubId }, { ...ev, type: 'UNEXPECTED_ARRIVAL', note: warning });
          message = 'Received';
          break;
        }
        default:
          throw new DomainError('bad_status', `${s.trackingNumber} is already ${s.status.toLowerCase().replace(/_/g, ' ')}`, 409);
      }
      return this.scanResult(tx, s.id, message, warning);
    });
  }

  private async courierBroughtBack(tx: Tx, s: Shipment, hubId: string, user: SessionUser, maxAttempts: number) {
    const item = await this.openRunItem(tx, s);
    const run = await tx.run.findUniqueOrThrow({ where: { id: item.runId } });
    if (run.hubId !== hubId) throw new DomainError('wrong_hub', 'Return this parcel to the hub its courier run started from', 409);
    await tx.runItem.update({ where: { id: item.id }, data: { backAtHub: true } });
    const ev = { hubId, userId: user.id };
    const base = { currentHubId: hubId, runId: null };

    if (s.direction === 'RETURN') {
      await this.core.move(tx, s, 'AT_HUB', base, { ...ev, type: 'BACK_FROM_COURIER', note: 'Return to merchant failed, will try again' });
      return 'Back from courier. Return to merchant will be tried again';
    }
    if (s.attempts >= maxAttempts) {
      await this.core.move(tx, s, 'AT_HUB', { ...base, direction: 'RETURN' }, { ...ev, type: 'RETURN_STARTED', note: `${s.attempts} failed attempts` });
      return `Back from courier. ${s.attempts} failed attempts, going back to the merchant`;
    }
    const reason = (s.lastFailReason ?? 'OTHER') as FailReason;
    if (FAIL_REASONS[reason]?.next === 'HOLD') {
      await this.core.move(tx, s, 'ON_HOLD', { ...base, holdReason: reason }, { ...ev, type: 'ON_HOLD', note: FAIL_REASONS[reason].label });
      return 'Back from courier. On hold until the merchant decides';
    }
    await this.core.move(tx, s, 'AT_HUB', base, { ...ev, type: 'BACK_FROM_COURIER', note: 'Will be attempted again' });
    return 'Back from courier. Ready for another attempt';
  }

  private async openRunItem(tx: Tx, s: Shipment) {
    if (!s.runId) throw new DomainError('bad_status', 'This parcel is not on a courier run', 409);
    const item = await tx.runItem.findUnique({ where: { runId_shipmentId: { runId: s.runId, shipmentId: s.id } } });
    if (!item) throw new DomainError('bad_status', 'This parcel is not on a courier run', 409);
    return item;
  }

  private async completePickupIfDone(tx: Tx, pickupId: string) {
    const left = await tx.shipment.count({ where: { pickupId, status: 'PICKED_UP' } });
    if (left === 0) {
      await tx.pickup.updateMany({ where: { id: pickupId, status: 'COLLECTED' }, data: { status: 'RECEIVED', receivedAt: new Date() } });
    }
  }

  private async completeBagIfEmpty(tx: Tx, bagId: string) {
    const left = await tx.shipment.count({ where: { bagId } });
    if (left > 0) return;
    const bag = await tx.bag.update({ where: { id: bagId }, data: { status: 'RECEIVED', receivedAt: new Date() } });
    if (bag.tripId) await this.completeTripIfDone(tx, bag.tripId);
  }

  private async completeTripIfDone(tx: Tx, tripId: string) {
    const open = await tx.bag.count({ where: { tripId, status: { not: 'RECEIVED' } } });
    if (open === 0) {
      await tx.trip.updateMany({ where: { id: tripId, status: 'IN_TRANSIT' }, data: { status: 'ARRIVED', arrivedAt: new Date() } });
    }
  }

  private async scanResult(tx: Tx, id: string, message: string, warning?: string): Promise<ScanResult> {
    const s = await tx.shipment.findUniqueOrThrow({ where: { id } });
    return { trackingNumber: s.trackingNumber, status: s.status, direction: s.direction, message, next: await this.core.nextStep(tx, s), warning };
  }

  /** Everything inside the hub, grouped by what has to happen next. */
  async onHand(hubId: string) {
    const parcels = await this.prisma.shipment.findMany({
      where: { currentHubId: hubId, status: { in: ['AT_HUB', 'ON_HOLD'] } },
      include: { merchant: { select: { name: true } } },
      orderBy: { updatedAt: 'asc' },
    });
    const groups: Record<'toSort' | 'toDeliver' | 'toReturn' | 'onHold' | 'bagged' | 'onRun', unknown[]> = {
      toSort: [], toDeliver: [], toReturn: [], onHold: [], bagged: [], onRun: [],
    };
    const hubs = new Map((await this.prisma.hub.findMany()).map((h) => [h.id, h]));
    for (const s of parcels) {
      const next = await this.core.nextStep(this.prisma as unknown as Tx, s);
      const row = {
        id: s.id,
        trackingNumber: s.trackingNumber,
        merchant: s.merchant.name,
        customerName: s.customerName,
        governorateCode: s.governorateCode,
        codAmount: s.codAmount,
        attempts: s.attempts,
        promisedDate: s.promisedDate,
        direction: s.direction,
        holdReason: s.holdReason,
        nextHub: next.kind === 'SEND' ? hubs.get(next.hubId)?.code : null,
      };
      if (s.runId) groups.onRun.push(row);
      else if (s.bagId) groups.bagged.push(row);
      else if (next.kind === 'HOLD') groups.onHold.push(row);
      else if (next.kind === 'SEND') groups.toSort.push(row);
      else if (next.kind === 'DELIVER') groups.toDeliver.push(row);
      else if (next.kind === 'RETURN_TO_MERCHANT') groups.toReturn.push(row);
    }
    return groups;
  }

  // ---------------------------------------------------------------- pickups

  async pickups(hubId: string, date?: string) {
    return this.prisma.pickup.findMany({
      where: { hubId, ...(date ? { date } : { status: { in: ['REQUESTED', 'ASSIGNED', 'COLLECTED'] } }) },
      include: { merchant: { select: { name: true, phone: true, pickupAddress: true } } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async assignPickup(hubId: string, pickupId: string, body: unknown, user: SessionUser) {
    const { courierId } = parse(AssignInput, body);
    await this.assertCourier(courierId, hubId);
    const result = await this.prisma.pickup.updateMany({
      where: { id: pickupId, hubId, status: { in: ['REQUESTED', 'ASSIGNED'] } },
      data: { courierId, status: 'ASSIGNED' },
    });
    if (result.count !== 1) throw new DomainError('bad_status', 'This pickup can no longer be assigned', 409);
    await this.prisma.auditLog.create({ data: { userId: user.id, action: 'PICKUP_ASSIGNED', entity: 'pickup', entityId: pickupId, data: { courierId } } });
  }

  // ---------------------------------------------------------------- sorting and bags

  /** Put a parcel into the open bag for its next hub. Opens a new bag when none is open. */
  async sort(hubId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    return this.prisma.tx(async (tx) => {
      const settings = await this.settings.all(tx);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      if (s.status !== 'AT_HUB' || s.currentHubId !== hubId) throw new DomainError('bad_status', `${s.trackingNumber} is not in this hub. Receive it first`, 409);
      if (s.runId) throw new DomainError('bad_status', `${s.trackingNumber} is loaded on a courier run`, 409);
      const next = await this.core.nextStep(tx, s);
      if (next.kind !== 'SEND') {
        throw new DomainError('no_transfer', `${s.trackingNumber} stays here: ${next.kind === 'DELIVER' ? 'it is ready for delivery' : 'it is ready to go back to the merchant'}`, 409);
      }
      if (s.bagId) {
        const current = await tx.bag.findUniqueOrThrow({ where: { id: s.bagId } });
        if (current.destinationHubId === next.hubId) return { bag: current, trackingNumber: s.trackingNumber, next, message: `Already in bag ${current.code}` };
        if (current.status !== 'OPEN') throw new DomainError('bad_status', `${s.trackingNumber} is in sealed bag ${current.code}`, 409);
      }
      let bag = await tx.bag.findFirst({ where: { originHubId: hubId, destinationHubId: next.hubId, status: 'OPEN' }, orderBy: { createdAt: 'asc' } });
      if (!bag) {
        bag = await tx.bag.create({ data: { code: await nextCode(tx, 'bag_seq', 'BG'), originHubId: hubId, destinationHubId: next.hubId } });
      }
      await this.core.move(tx, s, 'AT_HUB', { bagId: bag.id }, { type: 'BAGGED', hubId, userId: user.id, note: `Bag ${bag.code} to ${next.hubCode}` });
      return { bag, trackingNumber: s.trackingNumber, next, message: `Put in bag ${bag.code} for ${next.hubName}` };
    });
  }

  async bags(hubId: string) {
    const bags = await this.prisma.bag.findMany({
      where: { OR: [{ originHubId: hubId, status: { in: ['OPEN', 'SEALED'] } }, { destinationHubId: hubId, status: 'IN_TRANSIT' }] },
      orderBy: { createdAt: 'asc' },
    });
    const counts = await this.prisma.shipment.groupBy({ by: ['bagId'], where: { bagId: { in: bags.map((b) => b.id) } }, _count: true });
    const byBag = new Map(counts.map((c) => [c.bagId, c._count]));
    return bags.map((b) => ({ ...b, parcels: byBag.get(b.id) ?? 0 }));
  }

  async bag(hubId: string, bagId: string) {
    const bag = await this.prisma.bag.findUnique({ where: { id: bagId } });
    if (!bag || (bag.originHubId !== hubId && bag.destinationHubId !== hubId)) throw notFound('Bag');
    const parcels = await this.prisma.shipment.findMany({ where: { bagId }, select: { id: true, trackingNumber: true, status: true, customerName: true } });
    return { ...bag, parcels };
  }

  async removeFromBag(hubId: string, bagId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    return this.prisma.tx(async (tx) => {
      const settings = await this.settings.all(tx);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      const bag = await tx.bag.findUnique({ where: { id: bagId } });
      if (!bag || bag.originHubId !== hubId) throw notFound('Bag');
      if (bag.status !== 'OPEN') throw new DomainError('bad_status', 'Only open bags can be changed', 409);
      if (s.bagId !== bagId) throw new DomainError('bad_status', `${s.trackingNumber} is not in this bag`, 409);
      await this.core.move(tx, s, 'AT_HUB', { bagId: null }, { type: 'UNBAGGED', hubId, userId: user.id, note: `Out of bag ${bag.code}` });
    });
  }

  async sealBag(hubId: string, bagId: string, user: SessionUser) {
    return this.prisma.tx(async (tx) => {
      const bag = await tx.bag.findUnique({ where: { id: bagId } });
      if (!bag || bag.originHubId !== hubId) throw notFound('Bag');
      const parcels = await tx.shipment.count({ where: { bagId } });
      if (parcels === 0) throw new DomainError('invalid_input', 'An empty bag cannot be sealed', 422);
      const r = await tx.bag.updateMany({ where: { id: bagId, status: 'OPEN' }, data: { status: 'SEALED', sealedAt: new Date() } });
      if (r.count !== 1) throw new DomainError('bad_status', 'This bag is already sealed', 409);
      await tx.auditLog.create({ data: { userId: user.id, action: 'BAG_SEALED', entity: 'bag', entityId: bagId, data: { parcels } } });
    });
  }

  // ---------------------------------------------------------------- line haul trips

  async trips(hubId: string) {
    const trips = await this.prisma.trip.findMany({
      where: {
        OR: [
          { originHubId: hubId, status: { in: ['LOADING', 'IN_TRANSIT'] } },
          { destinationHubId: hubId, status: 'IN_TRANSIT' },
        ],
      },
      include: { bags: { select: { id: true, code: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return trips.map((t) => ({ ...t, outgoing: t.originHubId === hubId }));
  }

  async createTrip(hubId: string, body: unknown, user: SessionUser) {
    const d = parse(TripInput, body);
    if (d.destinationHubId === hubId) throw new DomainError('invalid_input', 'A trip must go to another hub', 422);
    const dest = await this.prisma.hub.findUnique({ where: { id: d.destinationHubId } });
    if (!dest || !dest.active) throw new DomainError('invalid_input', 'Unknown destination hub', 422);
    return this.prisma.tx(async (tx) => {
      const trip = await tx.trip.create({ data: { code: await nextCode(tx, 'trip_seq', 'TR'), originHubId: hubId, ...d } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'TRIP_CREATED', entity: 'trip', entityId: trip.id } });
      return trip;
    });
  }

  async loadBag(hubId: string, tripId: string, body: unknown) {
    const { code } = parse(Code, body);
    return this.prisma.tx(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: tripId } });
      if (!trip || trip.originHubId !== hubId) throw notFound('Trip');
      if (trip.status !== 'LOADING') throw new DomainError('bad_status', 'This trip already left', 409);
      const bag = await tx.bag.findUnique({ where: { code: normalizeCode(code) } });
      if (!bag || bag.originHubId !== hubId) throw notFound(`Bag ${normalizeCode(code)} in this hub`);
      if (bag.status === 'OPEN') throw new DomainError('bad_status', `Seal bag ${bag.code} before loading it`, 409);
      if (bag.status !== 'SEALED' || (bag.tripId && bag.tripId !== tripId)) throw new DomainError('bad_status', `Bag ${bag.code} is already on another trip`, 409);
      if (bag.destinationHubId !== trip.destinationHubId) throw new DomainError('wrong_hub', `Bag ${bag.code} is for another hub. Do not load it on this trip`, 409);
      await tx.bag.update({ where: { id: bag.id }, data: { tripId } });
      return { bag: bag.code, message: `Bag ${bag.code} loaded` };
    });
  }

  async unloadBag(hubId: string, tripId: string, body: unknown) {
    const { code } = parse(Code, body);
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.originHubId !== hubId) throw notFound('Trip');
    const r = await this.prisma.bag.updateMany({ where: { code: normalizeCode(code), tripId, status: 'SEALED' }, data: { tripId: null } });
    if (r.count !== 1 || trip.status !== 'LOADING') throw new DomainError('bad_status', 'That bag cannot be taken off this trip', 409);
  }

  /** The truck leaves: every bag and every parcel in it goes in transit. */
  async depart(hubId: string, tripId: string, user: SessionUser) {
    return this.prisma.tx(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: tripId }, include: { bags: true } });
      if (!trip || trip.originHubId !== hubId) throw notFound('Trip');
      if (trip.status !== 'LOADING') throw new DomainError('bad_status', 'This trip already left', 409);
      if (trip.bags.length === 0) throw new DomainError('invalid_input', 'Load at least one bag first', 422);
      const dest = await tx.hub.findUniqueOrThrow({ where: { id: trip.destinationHubId } });
      const parcels = await tx.shipment.findMany({ where: { bagId: { in: trip.bags.map((b) => b.id) } } });
      for (const s of parcels) {
        await this.core.move(tx, s, 'IN_TRANSIT', { currentHubId: null }, { type: 'DEPARTED', hubId, userId: user.id, note: `Trip ${trip.code} to ${dest.code}` });
      }
      await tx.bag.updateMany({ where: { tripId }, data: { status: 'IN_TRANSIT' } });
      await tx.trip.update({ where: { id: tripId }, data: { status: 'IN_TRANSIT', departedAt: new Date() } });
      return { bags: trip.bags.length, parcels: parcels.length };
    });
  }

  /** Receive a whole sealed bag at once. Parcels already scanned one by one are skipped. */
  async receiveBag(hubId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    return this.prisma.tx(async (tx) => {
      const bag = await tx.bag.findUnique({ where: { code: normalizeCode(code) } });
      if (!bag) throw notFound(`Bag ${normalizeCode(code)}`);
      if (bag.status !== 'IN_TRANSIT') throw new DomainError('bad_status', `Bag ${bag.code} is not on its way`, 409);
      const warning = bag.destinationHubId !== hubId ? `Bag ${bag.code} was meant for another hub` : undefined;
      const parcels = await tx.shipment.findMany({ where: { bagId: bag.id, status: 'IN_TRANSIT' } });
      for (const s of parcels) {
        await this.core.move(tx, s, 'AT_HUB', { currentHubId: hubId, bagId: null }, { type: 'RECEIVED_FROM_TRANSFER', hubId, userId: user.id, note: `Bag ${bag.code}${warning ? '. ' + warning : ''}` });
      }
      await this.completeBagIfEmpty(tx, bag.id);
      return { bag: bag.code, parcels: parcels.length, warning, message: `Bag ${bag.code} received with ${parcels.length} parcels` };
    });
  }

  /** Close a trip that arrived with bags missing. Missing parcels stay in transit for follow up. */
  async closeTrip(hubId: string, tripId: string, user: SessionUser) {
    return this.prisma.tx(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: tripId }, include: { bags: true } });
      if (!trip || trip.destinationHubId !== hubId) throw notFound('Trip');
      if (trip.status !== 'IN_TRANSIT') throw new DomainError('bad_status', 'This trip is not on its way', 409);
      const missing = trip.bags.filter((b) => b.status !== 'RECEIVED').map((b) => b.code);
      await tx.trip.update({ where: { id: tripId }, data: { status: 'ARRIVED', arrivedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'TRIP_CLOSED', entity: 'trip', entityId: tripId, data: { missing } } });
      return { missing };
    });
  }

  // ---------------------------------------------------------------- courier runs

  async couriers(hubId: string) {
    return this.prisma.user.findMany({ where: { hubId, role: 'COURIER', active: true }, select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' } });
  }

  private async assertCourier(courierId: string, hubId: string) {
    const courier = await this.prisma.user.findUnique({ where: { id: courierId } });
    if (!courier || courier.role !== 'COURIER' || !courier.active || courier.hubId !== hubId) {
      throw new DomainError('invalid_input', 'Pick an active courier from this hub', 422);
    }
  }

  async runs(hubId: string) {
    const runs = await this.prisma.run.findMany({
      where: { hubId, OR: [{ status: { in: ['LOADING', 'OUT'] } }, { date: todayInCairo() }] },
      include: { items: { select: { result: true, backAtHub: true, codCollected: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const couriers = new Map((await this.couriers(hubId)).map((c) => [c.id, c.name]));
    return runs.map(({ items, ...r }) => ({
      ...r,
      courierName: couriers.get(r.courierId) ?? 'Courier',
      total: items.length,
      pending: items.filter((i) => i.result === 'PENDING').length,
      done: items.filter((i) => i.result === 'DELIVERED' || i.result === 'RETURNED').length,
      failed: items.filter((i) => i.result === 'FAILED').length,
      failedNotBack: items.filter((i) => i.result === 'FAILED' && !i.backAtHub).length,
      cashCollected: items.reduce((sum, i) => sum + i.codCollected, 0),
    }));
  }

  async run(hubId: string, runId: string) {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      include: { items: { include: { shipment: { select: { trackingNumber: true, customerName: true, address: true, codAmount: true, status: true } } } } },
    });
    if (!run || run.hubId !== hubId) throw notFound('Run');
    return run;
  }

  async createRun(hubId: string, body: unknown, user: SessionUser) {
    const { courierId } = parse(RunInput, body);
    await this.assertCourier(courierId, hubId);
    return this.prisma.tx(async (tx) => {
      const active = await tx.run.findFirst({ where: { courierId, status: { in: ['LOADING', 'OUT'] } } });
      if (active) throw new DomainError('duplicate', `This courier still has run ${active.code} open`, 409);
      const run = await tx.run.create({ data: { code: await nextCode(tx, 'run_seq', 'RN'), hubId, courierId, date: todayInCairo() } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'RUN_CREATED', entity: 'run', entityId: run.id } });
      return run;
    });
  }

  async addToRun(hubId: string, runId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    return this.prisma.tx(async (tx) => {
      const settings = await this.settings.all(tx);
      const run = await tx.run.findUnique({ where: { id: runId } });
      if (!run || run.hubId !== hubId) throw notFound('Run');
      if (run.status !== 'LOADING') throw new DomainError('bad_status', 'This run already left', 409);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      if (s.status !== 'AT_HUB' || s.currentHubId !== hubId) throw new DomainError('bad_status', `${s.trackingNumber} is not ready in this hub`, 409);
      if (s.runId) throw new DomainError('bad_status', `${s.trackingNumber} is already on a run`, 409);
      if (s.bagId) throw new DomainError('bad_status', `${s.trackingNumber} is in a bag. Take it out first`, 409);
      const next = await this.core.nextStep(tx, s);
      if (next.kind === 'SEND') throw new DomainError('wrong_hub', `${s.trackingNumber} is not for this hub. Send it to ${next.hubName}`, 409);
      await tx.runItem.create({ data: { runId, shipmentId: s.id, direction: s.direction } });
      await this.core.move(tx, s, 'AT_HUB', { runId }, { type: 'LOADED_ON_RUN', hubId, userId: user.id, note: `Run ${run.code}` });
      return { trackingNumber: s.trackingNumber, direction: s.direction, message: s.direction === 'RETURN' ? 'Added as a return to merchant' : 'Added for delivery' };
    });
  }

  async removeFromRun(hubId: string, runId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    return this.prisma.tx(async (tx) => {
      const settings = await this.settings.all(tx);
      const run = await tx.run.findUnique({ where: { id: runId } });
      if (!run || run.hubId !== hubId) throw notFound('Run');
      if (run.status !== 'LOADING') throw new DomainError('bad_status', 'This run already left', 409);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      if (s.runId !== runId) throw new DomainError('bad_status', `${s.trackingNumber} is not on this run`, 409);
      await tx.runItem.delete({ where: { runId_shipmentId: { runId, shipmentId: s.id } } });
      await this.core.move(tx, s, 'AT_HUB', { runId: null }, { type: 'REMOVED_FROM_RUN', hubId, userId: user.id, note: `Run ${run.code}` });
    });
  }

  async startRun(hubId: string, runId: string, user: SessionUser) {
    return this.prisma.tx(async (tx) => {
      const run = await tx.run.findUnique({ where: { id: runId } });
      if (!run || run.hubId !== hubId) throw notFound('Run');
      if (run.status !== 'LOADING') throw new DomainError('bad_status', 'This run already left', 409);
      const parcels = await tx.shipment.findMany({ where: { runId } });
      if (parcels.length === 0) throw new DomainError('invalid_input', 'Add parcels to the run first', 422);
      for (const s of parcels) {
        await this.core.move(tx, s, 'OUT_FOR_DELIVERY', { currentHubId: null }, { type: s.direction === 'RETURN' ? 'OUT_FOR_RETURN' : 'OUT_FOR_DELIVERY', hubId, userId: user.id, note: `Run ${run.code}` });
      }
      await tx.run.update({ where: { id: runId }, data: { status: 'OUT', startedAt: new Date() } });
      return { parcels: parcels.length };
    });
  }

  /**
   * End of day. Every parcel must be delivered, returned, or scanned back into the hub,
   * and the courier hands over the cash. A difference is recorded against the courier.
   */
  async closeRun(hubId: string, runId: string, body: unknown, user: SessionUser) {
    const { cashReceived } = parse(CloseRunInput, body);
    return this.prisma.tx(async (tx) => {
      const run = await tx.run.findUnique({ where: { id: runId }, include: { items: { include: { shipment: { select: { trackingNumber: true } } } } } });
      if (!run || run.hubId !== hubId) throw notFound('Run');
      if (run.status !== 'OUT') throw new DomainError('bad_status', 'Only a run that is out can be closed', 409);
      const notBack = run.items.filter((i) => i.result === 'PENDING' || (i.result === 'FAILED' && !i.backAtHub));
      if (notBack.length) {
        throw new DomainError('parcels_missing', `Scan these parcels back into the hub first: ${notBack.map((i) => i.shipment.trackingNumber).join(', ')}`, 409);
      }
      const expected = run.items.reduce((sum, i) => sum + i.codCollected, 0);
      await tx.run.update({ where: { id: runId }, data: { status: 'CLOSED', cashExpected: expected, cashReceived, closedAt: new Date(), closedById: user.id } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'RUN_CLOSED', entity: 'run', entityId: runId, data: { expected, cashReceived } } });
      return { expected, received: cashReceived, difference: cashReceived - expected };
    });
  }
}
