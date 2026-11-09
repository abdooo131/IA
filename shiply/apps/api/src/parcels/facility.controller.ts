import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { DB, NeedAccess, parse } from '../platform';
import { BagsService } from './bags.service';
import { FacilityService } from './facility.service';
import { ScanService } from './scan.service';

@Controller('parcels')
export class FacilityController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(FacilityService) private readonly facility: FacilityService,
    @Inject(BagsService) private readonly bags: BagsService,
    @Inject(ScanService) private readonly scans: ScanService,
  ) {}

  @Get('facility/:siteId/inbound')
  @NeedAccess('shiply', 'view')
  inbound(@Param('siteId') siteId: string) {
    return this.facility.inbound(siteId);
  }

  @Post('facility/:siteId/inbound/close')
  @HttpCode(200)
  @NeedAccess('shiply', 'use')
  async closeInbound(@Param('siteId') siteId: string, @Body() body: unknown, @Req() req: Request) {
    await this.scans.assertSite(req.user!, siteId);
    return this.facility.closeInbound(siteId, parse(z.object({ pickupId: z.string().min(1) }), body).pickupId);
  }

  @Get('facility/:siteId/stuck')
  @NeedAccess('shiply', 'view')
  stuck(@Param('siteId') siteId: string) {
    return this.facility.stuck(siteId);
  }

  @Get('bags')
  @NeedAccess('shiply', 'view')
  bagList(@Query('site') site?: string, @Query('status') status?: string) {
    return this.db.bag.findMany({ where: { ...(site ? { OR: [{ fromSiteId: site }, { toSiteId: site }] } : {}), ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  @Post('bags/single')
  @NeedAccess('shiply', 'use')
  async single(@Body() body: unknown, @Req() req: Request) {
    const b = parse(z.object({ parcelId: z.string().min(1), seal: z.string().trim().min(1).max(80), siteId: z.string().min(1) }), body);
    await this.scans.assertSite(req.user!, b.siteId);
    return this.bags.single(b.parcelId, b.seal, b.siteId, req.user!.id);
  }

  @Post('bags/:seal/close')
  @HttpCode(200)
  @NeedAccess('shiply', 'use')
  async close(@Param('seal') seal: string, @Req() req: Request) {
    const bag = await this.bags.bagBySeal(this.db, seal);
    if (!bag) throw new HttpException({ error: 'not_found' }, 404);
    await this.scans.assertSite(req.user!, bag.fromSiteId);
    return this.bags.close(seal, req.user!.id);
  }

  @Get('cars')
  @NeedAccess('shiply', 'view')
  cars(@Query('site') site?: string) {
    return this.db.car.findMany({ where: site ? { OR: [{ fromSiteId: site }, { toSiteId: site }] } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  @Post('cars')
  @NeedAccess('shiply', 'use')
  async newCar(@Body() body: unknown, @Req() req: Request) {
    const b = parse(z.object({ fromSiteId: z.string().min(1), toSiteId: z.string().min(1), driverName: z.string().trim().min(1).max(120) }), body);
    await this.scans.assertSite(req.user!, b.fromSiteId);
    return this.db.car.create({ data: { ...b, createdById: req.user!.id } });
  }

  @Post('cars/:id/depart')
  @HttpCode(200)
  @NeedAccess('shiply', 'use')
  async depart(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const car = await this.bags.carSite(id);
    if (!car) throw new HttpException({ error: 'not_found' }, 404);
    await this.scans.assertSite(req.user!, car.fromSiteId);
    return this.bags.depart(id, parse(z.object({ driverCount: z.number().int().min(0).max(10_000) }), body).driverCount, req.user!.id);
  }

  @Get('gaps')
  @NeedAccess('shiply', 'view')
  gaps(@Query('site') site?: string, @Query('open') open?: string) {
    return this.db.gap.findMany({ where: { ...(site ? { siteId: site } : {}), ...(open === 'true' ? { open: true } : open === 'false' ? { open: false } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  @Post('gaps/:id/resolve')
  @HttpCode(200)
  @NeedAccess('shiply', 'use')
  async resolve(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { note } = parse(z.object({ note: z.string().trim().min(1).max(500) }), body);
    const { count } = await this.db.gap.updateMany({ where: { id, open: true }, data: { open: false, note, resolvedById: req.user!.id, resolvedAt: new Date() } });
    if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
    return { ok: true };
  }
}
