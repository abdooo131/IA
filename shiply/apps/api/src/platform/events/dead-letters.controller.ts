import { Controller, Get, HttpCode, HttpException, Inject, Injectable, OnModuleInit, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaClient } from '@shiply/db';
import { atLeast } from '@shiply/shared';
import { NeedAccess } from '../access/need-access.decorator';
import { AuditService } from '../audit/audit.service';
import { HomeRegistry } from '../home/home.registry';
import { DB } from '../tokens';

@Controller('events/dead')
export class DeadLettersController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @NeedAccess('settings', 'view')
  async list() {
    const rows = await this.db.eventDelivery.findMany({
      where: { status: 'dead' },
      include: { event: { select: { type: true, at: true, payload: true } } },
      orderBy: { nextAt: 'desc' },
      take: 200,
    });
    return { rows };
  }

  @Post(':eventId/:handler/retry')
  @HttpCode(200)
  @NeedAccess('settings', 'manage')
  async retry(@Param('eventId') eventId: string, @Param('handler') handler: string, @Req() req: Request) {
    return this.db.$transaction(async (tx) => {
      const d = await tx.eventDelivery.findUnique({ where: { eventId_handler: { eventId, handler } } });
      if (!d || d.status !== 'dead') throw new HttpException({ error: 'not_found' }, 404);
      await tx.eventDelivery.update({
        where: { eventId_handler: { eventId, handler } },
        data: { status: 'pending', attempts: 0, nextAt: new Date() },
      });
      await this.audit.record(tx, { userId: req.user!.id, action: 'event.retried', entity: 'event', entityId: `${eventId}:${handler}`, before: { status: 'dead', lastError: d.lastError } });
      return { ok: true };
    });
  }
}

/** Settings managers see dead events first on Home. */
@Injectable()
export class DeadLettersAttention implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(HomeRegistry) private readonly home: HomeRegistry,
  ) {}

  onModuleInit() {
    const count = () => this.db.eventDelivery.count({ where: { status: 'dead' } });
    this.home.addAttention(async (user) => {
      if (!atLeast(user.access.settings, 'manage')) return [];
      const n = await count();
      return n ? [{ app: 'settings', text: 'home.deadEvents', values: { count: n }, href: '/settings/dead-letters', urgency: 1 }] : [];
    });
    this.home.addCount('settings', async (user) => (atLeast(user.access.settings, 'manage') ? count() : 0));
  }
}
