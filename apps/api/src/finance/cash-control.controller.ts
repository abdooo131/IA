import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  addMonths,
  cashPosition,
  DomainError,
  listPettyCash,
  markMonthEndItem,
  monthEndChecklist,
  pettyCategories,
  reversePettyCash,
  setPettyCategory,
  unmarkMonthEndItem,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  cairoDay,
  isMonth,
  MONTH_END_ITEMS,
  monthEndMarkSchema,
  PETTY_CASH_STATUSES,
  pettyCashReverseSchema,
  pettyCategorySchema,
} from '@shiplynow/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { assertStore, limitedStores, storeFilter } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { cairoStamp, csv, egp } from './finance-csv';

/**
 * Cash controls for finance: the daily cash position, petty cash from the stores (list,
 * categories, reversing) and the month end checklist. Store scope applies: a person limited
 * to some stores sees only those stores' boxes, riders and petty cash.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class CashControlController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Banks, cash boxes, rider cash by age, merchants owed, bills due within 7 days, the net. */
  @Get('cash-position')
  position(@CurrentAccess() access: AccessProfile) {
    return cashPosition(this.prisma, { stores: limitedStores(access), now: this.clock.now() });
  }

  @Get('cash-position/export.csv')
  async positionCsv(@Res() res: Response, @CurrentAccess() access: AccessProfile) {
    const p = await cashPosition(this.prisma, {
      stores: limitedStores(access),
      now: this.clock.now(),
    });
    const rows: (string | number | null)[][] = [];
    for (const a of p.money.rows)
      rows.push([a.kind, a.code, a.nameEn, null, egp(a.balancePiastres), null, null]);
    for (const r of p.riders.rows)
      rows.push([
        'rider_cash',
        r.badgeCode,
        `${r.name} (${r.store.code})`,
        cairoStamp(r.heldSince),
        egp(r.cashPiastres),
        `fresh ${egp(r.freshPiastres)} / aging ${egp(r.agingPiastres)} / overdue ${egp(r.overduePiastres)}`,
        null,
      ]);
    for (const m of p.merchants?.rows ?? [])
      rows.push([
        'merchant_owed',
        null,
        m.name,
        m.nextPayoutDay,
        egp(0 - m.owedPiastres),
        m.schedule,
        null,
      ]);
    for (const b of p.bills?.rows ?? [])
      rows.push([
        'bill_due',
        `BILL-${String(b.number).padStart(6, '0')}`,
        `${b.supplier} ${b.reference}`,
        b.dueDate,
        egp(0 - b.leftPiastres),
        b.overdue ? 'overdue' : null,
        null,
      ]);
    if (p.netPiastres !== null)
      rows.push(['net_position', null, null, null, egp(p.netPiastres), null, null]);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader(
      'content-disposition',
      `attachment; filename="shiply-cash-position-${cairoDay(this.clock.now())}.csv"`,
    );
    res.send(csv(['section', 'code', 'name', 'date', 'amount_egp', 'detail', 'note'], rows));
  }

  // ─── petty cash ───────────────────────────────────────────────────────────────

  @Get('petty-cash')
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: PETTY_CASH_STATUSES })
  pettyCash(
    @CurrentAccess() access: AccessProfile,
    @Query('darkStoreId') darkStoreId?: string,
    @Query('status') status?: string,
  ) {
    return listPettyCash(this.prisma, {
      darkStoreId: storeFilter(access, darkStoreId),
      status: PETTY_CASH_STATUSES.find((s) => s === status),
    });
  }

  /** Expense categories and whether store staff may use each for petty cash. */
  @Get('petty-cash/categories')
  categories() {
    return pettyCategories(this.prisma);
  }

  @Post('petty-cash/categories/:accountId')
  category(
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(pettyCategorySchema)) body: z.infer<typeof pettyCategorySchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return setPettyCategory(this.prisma, { accountId, petty: body.petty, actorUserId: user.sub });
  }

  /** Takes a posted petty expense back with a reason (approve level). */
  @Post('petty-cash/:id/reverse')
  @Access('accounting', 'manage')
  async reverse(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(pettyCashReverseSchema))
    body: z.infer<typeof pettyCashReverseSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const row = await this.prisma.pettyCashExpense.findUnique({ where: { id } });
    if (!row) throw new DomainError('petty_cash_not_found', 404);
    assertStore(access, row.darkStoreId);
    return reversePettyCash(this.prisma, {
      pettyCashId: id,
      reason: body.reason,
      actorUserId: user.sub,
    });
  }

  // ─── month end ────────────────────────────────────────────────────────────────

  /** The checklist of a month (default: last month), checked live. */
  @Get('month-end')
  @ApiQuery({ name: 'month', required: false, description: 'YYYY-MM, default last month' })
  monthEnd(@Query('month') month?: string) {
    const now = this.clock.now();
    const chosen = month || addMonths(cairoDay(now).slice(0, 7), -1);
    if (!isMonth(chosen)) throw new DomainError('invalid_month', 400);
    return monthEndChecklist(this.prisma, chosen, now);
  }

  @Post('month-end/:month/marks')
  mark(
    @Param('month') month: string,
    @Body(new ZodValidationPipe(monthEndMarkSchema)) body: z.infer<typeof monthEndMarkSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return markMonthEndItem(this.prisma, { month, ...body, actorUserId: user.sub });
  }

  @Delete('month-end/:month/marks/:item')
  unmark(
    @Param('month') month: string,
    @Param('item') item: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const known = MONTH_END_ITEMS.find((i) => i === item);
    if (!known || !isMonth(month)) throw new DomainError('invalid_item', 400);
    return unmarkMonthEndItem(this.prisma, { month, item: known, actorUserId: user.sub });
  }
}
