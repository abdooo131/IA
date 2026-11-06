import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  getMerchantAccess,
  listPushDevices,
  pushPreferences,
  savePushSubscription,
  setPushPreference,
} from '@shiplynow/db';
import {
  isTeamRole,
  type MyAccess,
  type MyPush,
  pushEndpointSchema,
  pushPreferenceSchema,
  pushSubscriptionSchema,
  pushTypesFor,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { loadAccess } from '../auth/access.guard';
import type { AuthedRequest } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';

/**
 * A person's own notifications: their devices, their switches and a test. Open to every
 * signed in user (listed in test/route-access.test.ts); each call only touches the caller's rows.
 */
@ApiTags('push')
@ApiBearerAuth()
@Controller('me/push')
export class PushController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  private async myAccess(req: AuthedRequest): Promise<MyAccess> {
    const user = req.user!;
    if (isTeamRole(user.role))
      return { kind: 'team', role: user.role, profile: await loadAccess(req, this.prisma) };
    if (user.role === 'merchant') {
      const me = await getMerchantAccess(this.prisma, user.sub);
      if (!me) throw new ForbiddenException({ error: 'forbidden' });
      return { kind: 'merchant', merchantRole: me.merchantRole, rights: me.rights };
    }
    return { kind: 'rider' };
  }

  @Get()
  async mine(@Req() req: AuthedRequest): Promise<MyPush> {
    const userId = req.user!.sub;
    const types = pushTypesFor(await this.myAccess(req));
    const configured = await this.push.configured();
    return {
      configured,
      publicKey: configured ? this.push.publicKey : null,
      types: await pushPreferences(this.prisma, userId, types),
      devices: await listPushDevices(this.prisma, userId),
    };
  }

  /** Adds this device, or refreshes its keys and language. */
  @Post('subscriptions')
  @HttpCode(200)
  async subscribe(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(pushSubscriptionSchema))
    body: z.infer<typeof pushSubscriptionSchema>,
  ) {
    if (!(await this.push.configured()))
      throw new NotFoundException({ error: 'push_not_configured' });
    const row = await savePushSubscription(this.prisma, {
      userId: req.user!.sub,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      lang: body.lang,
      replaces: body.replaces,
      userAgent: req.get('user-agent') ?? null,
    });
    return { id: row.id };
  }

  /** This device stops receiving (the browser unsubscribed). */
  @Post('subscriptions/remove')
  @HttpCode(200)
  async unsubscribe(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(pushEndpointSchema)) body: z.infer<typeof pushEndpointSchema>,
  ) {
    const removed = await this.prisma.pushSubscription.deleteMany({
      where: { endpoint: body.endpoint, userId: req.user!.sub },
    });
    return { removed: removed.count };
  }

  @Delete('subscriptions/:id')
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    const removed = await this.prisma.pushSubscription.deleteMany({
      where: { id, userId: req.user!.sub },
    });
    if (removed.count === 0) throw new NotFoundException({ error: 'device_not_found' });
    return { removed: 1 };
  }

  @Put('preferences')
  async preference(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(pushPreferenceSchema)) body: z.infer<typeof pushPreferenceSchema>,
  ) {
    const types = pushTypesFor(await this.myAccess(req));
    if (!types.includes(body.type)) throw new ForbiddenException({ error: 'no_access' });
    await setPushPreference(this.prisma, req.user!.sub, body.type, body.enabled);
    return { type: body.type, enabled: body.enabled };
  }

  @Post('test')
  @HttpCode(200)
  async test(@Req() req: AuthedRequest) {
    if (!(await this.push.configured()))
      throw new NotFoundException({ error: 'push_not_configured' });
    const result = await this.push.test(req.user!.sub);
    return { sent: result.sent, failed: result.failed, gone: result.gone };
  }
}
