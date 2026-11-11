import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  compareForecasts,
  createForecast,
  deleteForecast,
  forecastBudgetPreview,
  forecastDetail,
  forecastSuggestion,
  forecastToBudget,
  listForecasts,
  renameForecast,
  saveForecastDrivers,
  saveForecastOverrides,
  setForecastStatus,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  createForecastSchema,
  forecastDriversSchema,
  forecastOverridesSchema,
  forecastToBudgetSchema,
  renameForecastSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Forecast (Accounting > Planning): named scenarios of the next 12 Cairo months. Accounting
 * view reads, use creates and edits drafts, manage approves, opens again and writes an
 * approved scenario into the budgets.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance/forecasts')
export class ForecastController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get()
  list() {
    return listForecasts(this.prisma);
  }

  /** What the system would start a new scenario from (nothing is saved). */
  @Get('suggestion')
  suggestion() {
    return forecastSuggestion(this.prisma, this.clock.now());
  }

  @Get('compare')
  @ApiQuery({ name: 'ids', description: 'Scenario ids, comma separated (at most 6)' })
  compare(@Query('ids') ids?: string) {
    const list = (ids ?? '').split(',').filter(Boolean);
    return compareForecasts(this.prisma, list);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createForecastSchema)) body: z.infer<typeof createForecastSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const f = await createForecast(this.prisma, {
      ...body,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
    return { id: f.id };
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return forecastDetail(this.prisma, id);
  }

  @Patch(':id')
  async rename(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(renameForecastSchema)) body: z.infer<typeof renameForecastSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const f = await renameForecast(this.prisma, {
      forecastId: id,
      name: body.name,
      actorUserId: user.sub,
    });
    return { id: f.id, name: f.name };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    await deleteForecast(this.prisma, { forecastId: id, actorUserId: user.sub });
    return { deleted: true };
  }

  @Put(':id/drivers')
  drivers(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(forecastDriversSchema))
    body: z.infer<typeof forecastDriversSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return saveForecastDrivers(this.prisma, {
      forecastId: id,
      changes: body.changes,
      actorUserId: user.sub,
    });
  }

  @Put(':id/overrides')
  overrides(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(forecastOverridesSchema))
    body: z.infer<typeof forecastOverridesSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return saveForecastOverrides(this.prisma, {
      forecastId: id,
      changes: body.changes,
      actorUserId: user.sub,
    });
  }

  @Post(':id/approve')
  @Access('accounting', 'manage')
  async approve(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    const f = await setForecastStatus(this.prisma, {
      forecastId: id,
      status: 'approved',
      actorUserId: user.sub,
    });
    return { id: f.id, status: f.status };
  }

  @Post(':id/reopen')
  @Access('accounting', 'manage')
  async reopen(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    const f = await setForecastStatus(this.prisma, {
      forecastId: id,
      status: 'draft',
      actorUserId: user.sub,
    });
    return { id: f.id, status: f.status };
  }

  /** Which months and accounts the budget would get, and which already hold a budget. */
  @Get(':id/budget-preview')
  budgetPreview(@Param('id') id: string) {
    return forecastBudgetPreview(this.prisma, id);
  }

  @Post(':id/to-budget')
  @Access('accounting', 'manage')
  toBudget(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(forecastToBudgetSchema))
    body: z.infer<typeof forecastToBudgetSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return forecastToBudget(this.prisma, {
      forecastId: id,
      mode: body.mode,
      actorUserId: user.sub,
    });
  }
}
