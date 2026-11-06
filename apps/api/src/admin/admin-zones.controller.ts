import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  assignArea,
  assignAreasInShape,
  excludeArea,
  forgetAreaNames,
  listAreasForMap,
  listAreasToReview,
  listZonesWithArea,
  Prisma,
  recordAudit,
  setZoneArea,
  unassignArea,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  assignAreaSchema,
  type CreateZoneInput,
  createZoneSchema,
  selectAreasSchema,
  type ZonePolygon,
  zonePolygonSchema,
} from '@shiplynow/shared';
import { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const areaBody = z.object({ area: zonePolygonSchema });
const patchBody = z
  .object({
    nameEn: z.string().trim().min(2).max(80).optional(),
    nameAr: z.string().trim().min(2).max(80).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing_to_update' });
const excludeBody = z.object({ note: z.string().trim().max(200).optional() });
const mapQuery = z.object({
  /** minLng,minLat,maxLng,maxLat */
  bbox: z
    .string()
    .regex(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/)
    .transform((v) => v.split(',').map(Number) as [number, number, number, number])
    .optional(),
  districtId: z.string().max(64).optional(),
  /** Comma separated levels, 2 to 4 by default */
  levels: z
    .string()
    .regex(/^[1-5](,[1-5])*$/)
    .transform((v) => v.split(',').map(Number))
    .optional(),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

type MapQuery = z.infer<typeof mapQuery>;

/** Long enough for a district's worth of neighbourhoods to be joined into one shape. */
const AREA_TX = { timeout: 60_000, maxWait: 10_000 };

@ApiTags('admin')
@ApiBearerAuth()
@Access('operations')
@Controller('admin/zones')
export class AdminZonesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return listZonesWithArea(this.prisma);
  }

  @Post()
  @Access('operations', 'manage')
  async create(
    @Body(new ZodValidationPipe(createZoneSchema)) body: CreateZoneInput,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const store = await tx.darkStore.findUnique({ where: { id: body.darkStoreId } });
        if (!store) throw new NotFoundException({ error: 'dark_store_not_found' });
        // A sorting facility never delivers, so it has no delivery zones.
        if (store.kind === 'hub') throw new ConflictException({ error: 'hub_has_no_zones' });
        const zone = await tx.zone.create({
          data: {
            darkStoreId: store.id,
            code: body.code,
            nameEn: body.nameEn,
            nameAr: body.nameAr,
            governorateId: store.governorateId,
          },
        });
        await recordAudit(tx, {
          actorUserId: user.sub,
          action: 'zone.create',
          entityType: 'zone',
          entityId: zone.id,
          after: { code: zone.code, nameEn: zone.nameEn, nameAr: zone.nameAr, area: body.area },
        });
        // A drawn shape selects the areas inside it; with no area map yet it is kept as the
        // zone's outline, as before zones were built from areas.
        if (!body.area) return { id: zone.id, assigned: 0, skipped: [], outline: false };
        const level = await this.mapLevel(tx);
        if (level) {
          const done = await assignAreasInShape(tx, {
            zoneId: zone.id,
            shape: body.area,
            level,
            actorUserId: user.sub,
          });
          if (done.assigned.length > 0)
            return {
              id: zone.id,
              assigned: done.assigned.length,
              skipped: done.skipped,
              outline: false,
            };
        }
        await this.writeArea(tx, zone.id, body.area);
        return { id: zone.id, assigned: 0, skipped: [], outline: true };
      }, AREA_TX);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ error: 'zone_code_taken' });
      }
      throw error;
    }
  }

  @Put(':id/area')
  @Access('operations', 'manage')
  async setArea(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(areaBody)) body: { area: ZonePolygon },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [before] = await tx.$queryRaw<{ area: string | null }[]>`
        SELECT ST_AsGeoJSON(area, 6) AS area FROM zones WHERE id = ${id} FOR UPDATE`;
      if (!before) throw new NotFoundException({ error: 'zone_not_found' });
      // A zone built from areas changes on the area map, never by drawing.
      if (await tx.storeArea.findFirst({ where: { zoneId: id }, select: { geoAreaId: true } }))
        throw new ConflictException({ error: 'zone_uses_areas' });
      await this.writeArea(tx, id, body.area);
      await recordAudit(tx, {
        actorUserId: user.sub,
        action: 'zone.area_update',
        entityType: 'zone',
        entityId: id,
        before: before.area ? { area: JSON.parse(before.area) } : null,
        after: { area: body.area },
      });
      return { id };
    });
  }

  @Patch(':id')
  @Access('operations', 'manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchBody)) body: z.infer<typeof patchBody>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.zone.findUnique({ where: { id } });
      if (!before) throw new NotFoundException({ error: 'zone_not_found' });
      const after = await tx.zone.update({ where: { id }, data: body });
      const pick = (z: typeof before) => ({
        nameEn: z.nameEn,
        nameAr: z.nameAr,
        isActive: z.isActive,
      });
      await recordAudit(tx, {
        actorUserId: user.sub,
        action: 'zone.update',
        entityType: 'zone',
        entityId: id,
        before: pick(before),
        after: pick(after),
      });
      return pick(after);
    });
  }

  /**
   * Deletes a zone that never had an order. A zone with orders keeps their history, so it can
   * only be switched off.
   */
  @Delete(':id')
  @Access('operations', 'manage')
  async remove(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.zone.findUnique({ where: { id } });
      if (!before) throw new NotFoundException({ error: 'zone_not_found' });
      if (await tx.order.findFirst({ where: { zoneId: id }, select: { id: true } }))
        throw new ConflictException({ error: 'zone_has_orders' });
      await tx.zone.delete({ where: { id } });
      await recordAudit(tx, {
        actorUserId: user.sub,
        action: 'zone.delete',
        entityType: 'zone',
        entityId: id,
        before: { code: before.code, nameEn: before.nameEn, nameAr: before.nameAr },
        after: null,
      });
      return { deleted: true };
    });
  }

  /**
   * The area map for the zone screen: areas inside a box or a district with who serves each,
   * simplified shapes, paginated by cursor.
   */
  @Get('areas')
  areas(@Query(new ZodValidationPipe(mapQuery as unknown as z.ZodType<MapQuery>)) query: MapQuery) {
    return listAreasForMap(this.prisma, query);
  }

  /** Areas the move from drawn outlines marked for a look (split between stores). */
  @Get('areas/review')
  review() {
    return listAreasToReview(this.prisma);
  }

  /** Serves an area (usually a neighbourhood or a whole district) from this zone. */
  @Post(':id/areas')
  @Access('operations', 'manage')
  assign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignAreaSchema)) body: z.infer<typeof assignAreaSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.prisma
      .$transaction(
        (tx) =>
          assignArea(tx, {
            areaId: body.areaId,
            zoneId: id,
            move: body.move,
            actorUserId: user.sub,
          }),
        AREA_TX,
      )
      .finally(forgetAreaNames);
  }

  /** "Select the areas inside this shape" for this zone. */
  @Post(':id/areas/select')
  @Access('operations', 'manage')
  select(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(selectAreasSchema)) body: z.infer<typeof selectAreasSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        if (!(await tx.zone.findUnique({ where: { id }, select: { id: true } })))
          throw new NotFoundException({ error: 'zone_not_found' });
        const done = await assignAreasInShape(tx, {
          zoneId: id,
          shape: body.shape,
          level: body.level,
          minShare: body.minShare,
          move: body.move,
          actorUserId: user.sub,
        });
        return { assigned: done.assigned.length, areaIds: done.assigned, skipped: done.skipped };
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
  }

  /** Removes an area's own assignment: it is served like the area above it again. */
  @Delete('areas/:areaId')
  @Access('operations', 'manage')
  unassign(@Param('areaId') areaId: string, @CurrentUser() user: AccessTokenClaims) {
    return this.prisma.$transaction(
      (tx) => unassignArea(tx, { areaId, actorUserId: user.sub }),
      AREA_TX,
    );
  }

  /** Marks an area as not served, even inside a served district. */
  @Post('areas/:areaId/exclude')
  @Access('operations', 'manage')
  exclude(
    @Param('areaId') areaId: string,
    @Body(new ZodValidationPipe(excludeBody)) body: z.infer<typeof excludeBody>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.prisma.$transaction(
      (tx) => excludeArea(tx, { areaId, note: body.note, actorUserId: user.sub }),
      AREA_TX,
    );
  }

  /** Neighbourhoods when the map has them, else districts; null when there is no map yet. */
  private async mapLevel(tx: Prisma.TransactionClient) {
    const [row] = await tx.$queryRaw<{ l2: number; l3: number }[]>`
      SELECT count(*) FILTER (WHERE level = 2)::int AS l2,
        count(*) FILTER (WHERE level = 3)::int AS l3
      FROM geo_areas WHERE is_active`;
    if (row?.l3) return 3;
    if (row?.l2) return 2;
    return null;
  }

  private async writeArea(tx: Prisma.TransactionClient, zoneId: string, area: ZonePolygon) {
    try {
      await setZoneArea(tx, zoneId, area);
    } catch (error) {
      if (error instanceof Error && error.message === 'zone_geometry_invalid') {
        throw new BadRequestException({ error: 'zone_geometry_invalid' });
      }
      throw error;
    }
  }
}
