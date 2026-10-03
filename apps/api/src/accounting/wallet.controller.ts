import { Body, Controller, Get, Post, Query, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../common/context';
import { Ctx, Roles } from '../common/decorators';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import { MERCHANT } from '../common/roles';
import { parse } from '../common/zod';
import { nextCashout } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { CashoutService, maskIban } from './cashout.service';
import { FinanceService } from './finance.service';

/** Merchant wallet: balance, statement and cashouts. Row level security limits everything to the caller. */
@Controller('merchant/wallet')
@Roles(...MERCHANT)
@UseInterceptors(NoStoreInterceptor)
export class WalletController {
  constructor(private readonly cashouts: CashoutService, private readonly finance: FinanceService, private readonly prisma: PrismaService) {}

  @Get()
  async summary(@Ctx() ctx: RequestContext) {
    const merchantId = ctx.merchantId!;
    return this.prisma.withContext(ctx, async (tx) => {
      const [s, merchant, bank, fees] = await Promise.all([
        this.cashouts.summary(tx, merchantId),
        tx.merchant.findUniqueOrThrow({ where: { id: merchantId } }),
        tx.merchantBankDetails.findUnique({ where: { merchantId } }),
        this.cashouts.feeConfig(tx),
      ]);
      return {
        ...s,
        cashoutFrequency: merchant.cashoutFrequency,
        nextCashoutDate: nextCashout(merchant.cashoutFrequency, new Date()).toISOString().slice(0, 10),
        bank: bank ? { bankName: bank.bankName, accountName: bank.accountName, iban: maskIban(bank.iban), lastChangedAt: bank.lastChangedAt } : null,
        fees,
      };
    });
  }

  @Get('statement')
  statement(@Ctx() ctx: RequestContext, @Query('page') page?: string) {
    return this.finance.statement(ctx, ctx.merchantId!, Math.max(1, parseInt(page ?? '1', 10) || 1));
  }

  @Get('cashouts')
  list(@Ctx() ctx: RequestContext) {
    return this.cashouts.list(ctx, { merchantId: ctx.merchantId! });
  }

  @Post('cashouts/quote')
  quote(@Body() body: unknown) {
    const b = parse(z.object({ amount: z.number().int().positive(), method: z.enum(['BANK', 'FAWRY_ACCOUNT', 'FAWRY_CARD']) }), body);
    return this.cashouts.quote(b.method, b.amount);
  }

  @Post('cashouts')
  @Roles('MERCHANT_OWNER')
  request(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(
      z.object({ amount: z.number().int().positive(), method: z.enum(['BANK', 'FAWRY_ACCOUNT', 'FAWRY_CARD']), destination: z.string().max(40).optional().nullable() }),
      body,
    );
    return this.cashouts.request(ctx, ctx.merchantId!, b);
  }
}
