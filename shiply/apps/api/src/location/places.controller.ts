import { Body, Controller, Delete, Get, HttpCode, HttpException, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { normalizeText } from '@shiply/address';
import type { PrismaClient } from '@shiply/db';
import { AuditService, DB, NeedAccess, parse } from '../platform';
import { GazetteerCache } from './gazetteer.cache';

const KINDS = ['governorate', 'city', 'district', 'neighbourhood', 'compound', 'landmark', 'street'] as const;
const name = z.string().trim().min(1).max(120);

const NewPlace = z.object({
  kind: z.enum(KINDS),
  parentId: z.string().optional(),
  nameEn: name,
  nameAr: name,
  names: z.array(name).max(100).default([]),
  needsParent: z.boolean().default(false),
});
const EditPlace = z.object({
  parentId: z.string().nullable().optional(),
  nameEn: name.optional(),
  nameAr: name.optional(),
  names: z.array(name).max(100).optional(),
  needsParent: z.boolean().optional(),
  served: z.boolean().optional(),
  active: z.boolean().optional(),
});

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place';
}

@Controller('location')
export class PlacesController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(GazetteerCache) private readonly cache: GazetteerCache,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async assertParent(parentId: string | null | undefined, kind?: string) {
    if (!parentId) {
      if (kind && kind !== 'governorate') throw new HttpException({ error: 'parent_required' }, 400);
      return;
    }
    const parent = await this.db.place.findUnique({ where: { id: parentId } });
    if (!parent?.active) throw new HttpException({ error: 'unknown_parent' }, 400);
  }

  @Get('places')
  @NeedAccess('location', 'view')
  async list(@Query('q') q?: string, @Query('kind') kind?: string, @Query('page') page = '1') {
    const p = Math.max(1, Number(page) || 1);
    const needle = q?.trim();
    const where = {
      active: true,
      ...(kind ? { kind } : {}),
      ...(needle
        ? { OR: [{ id: { contains: needle.toLowerCase() } }, { nameEn: { contains: needle, mode: 'insensitive' as const } }, { nameAr: { contains: needle } }, { names: { has: needle.toLowerCase() } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.place.findMany({ where, orderBy: [{ kind: 'asc' }, { nameEn: 'asc' }], skip: (p - 1) * 50, take: 50 }),
      this.db.place.count({ where }),
    ]);
    // The full path of each place (Cairo › Maadi › New Maadi), for pickers and lists.
    const all = new Map((await this.db.place.findMany({ select: { id: true, parentId: true, nameEn: true, nameAr: true } })).map((x) => [x.id, x]));
    const path = (id: string) => {
      const out: { id: string; nameEn: string; nameAr: string }[] = [];
      for (let cur = all.get(id); cur && out.length < 8; cur = cur.parentId ? all.get(cur.parentId) : undefined) out.unshift({ id: cur.id, nameEn: cur.nameEn, nameAr: cur.nameAr });
      return out;
    };
    return { rows: rows.map((r) => ({ ...r, path: path(r.id) })), total, page: p, pageSize: 50 };
  }

  @Get('places/:id')
  @NeedAccess('location', 'view')
  async one(@Param('id') id: string) {
    const place = await this.db.place.findUnique({ where: { id } });
    if (!place) throw new HttpException({ error: 'not_found' }, 404);
    const taught = await this.db.taughtName.findMany({ where: { placeId: id }, orderBy: { at: 'desc' } });
    return { ...place, taught };
  }

  @Post('places')
  @NeedAccess('location', 'manage')
  async create(@Body() body: unknown, @Req() req: Request) {
    const p = parse(NewPlace, body);
    await this.assertParent(p.parentId, p.kind);
    let id = slug(p.nameEn);
    for (let n = 2; await this.db.place.findUnique({ where: { id } }); n++) id = `${slug(p.nameEn)}-${n}`;
    const place = await this.db.$transaction(async (tx) => {
      const created = await tx.place.create({
        data: { id, kind: p.kind, parentId: p.parentId ?? null, nameEn: p.nameEn, nameAr: p.nameAr, names: p.names.map((x) => x.toLowerCase()), needsParent: p.needsParent },
      });
      await this.audit.record(tx, { userId: req.user!.id, action: 'place.created', entity: 'place', entityId: id, after: created });
      return created;
    });
    this.cache.invalidate();
    return place;
  }

  @Patch('places/:id')
  @NeedAccess('location', 'manage')
  async edit(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const e = parse(EditPlace, body);
    const before = await this.db.place.findUnique({ where: { id } });
    if (!before) throw new HttpException({ error: 'not_found' }, 404);
    if (e.parentId !== undefined) {
      if (e.parentId === id) throw new HttpException({ error: 'unknown_parent' }, 400);
      await this.assertParent(e.parentId, before.kind);
    }
    const after = await this.db.$transaction(async (tx) => {
      const updated = await tx.place.update({ where: { id }, data: { ...e, names: e.names?.map((x) => x.toLowerCase()) } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'place.changed', entity: 'place', entityId: id, before, after: updated });
      return updated;
    });
    this.cache.invalidate();
    return after;
  }

  /** Moves everything that points at this place to another one, then retires it. */
  @Post('places/:id/merge')
  @HttpCode(200)
  @NeedAccess('location', 'manage')
  async merge(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { intoId } = parse(z.object({ intoId: z.string().min(1) }), body);
    if (intoId === id) throw new HttpException({ error: 'same_place' }, 400);
    const [from, into] = await Promise.all([this.db.place.findUnique({ where: { id } }), this.db.place.findUnique({ where: { id: intoId } })]);
    if (!from?.active || !into?.active) throw new HttpException({ error: 'not_found' }, 404);
    await this.db.$transaction(async (tx) => {
      const names = [...new Set([...into.names, ...from.names, from.nameEn.toLowerCase(), from.nameAr])];
      await tx.place.update({ where: { id: intoId }, data: { names } });
      for (const t of await tx.taughtName.findMany({ where: { placeId: id } })) {
        const clash = await tx.taughtName.findUnique({ where: { normalized_placeId: { normalized: t.normalized, placeId: intoId } } });
        if (clash) await tx.taughtName.delete({ where: { id: t.id } });
        else await tx.taughtName.update({ where: { id: t.id }, data: { placeId: intoId } });
      }
      const service = await tx.areaService.findUnique({ where: { placeId: id } });
      if (service) {
        const kept = await tx.areaService.findUnique({ where: { placeId: intoId } });
        await tx.areaService.delete({ where: { placeId: id } });
        if (!kept) await tx.areaService.create({ data: { ...service, placeId: intoId } });
      }
      await tx.phoneMemory.updateMany({ where: { placeId: id }, data: { placeId: intoId } });
      await tx.addressDecision.updateMany({ where: { placeId: id }, data: { placeId: intoId } });
      await tx.place.updateMany({ where: { parentId: id }, data: { parentId: intoId } });
      await tx.place.update({ where: { id }, data: { active: false, mergedIntoId: intoId } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'place.merged', entity: 'place', entityId: id, after: { intoId } });
    });
    this.cache.invalidate();
    return { ok: true, intoId };
  }

  @Get('taught')
  @NeedAccess('location', 'view')
  taught() {
    return this.db.taughtName.findMany({ orderBy: { at: 'desc' }, take: 500 });
  }

  @Post('taught')
  @NeedAccess('location', 'use')
  async teach(@Body() body: unknown, @Req() req: Request) {
    const t = parse(z.object({ name: name, placeId: z.string().min(1) }), body);
    const place = await this.db.place.findUnique({ where: { id: t.placeId } });
    if (!place?.active) throw new HttpException({ error: 'unknown_place' }, 400);
    const normalized = normalizeText(t.name);
    if (normalized.length < 2) throw new HttpException({ error: 'name_too_short' }, 400);
    const row = await this.db.$transaction(async (tx) => {
      const saved = await tx.taughtName.upsert({
        where: { normalized_placeId: { normalized, placeId: t.placeId } },
        update: { byUserId: req.user!.id, at: new Date() },
        create: { name: t.name, normalized, placeId: t.placeId, byUserId: req.user!.id },
      });
      await this.audit.record(tx, { userId: req.user!.id, action: 'name.taught', entity: 'place', entityId: t.placeId, after: { name: t.name } });
      return saved;
    });
    this.cache.invalidate();
    return row;
  }

  @Delete('taught/:id')
  @NeedAccess('location', 'manage')
  async forget(@Param('id') id: string, @Req() req: Request) {
    const t = await this.db.taughtName.findUnique({ where: { id } });
    if (!t) throw new HttpException({ error: 'not_found' }, 404);
    await this.db.$transaction(async (tx) => {
      await tx.taughtName.delete({ where: { id } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'name.forgotten', entity: 'place', entityId: t.placeId, before: { name: t.name } });
    });
    this.cache.invalidate();
    return { ok: true };
  }
}
