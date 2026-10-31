import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { listDamageReports, settleDamage } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type SettleDamageBody,
  settleDamageSchema,
} from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** Damaged units waiting for admin to settle who pays. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/damage')
export class AdminDamageController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'settled'] })
  list(@Query('status') status?: string) {
    return listDamageReports(this.prisma, {
      status: status === 'pending' || status === 'settled' ? status : undefined,
    });
  }

  @Post(':id/settle')
  settle(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settleDamageSchema)) body: SettleDamageBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return settleDamage(this.prisma, { ...body, reportId: id, actorUserId: user.sub });
  }
}
