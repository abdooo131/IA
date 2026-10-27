import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  cancelReturn,
  createReturn,
  DomainError,
  getReturnDetail,
  listReturns,
  returnableStock,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  cancelReturnSchema,
  type CreateReturnBody,
  createReturnSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** The merchant takes stock back out of a dark store. Only their own products and returns. */
@ApiTags('merchant')
@ApiBearerAuth()
@Roles('merchant')
@Controller('merchant/returns')
export class MerchantReturnsController {
  constructor(private readonly prisma: PrismaService) {}

  private async merchantIdOf(user: AccessTokenClaims) {
    const me = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!me?.merchantId) throw new ForbiddenException({ error: 'no_merchant' });
    return me.merchantId;
  }

  @Get()
  async list(@CurrentUser() user: AccessTokenClaims) {
    return listReturns(this.prisma, { merchantId: await this.merchantIdOf(user) });
  }

  /** Units that can be asked back from one store, per product: sellable, damaged, held. */
  @Get('stock')
  @ApiQuery({ name: 'darkStoreId', type: String })
  async stock(@Query('darkStoreId') darkStoreId: string, @CurrentUser() user: AccessTokenClaims) {
    if (!darkStoreId) throw new DomainError('dark_store_not_found', 404);
    return returnableStock(this.prisma, await this.merchantIdOf(user), darkStoreId);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    const merchantId = await this.merchantIdOf(user);
    const detail = await getReturnDetail(this.prisma, id);
    if (!detail || detail.merchant.id !== merchantId)
      throw new DomainError('return_not_found', 404);
    return detail;
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createReturnSchema)) body: CreateReturnBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const ret = await createReturn(this.prisma, {
      ...body,
      merchantId: await this.merchantIdOf(user),
      actorUserId: user.sub,
    });
    return { id: ret.id, reference: ret.reference };
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelReturnSchema)) body: z.infer<typeof cancelReturnSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return cancelReturn(this.prisma, {
      returnId: id,
      merchantId: await this.merchantIdOf(user),
      actorUserId: user.sub,
      reason: body.reason,
    });
  }
}
