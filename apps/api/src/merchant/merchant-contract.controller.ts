import { Controller, ForbiddenException, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { contractForPrint, getContract, merchantContractView } from '@shiplynow/db';
import type { AccessTokenClaims } from '@shiplynow/shared';
import type { Response } from 'express';
import { CurrentUser, MerchantRight, Roles } from '../auth/decorators';
import { Clock } from '../common/clock';
import { sendContractPdf } from '../contracts/contract-files';
import { renderContractPdf } from '../contracts/contract-pdf';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The merchant reads their own contract (read only; Shiply changes it): the version in force,
 * one agreed for later, earlier versions, and the printed copy in English or Arabic. Drafts,
 * signed files and the team's notes stay with Shiply.
 */
@ApiTags('merchant')
@ApiBearerAuth()
@Roles('merchant')
@MerchantRight('money')
@Controller('merchant')
export class MerchantContractController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private async merchantId(user: AccessTokenClaims) {
    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { merchantId: true },
    });
    if (!me?.merchantId) throw new ForbiddenException({ error: 'no_merchant' });
    return me.merchantId;
  }

  @Get('contract')
  async contract(@CurrentUser() user: AccessTokenClaims) {
    const view = await getContract(this.prisma, await this.merchantId(user), this.clock.now());
    return merchantContractView(view);
  }

  @Get('contract/pdf')
  @ApiQuery({ name: 'lang', required: false, enum: ['en', 'ar'] })
  @ApiQuery({ name: 'version', required: false })
  async pdf(
    @CurrentUser() user: AccessTokenClaims,
    @Res() res: Response,
    @Query('lang') lang?: string,
    @Query('version') versionId?: string,
  ) {
    const print = await contractForPrint(this.prisma, {
      merchantId: await this.merchantId(user),
      versionId: versionId || null,
      now: this.clock.now(),
      merchantCopy: true,
    });
    const language = lang === 'ar' ? 'ar' : 'en';
    sendContractPdf(res, await renderContractPdf(print, language), print.version.label, language);
  }
}
