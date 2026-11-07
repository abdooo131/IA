import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { storePettyCash, submitPettyCash } from '@shiplynow/db';
import { type AccessTokenClaims, pettyCashLabel, pettyCashSchema } from '@shiplynow/shared';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from './store-access.service';

/**
 * Petty cash: store staff pay a small expense from the store's cash box with a receipt photo
 * (uploaded first with POST /photos?kind=receipt). Large ones, or ones that would leave the box
 * below its float, wait for finance.
 */
@ApiTags('store')
@ApiBearerAuth()
@Access('store')
@Controller('stores/:storeId/petty-cash')
export class StorePettyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StoreAccessService,
  ) {}

  /** Categories staff may choose, what the box holds, the limits and recent expenses. */
  @Get()
  async overview(@Param('storeId') storeId: string, @CurrentUser() user: AccessTokenClaims) {
    await this.access.check(user, storeId);
    return storePettyCash(this.prisma, storeId);
  }

  @Post()
  async create(
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(pettyCashSchema)) body: z.infer<typeof pettyCashSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    const result = await submitPettyCash(this.prisma, {
      ...body,
      darkStoreId: storeId,
      actorUserId: user.sub,
    });
    return { ...result, label: pettyCashLabel(result.number) };
  }
}
