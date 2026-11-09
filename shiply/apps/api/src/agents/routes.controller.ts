import { Body, Controller, Get, HttpException, Inject, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { DB, NeedAccess, parse } from '../platform';

const RouteBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/),
  fromSiteId: z.string().min(1),
  toSiteId: z.string().min(1),
  departAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  agentId: z.string().min(1),
  vehicleId: z.string().optional(),
});

/** Fixed truck routes between facilities and hubs, each run by an agent. */
@Controller('agents/routes')
export class RoutesController {
  constructor(@Inject(DB) private readonly db: PrismaClient) {}

  @Get()
  @NeedAccess('fleet', 'view')
  list() {
    return this.db.truckRoute.findMany({ orderBy: [{ departAt: 'asc' }, { code: 'asc' }] });
  }

  @Post()
  @NeedAccess('fleet', 'use')
  async create(@Body() body: unknown) {
    const b = parse(RouteBody, body);
    if (await this.db.truckRoute.findUnique({ where: { code: b.code } })) throw new HttpException({ error: 'code_taken' }, 409);
    if (!(await this.db.agent.findUnique({ where: { id: b.agentId } }))) throw new HttpException({ error: 'not_found' }, 404);
    return this.db.truckRoute.create({ data: { ...b, vehicleId: b.vehicleId ?? null } });
  }

  @Patch(':id')
  @NeedAccess('fleet', 'use')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.db.truckRoute.update({ where: { id }, data: parse(RouteBody.omit({ code: true }).partial().extend({ active: z.boolean().optional() }), body) });
  }
}
