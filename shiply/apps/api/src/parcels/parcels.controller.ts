import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { normalizeEgyptMobile, parseEgp } from '@shiply/shared';
import { DB, NeedAccess, parse } from '../platform';
import { ParcelsService } from './parcels.service';
import { STATUSES } from './status';

export const SIZES = ['small', 'medium', 'large', 'light_bulky', 'heavy_bulky'] as const;

/** COD may be zero; read the way people type it. */
const cod = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    const p = v === '' ? 0 : parseEgp(v);
    if (p < 0 || p > 2_000_000_000) throw new Error('range');
    return p;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'cod' });
    return z.NEVER;
  }
});
const ParcelBody = z.object({
  merchantId: z.string().min(1),
  merchantRef: z.string().trim().max(60).optional(),
  customerName: z.string().trim().min(1).max(120),
  phone: z.string().transform((v, ctx) => {
    const p = normalizeEgyptMobile(v);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'phone' });
      return z.NEVER;
    }
    return p;
  }),
  address: z.string().trim().min(3).max(500),
  size: z.enum(SIZES),
  cod: cod.default(0),
  openPackage: z.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
});

@Controller('parcels')
export class ParcelsController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(ParcelsService) private readonly parcels: ParcelsService,
  ) {}

  @Post()
  @NeedAccess('shiply', 'use')
  create(@Body() body: unknown, @Req() req: Request) {
    const { cod: codAmount, ...b } = parse(ParcelBody, body);
    return this.db.$transaction((tx) => this.parcels.create(tx, { ...b, codAmount }, req.user!.id));
  }

  @Get()
  @NeedAccess('shiply', 'view')
  async list(@Query() q: Record<string, string | undefined>) {
    const page = Math.max(1, Number(q.page) || 1);
    const where = {
      ...(q.status && (STATUSES as readonly string[]).includes(q.status) ? { status: q.status } : {}),
      ...(q.hub ? { hubId: q.hub } : {}),
      ...(q.merchant ? { merchantId: q.merchant } : {}),
      ...(q.courier ? { courierId: q.courier } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59`) } : {}) } } : {}),
      ...(q.q ? { OR: [{ tracking: { contains: q.q.trim().toUpperCase() } }, { phone: { contains: q.q.replace(/\D/g, '').slice(-9) || q.q } }, { customerName: { contains: q.q, mode: 'insensitive' as const } }, { merchantRef: q.q }] } : {}),
    };
    if ((q.from && isNaN(Date.parse(q.from))) || (q.to && isNaN(Date.parse(q.to)))) throw new HttpException({ error: 'invalid' }, 400);
    const [rows, total] = await Promise.all([this.db.parcel.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 50, take: 50 }), this.db.parcel.count({ where })]);
    return { rows, total, page, pageSize: 50 };
  }

  @Get(':key')
  @NeedAccess('shiply', 'view')
  async one(@Param('key') key: string) {
    const parcel = await this.parcels.find(key);
    if (!parcel) throw new HttpException({ error: 'not_found' }, 404);
    const [events, scans, attempts] = await Promise.all([
      this.db.parcelEvent.findMany({ where: { parcelId: parcel.id }, orderBy: { at: 'asc' } }),
      this.db.scan.findMany({ where: { parcelId: parcel.id }, orderBy: { at: 'asc' } }),
      this.db.attempt.findMany({ where: { parcelId: parcel.id }, orderBy: { number: 'asc' } }),
    ]);
    return { ...parcel, events, scans, attempts };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @NeedAccess('shiply', 'use')
  cancel(@Param('id') id: string, @Req() req: Request) {
    return this.db.$transaction((tx) => this.parcels.move(tx, id, 'cancelled', { userId: req.user!.id }));
  }
}
