import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { parseEgp } from '@shiply/shared';
import { DB, NeedAccess, parse } from '../platform';
import { HubService } from './hub.service';
import { RunsService } from './runs.service';
import { ScanService } from './scan.service';

const courierBody = z.object({ deviceScanId: z.string().min(8).max(80), clientAt: z.coerce.date().optional() });

@Controller('parcels')
export class HubController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(HubService) private readonly hub: HubService,
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(ScanService) private readonly scans: ScanService,
  ) {}

  @Post('hub/bags/:seal/done')
  @HttpCode(200)
  @NeedAccess('shiply', 'use')
  async bagDone(@Param('seal') seal: string, @Req() req: Request) {
    const bag = await this.db.bag.findUnique({ where: { seal: seal.trim().toUpperCase() } });
    if (!bag) throw new HttpException({ error: 'not_found' }, 404);
    await this.scans.assertSite(req.user!, bag.toSiteId);
    return this.hub.bagDone(seal);
  }

  @Get('hub/:hubId/suggest')
  @NeedAccess('shiply', 'view')
  suggest(@Query('zone') zone: string) {
    return this.runs.suggest(zone ?? '');
  }

  @Get('couriers')
  @NeedAccess('shiply', 'view')
  couriers() {
    return this.runs.couriers();
  }

  @Put('couriers/:id/zones')
  @NeedAccess('shiply', 'use')
  zones(@Param('id') id: string, @Body() body: unknown) {
    return this.runs.setZones(id, parse(z.object({ zoneIds: z.array(z.string().min(1)).max(200) }), body).zoneIds);
  }

  @Get('runs')
  @NeedAccess('shiply', 'view')
  list(@Query('hub') hub?: string, @Query('date') date?: string) {
    return this.db.run.findMany({ where: { ...(hub ? { hubId: hub } : {}), ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date: new Date(date) } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  @Post('runs')
  @NeedAccess('shiply', 'use')
  async create(@Body() body: unknown, @Req() req: Request) {
    const b = parse(z.object({ hubId: z.string().min(1), courierId: z.string().min(1) }), body);
    await this.scans.assertSite(req.user!, b.hubId);
    return this.runs.create(b.hubId, b.courierId, req.user!.id);
  }

  @Post('runs/:id/out')
  @HttpCode(200)
  @NeedAccess('shiply', 'use')
  async out(@Param('id') id: string, @Req() req: Request) {
    await this.siteOfRun(id, req);
    return this.runs.out(id);
  }

  @Post('runs/:id/close')
  @HttpCode(200)
  @NeedAccess('shiply', 'use')
  async close(@Param('id') id: string, @Req() req: Request) {
    await this.siteOfRun(id, req);
    return this.runs.close(id);
  }

  private async siteOfRun(id: string, req: Request) {
    const run = await this.db.run.findUnique({ where: { id } });
    if (!run) throw new HttpException({ error: 'not_found' }, 404);
    await this.scans.assertSite(req.user!, run.hubId);
  }

  // ── the courier's phone ──

  @Get('me/run')
  mine(@Req() req: Request) {
    if (req.user!.kind !== 'agent_person') throw new HttpException({ error: 'couriers_only' }, 403);
    return this.runs.mine(req.user!.id);
  }

  @Post('me/parcels/:id/deliver')
  @HttpCode(200)
  async deliver(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(courierBody.extend({ cash: z.union([z.string(), z.number()]).transform((v, ctx) => this.amount(v, ctx)), proof: z.enum(['otp', 'photo', 'none']).default('none') }), body);
    return this.scans.scan({ step: 'deliver', code: await this.tracking(id), deviceScanId: b.deviceScanId, clientAt: b.clientAt, cash: b.cash, proof: b.proof }, req.user!);
  }

  @Post('me/parcels/:id/fail')
  @HttpCode(200)
  async fail(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(courierBody.extend({ reason: z.string().max(40) }), body);
    return this.scans.scan({ step: 'fail', code: await this.tracking(id), deviceScanId: b.deviceScanId, clientAt: b.clientAt, reason: b.reason }, req.user!);
  }

  private amount(v: string | number, ctx: z.RefinementCtx) {
    try {
      return v === '' ? 0 : parseEgp(v);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'cash' });
      return z.NEVER;
    }
  }

  private async tracking(id: string) {
    const p = await this.db.parcel.findUnique({ where: { id }, select: { tracking: true } });
    if (!p) throw new HttpException({ error: 'not_found' }, 404);
    return p.tracking;
  }
}
