import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { resolveService } from './service-chain';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { AuditService, DB, NeedAccess, parse } from '../platform';

const name = z.string().trim().min(1).max(120);
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/);
const SiteBody = z.object({
  kind: z.enum(['sorting_facility', 'last_mile_hub', 'dark_store']),
  code,
  nameEn: name,
  nameAr: name,
  sortingFacilityId: z.string().optional(),
});
const SiteEdit = z.object({ nameEn: name.optional(), nameAr: name.optional(), sortingFacilityId: z.string().optional(), active: z.boolean().optional() });
const ZoneBody = z.object({ hubId: z.string().min(1), code, nameEn: name, nameAr: name });
const ZoneEdit = z.object({ nameEn: name.optional(), nameAr: name.optional(), active: z.boolean().optional() });
const MapBody = z.object({ zoneId: z.string().nullable().optional(), darkStoreId: z.string().nullable().optional(), notServed: z.boolean().default(false) });

/** Areas shown on the map: the levels a zone or a dark store is chosen for. */
const MAP_KINDS = ['city', 'district', 'neighbourhood', 'compound'];

@Controller('location')
export class MapController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async assertFacility(id: string | undefined) {
    if (!id) throw new HttpException({ error: 'hub_needs_facility' }, 400);
    const f = await this.db.site.findUnique({ where: { id } });
    if (!f || f.kind !== 'sorting_facility') throw new HttpException({ error: 'hub_needs_facility' }, 400);
  }

  @Get('sites')
  @NeedAccess('location', 'view')
  sites() {
    return this.db.site.findMany({ orderBy: [{ kind: 'asc' }, { code: 'asc' }], include: { sortingFacility: { select: { id: true, code: true, nameEn: true, nameAr: true } } } });
  }

  @Post('sites')
  @NeedAccess('location', 'manage')
  async createSite(@Body() body: unknown, @Req() req: Request) {
    const s = parse(SiteBody, body);
    if (s.kind === 'last_mile_hub') await this.assertFacility(s.sortingFacilityId);
    if (await this.db.site.findUnique({ where: { code: s.code } })) throw new HttpException({ error: 'code_taken' }, 409);
    return this.db.$transaction(async (tx) => {
      const site = await tx.site.create({ data: { ...s, sortingFacilityId: s.kind === 'last_mile_hub' ? s.sortingFacilityId : null } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'site.created', entity: 'site', entityId: site.id, after: site });
      return site;
    });
  }

  @Patch('sites/:id')
  @NeedAccess('location', 'manage')
  async editSite(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const e = parse(SiteEdit, body);
    const before = await this.db.site.findUnique({ where: { id } });
    if (!before) throw new HttpException({ error: 'not_found' }, 404);
    if (e.sortingFacilityId !== undefined && before.kind === 'last_mile_hub') await this.assertFacility(e.sortingFacilityId);
    return this.db.$transaction(async (tx) => {
      const after = await tx.site.update({ where: { id }, data: e });
      await this.audit.record(tx, { userId: req.user!.id, action: 'site.changed', entity: 'site', entityId: id, before, after });
      return after;
    });
  }

  @Get('zones')
  @NeedAccess('location', 'view')
  zones() {
    return this.db.deliveryZone.findMany({ orderBy: { code: 'asc' }, include: { hub: { select: { id: true, code: true, nameEn: true, nameAr: true } } } });
  }

  @Post('zones')
  @NeedAccess('location', 'manage')
  async createZone(@Body() body: unknown, @Req() req: Request) {
    const z0 = parse(ZoneBody, body);
    const hub = await this.db.site.findUnique({ where: { id: z0.hubId } });
    if (!hub || hub.kind !== 'last_mile_hub') throw new HttpException({ error: 'zone_needs_hub' }, 400);
    if (await this.db.deliveryZone.findUnique({ where: { code: z0.code } })) throw new HttpException({ error: 'code_taken' }, 409);
    return this.db.$transaction(async (tx) => {
      const zone = await tx.deliveryZone.create({ data: z0 });
      await this.audit.record(tx, { userId: req.user!.id, action: 'zone.created', entity: 'zone', entityId: zone.id, after: zone });
      return zone;
    });
  }

  @Patch('zones/:id')
  @NeedAccess('location', 'manage')
  async editZone(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const e = parse(ZoneEdit, body);
    const before = await this.db.deliveryZone.findUnique({ where: { id } });
    if (!before) throw new HttpException({ error: 'not_found' }, 404);
    return this.db.$transaction(async (tx) => {
      const after = await tx.deliveryZone.update({ where: { id }, data: e });
      await this.audit.record(tx, { userId: req.user!.id, action: 'zone.changed', entity: 'zone', entityId: id, before, after });
      return after;
    });
  }

  /** Every area with who serves it (its own setting or its district's), and the gaps. */
  @Get('map')
  @NeedAccess('location', 'view')
  async map(@Query('q') q?: string, @Query('page') page = '1') {
    const p = Math.max(1, Number(page) || 1);
    const needle = q?.trim();
    const where = {
      active: true,
      served: true,
      kind: { in: MAP_KINDS },
      ...(needle ? { OR: [{ nameEn: { contains: needle, mode: 'insensitive' as const } }, { nameAr: { contains: needle } }] } : {}),
    };
    const [places, total, all, services, zones, sites] = await Promise.all([
      this.db.place.findMany({ where, orderBy: { nameEn: 'asc' }, skip: (p - 1) * 50, take: 50 }),
      this.db.place.count({ where }),
      this.db.place.findMany({ select: { id: true, parentId: true, nameEn: true, nameAr: true } }),
      this.db.areaService.findMany(),
      this.db.deliveryZone.findMany({ where: { active: true } }),
      this.db.site.findMany({ where: { active: true } }),
    ]);
    const parents = new Map(all.map((x) => [x.id, x.parentId]));
    const names = new Map(all.map((x) => [x.id, { id: x.id, nameEn: x.nameEn, nameAr: x.nameAr }]));
    const svc = new Map(services.map((s) => [s.placeId, s]));
    const rows = places.map((place) => {
      const a = resolveService(place.id, parents, svc, zones, sites);
      const gap = a.notServed ? undefined : !a.zone ? 'no_zone' : !a.hub || !a.facility ? 'hub_without_facility' : undefined;
      return {
        place: { id: place.id, kind: place.kind, nameEn: place.nameEn, nameAr: place.nameAr },
        zone: a.zone ?? undefined,
        hub: a.hub ?? undefined,
        facility: a.facility ?? undefined,
        darkStore: a.darkStore ?? undefined,
        inheritedFrom: a.zoneFrom ? names.get(a.zoneFrom) : undefined,
        darkStoreFrom: a.darkStoreFrom ? names.get(a.darkStoreFrom) : undefined,
        own: svc.get(place.id) ?? null,
        notServed: a.notServed,
        gap,
      };
    });
    return { rows, total, page: p, pageSize: 50 };
  }

  /** Many areas to one zone, dark store or not served, in one go. */
  @Post('map/assign')
  @HttpCode(200)
  @NeedAccess('location', 'manage')
  async assign(@Body() body: unknown, @Req() req: Request) {
    const a = parse(
      z.object({ placeIds: z.array(z.string().min(1)).min(1).max(500), zoneId: z.string().nullable().optional(), darkStoreId: z.string().nullable().optional(), notServed: z.boolean().optional() }),
      body,
    );
    if (a.zoneId && !(await this.db.deliveryZone.findUnique({ where: { id: a.zoneId } }))) throw new HttpException({ error: 'unknown_zone' }, 400);
    if (a.darkStoreId && (await this.db.site.findUnique({ where: { id: a.darkStoreId } }))?.kind !== 'dark_store') throw new HttpException({ error: 'unknown_dark_store' }, 400);
    const found = await this.db.place.count({ where: { id: { in: a.placeIds }, active: true } });
    if (found !== new Set(a.placeIds).size) throw new HttpException({ error: 'unknown_place' }, 400);
    const data = { ...(a.zoneId !== undefined ? { zoneId: a.zoneId } : {}), ...(a.darkStoreId !== undefined ? { darkStoreId: a.darkStoreId } : {}), ...(a.notServed !== undefined ? { notServed: a.notServed } : {}) };
    await this.db.$transaction(async (tx) => {
      for (const placeId of new Set(a.placeIds)) {
        await tx.areaService.upsert({ where: { placeId }, update: data, create: { placeId, zoneId: null, darkStoreId: null, notServed: false, ...data } });
      }
      await this.audit.record(tx, { userId: req.user!.id, action: 'area.service_changed', entity: 'place', entityId: a.placeIds.join(','), after: data });
    });
    return { ok: true, count: new Set(a.placeIds).size };
  }

  @Put('map/:placeId')
  @NeedAccess('location', 'manage')
  async setService(@Param('placeId') placeId: string, @Body() body: unknown, @Req() req: Request) {
    const m = parse(MapBody, body);
    const place = await this.db.place.findUnique({ where: { id: placeId } });
    if (!place?.active) throw new HttpException({ error: 'not_found' }, 404);
    if (m.zoneId && !(await this.db.deliveryZone.findUnique({ where: { id: m.zoneId } }))) throw new HttpException({ error: 'unknown_zone' }, 400);
    if (m.darkStoreId) {
      const store = await this.db.site.findUnique({ where: { id: m.darkStoreId } });
      if (store?.kind !== 'dark_store') throw new HttpException({ error: 'unknown_dark_store' }, 400);
    }
    return this.db.$transaction(async (tx) => {
      const before = await tx.areaService.findUnique({ where: { placeId } });
      const data = { zoneId: m.zoneId ?? null, darkStoreId: m.darkStoreId ?? null, notServed: m.notServed };
      const after = await tx.areaService.upsert({ where: { placeId }, update: data, create: { placeId, ...data } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'area.service_changed', entity: 'place', entityId: placeId, before, after });
      return after;
    });
  }
}
