import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { Ctx, Roles } from '../common/decorators';
import { MERCHANT } from '../common/roles';
import { parse } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

const PickupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  governorateCode: z.string().trim().min(2).max(5),
  area: z.string().trim().min(2).max(120),
  addressLine: z.string().trim().min(5).max(400),
  contactPhone: z.string().trim().max(20).optional().nullable(),
  isDefault: z.boolean().optional(),
});

const BankSchema = z.object({
  bankName: z.string().trim().min(2).max(80),
  accountName: z.string().trim().min(2).max(120),
  iban: z.string().trim().regex(/^EG\d{27}$/, 'Egyptian IBAN: EG followed by 27 digits'),
});

/** Merchant self service: profile, pickup locations, bank details. RLS scopes every query to the caller. */
@Controller('merchant')
@Roles(...MERCHANT)
export class MerchantsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get('me')
  me(@Ctx() ctx: RequestContext) {
    return this.prisma.withContext(ctx, (tx) => tx.merchant.findUniqueOrThrow({ where: { id: ctx.merchantId! } }));
  }

  @Get('pickup-locations')
  pickups(@Ctx() ctx: RequestContext) {
    return this.prisma.withContext(ctx, (tx) =>
      tx.pickupLocation.findMany({
        where: { merchantId: ctx.merchantId!, archived: false },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
    );
  }

  @Post('pickup-locations')
  @Roles('MERCHANT_OWNER')
  addPickup(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(PickupSchema, body);
    return this.prisma.withContext(ctx, async (tx) => {
      if (b.isDefault) {
        await tx.pickupLocation.updateMany({ where: { merchantId: ctx.merchantId! }, data: { isDefault: false } });
      }
      const loc = await tx.pickupLocation.create({
        data: { ...b, governorateCode: b.governorateCode.toUpperCase(), merchantId: ctx.merchantId!, isDefault: !!b.isDefault },
      });
      await this.audit.record(tx, ctx, { action: 'pickup_location.create', entityType: 'pickup_location', entityId: loc.id, after: loc });
      return loc;
    });
  }

  @Patch('pickup-locations/:id/default')
  @Roles('MERCHANT_OWNER')
  makeDefault(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const loc = await tx.pickupLocation.findFirst({ where: { id, merchantId: ctx.merchantId!, archived: false } });
      if (!loc) throw new NotFoundException();
      await tx.pickupLocation.updateMany({ where: { merchantId: ctx.merchantId! }, data: { isDefault: false } });
      const after = await tx.pickupLocation.update({ where: { id }, data: { isDefault: true } });
      await this.audit.record(tx, ctx, { action: 'pickup_location.default', entityType: 'pickup_location', entityId: id, before: { isDefault: loc.isDefault }, after: { isDefault: true } });
      return after;
    });
  }

  @Patch('pickup-locations/:id/archive')
  @Roles('MERCHANT_OWNER')
  archivePickup(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const loc = await tx.pickupLocation.findFirst({ where: { id, merchantId: ctx.merchantId! } });
      if (!loc) throw new NotFoundException();
      const after = await tx.pickupLocation.update({ where: { id }, data: { archived: true, isDefault: false } });
      await this.audit.record(tx, ctx, { action: 'pickup_location.archive', entityType: 'pickup_location', entityId: id, before: { archived: false }, after: { archived: true } });
      return after;
    });
  }

  @Get('bank-details')
  @Roles('MERCHANT_OWNER')
  bank(@Ctx() ctx: RequestContext) {
    return this.prisma.withContext(ctx, (tx) => tx.merchantBankDetails.findUnique({ where: { merchantId: ctx.merchantId! } }));
  }

  /** The 15 day edit lock is enforced by a database trigger; violations surface as 422. */
  @Put('bank-details')
  @Roles('MERCHANT_OWNER')
  setBank(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(BankSchema, body);
    return this.prisma.withContext(ctx, async (tx) => {
      const before = await tx.merchantBankDetails.findUnique({ where: { merchantId: ctx.merchantId! } });
      const after = before
        ? await tx.merchantBankDetails.update({ where: { merchantId: ctx.merchantId! }, data: b })
        : await tx.merchantBankDetails.create({ data: { ...b, merchantId: ctx.merchantId! } });
      await this.audit.record(tx, ctx, { action: 'bank_details.update', entityType: 'merchant_bank_details', entityId: ctx.merchantId, before: before && maskIban(before), after: maskIban(after) });
      return after;
    });
  }
}

function maskIban<T extends { iban: string }>(r: T): T {
  return { ...r, iban: r.iban.slice(0, 4) + '…' + r.iban.slice(-4) };
}
