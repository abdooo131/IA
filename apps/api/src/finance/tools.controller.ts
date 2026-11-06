import { Body, Controller, Get, Param, Post, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { payoutBankFile, submitAssetDisposal, updateMerchantBank } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  cairoDay,
  disposeAssetSchema,
  merchantBankSchema,
  payoutNumber,
} from '@shiplynow/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { submitted } from './books.controller';
import { csv, egp } from './finance-csv';

/** The payout file for the bank, merchants' bank details, equipment sold. */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class ToolsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get('payouts/bank-file')
  bankFile() {
    return payoutBankFile(this.prisma);
  }

  /**
   * Ready payouts as one file to upload to the bank's bulk transfer: one row per payout.
   * The columns are the usual ones of a bulk transfer sheet; match them to CIB's template.
   */
  @Get('payouts/bank-file.csv')
  async bankFileCsv(@Res() res: Response) {
    const file = await payoutBankFile(this.prisma);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader(
      'content-disposition',
      `attachment; filename="payouts-${cairoDay(this.clock.now())}.csv"`,
    );
    res.send(
      csv(
        [
          'Beneficiary name',
          'Bank',
          'Account number',
          'IBAN',
          'Amount',
          'Currency',
          'Reference',
          'Merchant',
        ],
        file.ready.map((r) => [
          r.beneficiary,
          r.bankName,
          r.accountNumber,
          r.iban,
          egp(r.amountPiastres),
          'EGP',
          payoutNumber(r.number),
          r.merchant,
        ]),
      ),
    );
  }

  @Put('merchants/:id/bank')
  async merchantBank(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(merchantBankSchema)) body: z.infer<typeof merchantBankSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const m = await updateMerchantBank(this.prisma, {
      ...body,
      merchantId: id,
      actorUserId: user.sub,
    });
    return {
      id: m.id,
      bankName: m.bankName,
      bankAccountNumber: m.bankAccountNumber,
      iban: m.iban,
      beneficiaryName: m.beneficiaryName,
    };
  }

  /** Equipment sold or scrapped: waits for a second person. */
  @Post('assets/:id/dispose')
  async dispose(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(disposeAssetSchema)) body: z.infer<typeof disposeAssetSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(
      await submitAssetDisposal(this.prisma, { ...body, assetId: id, actorUserId: user.sub }),
    );
  }
}
