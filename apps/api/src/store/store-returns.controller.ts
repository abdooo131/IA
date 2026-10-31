import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  DomainError,
  getReturnDetail,
  handOverReturn,
  listReturns,
  pickForReturn,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type ReturnPickBody,
  returnHandOverSchema,
  returnPickSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from './store-access.service';

/** Staff pick merchant returns by scan and hand them to whoever collects. */
@ApiTags('store')
@ApiBearerAuth()
@Roles('admin', 'store_staff')
@Controller('stores/:storeId/returns')
export class StoreReturnsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StoreAccessService,
  ) {}

  @Get()
  async list(@Param('storeId') storeId: string, @CurrentUser() user: AccessTokenClaims) {
    await this.access.check(user, storeId);
    return listReturns(this.prisma, {
      darkStoreId: storeId,
      status: ['requested', 'picking', 'ready'],
    });
  }

  @Get(':id')
  async detail(
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    const detail = await getReturnDetail(this.prisma, id);
    if (!detail || detail.darkStore.id !== storeId) throw new DomainError('return_not_found', 404);
    return detail;
  }

  @Post(':id/pick')
  async pick(
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(returnPickSchema)) body: ReturnPickBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return pickForReturn(this.prisma, {
      ...body,
      returnId: id,
      darkStoreId: storeId,
      actorUserId: user.sub,
    });
  }

  @Post(':id/hand-over')
  async handOver(
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(returnHandOverSchema)) body: z.infer<typeof returnHandOverSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return handOverReturn(this.prisma, {
      returnId: id,
      darkStoreId: storeId,
      collectedBy: body.collectedBy,
      actorUserId: user.sub,
    });
  }
}
