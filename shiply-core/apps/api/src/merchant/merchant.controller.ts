import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles, type SessionUser } from '../auth/auth';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { MerchantService } from './merchant.service';

function merchantOf(user: SessionUser): string {
  if (!user.merchantId) throw new DomainError('forbidden', 'This account is not linked to a merchant', 403);
  return user.merchantId;
}

@Controller('merchant')
@Roles('MERCHANT')
export class MerchantController {
  constructor(
    private readonly service: MerchantService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('shipments')
  list(@CurrentUser() user: SessionUser, @Query() query: unknown) {
    return this.service.list(merchantOf(user), query);
  }

  @Post('shipments')
  create(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.service.create(merchantOf(user), body, user.id);
  }

  @Post('shipments/bulk')
  @HttpCode(200)
  bulk(@CurrentUser() user: SessionUser, @Body() body: { rows?: unknown }) {
    return this.service.createMany(merchantOf(user), body?.rows, user.id);
  }

  @Get('shipments/:id')
  get(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(merchantOf(user), id);
  }

  @Post('shipments/:id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.cancel(merchantOf(user), id, user.id);
    return { ok: true };
  }

  @Post('shipments/:id/decision')
  @HttpCode(200)
  async decide(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    await this.service.decide(merchantOf(user), id, body, user.id);
    return { ok: true };
  }

  @Get('pickups')
  pickups(@CurrentUser() user: SessionUser) {
    return this.service.pickups(merchantOf(user));
  }

  @Post('pickups')
  requestPickup(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.service.requestPickup(merchantOf(user), body, user.id);
  }

  @Post('pickups/:id/cancel')
  @HttpCode(200)
  async cancelPickup(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.cancelPickup(merchantOf(user), id);
    return { ok: true };
  }

  @Get('statement')
  statement(@CurrentUser() user: SessionUser) {
    return this.service.statement(merchantOf(user));
  }

  @Get('profile')
  profile(@CurrentUser() user: SessionUser) {
    return this.prisma.merchant.findUniqueOrThrow({ where: { id: merchantOf(user) }, include: { homeHub: true } });
  }
}
