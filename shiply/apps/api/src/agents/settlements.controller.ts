import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { CashService, MoneyService, type CompanyKey } from '../money';
import { AuditService, DB, NeedAccess, parse } from '../platform';
import { AgentsService } from './agents.service';

const RATE_OF: Record<string, 'perDelivery' | 'perPickup' | 'perTrip' | 'perRiderOrder'> = { delivery: 'perDelivery', pickup: 'perPickup', trip: 'perTrip', rider_order: 'perRiderOrder' };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(s));

/** One settlement per agent per period, both companies, less the cash its people hold. */
@Controller('agents')
export class SettlementsController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(AgentsService) private readonly agents: AgentsService,
    @Inject(CashService) private readonly cash: CashService,
    @Inject(MoneyService) private readonly money: MoneyService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get('settlements')
  @NeedAccess('fleet', 'view')
  list(@Query('agent') agent?: string) {
    return this.db.settlement.findMany({ where: agent ? { agentId: agent } : {}, orderBy: { from: 'desc' }, take: 500 });
  }

  @Post('settlements')
  @NeedAccess('fleet', 'use')
  async create(@Body() body: unknown, @Req() req: Request) {
    const b = parse(z.object({ agentId: z.string().min(1), from: day, to: day }), body);
    if (b.to < b.from) throw new HttpException({ error: 'invalid' }, 400);
    // A period still running would leave its later work unpaid for ever (periods cannot overlap).
    if (b.to >= new Date(new Date().toISOString().slice(0, 10))) throw new HttpException({ error: 'period_not_over' }, 400);
    const agent = await this.db.agent.findUnique({ where: { id: b.agentId } });
    if (!agent) throw new HttpException({ error: 'not_found' }, 404);
    return this.db.$transaction(async (tx) => {
      // One at a time per agent, so two overlapping periods cannot both pass.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settlement:${b.agentId}`}))`;
      const overlap = await tx.settlement.findFirst({ where: { agentId: b.agentId, status: { not: 'cancelled' }, from: { lte: b.to }, to: { gte: b.from } } });
      if (overlap) throw new HttpException({ error: 'overlapping_period' }, 409);
      const work = await tx.workLog.groupBy({ by: ['companyKey', 'kind'], where: { agentId: b.agentId, at: { gte: b.from, lt: new Date(b.to.getTime() + 86_400_000) } }, _count: true });
      const lines = work.map((w) => {
        const rate = agent[RATE_OF[w.kind] ?? 'perDelivery'];
        return { companyKey: w.companyKey, kind: w.kind, count: w._count, rate, amount: w._count * rate };
      });
      const gross = lines.reduce((s, l) => s + l.amount, 0);
      const people = await tx.person.findMany({ where: { agentId: b.agentId }, select: { userId: true } });
      let cashHeld = 0;
      for (const p of people) cashHeld += (await this.cash.heldBy('courier', p.userId)) + (await this.cash.heldBy('rider', p.userId));
      const s = await tx.settlement.create({ data: { agentId: b.agentId, from: b.from, to: b.to, lines, gross, cashHeld, net: gross - cashHeld, preparedById: req.user!.id } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'settlement.prepared', entity: 'settlement', entityId: s.id, after: s });
      return s;
    });
  }

  @Get('settlements/:id')
  @NeedAccess('fleet', 'view')
  async one(@Param('id') id: string) {
    const s = await this.db.settlement.findUnique({ where: { id } });
    if (!s) throw new HttpException({ error: 'not_found' }, 404);
    return s;
  }

  @Post('settlements/:id/approve')
  @HttpCode(200)
  @NeedAccess('fleet', 'manage')
  async approve(@Param('id') id: string, @Req() req: Request) {
    const s = await this.one(id);
    if (s.preparedById === req.user!.id) throw new HttpException({ error: 'own_settlement' }, 403);
    const { count } = await this.db.settlement.updateMany({ where: { id, status: 'draft' }, data: { status: 'approved', approvedById: req.user!.id } });
    if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
    return this.one(id);
  }

  @Post('settlements/:id/cancel')
  @HttpCode(200)
  @NeedAccess('fleet', 'use')
  async cancel(@Param('id') id: string) {
    const { count } = await this.db.settlement.updateMany({ where: { id, status: { in: ['draft', 'approved'] } }, data: { status: 'cancelled' } });
    if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
    return { ok: true };
  }

  /** The agent's invoice arrived: one draft bill per company in money, which still needs its own approval. */
  @Post('settlements/:id/invoice')
  @HttpCode(200)
  @NeedAccess('fleet', 'use')
  async invoice(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { invoiceNumber } = parse(z.object({ invoiceNumber: z.string().trim().min(1).max(60) }), body);
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.settlement.updateMany({ where: { id, status: 'approved' }, data: { status: 'billed', invoiceNumber } });
      if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
      const s = await tx.settlement.findUniqueOrThrow({ where: { id } });
      const agent = await tx.agent.findUniqueOrThrow({ where: { id: s.agentId } });
      const byCompany = new Map<string, number>();
      for (const l of s.lines as { companyKey: string; amount: number }[]) byCompany.set(l.companyKey, (byCompany.get(l.companyKey) ?? 0) + l.amount);
      const today = new Date(new Date().toISOString().slice(0, 10));
      const billIds: string[] = [];
      for (const [companyKey, amount] of byCompany) {
        if (amount <= 0) continue;
        const bill = await this.money.createBill(tx, { companyKey: companyKey as CompanyKey, payee: agent.name, supplierRef: `agent:${agent.id}`, number: invoiceNumber, date: today, dueDate: new Date(today.getTime() + 15 * 86_400_000), amount, vat: 0, accountCode: '5101', preparedById: req.user!.id });
        billIds.push(bill.id);
      }
      return tx.settlement.update({ where: { id }, data: { billIds } });
    });
  }

  @Get('me/settlements')
  async mine(@Req() req: Request) {
    const agentId = await this.agents.agentOfManager(req.user!.id);
    return this.db.settlement.findMany({ where: { agentId, status: { not: 'cancelled' } }, orderBy: { from: 'desc' } });
  }
}
