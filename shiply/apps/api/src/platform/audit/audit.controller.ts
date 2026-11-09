import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { PrismaClient } from '@shiply/db';
import { NeedAccess } from '../access/need-access.decorator';
import { DB } from '../tokens';

@Controller('audit')
export class AuditController {
  constructor(@Inject(DB) private readonly db: PrismaClient) {}

  @Get()
  @NeedAccess('settings', 'view')
  async list(@Query('entity') entity?: string, @Query('entityId') entityId?: string, @Query('page') page = '1') {
    const p = Math.max(1, Number(page) || 1);
    const where = { ...(entity ? { entity } : {}), ...(entityId ? { entityId } : {}) };
    const [rows, total] = await Promise.all([
      this.db.auditLog.findMany({ where, orderBy: { at: 'desc' }, skip: (p - 1) * 50, take: 50 }),
      this.db.auditLog.count({ where }),
    ]);
    return { rows, total, page: p, pageSize: 50 };
  }
}
