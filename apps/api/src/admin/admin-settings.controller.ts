import { Body, Controller, ForbiddenException, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { changeSetting, listAudit, listSettings } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type SettingKey,
  settingUpdateSchema,
  type AccessProfile,
  canDo,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { Access, ANY_APP, CurrentAccess, CurrentUser } from '../auth/decorators';
import { parseBound } from '../common/dates';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Access('settings', 'manage')
@Controller('admin')
export class AdminSettingsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Every team member's pages read the settings of their apps. */
  @Get('settings')
  @Access(ANY_APP)
  settings() {
    return listSettings(this.prisma);
  }

  /** Sets a global value or a store override; value null removes the override. */
  @Put('settings')
  @Access(['settings', 'merchants'], 'manage')
  async update(
    @Body(new ZodValidationPipe(settingUpdateSchema)) body: z.infer<typeof settingUpdateSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    // A setting is changed with settings manage; merchants manage may set a merchant's own fees.
    const merchantFee = body.scope.startsWith('merchant:');
    if (!canDo(access, 'settings', 'manage') && !merchantFee)
      throw new ForbiddenException({ error: 'no_access' });
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
