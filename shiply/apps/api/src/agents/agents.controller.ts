import { Body, Controller, Get, HttpException, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { normalizeEgyptMobile } from '@shiply/shared';
import { AuditService, createLogin, DB, NeedAccess, parse } from '../platform';
import { rate } from './rates';

const phone = z.string().transform((v, ctx) => {
  const p = normalizeEgyptMobile(v);
  if (!p) {
    ctx.addIssue({ code: 'custom', message: 'phone' });
    return z.NEVER;
  }
  return p;
});
const AgentBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/),
  name: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120),
  contactName: z.string().trim().min(1).max(120),
  phone,
  services: z.array(z.enum(['shiply', 'shiply_now'])).min(1),
  perDelivery: rate.default(0),
  perPickup: rate.default(0),
  perTrip: rate.default(0),
  perRiderOrder: rate.default(0),
});

@Controller('agents')
export class AgentsController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @NeedAccess('fleet', 'view')
  list(@Query('q') q?: string) {
    return this.db.agent.findMany({ where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q.toUpperCase() } }] } : {}, orderBy: { name: 'asc' } });
  }

  @Post()
  @NeedAccess('fleet', 'manage')
  async create(@Body() body: unknown, @Req() req: Request) {
    const b = parse(AgentBody, body);
    if (await this.db.agent.findUnique({ where: { code: b.code } })) throw new HttpException({ error: 'code_taken' }, 409);
    return this.db.$transaction(async (tx) => {
      const a = await tx.agent.create({ data: b });
      await this.audit.record(tx, { userId: req.user!.id, action: 'agent.created', entity: 'agent', entityId: a.id, after: a });
      return a;
    });
  }

  @Patch(':id')
  @NeedAccess('fleet', 'manage')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(AgentBody.omit({ code: true }).partial().extend({ active: z.boolean().optional() }), body);
    const before = await this.db.agent.findUnique({ where: { id } });
    if (!before) throw new HttpException({ error: 'not_found' }, 404);
    return this.db.$transaction(async (tx) => {
      const a = await tx.agent.update({ where: { id }, data: b });
      await this.audit.record(tx, { userId: req.user!.id, action: 'agent.updated', entity: 'agent', entityId: id, before, after: a });
      return a;
    });
  }

  @Post('managers')
  @NeedAccess('fleet', 'manage')
  async manager(@Body() body: unknown) {
    const b = parse(z.object({ agentId: z.string().min(1), name: z.string().trim().min(1), nameAr: z.string().trim().min(1), email: z.string().email().optional(), mobile: z.string().optional(), password: z.string().min(10) }), body);
    if (!(await this.db.agent.findUnique({ where: { id: b.agentId } }))) throw new HttpException({ error: 'not_found' }, 404);
    return this.db.$transaction(async (tx) => {
      const { id } = await createLogin(tx, { name: b.name, nameAr: b.nameAr, email: b.email, mobile: b.mobile, password: b.password, kind: 'agent_manager', roleKey: 'field' });
      await tx.agentManager.create({ data: { userId: id, agentId: b.agentId } });
      return { userId: id, agentId: b.agentId };
    });
  }

  @Get(':id')
  @NeedAccess('fleet', 'view')
  async one(@Param('id') id: string) {
    const a = await this.db.agent.findUnique({ where: { id } });
    if (!a) throw new HttpException({ error: 'not_found' }, 404);
    const [people, vehicles] = await Promise.all([this.db.person.count({ where: { agentId: id } }), this.db.vehicle.count({ where: { agentId: id } })]);
    return { ...a, people, vehicles };
  }
}
