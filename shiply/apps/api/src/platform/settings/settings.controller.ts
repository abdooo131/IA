import { Body, Controller, Get, HttpException, Inject, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { NeedAccess } from '../access/need-access.decorator';
import { AuditService } from '../audit/audit.service';
import { DB } from '../tokens';
import { parse } from '../validate';
import { SETTING_DEFAULTS, SETTING_SCHEMAS, SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get(':key')
  @NeedAccess('settings', 'view')
  async get(@Param('key') key: string) {
    if (!(key in SETTING_DEFAULTS)) throw new HttpException({ error: 'unknown_setting' }, 404);
    return { key, value: await this.settings.get(key) };
  }

  @Put(':key')
  @NeedAccess('settings', 'manage')
  async put(@Param('key') key: string, @Body() body: unknown, @Req() req: Request) {
    if (!(key in SETTING_DEFAULTS)) throw new HttpException({ error: 'unknown_setting' }, 404);
    const { value } = parse(z.object({ value: SETTING_SCHEMAS[key] ?? z.never() }), body);
    const before = await this.settings.get(key);
    await this.db.$transaction(async (tx) => {
      await this.settings.set(tx, key, value, req.user!.id);
      await this.audit.record(tx, { userId: req.user!.id, action: 'setting.changed', entity: 'setting', entityId: key, before: { value: before }, after: { value } });
    });
    return { key, value };
  }
}
