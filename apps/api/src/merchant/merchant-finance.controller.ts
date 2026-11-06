import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  getInvoice,
  listInvoices,
  listPayouts,
  merchantOwed,
  merchantStatement,
  recordAudit,
  updateMerchantBank,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  cairoDay,
  merchantBankSchema,
  payoutScheduleSchema,
} from '@shiplynow/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, MerchantRight, Roles } from '../auth/decorators';
import { Clock } from '../common/clock';
import { parseRange } from '../common/dates';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { cairoStamp, csv, egp } from '../finance/finance-csv';
import { PrismaService } from '../prisma/prisma.service';

/** A merchant's own wallet: what we owe them, their statement and their payouts. */
@ApiTags('merchant')
@ApiBearerAuth()
@Roles('merchant')
@MerchantRight('money')
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

  /** Merchants choose how often they are paid; finance still prepares and sends each payout. */
  @Patch('payout-schedule')
  @MerchantRight('settings')
  async schedule(
    @Body(new ZodValidationPipe(payoutScheduleSchema)) body: z.infer<typeof payoutScheduleSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const merchant = await this.merchantOf(user);
    await this.prisma.$transaction(async (tx) => {
      await tx.merchant.update({
        where: { id: merchant.id },
        data: { payoutSchedule: body.payoutSchedule },
      });
      await recordAudit(tx, {
        actorUserId: user.sub,
        action: 'merchant.payout_schedule',
        entityType: 'merchant',
        entityId: merchant.id,
        before: { payoutSchedule: merchant.payoutSchedule },
        after: { payoutSchedule: body.payoutSchedule },
      });
    });
    return { payoutSchedule: body.payoutSchedule };
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

  /** The merchant's tax invoices and credit notes from us. */
  @Get('invoices')
  async invoices(@CurrentUser() user: AccessTokenClaims): Promise<unknown> {
    const merchant = await this.merchantOf(user);
    return listInvoices(this.prisma, { merchantId: merchant.id });
  }

  @Get('invoices/:id')
  async invoice(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims): Promise<unknown> {
    const merchant = await this.merchantOf(user);
    const { company, ...invoice } = await getInvoice(this.prisma, id);
    if (invoice.merchant.id !== merchant.id)
      throw new NotFoundException({ error: 'invoice_not_found' });
    const { signerKeyHash: _hidden, itemCodes: _codes, ...publicCompany } = company;
    return { ...invoice, company: publicCompany };
  }

  /** The bank account payouts are sent to. */
  @Get('bank')
  async bank(@CurrentUser() user: AccessTokenClaims) {
    const m = await this.merchantOf(user);
    return {
      bankName: m.bankName,
      bankAccountNumber: m.bankAccountNumber,
      iban: m.iban,
      beneficiaryName: m.beneficiaryName,
    };
  }

  @Put('bank')
  async setBank(
    @Body(new ZodValidationPipe(merchantBankSchema)) body: z.infer<typeof merchantBankSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const m = await this.merchantOf(user);
    const after = await updateMerchantBank(this.prisma, {
      ...body,
      merchantId: m.id,
      actorUserId: user.sub,
    });
    return {
      bankName: after.bankName,
      bankAccountNumber: after.bankAccountNumber,
      iban: after.iban,
      beneficiaryName: after.beneficiaryName,
    };
  }
}
