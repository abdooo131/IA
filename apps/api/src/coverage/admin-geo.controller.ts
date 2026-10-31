import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  addAreaName,
  decideSuggestion,
  geoStats,
  listSuggestions,
  resolveByAreas,
  searchAreas,
} from '@shiplynow/db';
import type { AccessTokenClaims } from '@shiplynow/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { GeoImportService } from './geo-import.service';

const resolveSchema = z.object({ address: z.string().trim().min(2).max(500) });
const decideSchema = z.object({
  approve: z.boolean(),
  phrase: z.string().trim().min(2).max(120).optional(),
});
const nameSchema = z.object({ name: z.string().trim().min(2).max(120) });
const importSchema = z.object({ kind: z.enum(['places', 'streets']) });

/** The area map: how addresses are placed, names it learned, and filling it from OpenStreetMap. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/geo')
export class AdminGeoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imports: GeoImportService,
  ) {}

  @Get()
  async overview() {
    return { ...(await geoStats(this.prisma)), import: this.imports.status() };
  }

  /** Tries an address on the area engine alone (no paid lookup, nothing saved). */
  @Post('resolve')
  resolve(@Body(new ZodValidationPipe(resolveSchema)) body: z.infer<typeof resolveSchema>) {
    return resolveByAreas(this.prisma, body.address);
  }

  @Get('suggestions')
  suggestions() {
    return listSuggestions(this.prisma);
  }

  @Post('suggestions/:id')
  decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decideSchema)) body: z.infer<typeof decideSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return decideSuggestion(this.prisma, { suggestionId: id, ...body, actorUserId: user.sub });
  }

  @Get('areas')
  areas(@Query('q') q = '') {
    return searchAreas(this.prisma, q);
  }

  @Post('areas/:id/names')
  addName(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(nameSchema)) body: z.infer<typeof nameSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return addAreaName(this.prisma, { areaId: id, name: body.name, actorUserId: user.sub });
  }

  @Post('import')
  startImport(
    @Body(new ZodValidationPipe(importSchema)) body: z.infer<typeof importSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.imports.start(body.kind, user.sub);
  }
}
