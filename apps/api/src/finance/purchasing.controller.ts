import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  billPurchaseOrder,
  closePurchaseOrder,
  decidePurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  markPurchaseOrdered,
  receivePurchaseOrder,
  requestPurchaseOrder,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  billNumber,
  PURCHASE_ORDER_STATUSES,
  purchaseOrderBillSchema,
  purchaseOrderCloseSchema,
  purchaseOrderDecisionSchema,
  purchaseOrderNumber,
  purchaseOrderReceiveSchema,
  purchaseOrderSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Purchase orders (PO-000001): asked for with prepare level (accounting use), approved by
 * another person with approve level from the approval limit, ordered, received in parts
 * (packaging goes into packaging stock), billed from the order, closed.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance/purchase-orders')
export class PurchasingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: PURCHASE_ORDER_STATUSES })
  @ApiQuery({ name: 'supplierId', required: false })
  list(@Query('status') status?: string, @Query('supplierId') supplierId?: string) {
    return listPurchaseOrders(this.prisma, {
      status: PURCHASE_ORDER_STATUSES.find((s) => s === status),
      supplierId: supplierId || undefined,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<Record<string, unknown>> {
    const order = await getPurchaseOrder(this.prisma, id);
    return {
      ...order,
      bills: order.bills.map((b) => ({ ...b, numberLabel: billNumber(b.number) })),
    };
  }

  @Post()
  @Access('accounting', 'use')
  async request(
    @Body(new ZodValidationPipe(purchaseOrderSchema)) body: z.infer<typeof purchaseOrderSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const order = await requestPurchaseOrder(this.prisma, { ...body, actorUserId: user.sub });
    return { id: order.id, number: purchaseOrderNumber(order.number), status: order.status };
  }

  /** Approve or reject: another person than the one who asked, with the approve level. */
  @Post(':id/decide')
  @Access('accounting', 'manage')
  decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(purchaseOrderDecisionSchema))
    body: z.infer<typeof purchaseOrderDecisionSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return decidePurchaseOrder(this.prisma, {
      purchaseOrderId: id,
      ...body,
      actorUserId: user.sub,
    });
  }

  @Post(':id/ordered')
  @Access('accounting', 'use')
  ordered(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return markPurchaseOrdered(this.prisma, { purchaseOrderId: id, actorUserId: user.sub });
  }

  /** Goods arrived (all or part); store staff with inventory use may receive too. */
  @Post(':id/receive')
  @Access(['accounting', 'inventory'], 'use')
  receive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(purchaseOrderReceiveSchema))
    body: z.infer<typeof purchaseOrderReceiveSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return receivePurchaseOrder(this.prisma, {
      purchaseOrderId: id,
      ...body,
      actorUserId: user.sub,
    });
  }

  @Post(':id/bill')
  @Access('accounting', 'use')
  async bill(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(purchaseOrderBillSchema))
    body: z.infer<typeof purchaseOrderBillSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const bill = await billPurchaseOrder(this.prisma, {
      purchaseOrderId: id,
      ...body,
      actorUserId: user.sub,
    });
    return { id: bill.id, number: billNumber(bill.number) };
  }

  @Post(':id/close')
  @Access('accounting', 'use')
  close(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(purchaseOrderCloseSchema))
    body: z.infer<typeof purchaseOrderCloseSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return closePurchaseOrder(this.prisma, {
      purchaseOrderId: id,
      note: body.note,
      actorUserId: user.sub,
    });
  }
}
