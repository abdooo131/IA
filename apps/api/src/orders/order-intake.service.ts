import { Injectable } from '@nestjs/common';
import { createOrder, type CreatedOrder, DomainError } from '@shiplynow/db';
import type { CreateOrderBody } from '@shiplynow/shared';
import { CoverageService } from '../coverage/coverage.service';
import { DeliveryResolver } from '../coverage/delivery-resolver.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The single way manual orders enter the system. The dark store comes from the delivery
 * decision (the customer's pin, else the neighbourhood picked): served, open and under
 * capacity, or the 60 minute order is refused with the reason (outside_zones, address_unsure,
 * store_closed, at_capacity) so the merchant ships it the standard way.
 */
@Injectable()
export class OrderIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coverage: CoverageService,
    private readonly resolver: DeliveryResolver,
  ) {}

  async create(
    merchantId: string,
    body: CreateOrderBody,
    actorUserId: string,
    source: 'manual' | 'shopify' = 'manual',
    /** Refuses a store the person may not work in, before anything is written */
    checkStore?: (darkStoreId: string) => void,
  ): Promise<CreatedOrder> {
    // A pin decides first, then the neighbourhood picked; never the zone centre.
    const decision = await this.resolver.resolve(
      {
        point:
          body.latitude !== undefined && body.longitude !== undefined
            ? { latitude: body.latitude, longitude: body.longitude, source: 'pin' }
            : null,
        areaId: body.areaId ?? null,
      },
      { lookup: false },
    );
    const check = await this.coverage.fromDecision(decision);
    if (!check.covered) throw new DomainError(check.reason, 409);
    checkStore?.(check.darkStore.id);
    return createOrder(this.prisma, {
      merchantId,
      darkStoreId: check.darkStore.id,
      zoneId: check.zone.id,
      geoAreaId: decision.area?.id ?? null,
      resolvedBy: decision.confidence,
      locationSource: decision.pointSource,
      source,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      addressText: body.addressText,
      customerNote: body.customerNote,
      latitude: decision.doorPoint?.latitude,
      longitude: decision.doorPoint?.longitude,
      paymentMethod: body.paymentMethod,
      deliveryFeePiastres: body.deliveryFeePiastres,
      items: body.items,
      actorUserId,
    });
  }
}
