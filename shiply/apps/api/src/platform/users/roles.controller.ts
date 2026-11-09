import { Controller, Get, Inject } from '@nestjs/common';
import type { PrismaClient } from '@shiply/db';
import { NeedAccess } from '../access/need-access.decorator';
import { DB } from '../tokens';

@Controller('roles')
export class RolesController {
  constructor(@Inject(DB) private readonly db: PrismaClient) {}

  @Get()
  @NeedAccess('settings', 'view')
  async list() {
    return this.db.jobRole.findMany({ select: { key: true, nameEn: true, nameAr: true }, orderBy: { nameEn: 'asc' } });
  }
}
