import { Body, Controller, Get, HttpException, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { hash } from 'argon2';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { normalizeEgyptMobile } from '@shiply/shared';
import { NeedAccess } from '../access/need-access.decorator';
import { AuditService } from '../audit/audit.service';
import { DB } from '../tokens';
import { parse } from '../validate';

const PUBLIC_FIELDS = { id: true, name: true, nameAr: true, email: true, mobile: true, kind: true, active: true, createdAt: true, role: { select: { key: true, nameEn: true, nameAr: true } } } as const;

const NewUser = z
  .object({
    name: z.string().trim().min(1).max(120),
    nameAr: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().optional(),
    mobile: z.string().optional(),
    password: z.string().min(8).max(200),
    roleKey: z.string().min(1),
  })
  .refine((u) => u.email || u.mobile, { message: 'email or mobile is required' });

const EditUser = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  nameAr: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
  roleKey: z.string().min(1).optional(),
});

@Controller('users')
export class UsersController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @NeedAccess('settings', 'view')
  async list(@Query('q') q?: string, @Query('page') page = '1') {
    const p = Math.max(1, Number(page) || 1);
    // Office logins only: merchant and agent logins are managed by their own modules.
    const where = { kind: 'staff' as const, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { nameAr: { contains: q } }, { email: { contains: q.toLowerCase() } }, { mobile: { contains: q.replace(/\D/g, '') || q } }] } : {}) };
    const [rows, total] = await Promise.all([
      this.db.user.findMany({ where, select: PUBLIC_FIELDS, orderBy: { createdAt: 'desc' }, skip: (p - 1) * 50, take: 50 }),
      this.db.user.count({ where }),
    ]);
    return { rows, total, page: p, pageSize: 50 };
  }

  @Get(':id')
  @NeedAccess('settings', 'view')
  async one(@Param('id') id: string) {
    const user = await this.db.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!user) throw new HttpException({ error: 'not_found' }, 404);
    return user;
  }

  @Post()
  @NeedAccess('settings', 'manage')
  async create(@Body() body: unknown, @Req() req: Request) {
    const u = parse(NewUser, body);
    let mobile: string | undefined;
    if (u.mobile) {
      mobile = normalizeEgyptMobile(u.mobile) ?? undefined;
      if (!mobile) throw new HttpException({ error: 'invalid_mobile' }, 400);
    }
    const role = await this.db.jobRole.findUnique({ where: { key: u.roleKey } });
    if (!role) throw new HttpException({ error: 'unknown_role' }, 400);
    const taken = await this.db.user.findFirst({ where: { OR: [...(u.email ? [{ email: u.email }] : []), ...(mobile ? [{ mobile }] : [])] } });
    if (taken) throw new HttpException({ error: 'login_taken' }, 409);
    const passwordHash = await hash(u.password);
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: u.name, nameAr: u.nameAr, email: u.email, mobile, passwordHash, roleId: role.id },
        select: PUBLIC_FIELDS,
      });
      await this.audit.record(tx, { userId: req.user!.id, action: 'user.created', entity: 'user', entityId: user.id, after: user });
      return user;
    });
  }

  @Patch(':id')
  @NeedAccess('settings', 'manage')
  async edit(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const e = parse(EditUser, body);
    const before = await this.db.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!before) throw new HttpException({ error: 'not_found' }, 404);
    if (before.kind !== 'staff') throw new HttpException({ error: 'not_an_office_login' }, 403);
    let roleId: string | undefined;
    if (e.roleKey) {
      const role = await this.db.jobRole.findUnique({ where: { key: e.roleKey } });
      if (!role) throw new HttpException({ error: 'unknown_role' }, 400);
      roleId = role.id;
    }
    return this.db.$transaction(async (tx) => {
      const after = await tx.user.update({ where: { id }, data: { name: e.name, nameAr: e.nameAr, active: e.active, roleId }, select: PUBLIC_FIELDS });
      await this.audit.record(tx, { userId: req.user!.id, action: 'user.changed', entity: 'user', entityId: id, before, after });
      return after;
    });
  }
}
