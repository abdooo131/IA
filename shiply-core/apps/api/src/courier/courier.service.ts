import { Injectable } from '@nestjs/common';
import { FAIL_REASON_CODES, FAIL_REASONS } from '@shiply/shared';
import { returnFee } from '@shiply/shared';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth';
import { DomainError, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { ShipmentsCore } from '../core/shipments.core';
import { postDelivered, postReturned } from '../finance/postings';

const Code = z.object({ code: z.string().trim().min(3).max(40) });
const DeliverInput = z.object({
  codCollected: z.number().int().min(0),
  recipient: z.string().trim().max(120).default(''),
});
const FailInput = z.object({
  reason: z.enum(FAIL_REASON_CODES as [string, ...string[]]),
  note: z.string().trim().max(300).default(''),
});

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
      include: { merchant: { select: { name: true, phone: true, pickupAddress: true } } },
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
      if (pickup.status !== 'ASSIGNED') throw new DomainError('bad_status', 'This pickup is already finished', 409);
      const settings = await this.settings.all(tx);
      const s = await this.core.findByCode(tx, code, settings['tracking.prefix']);
      if (s.merchantId !== pickup.merchantId) throw new DomainError('wrong_merchant', `${s.trackingNumber} belongs to another merchant`, 409);
      if (s.status === 'PICKED_UP' && s.pickupId === pickupId) return { trackingNumber: s.trackingNumber, message: 'Already collected' };
      if (s.status !== 'CREATED') throw new DomainError('bad_status', `${s.trackingNumber} was already picked up or cancelled`, 409);
      const now = new Date();
      const promised = await this.core.promiseFor(tx, s, now, settings);
      await this.core.move(tx, s, 'PICKED_UP', { pickupId, enteredAt: now, promisedDate: promised }, { type: 'PICKED_UP', userId: user.id, hubId: pickup.hubId, note: `Pickup ${pickup.code}` });
      return { trackingNumber: s.trackingNumber, message: `Collected. Promised for ${promised}` };
    });
  }

  async finishPickup(user: SessionUser, pickupId: string) {
    const collected = await this.prisma.shipment.count({ where: { pickupId } });
    if (collected === 0) throw new DomainError('invalid_input', 'Scan at least one parcel, or ask the hub to cancel this pickup', 422);
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
          include: {
            shipment: {
              select: {
                id: true, trackingNumber: true, customerName: true, customerPhone: true, address: true,
                governorateCode: true, codAmount: true, allowOpen: true, notes: true, description: true,
                attempts: true, status: true, merchant: { select: { name: true, phone: true, pickupAddress: true } },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!run) return null;
    return { ...run, cashCollected: run.items.reduce((sum, i) => sum + i.codCollected, 0) };
  }

  private async item(tx: Tx, user: SessionUser, itemId: string) {
    const item = await tx.runItem.findUnique({ where: { id: itemId }, include: { run: true, shipment: true } });
    if (!item || item.run.courierId !== user.id) throw notFound('Stop');
    if (item.run.status !== 'OUT') throw new DomainError('bad_status', 'This run has not started or is closed', 409);
    if (item.result !== 'PENDING') throw new DomainError('bad_status', 'This stop is already done', 409);
    return item;
  }

  /** Handed over. Forward parcels must collect the full COD amount; no partial payments. */
  async deliver(user: SessionUser, itemId: string, body: unknown) {
    const d = parse(DeliverInput, body);
    return this.prisma.tx(async (tx) => {
      const item = await this.item(tx, user, itemId);
      const s = item.shipment;
      const now = new Date();
      if (item.direction === 'RETURN') {
        if (d.codCollected !== 0) throw new DomainError('invalid_input', 'Do not collect cash when returning a parcel to the merchant', 422);
        const settings = await this.settings.all(tx);
        const fee = returnFee(s.shippingFee, {
          codFeeBp: settings['fees.cod_fee_bp'],
          codFreeAmount: settings['fees.cod_free_amount'],
          returnFeeBp: settings['fees.return_fee_bp'],
        });
        await tx.runItem.update({ where: { id: item.id }, data: { result: 'RETURNED', recipient: d.recipient, resolvedAt: now } });
        await this.core.move(tx, s, 'RETURNED', { runId: null, returnFee: fee, closedAt: now, codFee: 0 }, { type: 'RETURNED', userId: user.id, hubId: item.run.hubId, note: d.recipient ? `Received by ${d.recipient}` : '' });
        await postReturned(tx, settings, { ...s, returnFee: fee, codFee: 0 }, user.id, user.id);
        return { message: 'Returned to merchant' };
      }
      if (d.codCollected !== s.codAmount) {
        throw new DomainError('wrong_amount', `Collect exactly ${(s.codAmount / 100).toFixed(2)} EGP. If the customer cannot pay it all, mark the attempt as failed`, 422);
      }
      await tx.runItem.update({ where: { id: item.id }, data: { result: 'DELIVERED', codCollected: d.codCollected, recipient: d.recipient, resolvedAt: now } });
      await this.core.move(tx, s, 'DELIVERED', { runId: null, codCollected: d.codCollected, deliveredAt: now, closedAt: now }, { type: 'DELIVERED', userId: user.id, hubId: item.run.hubId, note: d.recipient ? `Received by ${d.recipient}` : '' });
      await postDelivered(tx, await this.settings.all(tx), { ...s, codCollected: d.codCollected }, user.id, user.id);
      return { message: 'Delivered' };
    });
  }

  async fail(user: SessionUser, itemId: string, body: unknown) {
    const d = parse(FailInput, body);
    return this.prisma.tx(async (tx) => {
      const item = await this.item(tx, user, itemId);
      const s = item.shipment;
      const label = FAIL_REASONS[d.reason as keyof typeof FAIL_REASONS].label;
      await tx.runItem.update({ where: { id: item.id }, data: { result: 'FAILED', failReason: d.reason, resolvedAt: new Date() } });
      await this.core.move(
        tx,
        s,
        'ATTEMPT_FAILED',
        { attempts: item.direction === 'FORWARD' ? s.attempts + 1 : s.attempts, lastFailReason: d.reason },
        { type: item.direction === 'FORWARD' ? 'ATTEMPT_FAILED' : 'RETURN_ATTEMPT_FAILED', userId: user.id, hubId: item.run.hubId, note: [label, d.note].filter(Boolean).join('. ') },
      );
      return { message: 'Attempt recorded. Bring the parcel back to the hub' };
    });
  }
}
