import { Injectable } from '@nestjs/common';
import { FAIL_REASON_CODES, FAIL_REASONS } from '@shiplynow/shared/parcels';
import { makeTrackingNumber, returnFee } from '@shiplynow/shared/parcels';
import { nextCode, nextNumber } from '../common/codes';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth';
import { DomainError, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { ShipmentsCore, todayInCairo } from '../core/shipments.core';
import { postDelivered, postFlexPaid, postReturned } from '../finance/postings';
import { openAlert } from '../agents/alerts';
import { checkDeliveryCode, sendDeliveryCode } from '../common/delivery-code';
import { queueParcelMessage } from '../common/messages';

const Code = z.object({ code: z.string().trim().min(3).max(40) });
const PHOTO = z.object({
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  dataBase64: z.string().min(8),
});
const Where = {
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
};
const DeliverInput = z.object({
  codCollected: z.number().int().min(0),
  recipient: z.string().trim().max(120).default(''),
  /** Exchange parcels: the customer handed back the old item. */
  exchangeCollected: z.boolean().default(true),
  /** The code from the receiver's SMS. */
  code: z.string().trim().max(8).optional(),
  photo: PHOTO.nullish(),
  ...Where,
});
const FailInput = z.object({
  reason: z.enum(FAIL_REASON_CODES as [string, ...string[]]),
  note: z.string().trim().max(300).default(''),
  /** POSTPONED: the day the customer asked for. */
  deliverOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** REFUSED on a FlexShip merchant: did the customer pay the shipping? */
  flexPaid: z.boolean().default(false),
  ...Where,
});
const CollectReturnInput = z.object({
  photo: PHOTO,
  note: z.string().trim().max(300).default(''),
  ...Where,
});
const PingInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).optional(),
});
const VehicleProblemInput = z.object({
  reason: z.enum(['BREAKDOWN', 'VEHICLE_FULL']),
  note: z.string().trim().max(300).default(''),
});

function photoBytes(p: z.infer<typeof PHOTO>) {
  const clean = p.dataBase64.includes(',')
    ? p.dataBase64.slice(p.dataBase64.indexOf(',') + 1)
    : p.dataBase64;
  const buf = Buffer.from(clean, 'base64');
  if (buf.length === 0 || buf.length > 3 * 1024 * 1024)
    throw new DomainError('invalid_input', 'The photo must be under 3 MB', 422);
  return new Uint8Array(buf);
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class CourierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly core: ShipmentsCore,
  ) {}

  // ---------------------------------------------------------------- pickups

  async pickups(user: SessionUser) {
    const pickups = await this.prisma.pickup.findMany({
      where: { courierId: user.id, status: { in: ['ASSIGNED', 'COLLECTED'] } },
      include: { merchant: { select: { name: true, contactPhone: true, pickupAddress: true } } },
      orderBy: { date: 'asc' },
    });
    const collected = await this.prisma.shipment.groupBy({
      by: ['pickupId'],
      where: { pickupId: { in: pickups.map((p) => p.id) } },
      _count: true,
    });
    const byPickup = new Map(collected.map((c) => [c.pickupId, c._count]));
    return pickups.map((p) => ({ ...p, collected: byPickup.get(p.id) ?? 0 }));
  }

  /** At the merchant: scan each parcel label as it goes into the vehicle. */
  async collect(user: SessionUser, pickupId: string, body: unknown) {
    const { code } = parse(Code, body);
    return this.prisma.tx(async (tx) => {
      const pickup = await tx.pickup.findUnique({ where: { id: pickupId } });
      if (!pickup || pickup.courierId !== user.id) throw notFound('Pickup');
      if (pickup.status !== 'ASSIGNED')
        throw new DomainError('bad_status', 'This pickup is already finished', 409);
      const settings = await this.settings.all(tx);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      if (s.merchantId !== pickup.merchantId)
        throw new DomainError(
          'wrong_merchant',
          `${s.trackingNumber} belongs to another merchant`,
          409,
        );
      if (s.kind === 'CUSTOMER_RETURN')
        throw new DomainError(
          'wrong_kind',
          `${s.trackingNumber} is a return to collect from a customer, not from the merchant`,
          409,
        );
      if (s.status === 'PICKED_UP' && s.pickupId === pickupId)
        return { trackingNumber: s.trackingNumber, message: 'Already collected' };
      if (s.status !== 'CREATED')
        throw new DomainError(
          'bad_status',
          `${s.trackingNumber} was already picked up or cancelled`,
          409,
        );
      const now = new Date();
      const promised = await this.core.promiseFor(tx, s, now, settings);
      await this.core.move(
        tx,
        s,
        'PICKED_UP',
        { pickupId, enteredAt: now, promisedDate: promised },
        { type: 'PICKED_UP', userId: user.id, hubId: pickup.hubId, note: `Pickup ${pickup.code}` },
      );
      return { trackingNumber: s.trackingNumber, message: `Collected. Promised for ${promised}` };
    });
  }

  async finishPickup(user: SessionUser, pickupId: string) {
    const collected = await this.prisma.shipment.count({ where: { pickupId } });
    if (collected === 0)
      throw new DomainError(
        'invalid_input',
        'Scan at least one parcel, or ask the hub to cancel this pickup',
        422,
      );
    const r = await this.prisma.pickup.updateMany({
      where: { id: pickupId, courierId: user.id, status: 'ASSIGNED' },
      data: { status: 'COLLECTED', collectedAt: new Date() },
    });
    if (r.count !== 1) throw new DomainError('bad_status', 'This pickup is already finished', 409);
    return { collected };
  }

  // ---------------------------------------------------------------- delivery run

  async currentRun(user: SessionUser) {
    const run = await this.prisma.run.findFirst({
      where: { courierId: user.id, status: { in: ['LOADING', 'OUT'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          omit: { photo: true },
          include: {
            shipment: {
              select: {
                id: true,
                trackingNumber: true,
                customerName: true,
                customerPhone: true,
                address: true,
                governorateCode: true,
                codAmount: true,
                allowOpen: true,
                notes: true,
                description: true,
                attempts: true,
                status: true,
                kind: true,
                customerNote: true,
                deliverOn: true,
                shippingFee: true,
                merchant: {
                  select: { name: true, contactPhone: true, pickupAddress: true, flexShip: true },
                },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!run) return null;
    const settings = await this.settings.all();
    const coded = await this.prisma.otpCode.findMany({
      where: { purpose: { in: run.items.map((i) => `DELIVERY:${i.shipmentId}`) } },
      select: { purpose: true },
      distinct: ['purpose'],
    });
    const needsCode = new Set(coded.map((c) => c.purpose.slice('DELIVERY:'.length)));
    return {
      ...run,
      codeRequired: settings['delivery.code_required'] === 'ON',
      items: run.items.map((i) => ({ ...i, needsCode: needsCode.has(i.shipmentId) })),
      cashCollected: run.items.reduce((sum, i) => sum + i.codCollected, 0),
    };
  }

  private async item(tx: Tx, user: SessionUser, itemId: string) {
    const item = await tx.runItem.findUnique({
      where: { id: itemId },
      omit: { photo: true },
      include: { run: true, shipment: true },
    });
    if (!item || item.run.courierId !== user.id) throw notFound('Stop');
    if (item.run.status !== 'OUT')
      throw new DomainError('bad_status', 'This run has not started or is closed', 409);
    if (item.result !== 'PENDING')
      throw new DomainError('bad_status', 'This stop is already done', 409);
    return item;
  }

  /** Handed over. Forward parcels must collect the full COD amount; no partial payments. */
  async deliver(user: SessionUser, itemId: string, body: unknown) {
    const d = parse(DeliverInput, body);
    return this.prisma.tx(async (tx) => {
      const item = await this.item(tx, user, itemId);
      const s = item.shipment;
      const now = new Date();
      if (s.kind === 'CUSTOMER_RETURN' && item.direction === 'FORWARD')
        throw new DomainError(
          'wrong_kind',
          'This stop is a return to collect. Use Collect return and take a photo',
          409,
        );
      const codeChecked = await checkDeliveryCode(tx, s.id, d.code);
      const proof = {
        lat: d.lat ?? null,
        lng: d.lng ?? null,
        codeChecked,
        ...(d.photo ? { photo: photoBytes(d.photo), photoMime: d.photo.mime } : {}),
      };
      if (item.direction === 'RETURN') {
        if (d.codCollected !== 0)
          throw new DomainError(
            'invalid_input',
            'Do not collect cash when returning a parcel to the merchant',
            422,
          );
        const settings = await this.settings.all(tx);
        // A return the customer sent back costs the merchant the shipping only.
        const fee =
          s.kind === 'CUSTOMER_RETURN'
            ? 0
            : returnFee(s.shippingFee, {
                codFeeBp: settings['fees.cod_fee_bp'],
                codFreeAmount: settings['fees.cod_free_amount'],
                returnFeeBp: settings['fees.return_fee_bp'],
              });
        await tx.runItem.update({
          where: { id: item.id },
          data: { result: 'RETURNED', recipient: d.recipient, resolvedAt: now, ...proof },
        });
        await this.core.move(
          tx,
          s,
          'RETURNED',
          { runId: null, returnFee: fee, closedAt: now, codFee: 0 },
          {
            type: 'RETURNED',
            userId: user.id,
            hubId: item.run.hubId,
            note: d.recipient ? `Received by ${d.recipient}` : '',
          },
        );
        await postReturned(tx, settings, { ...s, returnFee: fee, codFee: 0 }, user.id, user.id);
        return { message: 'Returned to merchant' };
      }
      if (d.codCollected !== s.codAmount) {
        throw new DomainError(
          'wrong_amount',
          `Collect exactly ${(s.codAmount / 100).toFixed(2)} EGP. If the customer cannot pay it all, mark the attempt as failed`,
          422,
        );
      }
      await tx.runItem.update({
        where: { id: item.id },
        data: {
          result: 'DELIVERED',
          codCollected: d.codCollected,
          recipient: d.recipient,
          resolvedAt: now,
          ...proof,
        },
      });
      await this.core.move(
        tx,
        s,
        'DELIVERED',
        { runId: null, codCollected: d.codCollected, deliveredAt: now, closedAt: now },
        {
          type: 'DELIVERED',
          userId: user.id,
          hubId: item.run.hubId,
          note: d.recipient ? `Received by ${d.recipient}` : '',
        },
      );
      await postDelivered(
        tx,
        await this.settings.all(tx),
        { ...s, codCollected: d.codCollected },
        user.id,
        user.id,
      );
      if (s.kind === 'EXCHANGE' && d.exchangeCollected) {
        // The old item rides back on this run as a return to the merchant; the hub scans it in.
        const settings = await this.settings.all(tx);
        const back = await tx.shipment.create({
          data: {
            trackingNumber: makeTrackingNumber(
              settings['tracking.prefix'],
              await nextNumber(tx, 'tracking_seq'),
            ),
            merchantId: s.merchantId,
            merchantRef: s.merchantRef,
            customerName: s.customerName,
            customerPhone: s.customerPhone,
            address: s.address,
            governorateCode: s.governorateCode,
            areaId: s.areaId,
            size: s.size,
            description: `Exchange: old item from ${s.trackingNumber}`,
            status: 'ATTEMPT_FAILED',
            direction: 'RETURN',
            originHubId: s.originHubId,
            destinationHubId: s.destinationHubId,
            runId: item.runId,
            shippingFee: 0,
            codFee: 0,
            kind: 'EXCHANGE_RETURN',
            linkedShipmentId: s.id,
            enteredAt: now,
          },
        });
        await tx.shipmentEvent.create({
          data: {
            shipmentId: back.id,
            type: 'EXCHANGE_COLLECTED',
            toStatus: 'ATTEMPT_FAILED',
            hubId: item.run.hubId,
            userId: user.id,
            note: `Collected from the customer when delivering ${s.trackingNumber}`,
          },
        });
        await tx.runItem.create({
          data: {
            runId: item.runId,
            shipmentId: back.id,
            direction: 'RETURN',
            result: 'FAILED',
            failReason: 'EXCHANGE',
            resolvedAt: now,
          },
        });
        await tx.shipment.update({ where: { id: s.id }, data: { linkedShipmentId: back.id } });
        return {
          message: 'Delivered. Bring the old item back to the hub',
          exchangeReturn: back.trackingNumber,
        };
      }
      return { message: 'Delivered' };
    });
  }

  async fail(user: SessionUser, itemId: string, body: unknown) {
    const d = parse(FailInput, body);
    return this.prisma.tx(async (tx) => {
      const item = await this.item(tx, user, itemId);
      const s = item.shipment;
      const settings = await this.settings.all(tx);
      const label = FAIL_REASONS[d.reason as keyof typeof FAIL_REASONS].label;
      const now = new Date();
      const where = { lat: d.lat ?? null, lng: d.lng ?? null };
      const note = [label, d.note].filter(Boolean).join('. ');

      if (s.kind === 'CUSTOMER_RETURN' && item.direction === 'FORWARD') {
        // Nothing was collected, so nothing comes back to the hub. It waits for another try.
        const attempts = s.attempts + 1;
        await tx.runItem.update({
          where: { id: item.id },
          data: {
            result: 'FAILED',
            failReason: d.reason,
            resolvedAt: now,
            backAtHub: true,
            ...where,
          },
        });
        await this.core.move(
          tx,
          s,
          'CREATED',
          { runId: null, attempts, lastFailReason: d.reason },
          { type: 'RETURN_NOT_COLLECTED', userId: user.id, hubId: item.run.hubId, note },
        );
        if (attempts >= settings['delivery.max_attempts']) {
          await this.core.move(
            tx,
            { ...s, status: 'CREATED' },
            'CANCELLED',
            { closedAt: now },
            {
              type: 'CANCELLED',
              userId: user.id,
              hubId: item.run.hubId,
              note: `${attempts} visits without collecting the return`,
            },
          );
          return { message: 'Recorded. The return request is closed after too many visits' };
        }
        return { message: 'Recorded. The return will be tried again' };
      }

      let deliverOn: string | undefined;
      if (d.reason === 'POSTPONED' && item.direction === 'FORWARD') {
        const today = todayInCairo();
        if (!d.deliverOn || d.deliverOn <= today)
          throw new DomainError(
            'invalid_input',
            'Pick the day the customer asked for, from tomorrow on',
            422,
          );
        if (d.deliverOn > addDays(today, 14))
          throw new DomainError(
            'invalid_input',
            'A delivery can be postponed by two weeks at most',
            422,
          );
        deliverOn = d.deliverOn;
      }
      let flexPaid = 0;
      if (d.flexPaid) {
        const m = await tx.merchant.findUniqueOrThrow({
          where: { id: s.merchantId },
          select: { flexShip: true },
        });
        if (d.reason !== 'REFUSED' || item.direction !== 'FORWARD' || !m.flexShip)
          throw new DomainError(
            'invalid_input',
            'Shipping is only collected from a customer who refuses a FlexShip parcel',
            422,
          );
        flexPaid = s.shippingFee;
      }

      await tx.runItem.update({
        where: { id: item.id },
        data: {
          result: 'FAILED',
          failReason: d.reason,
          resolvedAt: now,
          codCollected: flexPaid,
          flexPaid,
          ...where,
        },
      });
      // A postponement the customer asked for does not count against the parcel's attempts.
      const counts = item.direction === 'FORWARD' && d.reason !== 'POSTPONED';
      await this.core.move(
        tx,
        s,
        'ATTEMPT_FAILED',
        {
          attempts: counts ? s.attempts + 1 : s.attempts,
          lastFailReason: d.reason,
          ...(deliverOn ? { deliverOn } : {}),
        },
        {
          type: item.direction === 'FORWARD' ? 'ATTEMPT_FAILED' : 'RETURN_ATTEMPT_FAILED',
          userId: user.id,
          hubId: item.run.hubId,
          note: [
            note,
            deliverOn ? `New day ${deliverOn}` : '',
            flexPaid ? 'Customer paid the shipping (FlexShip)' : '',
          ]
            .filter(Boolean)
            .join('. '),
        },
      );
      if (deliverOn) await queueParcelMessage(tx, s.id, 'POSTPONED', { date: deliverOn });
      if (flexPaid) await postFlexPaid(tx, s, item.id, flexPaid, user.id, user.id);
      return {
        message: flexPaid
          ? 'Recorded. Keep the shipping cash with the run cash and bring the parcel back'
          : 'Attempt recorded. Bring the parcel back to the hub',
      };
    });
  }

  /** A return the customer hands over: the courier photographs it in front of them. */
  async collectReturn(user: SessionUser, itemId: string, body: unknown) {
    const d = parse(CollectReturnInput, body);
    const photo = photoBytes(d.photo);
    return this.prisma.tx(async (tx) => {
      const item = await this.item(tx, user, itemId);
      const s = item.shipment;
      if (s.kind !== 'CUSTOMER_RETURN' || item.direction !== 'FORWARD')
        throw new DomainError('wrong_kind', 'This stop is not a return to collect', 409);
      const now = new Date();
      // From here on it travels like any return: back through the hub to the merchant.
      await tx.runItem.update({
        where: { id: item.id },
        data: {
          result: 'FAILED',
          failReason: 'CUSTOMER_RETURN',
          direction: 'RETURN',
          resolvedAt: now,
          photo,
          photoMime: d.photo.mime,
          lat: d.lat ?? null,
          lng: d.lng ?? null,
        },
      });
      await this.core.move(
        tx,
        s,
        'ATTEMPT_FAILED',
        { direction: 'RETURN', enteredAt: now },
        {
          type: 'RETURN_COLLECTED',
          userId: user.id,
          hubId: item.run.hubId,
          note: d.note || 'Collected from the customer with a photo',
        },
      );
      return { message: 'Return collected. Bring it to the hub' };
    });
  }

  /** Sends the receiver a new code when the first SMS did not arrive. */
  async resendCode(user: SessionUser, itemId: string) {
    return this.prisma.tx(async (tx) => {
      const item = await this.item(tx, user, itemId);
      if (!(await sendDeliveryCode(tx, item.shipmentId)))
        throw new DomainError(
          'rate_limited',
          'Three codes were already sent for this parcel today',
          429,
        );
      return { message: 'A new code is on its way to the receiver' };
    });
  }

  // ---------------------------------------------------------------- location and problems

  async config() {
    const s = await this.settings.all();
    return {
      pingSeconds: s['courier.ping_seconds'],
      codeRequired: s['delivery.code_required'] === 'ON',
    };
  }

  async ping(user: SessionUser, body: unknown) {
    const d = parse(PingInput, body);
    const last = await this.prisma.courierPing.findFirst({
      where: { userId: user.id },
      orderBy: { at: 'desc' },
      select: { at: true },
    });
    if (last && Date.now() - last.at.getTime() < 15_000) return { ok: true, skipped: true };
    await this.prisma.courierPing.create({
      data: { userId: user.id, lat: d.lat, lng: d.lng, accuracy: d.accuracy ?? null },
    });
    return { ok: true };
  }

  /** Broken down or full: the agent is asked for a vehicle and operations see an alert. */
  async vehicleProblem(user: SessionUser, body: unknown) {
    const d = parse(VehicleProblemInput, body);
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { name: true, agentId: true, hubId: true },
    });
    const run = await this.prisma.run.findFirst({
      where: { courierId: user.id, status: { in: ['LOADING', 'OUT'] } },
      select: { hubId: true, code: true },
    });
    const hubId = run?.hubId ?? me.hubId ?? null;
    const what = d.reason === 'BREAKDOWN' ? 'vehicle broke down' : 'vehicle is full';
    return this.prisma.tx(async (tx) => {
      let code = '';
      if (me.agentId) {
        const r = await tx.vehicleRequest.create({
          data: {
            code: await nextCode(tx, 'pickup_seq', 'VR'),
            agentId: me.agentId,
            reason: d.reason,
            hubId,
            date: todayInCairo(),
            price: 0,
            notes: [`${me.name}: ${what}`, d.note].filter(Boolean).join('. '),
            requestedById: user.id,
          },
        });
        code = r.code;
        await openAlert(tx, {
          kind: 'VEHICLE_REQUESTED',
          entity: 'vehicle_request',
          entityId: r.id,
          agentId: me.agentId,
          severity: 'high',
          message: `${me.name}'s ${what}. Send a vehicle (${r.code})`,
        });
      }
      await openAlert(tx, {
        kind: 'COURIER_VEHICLE_PROBLEM',
        entity: 'user',
        entityId: user.id,
        hubId,
        severity: 'high',
        message: `${me.name}'s ${what}${run ? ` on run ${run.code}` : ''}${d.note ? `: ${d.note}` : ''}`,
      });
      return {
        message: me.agentId
          ? `Your agent was asked for a vehicle (${code})`
          : 'Operations were told',
      };
    });
  }
}
