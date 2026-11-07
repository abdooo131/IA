import { Controller, ForbiddenException, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { listAudit } from '@shiplynow/db';
import { type AccessApp, type AccessProfile, canDo } from '@shiplynow/shared';
import { Access, ANY_APP, CurrentAccess } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Which app's people may read a record's history (view level). Money records belong to
 * accounting; merchants and riders have wallets, so accounting reads theirs too. Anything not
 * listed (users, settings, tickets...) is for settings manage.
 */
const HISTORY_APPS: Record<string, readonly AccessApp[]> = {
  order: ['operations'],
  alert: ['operations'],
  zone: ['operations'],
  dark_store: ['operations'],
  geo_area: ['operations'],
  transfer: ['inventory'],
  inbound_manifest: ['inventory'],
  merchant_return: ['inventory'],
  damage_report: ['inventory'],
  stock_count: ['inventory'],
  stock_level: ['inventory'],
  stock_target: ['inventory'],
  refill: ['inventory'],
  merchant: ['merchants', 'accounting'],
  sku: ['merchants'],
  shopify_shop: ['merchants'],
  shopify_app: ['merchants'],
  rider: ['operations', 'accounting'],
  customer: [],
  payout: ['accounting'],
  cash_handover: ['accounting'],
  ledger_account: ['accounting'],
  ledger_entry: ['accounting'],
  finance_request: ['accounting'],
  tax_invoice: ['accounting'],
  bill: ['accounting'],
  purchase_order: ['accounting'],
  packaging_item: ['inventory', 'accounting'],
  email: ['accounting'],
  supplier: ['accounting'],
  bank_statement: ['accounting'],
  bank_statement_line: ['accounting'],
  recurring_entry: ['accounting'],
  fixed_asset: ['accounting'],
  prepayment: ['accounting'],
  budget: ['accounting'],
  company_profile: ['accounting'],
  books: ['accounting'],
  employee: ['hr'],
  cheque: ['accounting'],
  merchant_contract: ['merchants', 'accounting'],
};

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
