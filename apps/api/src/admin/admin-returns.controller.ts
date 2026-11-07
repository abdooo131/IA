import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { cancelReturn, getReturnDetail, listReturns, type ReturnStatus } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  cancelReturnSchema,
  RETURN_STATUSES,
  type AccessProfile,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { assertStore, storeFilter } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** Returns to merchants across all stores. */
@ApiTags('admin')
@ApiBearerAuth()
@Access('inventory')
@Controller('admin/returns')
export class AdminReturnsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: RETURN_STATUSES })
  list(@CurrentAccess() access: AccessProfile, @Query('status') status?: string) {
    const valid = (RETURN_STATUSES as readonly string[]).includes(status ?? '');
    return listReturns(this.prisma, {
      status: valid ? [status as ReturnStatus] : undefined,
      darkStoreId: storeFilter(access),
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const detail = await getReturnDetail(this.prisma, id);
    if (!detail) throw new NotFoundException({ error: 'return_not_found' });
    await this.checkStore(id, access);
    return detail;
  }

  @Post(':id/cancel')
  @Access('inventory', 'manage')
  async cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelReturnSchema)) body: z.infer<typeof cancelReturnSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.checkStore(id, access);
    return cancelReturn(this.prisma, { returnId: id, actorUserId: user.sub, reason: body.reason });
  }

  private async checkStore(id: string, access: AccessProfile) {
    const row = await this.prisma.merchantReturn.findUnique({
      where: { id },
      select: { darkStoreId: true },
    });
    if (row) assertStore(access, row.darkStoreId);
  }
}
