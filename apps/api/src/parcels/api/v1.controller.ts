import { ParseIdPipe } from '../common/id.pipe';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Public, Roles, type SessionUser } from '../auth/auth';
import { PrismaService } from '../common/prisma.service';
import { sendDueWebhooks } from '../common/webhooks';
import { ApiKeyGuard, Caller, type ApiCaller } from './api-key';
import { DeveloperService } from './developer.service';
import { V1Service } from './v1.service';

/** The merchant API. Signs in with an API key, not a session. */
@Controller('v1')
@Public()
@UseGuards(ApiKeyGuard)
export class V1Controller {
  constructor(private readonly v1: V1Service) {}

  @Get('me')
  me(@Caller() c: ApiCaller) {
    return this.v1.me(c);
  }

  @Get('locations')
  locations() {
    return this.v1.locations();
  }

  @Get('quote')
  quote(@Caller() c: ApiCaller, @Query() q: unknown) {
    return this.v1.quote(c, q);
  }

  @Post('shipments')
  async create(
    @Caller() c: ApiCaller,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res() res: Response,
  ) {
    const r = await this.v1.once(c, key, () => this.v1.create(c, body));
    if (r.replay) res.setHeader('Idempotent-Replayed', 'true');
    res.status(r.status).json(r.body);
  }

  @Post('shipments/bulk')
  async bulk(
    @Caller() c: ApiCaller,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res() res: Response,
  ) {
    const r = await this.v1.once(c, key, () => this.v1.createMany(c, body));
    if (r.replay) res.setHeader('Idempotent-Replayed', 'true');
    res.status(r.status).json(r.body);
  }

  @Get('shipments')
  list(@Caller() c: ApiCaller, @Query() q: unknown) {
    return this.v1.list(c, q);
  }

  @Get('shipments/:number')
  get(@Caller() c: ApiCaller, @Param('number') n: string) {
    return this.v1.get(c, n);
  }

  @Post('shipments/:number/cancel')
  @HttpCode(200)
  cancel(@Caller() c: ApiCaller, @Param('number') n: string) {
    return this.v1.cancel(c, n);
  }

  @Get('shipments/:number/label')
  label(@Caller() c: ApiCaller, @Param('number') n: string) {
    return this.v1.label(c, n);
  }

  @Post('pickups')
  pickup(@Caller() c: ApiCaller, @Body() body: unknown) {
    return this.v1.pickup(c, body);
  }

  @Post('sandbox/shipments/:number/advance')
  @HttpCode(200)
  advance(@Caller() c: ApiCaller, @Param('number') n: string, @Body() body: unknown) {
    return this.v1.advance(c, n, body);
  }
}

/** The Developers page in the merchant panel. */
@Controller('merchant/developer')
@Roles('MERCHANT')
export class DeveloperController {
  constructor(private readonly dev: DeveloperService) {}

  @Get('keys')
  keys(@CurrentUser() u: SessionUser) {
    return this.dev.keys(u);
  }

  @Post('keys')
  createKey(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.dev.createKey(u, body);
  }

  @Post('keys/:id/revoke')
  @HttpCode(200)
  revoke(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string) {
    return this.dev.revokeKey(u, id);
  }

  @Get('webhooks')
  hooks(@CurrentUser() u: SessionUser) {
    return this.dev.hooks(u);
  }

  @Post('webhooks')
  createHook(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.dev.saveHook(u, null, body);
  }

  @Put('webhooks/:id')
  updateHook(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.dev.saveHook(u, id, body);
  }

  @Delete('webhooks/:id')
  deleteHook(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string) {
    return this.dev.deleteHook(u, id);
  }

  @Get('webhooks/:id/secret')
  secret(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string) {
    return this.dev.hookSecret(u, id);
  }

  @Post('webhooks/:id/ping')
  @HttpCode(200)
  ping(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string) {
    return this.dev.pingHook(u, id);
  }

  @Get('webhooks/:id/deliveries')
  deliveries(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string) {
    return this.dev.deliveries(u, id);
  }

  @Post('deliveries/:id/retry')
  @HttpCode(200)
  retry(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string) {
    return this.dev.retry(u, id);
  }
}

/** Sends due webhook calls every 15 seconds. */
@Injectable()
export class WebhookSender implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.SHIPLY_JOBS === 'off') return;
    this.timer = setInterval(() => void this.run(), 15_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run() {
    if (this.busy) return { due: 0, sent: 0 };
    this.busy = true;
    try {
      return await sendDueWebhooks(this.prisma);
    } catch (e) {
      console.error('webhooks', e);
      return { due: 0, sent: 0 };
    } finally {
      this.busy = false;
    }
  }
}
