import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { atLeast } from '@shiply/shared';
import { DB, NeedAccess, parse } from '../platform';
import { AgentsService } from './agents.service';
import { ROLES } from './people.controller';

@Controller('agents')
export class RequestsController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(AgentsService) private readonly agents: AgentsService,
  ) {}

  /** A hub or store asks for extra people or vehicles for a day (fleet or shiply use). */
  @Post('requests')
  async create(@Body() body: unknown, @Req() req: Request) {
    const u = req.user!;
    if (!atLeast(u.access.fleet, 'use') && !atLeast(u.access.shiply, 'use')) throw new HttpException({ error: 'no_access' }, 403);
    const b = parse(
      z.object({
        siteId: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(s)),
        role: z.enum(ROLES),
        count: z.number().int().min(1).max(200),
        vehicleType: z.enum(['motorbike', 'car', 'van', 'truck']).optional(),
        note: z.string().trim().max(300).optional(),
        agentId: z.string().optional(),
      }),
      body,
    );
    return this.db.request.create({ data: { ...b, requestedById: u.id } });
  }

  @Get('requests')
  @NeedAccess('fleet', 'view')
  list(@Query('status') status?: string, @Query('site') site?: string) {
    return this.db.request.findMany({ where: { ...(status ? { status } : {}), ...(site ? { siteId: site } : {}) }, orderBy: { date: 'desc' }, take: 500 });
  }

  // ── the agent manager's own requests ──

  @Get('me/requests')
  async mine(@Req() req: Request) {
    const agentId = await this.agents.agentOfManager(req.user!.id);
    return this.db.request.findMany({ where: { OR: [{ agentId }, { agentId: null, status: 'open', NOT: { declinedAgentIds: { has: agentId } } }, { answeredAgentId: agentId }] }, orderBy: { date: 'asc' }, take: 500 });
  }

  @Post('me/requests/:id/confirm')
  @HttpCode(200)
  confirm(@Param('id') id: string, @Req() req: Request) {
    return this.answer(id, 'confirmed', req);
  }

  @Post('me/requests/:id/decline')
  @HttpCode(200)
  decline(@Param('id') id: string, @Req() req: Request) {
    return this.answer(id, 'declined', req);
  }

  private async answer(id: string, status: 'confirmed' | 'declined', req: Request) {
    const agentId = await this.agents.agentOfManager(req.user!.id);
    const r = await this.db.request.findUnique({ where: { id } });
    if (!r || (r.agentId && r.agentId !== agentId)) throw new HttpException({ error: 'not_found' }, 404);
    if (!r.agentId && status === 'declined') {
      // Sent to any agent: this one says no, it stays open for the others.
      if (r.status !== 'open') throw new HttpException({ error: 'wrong_status' }, 409);
      return this.db.request.update({ where: { id }, data: { declinedAgentIds: { push: agentId } } });
    }
    const { count } = await this.db.request.updateMany({ where: { id, status: 'open' }, data: { status, answeredById: req.user!.id, answeredAgentId: agentId, answeredAt: new Date() } });
    if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
    return this.db.request.findUniqueOrThrow({ where: { id } });
  }
}
