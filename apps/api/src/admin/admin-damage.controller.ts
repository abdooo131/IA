import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { listDamageReports, settleDamage } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type SettleDamageBody,
  settleDamageSchema,
  type AccessProfile,
} from '@shiplynow/shared';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { assertStore, storeFilter } from '../auth/access-scope';
import { PrismaService } from '../prisma/prisma.service';

/** Damaged units waiting for admin to settle who pays. */
@ApiTags('admin')
@ApiBearerAuth()
@Access('inventory')
@Controller('admin/damage')
export class AdminDamageController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'settled'] })
  list(@CurrentAccess() access: AccessProfile, @Query('status') status?: string) {
    return listDamageReports(this.prisma, {
      status: status === 'pending' || status === 'settled' ? status : undefined,
      darkStoreId: storeFilter(access),
    });
  }

  @Post(':id/settle')
  @Access('inventory', 'manage')
  async settle(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settleDamageSchema)) body: SettleDamageBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const report = await this.prisma.damageReport.findUnique({
      where: { id },
      select: { darkStoreId: true },
    });
    if (report) assertStore(access, report.darkStoreId);
    return settleDamage(this.prisma, { ...body, reportId: id, actorUserId: user.sub });
  }
}
