import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { cancelReturn, getReturnDetail, listReturns, type ReturnStatus } from '@shiplynow/db';
import { type AccessTokenClaims, cancelReturnSchema, RETURN_STATUSES } from '@shiplynow/shared';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** Returns to merchants across all stores. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/returns')
export class AdminReturnsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: RETURN_STATUSES })
  list(@Query('status') status?: string) {
    const valid = (RETURN_STATUSES as readonly string[]).includes(status ?? '');
    return listReturns(this.prisma, {
      status: valid ? [status as ReturnStatus] : undefined,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const detail = await getReturnDetail(this.prisma, id);
    if (!detail) throw new NotFoundException({ error: 'return_not_found' });
    return detail;
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelReturnSchema)) body: z.infer<typeof cancelReturnSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return cancelReturn(this.prisma, { returnId: id, actorUserId: user.sub, reason: body.reason });
  }
}
