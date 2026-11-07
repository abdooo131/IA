import { Controller, Get, Param } from '@nestjs/common';
import { STATUS_LABELS, normalizeCode } from '@shiply/shared';
import { Public } from '../auth/auth';
import { notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

// What the customer may see. Never the address, phone, or any money except COD to prepare.
const CUSTOMER_EVENTS: Record<string, string> = {
  CREATED: 'Order created by the store',
  PICKED_UP: 'Picked up from the store',
  DROPPED_OFF: 'Received at our hub',
  RECEIVED_FROM_PICKUP: 'Received at our hub',
  DEPARTED: 'On the way to your city',
  RECEIVED_FROM_TRANSFER: 'Arrived at a Shiply hub',
  OUT_FOR_DELIVERY: 'Out for delivery',
  ATTEMPT_FAILED: 'Delivery attempt failed',
  REATTEMPT_REQUESTED: 'Scheduled for another attempt',
  ON_HOLD: 'Waiting for the store',
  RETURN_STARTED: 'Going back to the store',
  RETURN_REQUESTED: 'Going back to the store',
  DELIVERED: 'Delivered',
  RETURNED: 'Returned to the store',
  CANCELLED: 'Cancelled',
};

@Controller()
export class PublicController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('track/:number')
  async track(@Param('number') number: string) {
    const s = await this.prisma.shipment.findUnique({
      where: { trackingNumber: normalizeCode(number) },
      include: { merchant: { select: { name: true } }, events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!s) throw notFound('Parcel');
    const hubs = new Map((await this.prisma.hub.findMany()).map((h) => [h.id, h.name]));
    const open = !['DELIVERED', 'RETURNED', 'CANCELLED'].includes(s.status);
    return {
      trackingNumber: s.trackingNumber,
      store: s.merchant.name,
      status: s.status,
      statusLabel: s.direction === 'RETURN' && open ? 'Returning to the store' : STATUS_LABELS[s.status],
      promisedDate: s.direction === 'FORWARD' ? s.promisedDate : null,
      codToPrepare: s.direction === 'FORWARD' && open ? s.codAmount : 0,
      events: s.events
        .filter((e) => CUSTOMER_EVENTS[e.type])
        .map((e) => ({ at: e.createdAt, text: CUSTOMER_EVENTS[e.type], place: e.hubId ? hubs.get(e.hubId) ?? null : null })),
    };
  }

  /** Lists for address forms. Not sensitive. */
  @Public()
  @Get('reference/locations')
  async locations() {
    const govs = await this.prisma.governorate.findMany({ include: { areas: { orderBy: { nameEn: 'asc' } } }, orderBy: { nameEn: 'asc' } });
    return govs.map((g) => ({
      code: g.code,
      nameEn: g.nameEn,
      nameAr: g.nameAr,
      served: g.hubId !== null || g.areas.some((a) => a.hubId),
      areas: g.areas.map((a) => ({ id: a.id, nameEn: a.nameEn, nameAr: a.nameAr })),
    }));
  }

  @Public()
  @Get('health')
  health() {
    return { ok: true };
  }
}
