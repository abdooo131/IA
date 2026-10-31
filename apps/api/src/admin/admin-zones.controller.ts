import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { listZonesWithArea, Prisma, recordAudit, setZoneArea } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type CreateZoneInput,
  createZoneSchema,
  type ZonePolygon,
  zonePolygonSchema,
} from '@shiplynow/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
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

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/zones')
export class AdminZonesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return listZonesWithArea(this.prisma);
  }

  @Post()
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
        await this.writeArea(tx, zone.id, body.area);
        await recordAudit(tx, {
          actorUserId: user.sub,
          action: 'zone.create',
          entityType: 'zone',
          entityId: zone.id,
          after: { code: zone.code, nameEn: zone.nameEn, nameAr: zone.nameAr, area: body.area },
        });
        return { id: zone.id };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ error: 'zone_code_taken' });
      }
      throw error;
    }
  }

  @Put(':id/area')
  async setArea(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(areaBody)) body: { area: ZonePolygon },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [before] = await tx.$queryRaw<{ area: string | null }[]>`
        SELECT ST_AsGeoJSON(area, 6) AS area FROM zones WHERE id = ${id} FOR UPDATE`;
      if (!before) throw new NotFoundException({ error: 'zone_not_found' });
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
