import { Controller, ForbiddenException, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { listAudit } from '@shiplynow/db';
import type { AccessTokenClaims } from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

/** Records finance may read the history of; admin reads every record's. */
const FINANCE_TYPES = new Set([
  'payout',
  'cash_handover',
  'ledger_account',
  'ledger_entry',
  'merchant',
  'rider',
]);

/** The history of one record (who did what, when, before and after), newest first. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'finance')
@Controller('history')
export class HistoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':entityType/:entityId')
  async history(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    if (user.role === 'finance' && !FINANCE_TYPES.has(entityType))
      throw new ForbiddenException({ error: 'forbidden' });
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
