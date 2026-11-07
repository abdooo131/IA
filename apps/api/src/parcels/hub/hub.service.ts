import { Injectable } from '@nestjs/common';
import type { Hub, Shipment } from '@shiplynow/db';
import { FAIL_REASONS, normalizeCode, type FailReason } from '@shiplynow/shared/parcels';
import { z } from 'zod';
import { assertTeam, type SessionUser } from '../auth/auth';
import { nextCode } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { ShipmentsCore, todayInCairo, type NextStep } from '../core/shipments.core';
import { sendDeliveryCode } from '../common/delivery-code';
import { formatEgp } from '@shiplynow/shared/parcels';
import { courierStanding, postPickupReceived, postRunClosed } from '../finance/postings';
import { onFound, onLost } from '../control/lost';

const Code = z.object({ code: z.string().trim().min(3).max(40) });
const TripInput = z.object({
  destinationHubId: z.string().min(1).max(64),
  /** A back haul: the vehicle that came on this trip goes back with returns. */
  backhaulOfId: z.string().min(1).max(64).nullish(),
  vehicle: z.string().trim().max(40).default(''),
  driverName: z.string().trim().max(80).default(''),
});
const RunInput = z.object({ courierId: z.string().min(1).max(64) });
const CloseRunInput = z.object({ cashReceived: z.number().int().min(0) });
const AssignInput = z.object({ courierId: z.string().min(1).max(64) });

export interface ScanResult {
  trackingNumber: string;
  status: Shipment['status'];
  direction: Shipment['direction'];
  message: string;
  next: NextStep;
  warning?: string;
}

/**
 * Work inside a sorting facility (inbound team → sorting team → outbound team) and inside a
 * last mile hub (receive, courier runs, send returns back to the facility).
 */
@Injectable()
export class HubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly core: ShipmentsCore,
  ) {}

  async hub(hubId: string): Promise<Hub> {
    const hub = await this.prisma.hub.findUnique({ where: { id: hubId } });
    if (!hub || !hub.active) throw notFound('Hub');
    return hub;
  }

  /** Where an incoming parcel lands: the inbound team's area in a facility, the shelf in a hub. */
  private arrival(hub: Hub) {
    return hub.isSorting ? ('AT_INBOUND' as const) : ('AT_HUB' as const);
  }

  // ---------------------------------------------------------------- inbound (receiving)

  /**
   * Scan anything that arrives. In a sorting facility (inbound team): pickups, merchant drop
   * offs, parcels from line haul, failed returns. In a last mile hub: line haul parcels and
   * parcels couriers bring back.
   */
  async inbound(hubId: string, body: unknown, user: SessionUser): Promise<ScanResult> {
    const { code } = parse(Code, body);
    const hub = await this.hub(hubId);
    assertTeam(user, hub, 'INBOUND');
    return this.prisma.tx(async (tx) => {
      const settings = await this.settings.all(tx);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      const ev = { hubId, userId: user.id };
      const now = new Date();
      const landed = this.arrival(hub);
      let message = 'Received';
      let warning: string | undefined;

      switch (s.status) {
        case 'CREATED':
        case 'PICKED_UP': {
          if (!hub.isSorting) {
            const facility = await tx.hub.findUniqueOrThrow({ where: { id: s.originHubId } });
            throw new DomainError(
              'wrong_hub',
              `Merchant parcels go to the sorting facility first: ${facility.name}`,
              409,
            );
          }
          if (s.originHubId !== hubId)
            warning = 'This merchant belongs to another sorting facility. The system will route it';
          const patch: Partial<Shipment> = { currentHubId: hubId };
          if (s.status === 'CREATED') {
            patch.enteredAt = now;
            patch.promisedDate = await this.core.promiseFor(tx, s, now, settings);
          }
          await this.core.move(tx, s, 'AT_INBOUND', patch, {
            ...ev,
            type: s.status === 'CREATED' ? 'DROPPED_OFF' : 'RECEIVED_FROM_PICKUP',
            note: warning ?? '',
          });
          if (s.pickupId) {
            await this.completePickupIfDone(tx, s.pickupId);
            const pickup =
              s.status === 'PICKED_UP'
                ? await tx.pickup.findUnique({ where: { id: s.pickupId } })
                : null;
            if (pickup?.courierId)
              await postPickupReceived(tx, settings, s, pickup.courierId, user.id);
          }
          message =
            s.status === 'CREATED' ? 'Merchant drop off received' : 'Received from pickup courier';
          break;
        }
        case 'IN_TRANSIT': {
          const bag = s.bagId ? await tx.bag.findUnique({ where: { id: s.bagId } }) : null;
          if (bag && bag.destinationHubId !== hubId)
            warning = `This parcel was in bag ${bag.code} for another place`;
          await this.core.move(
            tx,
            s,
            landed,
            { currentHubId: hubId, bagId: null },
            { ...ev, type: 'RECEIVED_FROM_TRANSFER', note: warning ?? '' },
          );
          if (bag) await this.completeBagIfEmpty(tx, bag.id);
          message = 'Received from line haul';
          break;
        }
        case 'ATTEMPT_FAILED':
          message = await this.courierBroughtBack(
            tx,
            s,
            hub,
            user,
            settings['delivery.max_attempts'],
          );
          break;
        case 'OUT_FOR_DELIVERY': {
          // The courier came back without trying this parcel. No attempt is counted.
          const item = await this.openRunItem(tx, s);
          const run = await tx.run.findUniqueOrThrow({ where: { id: item.runId } });
          if (run.hubId !== hubId)
            throw new DomainError(
              'wrong_hub',
              'Return this parcel to the place its courier run started from',
              409,
            );
          await tx.runItem.update({
            where: { id: item.id },
            data: {
              result: 'FAILED',
              failReason: 'NOT_ATTEMPTED',
              backAtHub: true,
              resolvedAt: now,
            },
          });
          await this.core.move(
            tx,
            s,
            'AT_HUB',
            { currentHubId: hubId, runId: null },
            { ...ev, type: 'NOT_ATTEMPTED', note: 'Courier brought it back without an attempt' },
          );
          message = 'Back from courier, not attempted';
          break;
        }
        case 'LOST':
          await this.core.move(
            tx,
            s,
            landed,
            { currentHubId: hubId, bagId: null, runId: null },
            { ...ev, type: 'FOUND' },
          );
          await onFound(tx, settings, s, user.id);
          message = 'Lost parcel found';
          break;
        case 'AT_INBOUND':
        case 'SORTED':
        case 'AT_OUTBOUND':
        case 'AT_HUB':
        case 'ON_HOLD': {
          if (s.currentHubId === hubId) {
            message = 'Already in this building';
            break;
          }
          if (s.runId)
            throw new DomainError(
              'bad_status',
              'This parcel is loaded on a courier run somewhere else',
              409,
            );
          if (s.bagId)
            throw new DomainError(
              'bad_status',
              'This parcel is in a bag at another place. Take it out of that bag first',
              409,
            );
          warning = 'The system had this parcel somewhere else';
          await this.core.move(
            tx,
            s,
            landed,
            { currentHubId: hubId },
            { ...ev, type: 'UNEXPECTED_ARRIVAL', note: warning },
          );
          break;
        }
        default:
          throw new DomainError(
            'bad_status',
            `${s.trackingNumber} is already ${s.status.toLowerCase().replace(/_/g, ' ')}`,
            409,
          );
      }
      return this.scanResult(tx, s.id, message, warning);
    });
  }

  private async courierBroughtBack(
    tx: Tx,
    s: Shipment,
    hub: Hub,
    user: SessionUser,
    maxAttempts: number,
  ) {
    const item = await this.openRunItem(tx, s);
    const run = await tx.run.findUniqueOrThrow({ where: { id: item.runId } });
    if (run.hubId !== hub.id)
      throw new DomainError(
        'wrong_hub',
        'Return this parcel to the place its courier run started from',
        409,
      );
    await tx.runItem.update({ where: { id: item.id }, data: { backAtHub: true } });
    const ev = { hubId: hub.id, userId: user.id };
    const base = { currentHubId: hub.id, runId: null };

    if (s.direction === 'RETURN' && item.failReason === 'CUSTOMER_RETURN') {
      await this.core.move(tx, s, 'AT_HUB', base, {
        ...ev,
        type: 'BACK_FROM_COURIER',
        note: 'Return collected from the customer, going back to the merchant',
      });
      return 'Customer return received. It goes back to the merchant';
    }
    if (s.direction === 'RETURN' && item.failReason === 'EXCHANGE') {
      await this.core.move(tx, s, 'AT_HUB', base, {
        ...ev,
        type: 'BACK_FROM_COURIER',
        note: 'Exchange item from the customer, going back to the merchant',
      });
      return 'Exchange item received. It goes back to the merchant';
    }
    if (s.direction === 'RETURN') {
      await this.core.move(tx, s, 'AT_HUB', base, {
        ...ev,
        type: 'BACK_FROM_COURIER',
        note: 'Handing back to the merchant failed, will try again',
      });
      return 'Back from courier. Return to merchant will be tried again';
    }
    if (s.attempts >= maxAttempts) {
      await this.core.move(
        tx,
        s,
        'AT_HUB',
        { ...base, direction: 'RETURN' },
        { ...ev, type: 'RETURN_STARTED', note: `${s.attempts} failed attempts` },
      );
      return `Back from courier. ${s.attempts} failed attempts, going back to the merchant`;
    }
    const reason = (s.lastFailReason ?? 'OTHER') as FailReason;
    if (FAIL_REASONS[reason]?.next === 'HOLD') {
      await this.core.move(
        tx,
        s,
        'ON_HOLD',
        { ...base, holdReason: reason },
        { ...ev, type: 'ON_HOLD', note: FAIL_REASONS[reason].label },
      );
      return 'Back from courier. On hold until the merchant decides';
    }
    await this.core.move(tx, s, 'AT_HUB', base, {
      ...ev,
      type: 'BACK_FROM_COURIER',
      note: 'Will be attempted again',
    });
    return 'Back from courier. Ready for another attempt';
  }

  private async openRunItem(tx: Tx, s: Shipment) {
    if (!s.runId) throw new DomainError('bad_status', 'This parcel is not on a courier run', 409);
    const item = await tx.runItem.findUnique({
      where: { runId_shipmentId: { runId: s.runId, shipmentId: s.id } },
    });
    if (!item) throw new DomainError('bad_status', 'This parcel is not on a courier run', 409);
    return item;
  }

  private async completePickupIfDone(tx: Tx, pickupId: string) {
    const left = await tx.shipment.count({ where: { pickupId, status: 'PICKED_UP' } });
    if (left === 0) {
      await tx.pickup.updateMany({
        where: { id: pickupId, status: 'COLLECTED' },
        data: { status: 'RECEIVED', receivedAt: new Date() },
      });
    }
  }

  /** Once every parcel of an arrived bag is scanned in, the bag is checked. */
  private async completeBagIfEmpty(tx: Tx, bagId: string) {
    const left = await tx.shipment.count({ where: { bagId } });
    if (left > 0) return;
    const now = new Date();
    const current = await tx.bag.findUniqueOrThrow({ where: { id: bagId } });
    const bag = await tx.bag.update({
      where: { id: bagId },
      data: { status: 'CHECKED', checkedAt: now, receivedAt: current.receivedAt ?? now },
    });
    if (bag.tripId) await this.completeTripIfDone(tx, bag.tripId);
  }

  private async completeTripIfDone(tx: Tx, tripId: string) {
    const onRoad = await tx.bag.count({ where: { tripId, status: 'IN_TRANSIT' } });
    if (onRoad === 0) {
      await tx.trip.updateMany({
        where: { id: tripId, status: 'IN_TRANSIT' },
        data: { status: 'ARRIVED', arrivedAt: new Date() },
      });
    }
  }

  private async scanResult(
    tx: Tx,
    id: string,
    message: string,
    warning?: string,
  ): Promise<ScanResult> {
    const s = await tx.shipment.findUniqueOrThrow({ where: { id } });
    return {
      trackingNumber: s.trackingNumber,
      status: s.status,
      direction: s.direction,
      message,
      next: await this.core.nextStep(tx, s),
      warning,
    };
  }

  /**
   * A bag arrives: the inbound team scans the bag, then each parcel in it. Parcels are only
   * received by their own scan, so a parcel missing from the bag is caught when the bag is checked.
   */
  async receiveBag(hubId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    const hub = await this.hub(hubId);
    assertTeam(user, hub, 'INBOUND');
    return this.prisma.tx(async (tx) => {
      const bag = await tx.bag.findUnique({ where: { code: normalizeCode(code) } });
      if (!bag) throw notFound(`Bag ${normalizeCode(code)}`);
      if (bag.status === 'RECEIVED')
        return {
          bag: bag.code,
          bagId: bag.id,
          expected: await tx.shipment.count({ where: { bagId: bag.id, status: 'IN_TRANSIT' } }),
          message: `Bag ${bag.code} is already open here. Scan its parcels`,
        };
      if (bag.status !== 'IN_TRANSIT')
        throw new DomainError('bad_status', `Bag ${bag.code} is not on its way`, 409);
      const warning =
        bag.destinationHubId !== hubId ? `Bag ${bag.code} was meant for another place` : undefined;
      await tx.bag.update({
        where: { id: bag.id },
        data: { status: 'RECEIVED', receivedAt: new Date(), destinationHubId: hubId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'BAG_ARRIVED',
          entityType: 'bag',
          entityId: bag.id,
          after: { warning },
        },
      });
      const expected = await tx.shipment.count({ where: { bagId: bag.id, status: 'IN_TRANSIT' } });
      if (expected === 0) await this.completeBagIfEmpty(tx, bag.id);
      else if (bag.tripId) await this.completeTripIfDone(tx, bag.tripId);
      return {
        bag: bag.code,
        bagId: bag.id,
        expected,
        warning,
        message: `Bag ${bag.code} opened. Scan each of its ${expected} parcels`,
      };
    });
  }

  /**
   * The inbound team finished a bag. Every parcel that was in it but was not scanned in is
   * marked lost, with the bag and the place recorded, so a missing order is known at once.
   */
  async checkBag(hubId: string, bagId: string, user: SessionUser) {
    const hub = await this.hub(hubId);
    assertTeam(user, hub, 'INBOUND');
    return this.prisma.tx(async (tx) => {
      const bag = await tx.bag.findUnique({ where: { id: bagId } });
      if (!bag || bag.destinationHubId !== hubId) throw notFound('Bag');
      if (bag.status !== 'RECEIVED')
        throw new DomainError('bad_status', `Bag ${bag.code} is not open here`, 409);
      const missing = await tx.shipment.findMany({ where: { bagId, status: 'IN_TRANSIT' } });
      for (const s of missing) {
        await this.core.move(
          tx,
          s,
          'LOST',
          { bagId: null, currentHubId: null },
          {
            type: 'MISSING_FROM_BAG',
            hubId,
            userId: user.id,
            note: `Not in bag ${bag.code} when it was opened at ${hub.code}`,
          },
        );
        await onLost(tx, await this.settings.all(tx), s, user.id);
      }
      await tx.bag.update({
        where: { id: bagId },
        data: { status: 'CHECKED', checkedAt: new Date() },
      });
      if (bag.tripId) await this.completeTripIfDone(tx, bag.tripId);
      return { bag: bag.code, missing: missing.map((m) => m.trackingNumber) };
    });
  }

  /** Bags opened here whose parcels are still being scanned in. */
  async openArrivals(hubId: string) {
    const bags = await this.prisma.bag.findMany({
      where: { destinationHubId: hubId, status: 'RECEIVED' },
      orderBy: { receivedAt: 'asc' },
    });
    const out = [];
    for (const b of bags) {
      const left = await this.prisma.shipment.findMany({
        where: { bagId: b.id, status: 'IN_TRANSIT' },
        select: { trackingNumber: true, customerName: true },
      });
      out.push({
        id: b.id,
        code: b.code,
        originHubId: b.originHubId,
        receivedAt: b.receivedAt,
        left,
      });
    }
    return out;
  }

  /**
   * Where parcels wait between two teams. Anything waiting longer than the alert setting is
   * late: that is where an order goes missing.
   */
  async handoverCheck(hubId: string) {
    const hub = await this.hub(hubId);
    const settings = await this.settings.all();
    const lateAfter = settings['handover.alert_hours'] * 3600 * 1000;
    const now = Date.now();
    const pick = {
      id: true,
      trackingNumber: true,
      customerName: true,
      updatedAt: true,
      merchant: { select: { name: true } },
    } as const;
    const pickups = hub.isSorting
      ? await this.prisma.pickup.findMany({
          where: { hubId, status: { in: ['COLLECTED', 'ASSIGNED'] } },
          select: { id: true },
        })
      : [];
    const arrived = await this.prisma.bag.findMany({
      where: { destinationHubId: hubId, status: 'RECEIVED' },
      select: { id: true },
    });
    const [pickedUp, notSorted, notBagged, bagged, notScanned] = await Promise.all([
      hub.isSorting
        ? this.prisma.shipment.findMany({
            where: { status: 'PICKED_UP', pickupId: { in: pickups.map((p) => p.id) } },
            select: pick,
          })
        : [],
      this.prisma.shipment.findMany({
        where: { currentHubId: hubId, status: 'AT_INBOUND' },
        select: pick,
      }),
      this.prisma.shipment.findMany({
        where: { currentHubId: hubId, status: 'SORTED' },
        select: pick,
      }),
      this.prisma.shipment.findMany({
        where: { currentHubId: hubId, status: 'AT_OUTBOUND' },
        select: pick,
      }),
      this.prisma.shipment.findMany({
        where: { status: 'IN_TRANSIT', bagId: { in: arrived.map((b) => b.id) } },
        select: pick,
      }),
    ]);
    const since7 = new Date(now - 7 * 864e5);
    const lostEvents = await this.prisma.shipmentEvent.findMany({
      where: {
        hubId,
        type: { in: ['MISSING_FROM_BAG', 'MARKED_LOST'] },
        createdAt: { gte: since7 },
      },
      include: { shipment: { select: { trackingNumber: true, status: true, customerName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const rows = (
      list: {
        id: string;
        trackingNumber: string;
        customerName: string;
        updatedAt: Date;
        merchant: { name: string };
      }[],
    ) =>
      list.map((r) => ({
        id: r.id,
        trackingNumber: r.trackingNumber,
        customerName: r.customerName,
        merchant: r.merchant.name,
        since: r.updatedAt,
        late: now - r.updatedAt.getTime() > lateAfter,
      }));
    const stages = [
      ...(hub.isSorting
        ? [
            {
              key: 'pickedUp',
              from: 'First mile courier',
              to: 'Inbound team',
              title: 'Picked up, not received by inbound',
              rows: rows(pickedUp),
            },
          ]
        : []),
      ...(hub.isSorting
        ? [
            {
              key: 'notSorted',
              from: 'Inbound team',
              to: 'Sorting team',
              title: 'Received, not sorted yet',
              rows: rows(notSorted),
            },
            {
              key: 'notBagged',
              from: 'Sorting team',
              to: 'Outbound team',
              title: 'Sorted on a lane, not bagged by outbound',
              rows: rows(notBagged),
            },
            {
              key: 'bagged',
              from: 'Outbound team',
              to: 'Truck',
              title: 'In outbound bags, not on a truck yet',
              rows: rows(bagged),
            },
          ]
        : [
            {
              key: 'bagged',
              from: 'Hub staff',
              to: 'Truck',
              title: 'In bags, not on a truck yet',
              rows: rows(bagged),
            },
          ]),
      {
        key: 'notScanned',
        from: 'Truck',
        to: hub.isSorting ? 'Inbound team' : 'Hub staff',
        title: 'Bag arrived, parcel not scanned in',
        rows: rows(notScanned),
      },
    ];
    return {
      lateAfterHours: settings['handover.alert_hours'],
      stages,
      lost: lostEvents.map((e) => ({
        trackingNumber: e.shipment.trackingNumber,
        customerName: e.shipment.customerName,
        status: e.shipment.status,
        note: e.note,
        at: e.createdAt,
        type: e.type,
      })),
    };
  }

  /** Everything in the building, grouped by the team or step that has to act next. */
  async onHand(hubId: string) {
    const hub = await this.hub(hubId);
    const parcels = await this.prisma.shipment.findMany({
      where: {
        currentHubId: hubId,
        status: { in: ['AT_INBOUND', 'SORTED', 'AT_OUTBOUND', 'AT_HUB', 'ON_HOLD'] },
      },
      include: { merchant: { select: { name: true } } },
      orderBy: { updatedAt: 'asc' },
    });
    const net = await this.core.network(this.prisma as unknown as Tx);
    const groups = hub.isSorting
      ? [
          {
            key: 'inbound',
            title: 'Received, waiting for sorting',
            hint: 'Inbound team has scanned these in. Sorting team scans each into its bag.',
            rows: [] as unknown[],
          },
          {
            key: 'sorted',
            title: 'Sorted on lanes, waiting for outbound',
            hint: 'Sorting put these on the lane for their next place. Outbound scans each one into its bag.',
            rows: [] as unknown[],
          },
          {
            key: 'outbound',
            title: 'In outbound bags, waiting for a truck',
            hint: 'Outbound scanned these into bags. Seal the bags and load the truck.',
            rows: [] as unknown[],
          },
          {
            key: 'returnShelf',
            title: 'Return shelf',
            hint: 'Going back to merchants of this facility. Load on a pickup courier run.',
            rows: [] as unknown[],
          },
          {
            key: 'onRun',
            title: 'Loaded on courier runs',
            hint: 'On a run that has not left yet.',
            rows: [] as unknown[],
          },
        ]
      : [
          {
            key: 'deliver',
            title: 'Ready for delivery',
            hint: 'Load these on courier runs.',
            rows: [] as unknown[],
          },
          {
            key: 'onHold',
            title: 'On hold',
            hint: 'Waiting for the merchant to decide.',
            rows: [] as unknown[],
          },
          {
            key: 'send',
            title: 'To send back to the sorting facility',
            hint: 'Returns and rerouted parcels. Scan each one into the bag on Send back.',
            rows: [] as unknown[],
          },
          {
            key: 'bagged',
            title: 'In bags',
            hint: 'In a bag that has not left yet.',
            rows: [] as unknown[],
          },
          {
            key: 'onRun',
            title: 'Loaded on courier runs',
            hint: 'On a run that has not left yet.',
            rows: [] as unknown[],
          },
        ];
    const put = (key: string, row: unknown) => groups.find((g) => g.key === key)?.rows.push(row);
    for (const s of parcels) {
      const next = await this.core.nextStep(this.prisma as unknown as Tx, s, net);
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
        nextHub: next.kind === 'SEND' ? next.hubCode : null,
      };
      if (s.runId) put('onRun', row);
      else if (hub.isSorting) {
        if (s.status === 'AT_INBOUND') put('inbound', row);
        else if (s.status === 'SORTED') put('sorted', row);
        else if (s.status === 'AT_OUTBOUND') put('outbound', row);
        else put('returnShelf', row);
      } else if (s.status === 'AT_OUTBOUND') put('bagged', row);
      else if (next.kind === 'HOLD') put('onHold', row);
      else if (next.kind === 'DELIVER') put('deliver', row);
      else put('send', row);
    }
    return {
      hub: { id: hub.id, code: hub.code, name: hub.name, isSorting: hub.isSorting },
      groups,
    };
  }

  // ---------------------------------------------------------------- pickups (facility)

  async pickups(hubId: string, date?: string) {
    return this.prisma.pickup.findMany({
      where: {
        hubId,
        ...(date ? { date } : { status: { in: ['REQUESTED', 'ASSIGNED', 'COLLECTED'] } }),
      },
      include: { merchant: { select: { name: true, contactPhone: true, pickupAddress: true } } },
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
    if (result.count !== 1)
      throw new DomainError('bad_status', 'This pickup can no longer be assigned', 409);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'PICKUP_ASSIGNED',
        entityType: 'pickup',
        entityId: pickupId,
        after: { courierId },
      },
    });
  }

  // ---------------------------------------------------------------- sorting team

  /**
   * Sorting team scans a parcel the inbound team received. The system routes it to the lane for
   * its next place, or to the return shelf when it is back at its merchant's facility. Outbound
   * then scans it from the lane into a bag, which completes the handover.
   */
  async sort(hubId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    const hub = await this.hub(hubId);
    if (!hub.isSorting)
      throw new DomainError(
        'invalid_input',
        'Last mile hubs scan returns straight into the bag on Send back',
        422,
      );
    assertTeam(user, hub, 'SORTING');
    return this.prisma.tx(async (tx) => {
      const settings = await this.settings.all(tx);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      if (s.currentHubId !== hubId || !['AT_INBOUND', 'SORTED'].includes(s.status)) {
        const why =
          s.status === 'AT_OUTBOUND'
            ? 'outbound already bagged it'
            : s.currentHubId === hubId && s.status === 'AT_HUB'
              ? 'it is on the return shelf'
              : 'inbound must scan it in first';
        throw new DomainError('bad_status', `${s.trackingNumber} cannot be sorted: ${why}`, 409);
      }
      const next = await this.core.nextStep(tx, { ...s, status: 'AT_INBOUND' });
      const ev = { hubId, userId: user.id };
      if (next.kind === 'RETURN_TO_MERCHANT') {
        await this.core.move(
          tx,
          s,
          'AT_HUB',
          { laneHubId: null },
          { ...ev, type: 'RETURN_SHELF', note: 'Ready to hand back to the merchant' },
        );
        const m = await tx.merchant.findUniqueOrThrow({ where: { id: s.merchantId } });
        return {
          lane: null,
          trackingNumber: s.trackingNumber,
          next: { kind: 'RETURN_TO_MERCHANT', merchantName: m.name },
          message: `Return shelf for ${m.name}`,
        };
      }
      if (next.kind !== 'SEND')
        throw new DomainError(
          'no_transfer',
          `${s.trackingNumber} has nowhere to go from here`,
          409,
        );
      await this.core.move(
        tx,
        s,
        'SORTED',
        { laneHubId: next.hubId },
        { ...ev, type: 'SORTED', note: `Lane ${next.hubCode}` },
      );
      return {
        lane: next.hubCode,
        trackingNumber: s.trackingNumber,
        next,
        message: `Lane ${next.hubCode} (${next.hubName})`,
      };
    });
  }

  /** Parcels on each lane, waiting for outbound. */
  async lanes(hubId: string) {
    const parcels = await this.prisma.shipment.groupBy({
      by: ['laneHubId'],
      where: { currentHubId: hubId, status: 'SORTED' },
      _count: true,
    });
    const hubs = new Map((await this.prisma.hub.findMany()).map((h) => [h.id, h]));
    return parcels
      .filter((p) => p.laneHubId)
      .map((p) => ({
        hubId: p.laneHubId,
        code: hubs.get(p.laneHubId!)?.code ?? '',
        name: hubs.get(p.laneHubId!)?.name ?? '',
        parcels: p._count,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  // ---------------------------------------------------------------- outbound team

  /**
   * Outbound team scans each parcel from its lane into the bag for its next place: this scan is
   * the handover from sorting to outbound. In a last mile hub, staff scan returns into the bag
   * for the sorting facility the same way.
   */
  async bagParcel(hubId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    const hub = await this.hub(hubId);
    assertTeam(user, hub, 'OUTBOUND');
    return this.prisma.tx(async (tx) => {
      const settings = await this.settings.all(tx);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      if (s.currentHubId !== hubId)
        throw new DomainError('bad_status', `${s.trackingNumber} is not in this building`, 409);
      if (s.runId)
        throw new DomainError('bad_status', `${s.trackingNumber} is loaded on a courier run`, 409);
      if (hub.isSorting && s.status === 'AT_INBOUND')
        throw new DomainError(
          'bad_status',
          `${s.trackingNumber} was not sorted yet. Hand it to the sorting team`,
          409,
        );
      const ready = hub.isSorting ? 'SORTED' : 'AT_HUB';
      const next = await this.core.nextStep(tx, {
        ...s,
        status: hub.isSorting ? 'AT_INBOUND' : 'AT_HUB',
      });
      if (s.status === 'AT_OUTBOUND' && s.bagId) {
        const current = await tx.bag.findUniqueOrThrow({ where: { id: s.bagId } });
        return {
          bag: current,
          trackingNumber: s.trackingNumber,
          next,
          message: `Already in bag ${current.code}`,
        };
      }
      if (s.status !== ready || next.kind !== 'SEND') {
        throw new DomainError(
          'bad_status',
          next.kind === 'DELIVER'
            ? `${s.trackingNumber} stays here for delivery`
            : `${s.trackingNumber} is not ready to be bagged`,
          409,
        );
      }
      let bag = await tx.bag.findFirst({
        where: { originHubId: hubId, destinationHubId: next.hubId, status: 'OPEN' },
        orderBy: { createdAt: 'asc' },
      });
      if (!bag)
        bag = await tx.bag.create({
          data: {
            code: await nextCode(tx, 'bag_seq', 'BG'),
            originHubId: hubId,
            destinationHubId: next.hubId,
          },
        });
      const warning =
        hub.isSorting && s.laneHubId && s.laneHubId !== next.hubId
          ? 'This parcel was on another lane. The system put it in the right bag'
          : undefined;
      await this.core.move(
        tx,
        s,
        'AT_OUTBOUND',
        { bagId: bag.id, laneHubId: null },
        {
          type: 'BAGGED_BY_OUTBOUND',
          hubId,
          userId: user.id,
          note: `Bag ${bag.code} to ${next.hubCode}`,
        },
      );
      const count = await tx.shipment.count({ where: { bagId: bag.id } });
      return {
        bag,
        count,
        trackingNumber: s.trackingNumber,
        next,
        warning,
        message: `Bag ${bag.code} for ${next.hubName}`,
      };
    });
  }

  async bags(hubId: string) {
    const bags = await this.prisma.bag.findMany({
      where: {
        OR: [
          { originHubId: hubId, status: { in: ['OPEN', 'SEALED'] } },
          { destinationHubId: hubId, status: { in: ['IN_TRANSIT', 'RECEIVED'] } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    const counts = await this.prisma.shipment.groupBy({
      by: ['bagId'],
      where: { bagId: { in: bags.map((b) => b.id) } },
      _count: true,
    });
    const byBag = new Map(counts.map((c) => [c.bagId, c._count]));
    return bags.map((b) => ({ ...b, parcels: byBag.get(b.id) ?? 0 }));
  }

  async bag(hubId: string, bagId: string) {
    const bag = await this.prisma.bag.findUnique({ where: { id: bagId } });
    if (!bag || (bag.originHubId !== hubId && bag.destinationHubId !== hubId))
      throw notFound('Bag');
    const parcels = await this.prisma.shipment.findMany({
      where: { bagId },
      select: { id: true, trackingNumber: true, status: true, customerName: true },
    });
    return { ...bag, parcels };
  }

  async removeFromBag(hubId: string, bagId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    const hub = await this.hub(hubId);
    assertTeam(user, hub, 'OUTBOUND');
    return this.prisma.tx(async (tx) => {
      const settings = await this.settings.all(tx);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      const bag = await tx.bag.findUnique({ where: { id: bagId } });
      if (!bag || bag.originHubId !== hubId) throw notFound('Bag');
      if (bag.status !== 'OPEN')
        throw new DomainError('bad_status', 'Only open bags can be changed', 409);
      if (s.bagId !== bagId)
        throw new DomainError('bad_status', `${s.trackingNumber} is not in this bag`, 409);
      await this.core.move(
        tx,
        s,
        hub.isSorting ? 'SORTED' : 'AT_HUB',
        { bagId: null, laneHubId: hub.isSorting ? bag.destinationHubId : null },
        { type: 'UNBAGGED', hubId, userId: user.id, note: `Out of bag ${bag.code}` },
      );
    });
  }

  async sealBag(hubId: string, bagId: string, user: SessionUser) {
    const hub = await this.hub(hubId);
    assertTeam(user, hub, 'OUTBOUND');
    return this.prisma.tx(async (tx) => {
      const bag = await tx.bag.findUnique({ where: { id: bagId } });
      if (!bag || bag.originHubId !== hubId) throw notFound('Bag');
      const parcels = await tx.shipment.count({ where: { bagId } });
      if (parcels === 0)
        throw new DomainError('invalid_input', 'An empty bag cannot be sealed', 422);
      const r = await tx.bag.updateMany({
        where: { id: bagId, status: 'OPEN' },
        data: { status: 'SEALED', sealedAt: new Date() },
      });
      if (r.count !== 1) throw new DomainError('bad_status', 'This bag is already sealed', 409);
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'BAG_SEALED',
          entityType: 'bag',
          entityId: bagId,
          after: { parcels },
        },
      });
    });
  }

  // ---------------------------------------------------------------- outbound team

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
    const hub = await this.hub(hubId);
    assertTeam(user, hub, 'OUTBOUND');
    if (d.destinationHubId === hubId)
      throw new DomainError('invalid_input', 'A trip must go to another place', 422);
    const dest = await this.prisma.hub.findUnique({ where: { id: d.destinationHubId } });
    if (!dest || !dest.active) throw new DomainError('invalid_input', 'Unknown destination', 422);
    if (d.backhaulOfId) {
      const came = await this.prisma.trip.findUnique({ where: { id: d.backhaulOfId } });
      if (!came || came.destinationHubId !== hubId || came.originHubId !== d.destinationHubId)
        throw new DomainError(
          'invalid_input',
          'A back haul goes back where its vehicle came from',
          422,
        );
      d.vehicle ||= came.vehicle;
      d.driverName ||= came.driverName;
    }
    return this.prisma.tx(async (tx) => {
      const trip = await tx.trip.create({
        data: {
          code: await nextCode(tx, 'trip_seq', 'TR'),
          originHubId: hubId,
          ...d,
          backhaulOfId: d.backhaulOfId ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'TRIP_CREATED',
          entityType: 'trip',
          entityId: trip.id,
        },
      });
      return trip;
    });
  }

  async loadBag(hubId: string, tripId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    const hub = await this.hub(hubId);
    assertTeam(user, hub, 'OUTBOUND');
    return this.prisma.tx(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: tripId } });
      if (!trip || trip.originHubId !== hubId) throw notFound('Trip');
      if (trip.status !== 'LOADING')
        throw new DomainError('bad_status', 'This trip already left', 409);
      const bag = await tx.bag.findUnique({ where: { code: normalizeCode(code) } });
      if (!bag || bag.originHubId !== hubId) throw notFound(`Bag ${normalizeCode(code)} here`);
      if (bag.status === 'OPEN')
        throw new DomainError('bad_status', `Bag ${bag.code} is still open. Seal it first`, 409);
      if (bag.status !== 'SEALED' || (bag.tripId && bag.tripId !== tripId))
        throw new DomainError('bad_status', `Bag ${bag.code} is already on another trip`, 409);
      if (bag.destinationHubId !== trip.destinationHubId)
        throw new DomainError(
          'wrong_hub',
          `Bag ${bag.code} is for another place. Do not load it on this trip`,
          409,
        );
      await tx.bag.update({ where: { id: bag.id }, data: { tripId } });
      return { bag: bag.code, message: `Bag ${bag.code} loaded` };
    });
  }

  async unloadBag(hubId: string, tripId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    const hub = await this.hub(hubId);
    assertTeam(user, hub, 'OUTBOUND');
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.originHubId !== hubId) throw notFound('Trip');
    const r = await this.prisma.bag.updateMany({
      where: { code: normalizeCode(code), tripId },
      data: { tripId: null },
    });
    if (r.count !== 1 || trip.status !== 'LOADING')
      throw new DomainError('bad_status', 'That bag cannot be taken off this trip', 409);
  }

  /** The truck leaves: every bag and every parcel in it goes in transit. */
  async depart(hubId: string, tripId: string, user: SessionUser) {
    const hub = await this.hub(hubId);
    assertTeam(user, hub, 'OUTBOUND');
    return this.prisma.tx(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: tripId }, include: { bags: true } });
      if (!trip || trip.originHubId !== hubId) throw notFound('Trip');
      if (trip.status !== 'LOADING')
        throw new DomainError('bad_status', 'This trip already left', 409);
      if (trip.bags.length === 0)
        throw new DomainError('invalid_input', 'Load at least one bag first', 422);
      const dest = await tx.hub.findUniqueOrThrow({ where: { id: trip.destinationHubId } });
      const parcels = await tx.shipment.findMany({
        where: { bagId: { in: trip.bags.map((b) => b.id) } },
      });
      for (const s of parcels) {
        await this.core.move(
          tx,
          s,
          'IN_TRANSIT',
          { currentHubId: null },
          { type: 'DEPARTED', hubId, userId: user.id, note: `Trip ${trip.code} to ${dest.code}` },
        );
      }
      await tx.bag.updateMany({ where: { tripId }, data: { status: 'IN_TRANSIT' } });
      await tx.pallet.updateMany({ where: { tripId }, data: { status: 'IN_TRANSIT' } });
      await tx.trip.update({
        where: { id: tripId },
        data: { status: 'IN_TRANSIT', departedAt: new Date() },
      });
      return { bags: trip.bags.length, parcels: parcels.length };
    });
  }

  /** Close a trip that arrived with bags missing. Missing parcels stay in transit for follow up. */
  async closeTrip(hubId: string, tripId: string, user: SessionUser) {
    const hub = await this.hub(hubId);
    assertTeam(user, hub, 'INBOUND');
    return this.prisma.tx(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: tripId }, include: { bags: true } });
      if (!trip || trip.destinationHubId !== hubId) throw notFound('Trip');
      if (trip.status !== 'IN_TRANSIT')
        throw new DomainError('bad_status', 'This trip is not on its way', 409);
      const missing = trip.bags.filter((b) => b.status === 'IN_TRANSIT').map((b) => b.code);
      await tx.trip.update({
        where: { id: tripId },
        data: { status: 'ARRIVED', arrivedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'TRIP_CLOSED',
          entityType: 'trip',
          entityId: tripId,
          after: { missing },
        },
      });
      return { missing };
    });
  }

  // ---------------------------------------------------------------- courier runs

  async couriers(hubId: string) {
    return this.prisma.user.findMany({
      where: { hubId, role: 'courier', isActive: true },
      select: { id: true, name: true, phone: true },
      orderBy: { name: 'asc' },
    });
  }

  private async assertCourier(courierId: string, hubId: string) {
    const courier = await this.prisma.user.findUnique({ where: { id: courierId } });
    if (!courier || courier.role !== 'courier' || !courier.isActive || courier.hubId !== hubId) {
      throw new DomainError('invalid_input', 'Pick an active courier from this place', 422);
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
      include: {
        items: {
          include: {
            shipment: {
              select: {
                trackingNumber: true,
                customerName: true,
                address: true,
                codAmount: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!run || run.hubId !== hubId) throw notFound('Run');
    return run;
  }

  async createRun(hubId: string, body: unknown, user: SessionUser) {
    const { courierId } = parse(RunInput, body);
    await this.assertCourier(courierId, hubId);
    const standing = await courierStanding(this.prisma, await this.settings.all(), courierId);
    if (standing.frozen) {
      throw new DomainError(
        'courier_frozen',
        `This courier's wallet is negative (${formatEgp(standing.wallet)}). They must recharge, or finance can let them work with a reason`,
        409,
      );
    }
    return this.prisma.tx(async (tx) => {
      const active = await tx.run.findFirst({
        where: { courierId, status: { in: ['LOADING', 'OUT'] } },
      });
      if (active)
        throw new DomainError('duplicate', `This courier still has run ${active.code} open`, 409);
      const run = await tx.run.create({
        data: { code: await nextCode(tx, 'run_seq', 'RN'), hubId, courierId, date: todayInCairo() },
      });
      await tx.auditLog.create({
        data: { actorUserId: user.id, action: 'RUN_CREATED', entityType: 'run', entityId: run.id },
      });
      return run;
    });
  }

  /** Returns customers asked to send back, waiting for a courier from this hub to collect them. */
  customerReturns(hubId: string) {
    return this.prisma.shipment.findMany({
      where: { kind: 'CUSTOMER_RETURN', status: 'CREATED', destinationHubId: hubId },
      select: {
        id: true,
        trackingNumber: true,
        customerName: true,
        customerPhone: true,
        address: true,
        governorateCode: true,
        attempts: true,
        runId: true,
        description: true,
        createdAt: true,
        merchant: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 300,
    });
  }

  async addToRun(hubId: string, runId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    return this.prisma.tx(async (tx) => {
      const settings = await this.settings.all(tx);
      const run = await tx.run.findUnique({ where: { id: runId } });
      if (!run || run.hubId !== hubId) throw notFound('Run');
      if (run.status !== 'LOADING')
        throw new DomainError('bad_status', 'This run already left', 409);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      if (s.kind === 'CUSTOMER_RETURN' && s.status === 'CREATED') {
        // Nothing to put on the shelf: the courier goes to the customer to collect it.
        if (s.destinationHubId !== hubId)
          throw new DomainError(
            'wrong_hub',
            `${s.trackingNumber} is collected by another hub`,
            409,
          );
        if (s.runId)
          throw new DomainError('bad_status', `${s.trackingNumber} is already on a run`, 409);
        await tx.runItem.create({ data: { runId, shipmentId: s.id, direction: 'FORWARD' } });
        await tx.shipment.update({ where: { id: s.id }, data: { runId } });
        await tx.shipmentEvent.create({
          data: {
            shipmentId: s.id,
            type: 'LOADED_ON_RUN',
            fromStatus: 'CREATED',
            toStatus: 'CREATED',
            hubId,
            userId: user.id,
            note: `Run ${run.code}: collect from the customer`,
          },
        });
        return {
          trackingNumber: s.trackingNumber,
          direction: 'FORWARD',
          message: 'Added: collect the return from the customer',
        };
      }
      if (s.status !== 'AT_HUB' || s.currentHubId !== hubId)
        throw new DomainError('bad_status', `${s.trackingNumber} is not ready here`, 409);
      if (s.runId)
        throw new DomainError('bad_status', `${s.trackingNumber} is already on a run`, 409);
      if (s.bagId)
        throw new DomainError(
          'bad_status',
          `${s.trackingNumber} is in a bag. Take it out first`,
          409,
        );
      if (s.direction === 'FORWARD' && s.deliverOn && s.deliverOn > todayInCairo())
        throw new DomainError(
          'postponed',
          `The customer asked for delivery on ${s.deliverOn}. Keep it on the shelf until then`,
          409,
        );
      const next = await this.core.nextStep(tx, s);
      if (next.kind === 'SEND')
        throw new DomainError(
          'wrong_hub',
          `${s.trackingNumber} is not for here. Send it to ${next.hubName}`,
          409,
        );
      await tx.runItem.create({ data: { runId, shipmentId: s.id, direction: s.direction } });
      await this.core.move(
        tx,
        s,
        'AT_HUB',
        { runId },
        { type: 'LOADED_ON_RUN', hubId, userId: user.id, note: `Run ${run.code}` },
      );
      return {
        trackingNumber: s.trackingNumber,
        direction: s.direction,
        message: s.direction === 'RETURN' ? 'Added as a return to merchant' : 'Added for delivery',
      };
    });
  }

  async removeFromRun(hubId: string, runId: string, body: unknown, user: SessionUser) {
    const { code } = parse(Code, body);
    return this.prisma.tx(async (tx) => {
      const settings = await this.settings.all(tx);
      const run = await tx.run.findUnique({ where: { id: runId } });
      if (!run || run.hubId !== hubId) throw notFound('Run');
      if (run.status !== 'LOADING')
        throw new DomainError('bad_status', 'This run already left', 409);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      if (s.runId !== runId)
        throw new DomainError('bad_status', `${s.trackingNumber} is not on this run`, 409);
      await tx.runItem.delete({ where: { runId_shipmentId: { runId, shipmentId: s.id } } });
      if (s.status === 'CREATED') {
        await tx.shipment.update({ where: { id: s.id }, data: { runId: null } });
        await tx.shipmentEvent.create({
          data: {
            shipmentId: s.id,
            type: 'REMOVED_FROM_RUN',
            fromStatus: 'CREATED',
            toStatus: 'CREATED',
            hubId,
            userId: user.id,
            note: `Run ${run.code}`,
          },
        });
        return;
      }
      await this.core.move(
        tx,
        s,
        'AT_HUB',
        { runId: null },
        { type: 'REMOVED_FROM_RUN', hubId, userId: user.id, note: `Run ${run.code}` },
      );
    });
  }

  async startRun(hubId: string, runId: string, user: SessionUser) {
    return this.prisma.tx(async (tx) => {
      const run = await tx.run.findUnique({ where: { id: runId } });
      if (!run || run.hubId !== hubId) throw notFound('Run');
      if (run.status !== 'LOADING')
        throw new DomainError('bad_status', 'This run already left', 409);
      const parcels = await tx.shipment.findMany({ where: { runId } });
      if (parcels.length === 0)
        throw new DomainError('invalid_input', 'Add parcels to the run first', 422);
      for (const s of parcels) {
        await this.core.move(
          tx,
          s,
          'OUT_FOR_DELIVERY',
          { currentHubId: null },
          {
            type: s.direction === 'RETURN' ? 'OUT_FOR_RETURN' : 'OUT_FOR_DELIVERY',
            hubId,
            userId: user.id,
            note: `Run ${run.code}`,
          },
        );
      }
      await tx.run.update({ where: { id: runId }, data: { status: 'OUT', startedAt: new Date() } });
      // Each receiver gets the code they will give the courier at the door.
      let codes = 0;
      if ((await this.settings.all(tx))['delivery.code_required'] === 'ON') {
        for (const s of parcels)
          if (s.kind !== 'CUSTOMER_RETURN' && (await sendDeliveryCode(tx, s.id))) codes++;
      }
      return { parcels: parcels.length, codes };
    });
  }

  /**
   * End of day. Every parcel must be delivered, returned, or scanned back in, and the courier
   * hands over the cash. A difference is recorded against the courier.
   */
  async closeRun(hubId: string, runId: string, body: unknown, user: SessionUser) {
    const { cashReceived } = parse(CloseRunInput, body);
    return this.prisma.tx(async (tx) => {
      const run = await tx.run.findUnique({
        where: { id: runId },
        include: { items: { include: { shipment: { select: { trackingNumber: true } } } } },
      });
      if (!run || run.hubId !== hubId) throw notFound('Run');
      if (run.status !== 'OUT')
        throw new DomainError('bad_status', 'Only a run that is out can be closed', 409);
      const notBack = run.items.filter(
        (i) => i.result === 'PENDING' || (i.result === 'FAILED' && !i.backAtHub),
      );
      if (notBack.length) {
        throw new DomainError(
          'parcels_missing',
          `Scan these parcels back in first: ${notBack.map((i) => i.shipment.trackingNumber).join(', ')}`,
          409,
        );
      }
      const expected = run.items.reduce((sum, i) => sum + i.codCollected, 0);
      // Cash the courier already paid in through Fawry for this run is not expected at the hub.
      const paid = await tx.payIn.aggregate({
        where: { runId, purpose: 'CASH', status: 'CONFIRMED' },
        _sum: { amount: true },
      });
      const paidIn = paid._sum.amount ?? 0;
      const due = Math.max(0, expected - paidIn);
      await tx.run.update({
        where: { id: runId },
        data: {
          status: 'CLOSED',
          cashExpected: expected,
          cashReceived,
          closedAt: new Date(),
          closedById: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'RUN_CLOSED',
          entityType: 'run',
          entityId: runId,
          after: { expected, paidIn, cashReceived },
        },
      });
      const money = await postRunClosed(
        tx,
        await this.settings.all(tx),
        run,
        due,
        cashReceived,
        user.id,
      );
      return {
        expected,
        paidIn,
        due,
        received: cashReceived,
        difference: cashReceived - due,
        ...money,
      };
    });
  }
}
