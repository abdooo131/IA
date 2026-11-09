import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { AuditService, DB, NeedAccess, parse } from '../platform';
import { egp } from './amount';
import { CashService, HOLDER_ACCOUNT } from './cash.service';

const company = z.enum(['shiply_now', 'shiply']);
const HolderBody = z.object({
  kind: z.enum(['rider', 'courier', 'store_box', 'hub_safe', 'agent', 'bank']),
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120),
  companyKey: company,
  refId: z.string().trim().max(60).optional(),
  costCentreId: z.string().optional(),
});

@Controller('money')
export class CashController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(CashService) private readonly cash: CashService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get('holders')
  @NeedAccess('accounting', 'view')
  async holders(@Query('company') companyKey?: string) {
    const rows = await this.db.cashHolder.findMany({ where: companyKey ? { companyKey } : {}, orderBy: [{ kind: 'asc' }, { nameEn: 'asc' }] });
    return Promise.all(rows.map(async (h) => ({ ...h, held: await this.cash.held(h.id) })));
  }

  @Post('holders')
  @NeedAccess('accounting', 'manage')
  async createHolder(@Body() body: unknown, @Req() req: Request) {
    const h = parse(HolderBody, body);
    return this.db.$transaction(async (tx) => {
      const holder = await tx.cashHolder.create({ data: { ...h, refId: h.refId ?? null, accountCode: HOLDER_ACCOUNT[h.kind]! } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'cash.holder_created', entity: 'cash_holder', entityId: holder.id, after: holder });
      return holder;
    });
  }

  @Patch('holders/:id')
  @NeedAccess('accounting', 'manage')
  editHolder(@Param('id') id: string, @Body() body: unknown) {
    return this.db.cashHolder.update({ where: { id }, data: parse(z.object({ nameEn: z.string().trim().min(1).max(120).optional(), nameAr: z.string().trim().min(1).max(120).optional(), active: z.boolean().optional() }), body) });
  }

  @Get('holders/:id')
  @NeedAccess('accounting', 'view')
  async holder(@Param('id') id: string) {
    const h = await this.db.cashHolder.findUnique({ where: { id } });
    if (!h) throw new HttpException({ error: 'not_found' }, 404);
    const handovers = await this.db.handover.findMany({ where: { OR: [{ fromHolderId: id }, { toHolderId: id }] }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { ...h, held: await this.cash.held(id), handovers };
  }

  @Get('handovers')
  @NeedAccess('accounting', 'view')
  handovers(@Query('status') status?: string) {
    return this.db.handover.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  @Post('handovers')
  @NeedAccess('accounting', 'use')
  handOver(@Body() body: unknown, @Req() req: Request) {
    const h = parse(z.object({ fromHolderId: z.string().min(1), toHolderId: z.string().min(1), amount: egp }), body);
    return this.cash.handOver(h.fromHolderId, h.toHolderId, h.amount, req.user!.id);
  }

  @Post('handovers/:id/confirm')
  @HttpCode(200)
  @NeedAccess('accounting', 'use')
  confirm(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { receivedAmount } = parse(z.object({ receivedAmount: z.union([z.string(), z.number()]).transform((v, ctx) => {
      try {
        return v === 0 || v === '0' ? 0 : egp.parse(v);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'amount' });
        return z.NEVER;
      }
    }) }), body);
    return this.cash.confirm(id, receivedAmount, req.user!.id);
  }
}
