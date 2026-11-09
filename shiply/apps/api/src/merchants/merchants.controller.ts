import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { LocationService } from '../location';

import { AuditService, createLogin, DB, loginsInfo, NeedAccess, parse, setLoginsActive } from '../platform';
import { MerchantsService } from './merchants.service';

const text = (max = 200) => z.string().trim().min(1).max(max);
const opt = (max = 200) => z.string().trim().max(max).optional();
const MerchantBody = z.object({
  name: text(),
  contactName: text(),
  contactPhone: text(30),
  contactEmail: z.string().trim().toLowerCase().email().optional(),
  services: z.array(z.enum(['shiply_now', 'shiply'])).min(1),
  pickupAddress: opt(500),
  legalName: opt(),
  billingEmails: z.array(z.string().trim().toLowerCase().email()).max(10).optional(),
  emailLanguage: z.enum(['ar', 'en']).optional(),
  taxNumber: opt(40),
  taxGovernorate: opt(),
  taxCity: opt(),
  taxStreet: opt(),
  taxBuilding: opt(40),
  bankName: opt(),
  bankAccount: opt(40),
  iban: opt(40),
  beneficiary: opt(),
  accountManagerId: opt(40),
  flexShip: z.boolean().optional(),
});
const UserBody = z.object({
  name: text(120),
  nameAr: text(120),
  email: z.string().trim().toLowerCase().email().optional(),
  mobile: z.string().optional(),
  password: z.string().min(8).max(200),
  role: z.enum(['owner', 'staff']).default('staff'),
});

@Controller('merchants')
export class MerchantsController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(MerchantsService) private readonly merchants: MerchantsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LocationService) private readonly location: LocationService,
  ) {}

  @Get()
  @NeedAccess('merchants', 'view')
  async list(@Query('q') q?: string, @Query('status') status?: string, @Query('service') service?: string, @Query('page') page = '1') {
    const p = Math.max(1, Number(page) || 1);
    const needle = q?.trim();
    const where = {
      ...(status ? { status } : {}),
      ...(service ? { services: { has: service } } : {}),
      ...(needle ? { OR: [{ name: { contains: needle, mode: 'insensitive' as const } }, { code: { contains: needle.toUpperCase() } }, { contactPhone: { contains: needle.replace(/\\D/g, '').slice(-9) || needle } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.merchant.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p - 1) * 50, take: 50 }),
      this.db.merchant.count({ where }),
    ]);
    return { rows, total, page: p, pageSize: 50 };
  }

  @Get('signups')
  @NeedAccess('merchants', 'view')
  async signups() {
    const rows = await this.db.merchant.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' } });
    return { rows, total: rows.length };
  }

  @Get(':id')
  @NeedAccess('merchants', 'view')
  async one(@Param('id') id: string) {
    const m = await this.db.merchant.findUnique({ where: { id }, include: { users: true, shops: true } });
    if (!m) throw new HttpException({ error: 'not_found' }, 404);
    const logins = await loginsInfo(this.db, m.users.map((u) => u.userId));
    const pickupPath = m.pickupPlaceId ? await this.location.pathOf(m.pickupPlaceId) : [];
    return { ...m, pickupPath, users: m.users.map((u) => ({ ...u, login: logins.find((l) => l.id === u.userId) })) };
  }

  @Post()
  @NeedAccess('merchants', 'use')
  create(@Body() body: unknown, @Req() req: Request) {
    const input = parse(MerchantBody, body);
    return this.db.$transaction((tx) => this.merchants.create(tx, input, req.user!.id));
  }

  @Patch(':id')
  @NeedAccess('merchants', 'use')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.merchants.update(id, parse(MerchantBody.partial(), body), req.user!.id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @NeedAccess('merchants', 'manage')
  approve(@Param('id') id: string, @Req() req: Request) {
    return this.merchants.setStatus(id, ['pending'], 'approved', req.user!.id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @NeedAccess('merchants', 'manage')
  reject(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { reason } = parse(z.object({ reason: text(500) }), body);
    return this.merchants.setStatus(id, ['pending'], 'rejected', req.user!.id, reason);
  }

  /** Stops the merchant: its logins stop working; its contract stays for history. */
  @Post(':id/deactivate')
  @HttpCode(200)
  @NeedAccess('merchants', 'manage')
  async deactivate(@Param('id') id: string, @Req() req: Request) {
    // One transaction: the merchant is never inactive while a login of it still works.
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.merchant.updateMany({ where: { id, status: { in: ['approved', 'pending'] } }, data: { status: 'inactive' } });
      if (!count) {
        const exists = await tx.merchant.findUnique({ where: { id } });
        throw new HttpException({ error: exists ? 'wrong_status' : 'not_found' }, exists ? 409 : 404);
      }
      const users = await tx.merchantUser.findMany({ where: { merchantId: id } });
      await setLoginsActive(tx, users.map((u) => u.userId), false);
      await this.audit.record(tx, { userId: req.user!.id, action: 'merchant.inactive', entity: 'merchant', entityId: id, after: { status: 'inactive' } });
      return tx.merchant.findUniqueOrThrow({ where: { id } });
    });
  }

  @Post(':id/users')
  @NeedAccess('merchants', 'use')
  async addUser(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const u = parse(UserBody, body);
    return this.db.$transaction(async (tx) => {
      // Locks the merchant, so a deactivation at the same moment waits for this login, then stops it.
      const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM merchants.merchants WHERE id = ${id} FOR UPDATE`;
      if (!rows[0]) throw new HttpException({ error: 'not_found' }, 404);
      if (rows[0].status === 'inactive' || rows[0].status === 'rejected') throw new HttpException({ error: 'merchant_inactive' }, 409);
      const login = await createLogin(tx, { name: u.name, nameAr: u.nameAr, email: u.email, mobile: u.mobile, password: u.password, kind: 'merchant_user', roleKey: 'merchant' });
      const link = await tx.merchantUser.create({ data: { userId: login.id, merchantId: id, role: u.role } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'merchant.user_added', entity: 'merchant', entityId: id, after: { userId: login.id, role: u.role } });
      return link;
    });
  }
}
