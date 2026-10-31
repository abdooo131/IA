import { Injectable } from '@nestjs/common';
import { createOrder, type CreatedOrder, DomainError } from '@shiplynow/db';
import type { CreateOrderBody } from '@shiplynow/shared';
import { CoverageService } from '../coverage/coverage.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The single way orders enter the system (manual entry today, Shopify next). The dark
 * store comes from the customer's location: covered, open and under capacity, or the
 * 60 minute order is refused with the reason so the merchant ships it the standard way.
 */
@Injectable()
export class OrderIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coverage: CoverageService,
  ) {}

  async create(
    merchantId: string,
    body: CreateOrderBody,
    actorUserId: string,
    source: 'manual' | 'shopify' = 'manual',
  ): Promise<CreatedOrder> {
    const check = await this.coverage.check({ lat: body.latitude, lng: body.longitude });
    if (!check.covered) throw new DomainError(check.reason, 409);
    return createOrder(this.prisma, {
      merchantId,
      darkStoreId: check.darkStore.id,
      zoneId: check.zone.id,
      source,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      addressText: body.addressText,
      customerNote: body.customerNote,
      latitude: body.latitude,
      longitude: body.longitude,
      paymentMethod: body.paymentMethod,
      deliveryFeePiastres: body.deliveryFeePiastres,
      items: body.items,
      actorUserId,
    });
  }
}
