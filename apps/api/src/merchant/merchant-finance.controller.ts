import { Controller, ForbiddenException, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { listPayouts, merchantOwed, merchantStatement } from '@shiplynow/db';
import { type AccessTokenClaims, cairoDay } from '@shiplynow/shared';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../auth/decorators';
import { Clock } from '../common/clock';
import { parseRange } from '../common/dates';
import { cairoStamp, csv, egp } from '../finance/finance-csv';
import { PrismaService } from '../prisma/prisma.service';

/** A merchant's own wallet: what we owe them, their statement and their payouts. */
@ApiTags('merchant')
@ApiBearerAuth()
@Roles('merchant')
@Controller('merchant/finance')
export class MerchantFinanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private async merchantOf(user: AccessTokenClaims) {
    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: { merchant: true },
    });
    if (!me?.merchant) throw new ForbiddenException({ error: 'no_merchant' });
    return me.merchant;
  }

  @Get()
  async wallet(@CurrentUser() user: AccessTokenClaims) {
    const merchant = await this.merchantOf(user);
    const payouts = await listPayouts(this.prisma, { merchantId: merchant.id, take: 50 });
    return {
      owedPiastres: await merchantOwed(this.prisma, merchant.id),
      payoutSchedule: merchant.payoutSchedule,
      // Merchants see payouts once they are scheduled or paid, never who handled them.
      payouts: payouts
        .filter((p) => p.status !== 'cancelled')
        .map((p) => ({
          id: p.id,
          cutoffAt: p.cutoffAt,
          amountPiastres: p.amountPiastres,
          status: p.status,
          reference: p.status === 'paid' ? p.reference : null,
          paidAt: p.paidAt,
        })),
    };
  }

  @Get('statement')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async statement(
    @CurrentUser() user: AccessTokenClaims,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const merchant = await this.merchantOf(user);
    const range = parseRange(from, to, this.clock.now(), 30);
    return merchantStatement(this.prisma, merchant.id, range.from, range.to);
  }

  @Get('statement/export.csv')
  async statementCsv(
    @Res() res: Response,
    @CurrentUser() user: AccessTokenClaims,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const merchant = await this.merchantOf(user);
    const range = parseRange(from, to, this.clock.now(), 30);
    const s = await merchantStatement(this.prisma, merchant.id, range.from, range.to);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader(
      'content-disposition',
      `attachment; filename="statement-${cairoDay(range.from)}.csv"`,
    );
    res.send(
      csv(
        ['date_cairo', 'type', 'order', 'amount_egp', 'balance_egp'],
        [
          [cairoStamp(range.from), 'opening_balance', null, null, egp(s.openingOwedPiastres)],
          ...s.lines.map((l) => [
            cairoStamp(l.at),
            l.kind,
            l.orderNumber,
            egp(l.amountPiastres),
            egp(l.balanceAfterPiastres),
          ]),
          [
            cairoStamp(new Date(range.to.getTime() - 1)),
            'closing_balance',
            null,
            null,
            egp(s.closingOwedPiastres),
          ],
        ],
      ),
    );
  }
}
