import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { AgentsService } from '../agents';
import { AuditService, DB, NeedAccess, parse } from '../platform';
import { PickupsService } from './pickups.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(s));
const weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(7);

@Controller('parcels')
export class PickupsController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(PickupsService) private readonly pickups: PickupsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AgentsService) private readonly agents: AgentsService,
  ) {}

  @Get('pickups')
  @NeedAccess('shiply', 'view')
  list(@Query('date') date?: string, @Query('status') status?: string) {
    const d = date ? parse(day, date) : undefined;
    return this.db.pickup.findMany({ where: { ...(d ? { date: d } : {}), ...(status ? { status } : {}) }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500 });
  }

  @Post('pickups')
  @NeedAccess('shiply', 'use')
  create(@Body() body: unknown, @Req() req: Request) {
    const b = parse(z.object({ merchantId: z.string().min(1), date: day, expectedCount: z.number().int().min(0).max(100_000).optional() }), body);
    return this.db.$transaction(async (tx) => {
      const p = await tx.pickup.create({ data: { ...b, createdById: req.user!.id } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'pickup.created', entity: 'pickup', entityId: p.id, after: p });
      return p;
    });
  }

  @Get('pickups/recurring')
  @NeedAccess('shiply', 'view')
  recurring() {
    return this.db.recurringPickup.findMany({ orderBy: { merchantId: 'asc' } });
  }

  @Post('pickups/recurring')
  @NeedAccess('shiply', 'use')
  addRecurring(@Body() body: unknown) {
    return this.db.recurringPickup.create({ data: parse(z.object({ merchantId: z.string().min(1), weekdays }), body) });
  }

  @Patch('pickups/recurring/:id')
  @NeedAccess('shiply', 'use')
  editRecurring(@Param('id') id: string, @Body() body: unknown) {
    return this.db.recurringPickup.update({ where: { id }, data: parse(z.object({ weekdays: weekdays.optional(), active: z.boolean().optional() }), body) });
  }

  @Post('pickups/make-day')
  @HttpCode(200)
  @NeedAccess('shiply', 'use')
  makeDay(@Body() body: unknown, @Req() req: Request) {
    return this.pickups.makeDay(parse(z.object({ date: day }), body).date, req.user!.id);
  }

  @Post('pickups/:id/assign')
  @HttpCode(200)
  @NeedAccess('shiply', 'use')
  async assign(@Param('id') id: string, @Body() body: unknown) {
    const { courierId } = parse(z.object({ courierId: z.string().min(1) }), body);
    const c = await this.db.user.findUnique({ where: { id: courierId } });
    if (!c?.active || c.kind !== 'agent_person') throw new HttpException({ error: 'not_a_courier' }, 400);
    await this.agents.assertCanWork(courierId);
    const { count } = await this.db.pickup.updateMany({ where: { id, status: { in: ['scheduled', 'assigned'] } }, data: { courierId, status: 'assigned' } });
    if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
    return this.db.pickup.findUniqueOrThrow({ where: { id } });
  }

  @Post('pickups/:id/cancel')
  @HttpCode(200)
  @NeedAccess('shiply', 'use')
  async cancel(@Param('id') id: string) {
    const { count } = await this.db.pickup.updateMany({ where: { id, status: { in: ['scheduled', 'assigned'] } }, data: { status: 'cancelled' } });
    if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
    return { ok: true };
  }

  /** The courier's own pickups for a day (today by default). */
  @Get('me/pickups')
  mine(@Req() req: Request, @Query('date') date?: string) {
    if (req.user!.kind !== 'agent_person') throw new HttpException({ error: 'couriers_only' }, 403);
    const d = date ? parse(day, date) : new Date(new Date().toISOString().slice(0, 10));
    return this.db.pickup.findMany({ where: { courierId: req.user!.id, date: d, status: { in: ['assigned', 'on_the_way'] } }, orderBy: { createdAt: 'asc' } });
  }
}
