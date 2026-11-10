import { Controller, ForbiddenException, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { listAudit, recordRef } from '@shiplynow/db';
import { type AccessProfile, canDo, RECORD_APPS, recordNeedsCustomerData } from '@shiplynow/shared';
import { assertRecordScope } from '../auth/access-scope';
import { Access, ANY_APP, CurrentAccess } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Which app's people may read a record's history (view level). Money records belong to
 * accounting; merchants and riders have wallets, so accounting reads theirs too. Anything not
 * listed (users, settings, tickets...) is for settings manage.
 */
const HISTORY_APPS = RECORD_APPS;

/** The history of one record (who did what, when, before and after), newest first. */
@ApiTags('admin')
@ApiBearerAuth()
@Access(ANY_APP)
@Controller('history')
export class HistoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':entityType/:entityId')
  async history(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentAccess() access: AccessProfile,
  ) {
    const apps = HISTORY_APPS[entityType] ?? [];
    const allowed =
      canDo(access, 'settings', 'manage') || apps.some((app) => canDo(access, app, 'view'));
    if (!allowed) throw new ForbiddenException({ error: 'no_access' });
    // A named person's history (who opened the profile, merges) needs customer data too.
    if (recordNeedsCustomerData(entityType) && !access.customerData)
      throw new ForbiddenException({ error: 'no_access' });
    // A record of a known kind stays inside the person's stores and merchants.
    const ref = await recordRef(this.prisma, entityType, entityId);
    if (ref) assertRecordScope(access, ref);
    const page = await listAudit(this.prisma, { entityType, entityId, take: 100 });
    return page.rows.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      actor: r.actor ? { name: r.actor.name, role: r.actor.role } : null,
      before: r.before,
      after: r.after,
    }));
  }
}
