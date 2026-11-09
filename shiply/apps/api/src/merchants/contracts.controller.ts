import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { LocationService } from '../location';
import { AuditService, DB, NeedAccess, parse } from '../platform';
import { ContractsService, SIZES } from './contracts.service';

const money = z.number().int().min(0).max(1_000_000_000);
const bp = z.number().int().min(0).max(10_000);
const VersionBody = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date().nullable(),
    noticeDays: z.number().int().min(0).max(365),
    payoutSchedule: z.enum(['weekly', 'twice_weekly', 'daily']),
    minimumPayout: money,
    minimumMonthlyFee: money,
    securityDeposit: money,
    creditLimit: money,
    deliveryFee: money,
    orderFixed: money,
    orderPercentBp: bp,
    codPercentBp: bp,
    failedDeliveryFee: money,
    receivingPerUnit: money,
    storagePerUnitMonth: money,
    returnPerUnit: money,
    packagingCharge: money,
    promiseMinutes: z.number().int().min(15).max(1440),
    codFeeBp: bp,
    returnFeeBp: bp,
    openPackageFee: money,
    deliveryAttempts: z.number().int().min(1).max(5),
    terms: z.string().max(20_000).nullable(),
    internalNote: z.string().max(5_000).nullable(),
    prices: z.array(z.object({ pricingZoneId: z.string().min(1), size: z.enum(SIZES), price: money })).max(200),
    tiers: z.array(z.object({ minParcels: z.number().int().min(1), discountBp: bp })).max(20),
  })
  .partial();
const ZoneBody = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/), nameEn: z.string().trim().min(1).max(120), nameAr: z.string().trim().min(1).max(120) });

@Controller('merchants')
export class ContractsController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(ContractsService) private readonly contracts: ContractsService,
    @Inject(LocationService) private readonly location: LocationService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get('pricing-zones')
  @NeedAccess('merchants', 'view')
  zones() {
    return this.db.pricingZone.findMany({ orderBy: { code: 'asc' }, include: { areas: true } });
  }

  @Post('pricing-zones')
  @NeedAccess('merchants', 'manage')
  async createZone(@Body() body: unknown, @Req() req: Request) {
    const z0 = parse(ZoneBody, body);
    if (await this.db.pricingZone.findUnique({ where: { code: z0.code } })) throw new HttpException({ error: 'code_taken' }, 409);
    return this.db.$transaction(async (tx) => {
      const zone = await tx.pricingZone.create({ data: z0 });
      await this.audit.record(tx, { userId: req.user!.id, action: 'pricing_zone.created', entity: 'pricing_zone', entityId: zone.id, after: zone });
      return zone;
    });
  }

  @Patch('pricing-zones/:id')
  @NeedAccess('merchants', 'manage')
  editZone(@Param('id') id: string, @Body() body: unknown) {
    const e = parse(ZoneBody.partial().extend({ active: z.boolean().optional() }), body);
    return this.db.pricingZone.update({ where: { id }, data: e });
  }

  /** The governorates in a pricing zone; a governorate belongs to one zone only. */
  @Put('pricing-zones/:id/areas')
  @NeedAccess('merchants', 'manage')
  async setAreas(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { placeIds } = parse(z.object({ placeIds: z.array(z.string().min(1)).max(40) }), body);
    for (const placeId of placeIds) {
      const p = await this.location.placeInfo(placeId);
      if (!p?.active || p.kind !== 'governorate') throw new HttpException({ error: 'not_a_governorate', placeId }, 400);
    }
    const elsewhere = await this.db.pricingZoneArea.findFirst({ where: { placeId: { in: placeIds }, pricingZoneId: { not: id } } });
    if (elsewhere) throw new HttpException({ error: 'governorate_in_other_zone', placeId: elsewhere.placeId }, 409);
    return this.db.$transaction(async (tx) => {
      await tx.pricingZoneArea.deleteMany({ where: { pricingZoneId: id } });
      await tx.pricingZoneArea.createMany({ data: placeIds.map((placeId) => ({ placeId, pricingZoneId: id })) });
      await this.audit.record(tx, { userId: req.user!.id, action: 'pricing_zone.areas_changed', entity: 'pricing_zone', entityId: id, after: { placeIds } });
      return { ok: true };
    });
  }

  @Get('contracts/pending')
  @NeedAccess('merchants', 'view')
  pending() {
    return this.contracts.pending();
  }

  @Get('contract-versions/:id')
  @NeedAccess('merchants', 'view')
  async version(@Param('id') id: string) {
    const v = await this.db.contractVersion.findUnique({ where: { id }, include: { prices: true, tiers: { orderBy: { minParcels: 'asc' } }, contract: { include: { merchant: { select: { id: true, code: true, name: true } } } } } });
    if (!v) throw new HttpException({ error: 'not_found' }, 404);
    return v;
  }

  @Get(':id/contract')
  @NeedAccess('merchants', 'view')
  contract(@Param('id') id: string) {
    return this.contracts.forMerchant(id);
  }

  @Post(':id/contract/drafts')
  @NeedAccess('merchants', 'use')
  draft(@Param('id') id: string, @Req() req: Request) {
    return this.contracts.newDraft(id, req.user!.id);
  }

  @Patch('contract-versions/:id')
  @NeedAccess('merchants', 'use')
  edit(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.contracts.editDraft(id, parse(VersionBody, body), req.user!.id);
  }

  @Post('contract-versions/:id/submit')
  @HttpCode(200)
  @NeedAccess('merchants', 'use')
  submit(@Param('id') id: string, @Req() req: Request) {
    return this.contracts.submit(id, req.user!.id);
  }

  @Post('contract-versions/:id/approve')
  @HttpCode(200)
  @NeedAccess('sales', 'manage')
  approve(@Param('id') id: string, @Req() req: Request) {
    return this.contracts.approve(id, req.user!.id);
  }

  @Post('contract-versions/:id/reject')
  @HttpCode(200)
  @NeedAccess('sales', 'manage')
  reject(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(500) }), body);
    return this.contracts.reject(id, req.user!.id, reason);
  }
}
