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
  getPayoutProofFile,
  getPayoutStatement,
  listInvoices,
  listPayouts,
  merchantOwed,
  merchantStatement,
  payoutStatementCsv,
  recordAudit,
  updateMerchantBank,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  cairoDay,
  merchantBankSchema,
  payoutMatches,
  payoutScheduleSchema,
  proofNumber,
  soaNumber,
} from '@shiplynow/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, MerchantRight, Roles } from '../auth/decorators';
import { Clock } from '../common/clock';
import { parseRange } from '../common/dates';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { cairoStamp, csv, egp } from '../finance/finance-csv';
import {
  sendProofFile,
  sendStatementCsv,
  sendStatementPdf,
  statementPdfFor,
} from '../finance/payout-statement-pdf';
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
    const ids = payouts.map((p) => p.id);
    const [statements, proofs, cheques] = await Promise.all([
      this.prisma.payoutStatement.findMany({
        where: { payoutId: { in: ids } },
        select: { payoutId: true, number: true, netPiastres: true },
      }),
      this.prisma.payoutProof.findMany({
        where: { payoutId: { in: ids }, payout: { status: 'paid' } },
        select: {
          payoutId: true,
          number: true,
          amountPiastres: true,
          reference: true,
          contentType: true,
        },
      }),
      this.prisma.cheque.findMany({
        where: { payoutId: { in: ids } },
        select: { payoutId: true },
      }),
    ]);
    return {
      owedPiastres: await merchantOwed(this.prisma, merchant.id),
      payoutSchedule: merchant.payoutSchedule,
      // Merchants see payouts once they are scheduled or paid, never who handled them.
      payouts: payouts
        .filter((p) => p.status !== 'cancelled')
        .map((p) => {
          const soa = statements.find((x) => x.payoutId === p.id);
          // The proof of transfer is shown once the payout is paid.
          const pot = proofs.find((x) => x.payoutId === p.id);
          return {
            id: p.id,
            cutoffAt: p.cutoffAt,
            amountPiastres: p.amountPiastres,
            status: p.status,
            reference: p.status === 'paid' ? p.reference : null,
            paidAt: p.paidAt,
            soa: soa ? { number: soaNumber(soa.number), netPiastres: soa.netPiastres } : null,
            pot: pot
              ? {
                  number: proofNumber(pot.number),
                  amountPiastres: pot.amountPiastres,
                  reference: pot.reference,
                  contentType: pot.contentType,
                }
              : null,
            paidByCheque: cheques.some((c) => c.payoutId === p.id),
            matches: payoutMatches({
              amountPiastres: p.amountPiastres,
              soaNetPiastres: soa?.netPiastres ?? null,
              potAmountPiastres: pot?.amountPiastres ?? null,
            }),
          };
        }),
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

  /** A payout of this merchant that the merchant may see (scheduled or paid, never cancelled). */
  private async ownPayout(user: AccessTokenClaims, payoutId: string) {
    const merchant = await this.merchantOf(user);
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      select: { merchantId: true, status: true },
    });
    if (!payout || payout.merchantId !== merchant.id || payout.status === 'cancelled')
      throw new NotFoundException({ error: 'payout_not_found' });
    return merchant;
  }

  /** The statement of account frozen with one of the merchant's payouts. */
  @Get('payouts/:id/statement')
  async payoutStatement(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    const merchant = await this.ownPayout(user, id);
    return getPayoutStatement(this.prisma, id, merchant.id);
  }

  @Get('payouts/:id/statement.pdf')
  @ApiQuery({ name: 'lang', required: false, enum: ['en', 'ar'] })
  async payoutStatementPdf(
    @Param('id') id: string,
    @Query('lang') lang: string | undefined,
    @CurrentUser() user: AccessTokenClaims,
    @Res() res: Response,
  ) {
    const merchant = await this.ownPayout(user, id);
    const language = lang === 'en' ? 'en' : 'ar';
    const made = await statementPdfFor(this.prisma, {
      payoutId: id,
      lang: language,
      merchantId: merchant.id,
    });
    sendStatementPdf(res, made.pdf, made.number, language);
  }

  @Get('payouts/:id/statement.csv')
  async payoutStatementCsv(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @Res() res: Response,
  ) {
    const merchant = await this.ownPayout(user, id);
    const s = await getPayoutStatement(this.prisma, id, merchant.id);
    sendStatementCsv(res, payoutStatementCsv(s), s.number);
  }

  /** The bank's proof of transfer, once the payout is paid. */
  @Get('payouts/:id/proof')
  async payoutProof(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @Res() res: Response,
  ) {
    const merchant = await this.ownPayout(user, id);
    sendProofFile(res, await getPayoutProofFile(this.prisma, id, merchant.id));
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
