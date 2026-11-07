import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  accountingDocument,
  bulkApprovePayouts,
  bulkDecideRequests,
  financeDashboard,
  financeSearch,
  type ListScope,
  queryFinanceList,
} from '@shiplynow/db';
import {
  ACCOUNTING_DOCS,
  type AccessProfile,
  type AccessTokenClaims,
  type AccountingDoc,
  bulkDecideSchema,
  bulkIdsSchema,
  canDo,
  FINANCE_LIST_IDS,
  type FinanceListId,
  type ListQuery,
  listQuerySchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { assertMerchant, assertStore, limitedMerchants, limitedStores } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** The person's scope for lists, the dashboard and the search. */
export function scopeOf(user: AccessTokenClaims, access: AccessProfile): ListScope {
  return {
    userId: user.sub,
    storeIds: limitedStores(access),
    merchantIds: limitedMerchants(access),
  };
}

/**
 * Accounting UX phase A (docs/ARCHITECTURE.md "List views and document pages"): the list
 * views with server side search, filters, grouping, sums and paging; document pages; the
 * dashboard's journal cards; the one search; and bulk approvals.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class FinanceViewsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** The journal cards and the Today strip. */
  @Get('dashboard')
  dashboard(@CurrentUser() user: AccessTokenClaims, @CurrentAccess() access: AccessProfile) {
    return financeDashboard(this.prisma, {
      userId: user.sub,
      stores: limitedStores(access),
      canApprove: canDo(access, 'accounting', 'manage'),
      now: this.clock.now(),
    });
  }

  /**
   * One list view: q, f (filters), g (group by), sort, desc, page, size; open (a group's
   * keys joined by a newline) returns that group's rows; all=1 returns every row (exports).
   */
  @Get('lists/:id')
  list(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    if (!FINANCE_LIST_IDS.includes(id as FinanceListId))
      throw new NotFoundException({ error: 'list_not_found' });
    return queryFinanceList(
      this.prisma,
      id as FinanceListId,
      query,
      scopeOf(user, access),
      this.clock.now(),
    );
  }

  /** A document page: fields, lines, smart buttons and attachments. */
  @Get('documents/:type/:id')
  async document(
    @Param('type') type: string,
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
  ) {
    if (!ACCOUNTING_DOCS.includes(type as AccountingDoc))
      throw new NotFoundException({ error: 'not_found' });
    const doc = await accountingDocument(this.prisma, type as AccountingDoc, id);
    if (!doc) throw new NotFoundException({ error: 'not_found' });
    const store = doc.data.darkStoreId;
    if (typeof store === 'string') assertStore(access, store);
    const merchant = doc.data.merchantId;
    if (typeof merchant === 'string') assertMerchant(access, merchant);
    return doc;
  }

  /** Finds a document by number, an order or a merchant. */
  @Get('search')
  search(
    @Query('q') q: string | undefined,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return financeSearch(this.prisma, q ?? '', scopeOf(user, access));
  }

  /** Approve or reject several waiting requests: each is checked on its own. */
  @Post('requests/bulk-decide')
  @Access('accounting', 'manage')
  bulkDecide(
    @Body(new ZodValidationPipe(bulkDecideSchema)) body: z.infer<typeof bulkDecideSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return bulkDecideRequests(this.prisma, { ...body, actorUserId: user.sub });
  }

  /** Approve several draft payouts above the approval limit. */
  @Post('payouts/bulk-approve')
  @Access('accounting', 'manage')
  bulkApprove(
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return bulkApprovePayouts(this.prisma, { ids: body.ids, actorUserId: user.sub });
  }
}
