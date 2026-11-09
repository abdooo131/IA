import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { AuditService, createLogin, DB, loginsInfo, NeedAccess, parse } from '../platform';

export const ROLES = ['delivery', 'pickup', 'rider', 'truck_driver'] as const;

@Controller('agents/people')
export class PeopleController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @NeedAccess('fleet', 'view')
  async list(@Query('agent') agent?: string, @Query('status') status?: string, @Query('q') q?: string) {
    const rows = await this.db.person.findMany({ where: { ...(agent ? { agentId: agent } : {}), ...(status === 'blocked' ? { blocked: true } : status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 1000 });
    const users = await loginsInfo(this.db, rows.map((r) => r.userId));
    const out = rows.map((r) => ({ ...r, ...pick(users.find((u) => u.id === r.userId)) }));
    const needle = q?.trim().toLowerCase();
    return needle ? out.filter((r) => `${r.name} ${r.nameAr} ${r.mobile ?? ''}`.toLowerCase().includes(needle)) : out;
  }

  @Post()
  @NeedAccess('fleet', 'use')
  async create(@Body() body: unknown, @Req() req: Request) {
    const b = parse(
      z.object({ agentId: z.string().min(1), role: z.enum(ROLES), name: z.string().trim().min(1).max(120), nameAr: z.string().trim().min(1).max(120), mobile: z.string().min(8), password: z.string().min(10), nationalId: z.string().trim().max(20).optional() }),
      body,
    );
    if (!(await this.db.agent.findUnique({ where: { id: b.agentId } }))) throw new HttpException({ error: 'not_found' }, 404);
    return this.db.$transaction(async (tx) => {
      const { id: userId } = await createLogin(tx, { name: b.name, nameAr: b.nameAr, mobile: b.mobile, password: b.password, kind: 'agent_person', roleKey: 'field' });
      const p = await tx.person.create({ data: { agentId: b.agentId, userId, role: b.role, nationalId: b.nationalId ?? null, createdById: req.user!.id } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'agent_person.created', entity: 'person', entityId: p.id, after: p });
      return p;
    });
  }

  /** A second person approves a new courier: never the one who added him. */
  @Post(':id/approve')
  @HttpCode(200)
  @NeedAccess('fleet', 'manage')
  async approve(@Param('id') id: string, @Req() req: Request) {
    const p = await this.db.person.findUnique({ where: { id } });
    if (!p) throw new HttpException({ error: 'not_found' }, 404);
    if (p.createdById === req.user!.id) throw new HttpException({ error: 'own_person' }, 403);
    const { count } = await this.db.person.updateMany({ where: { id, status: 'pending' }, data: { status: 'approved', approvedById: req.user!.id } });
    if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
    await this.audit.record(this.db as never, { userId: req.user!.id, action: 'agent_person.approved', entity: 'person', entityId: id });
    return this.db.person.findUniqueOrThrow({ where: { id } });
  }

  @Post(':id/reject')
  @HttpCode(200)
  @NeedAccess('fleet', 'manage')
  async reject(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(300) }), body);
    const { count } = await this.db.person.updateMany({ where: { id, status: 'pending' }, data: { status: 'rejected', blockedReason: reason } });
    if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
    await this.audit.record(this.db as never, { userId: req.user!.id, action: 'agent_person.rejected', entity: 'person', entityId: id, after: { reason } });
    return { ok: true };
  }
}

function pick(u?: { name: string; nameAr: string; mobile: string | null; active: boolean }) {
  return { name: u?.name ?? '', nameAr: u?.nameAr ?? '', mobile: u?.mobile ?? null, loginActive: u?.active ?? false };
}
