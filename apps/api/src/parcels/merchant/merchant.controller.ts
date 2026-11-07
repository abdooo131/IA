import { ParseIdPipe } from '../common/id.pipe';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { CurrentUser, Public, Roles, assertMerchantRight, type SessionUser } from '../auth/auth';
import type { Response } from 'express';
import { MerchantDeskService } from './desk.service';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { MerchantService } from './merchant.service';

function merchantOf(user: SessionUser, right?: 'orders' | 'pickups' | 'money' | 'settings'): string {
  if (!user.merchantId) throw new DomainError('forbidden', 'This account is not linked to a merchant', 403);
  if (right) assertMerchantRight(user, right);
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
    return this.service.list(merchantOf(user, 'orders'), query);
  }

  @Post('shipments')
  create(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.service.create(merchantOf(user, 'orders'), body, user.id);
  }

  @Post('shipments/bulk')
  @HttpCode(200)
  bulk(@CurrentUser() user: SessionUser, @Body() body: { rows?: unknown }) {
    return this.service.createMany(merchantOf(user, 'orders'), body?.rows, user.id);
  }

  @Get('shipments/:id')
  get(@CurrentUser() user: SessionUser, @Param('id', ParseIdPipe) id: string) {
    return this.service.get(merchantOf(user, 'orders'), id);
  }

  @Post('shipments/:id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: SessionUser, @Param('id', ParseIdPipe) id: string) {
    await this.service.cancel(merchantOf(user, 'orders'), id, user.id);
    return { ok: true };
  }

  @Post('shipments/:id/decision')
  @HttpCode(200)
  async decide(@CurrentUser() user: SessionUser, @Param('id', ParseIdPipe) id: string, @Body() body: unknown) {
    await this.service.decide(merchantOf(user, 'orders'), id, body, user.id);
    return { ok: true };
  }

  @Get('pickups')
  pickups(@CurrentUser() user: SessionUser) {
    return this.service.pickups(merchantOf(user, 'pickups'));
  }

  @Post('pickups')
  requestPickup(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.service.requestPickup(merchantOf(user, 'pickups'), body, user.id);
  }

  @Post('pickups/:id/cancel')
  @HttpCode(200)
  async cancelPickup(@CurrentUser() user: SessionUser, @Param('id', ParseIdPipe) id: string) {
    await this.service.cancelPickup(merchantOf(user, 'pickups'), id);
    return { ok: true };
  }

  @Get('statement')
  statement(@CurrentUser() user: SessionUser) {
    return this.service.statement(merchantOf(user, 'money'));
  }

  @Get('profile')
  profile(@CurrentUser() user: SessionUser) {
    return this.prisma.merchant.findUniqueOrThrow({ where: { id: merchantOf(user) }, omit: { logo: true }, include: { homeHub: true } });
  }
}

/** The merchant desk: team, logo, recurring pickups, prices and analytics. */
@Controller('merchant')
@Roles('MERCHANT')
export class MerchantDeskController {
  constructor(private readonly desk: MerchantDeskService) {}

  private owner(user: SessionUser) {
    if (!user.merchantOwner) throw new DomainError('forbidden', 'Only the account owner can manage the team', 403);
    return merchantOf(user);
  }

  @Get('team')
  team(@CurrentUser() user: SessionUser) {
    return this.desk.team(this.owner(user));
  }

  @Post('team')
  addMember(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.desk.saveTeamMember(this.owner(user), null, body, user);
  }

  @Put('team/:id')
  @HttpCode(200)
  updateMember(@CurrentUser() user: SessionUser, @Param('id', ParseIdPipe) id: string, @Body() body: unknown) {
    return this.desk.saveTeamMember(this.owner(user), id, body, user);
  }

  @Put('logo')
  @HttpCode(200)
  logo(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.desk.setLogo(merchantOf(user, 'settings'), body);
  }

  @Get('recurring-pickup')
  async recurring(@CurrentUser() user: SessionUser) {
    return (await this.desk.recurring(merchantOf(user, 'pickups'))) ?? { weekdays: [], active: false, notes: '' };
  }

  @Put('recurring-pickup')
  @HttpCode(200)
  saveRecurring(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.desk.saveRecurring(merchantOf(user, 'pickups'), body);
  }

  @Get('quote')
  quote(@CurrentUser() user: SessionUser, @Query() query: unknown) {
    return this.desk.quote(merchantOf(user, 'orders'), query);
  }

  @Get('prices')
  prices(@CurrentUser() user: SessionUser) {
    return this.desk.priceList(merchantOf(user));
  }

  @Get('analytics')
  analytics(@CurrentUser() user: SessionUser, @Query('days') days?: string) {
    return this.desk.analytics(merchantOf(user), days);
  }
}

/** Public: merchant sign up with a phone code, and the customer's actions on the tracking page. */
@Controller()
export class PublicDeskController {
  constructor(private readonly desk: MerchantDeskService) {}

  @Public()
  @Post('auth/signup/code')
  @HttpCode(200)
  code(@Body() body: unknown) {
    return this.desk.requestCode(body);
  }

  @Public()
  @Post('auth/signup')
  signup(@Body() body: unknown) {
    return this.desk.signup(body);
  }

  @Public()
  @Get('track/:number/logo')
  async logo(@Param('number') number: string, @Res() res: Response) {
    const f = await this.desk.logoForParcel(number);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(f.data));
  }

  @Public()
  @Post('track/:number/action')
  @HttpCode(200)
  action(@Param('number') number: string, @Body() body: unknown) {
    return this.desk.customerAction(number, body);
  }
}

/** Operations: sign ups to approve, tiers, agreed prices, the message outbox, the jobs. */
@Controller('admin')
@Roles('ADMIN')
export class AdminDeskController {
  constructor(private readonly desk: MerchantDeskService) {}

  @Get('signups')
  signups() {
    return this.desk.pendingSignups();
  }

  @Post('merchants/:id/signup/:decision')
  @HttpCode(200)
  decide(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string, @Param('decision') d: string) {
    if (d !== 'approve' && d !== 'reject') throw new DomainError('invalid_input', 'Use approve or reject', 422);
    return this.desk.decideSignup(id, d === 'approve', u);
  }

  @Get('price-tiers')
  tiers() {
    return this.desk.tiers();
  }

  @Put('price-tiers')
  @HttpCode(200)
  saveTiers(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.desk.saveTiers(body, u);
  }

  @Get('merchants/:id/prices')
  prices(@Param('id', ParseIdPipe) id: string) {
    return this.desk.priceList(id);
  }

  @Put('merchants/:id/prices')
  @HttpCode(200)
  savePrices(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string, @Body() body: unknown) {
    return this.desk.saveMerchantPrices(id, body, u);
  }

  @Get('messages')
  outbox(@Query('status') status?: string) {
    return this.desk.outbox(status || undefined);
  }

  @Post('jobs/recurring-pickups')
  @HttpCode(200)
  async recurring() {
    return { made: await this.desk.createRecurringPickups() };
  }

  @Post('jobs/send-messages')
  @HttpCode(200)
  send() {
    return this.desk.sendQueued();
  }
}
