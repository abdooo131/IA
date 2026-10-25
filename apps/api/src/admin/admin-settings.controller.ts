import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { changeSetting, listAudit, listSettings } from '@shiplynow/db';
import { type AccessTokenClaims, type SettingKey, settingUpdateSchema } from '@shiplynow/shared';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { parseBound } from '../common/dates';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminSettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('settings')
  settings() {
    return listSettings(this.prisma);
  }

  /** Sets a global value or a store override; value null removes the override. */
  @Put('settings')
  async update(
    @Body(new ZodValidationPipe(settingUpdateSchema)) body: z.infer<typeof settingUpdateSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await changeSetting(this.prisma, {
      key: body.key as SettingKey,
      scope: body.scope,
      value: body.value,
      actorUserId: user.sub,
    });
    return listSettings(this.prisma);
  }

  @Get('audit')
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'actorUserId', required: false })
  @ApiQuery({ name: 'action', required: false, description: 'Prefix, for example "order."' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  audit(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
  ) {
    return listAudit(this.prisma, {
      entityType: entityType || undefined,
      entityId: entityId || undefined,
      actorUserId: actorUserId || undefined,
      action: action || undefined,
      from: parseBound(from, 'from'),
      to: parseBound(to, 'to'),
      cursor: cursor || undefined,
    });
  }
}
