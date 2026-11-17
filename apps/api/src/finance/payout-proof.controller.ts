import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  addPayoutProof,
  createPayoutCheck,
  DomainError,
  getPayoutProofFile,
  getPayoutStatement,
  listPayoutChecks,
  markPayoutCheck,
  payoutControls,
  payoutStatementCsv,
  updatePayoutCheck,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  payoutCheckCreateSchema,
  payoutCheckMarkSchema,
  payoutCheckUpdateSchema,
  payoutProofQuerySchema,
} from '@shiplynow/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { assertMerchant } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import {
  sendProofFile,
  sendStatementCsv,
  sendStatementPdf,
  statementPdfFor,
} from './payout-statement-pdf';

/**
 * Payout controls: the statement of account frozen with each payout (JSON, PDF in English or
 * Arabic, CSV), the proof of transfer (the bank slip with its amount and reference), and the
 * payout checks ticked before Mark paid (accounting use), edited in Setup (accounting manage).
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class PayoutProofController {
  constructor(private readonly prisma: PrismaService) {}

  /** The payout's merchant must be inside the person's merchants. */
  private async scope(access: AccessProfile, payoutId: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      select: { merchantId: true },
    });
    if (!payout) throw new DomainError('payout_not_found', 404);
    assertMerchant(access, payout.merchantId);
  }

  /** SOA, POT and checks of one payout, with what still stands before the viewer can pay it. */
  @Get('payouts/:id/controls')
  async controls(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.scope(access, id);
    return payoutControls(this.prisma, id, user.sub);
  }

  @Get('payouts/:id/statement')
  async statement(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    await this.scope(access, id);
    return getPayoutStatement(this.prisma, id);
  }

  @Get('payouts/:id/statement.pdf')
  @ApiQuery({ name: 'lang', required: false, enum: ['en', 'ar'] })
  async statementPdf(
    @Param('id') id: string,
    @Query('lang') lang: string | undefined,
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    await this.scope(access, id);
    const language = lang === 'ar' ? 'ar' : 'en';
    const made = await statementPdfFor(this.prisma, { payoutId: id, lang: language });
    sendStatementPdf(res, made.pdf, made.number, language);
  }

  @Get('payouts/:id/statement.csv')
  async statementCsv(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    await this.scope(access, id);
    const s = await getPayoutStatement(this.prisma, id);
    sendStatementCsv(res, payoutStatementCsv(s), s.number);
  }

  /**
   * Body: the bank slip itself (PDF, JPG or PNG, at most 5 MB). Query: its file name, the
   * amount in piastres and the bank reference typed from the slip.
   */
  @Post('payouts/:id/proof')
  @ApiQuery({ name: 'name' })
  @ApiQuery({ name: 'amountPiastres' })
  @ApiQuery({ name: 'reference' })
  async uploadProof(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(payoutProofQuerySchema))
    q: z.infer<typeof payoutProofQuerySchema>,
    @Req() req: Request,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.scope(access, id);
    if (!Buffer.isBuffer(req.body)) throw new DomainError('file_type_not_allowed', 400);
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    return addPayoutProof(this.prisma, {
      payoutId: id,
      fileName: q.name,
      contentType,
      data: req.body,
      amountPiastres: q.amountPiastres,
      reference: q.reference,
      actorUserId: user.sub,
    });
  }

  @Get('payouts/:id/proof')
  async proof(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    await this.scope(access, id);
    sendProofFile(res, await getPayoutProofFile(this.prisma, id));
  }

  /** Ticks one active check (the second person check: someone other than the payer). */
  @Post('payouts/:id/checks/:checkId')
  async tick(
    @Param('id') id: string,
    @Param('checkId') checkId: string,
    @Body(new ZodValidationPipe(payoutCheckMarkSchema)) body: z.infer<typeof payoutCheckMarkSchema>,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.scope(access, id);
    const mark = await markPayoutCheck(this.prisma, {
      payoutId: id,
      checkId,
      note: body.note,
      actorUserId: user.sub,
    });
    return { id: mark.id };
  }

  @Get('payout-checks')
  async checks() {
    const rows = await listPayoutChecks(this.prisma);
    return rows.map((c) => ({
      id: c.id,
      code: c.code,
      labelEn: c.labelEn,
      labelAr: c.labelAr,
      active: c.active,
      system: c.system,
      sort: c.sort,
      createdBy: c.createdBy?.name ?? null,
    }));
  }

  @Post('payout-checks')
  @Access('accounting', 'manage')
  async createCheck(
    @Body(new ZodValidationPipe(payoutCheckCreateSchema))
    body: z.infer<typeof payoutCheckCreateSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const check = await createPayoutCheck(this.prisma, { ...body, actorUserId: user.sub });
    return { id: check.id };
  }

  @Patch('payout-checks/:id')
  @Access('accounting', 'manage')
  async updateCheck(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(payoutCheckUpdateSchema))
    body: z.infer<typeof payoutCheckUpdateSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const check = await updatePayoutCheck(this.prisma, { id, ...body, actorUserId: user.sub });
    return { id: check.id, active: check.active };
  }
}
