import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  approvalThreshold,
  approvePayout,
  attachReceipt,
  booksLock,
  cancelFinanceRequest,
  closeBooks,
  decideFinanceRequest,
  listFinanceRequests,
  missingReceipts,
  receiptsFor,
  recordOpeningBalances,
  DomainError,
  linkAttachments,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  attachReceiptSchema,
  canDo,
  closeBooksSchema,
  decideRequestSchema,
  entryNumber,
  openingBalancesSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

/**
 * Controls on the books: closing months, a second person for large amounts and every claimed
 * money in, receipts on money movements, and the opening balances.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class ControlsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Through which day the books are closed, and the approval limit. */
  @Get('controls')
  async controls() {
    return {
      lock: await booksLock(this.prisma),
      approvalThresholdPiastres: await approvalThreshold(this.prisma),
      waiting: await this.prisma.financeRequest.count({ where: { status: 'pending' } }),
      payoutsToApprove: await this.waitingPayouts(),
      missingReceipts: (await missingReceipts(this.prisma, 0)).count,
    };
  }

  private async waitingPayouts() {
    const limit = await approvalThreshold(this.prisma);
    if (limit <= 0) return 0;
    return this.prisma.payout.count({
      where: { status: 'draft', approvedById: null, amountPiastres: { gte: limit } },
    });
  }

  /** Close the books through a day (approve level); moving it back needs settings manage too, with a reason. */
  @Post('books-lock')
  @Access('accounting', 'manage')
  close(
    @Body(new ZodValidationPipe(closeBooksSchema)) body: z.infer<typeof closeBooksSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return closeBooks(this.prisma, {
      day: body.day,
      reason: body.reason,
      actorUserId: user.sub,
      // Reopening closed days is for the owners: people with settings manage.
      actorRole: canDo(access, 'settings', 'manage') ? 'admin' : 'finance',
    });
  }

  @Get('requests')
  @ApiQuery({ name: 'status', required: false, enum: REQUEST_STATUSES })
  requests(@Query('status') status?: string) {
    const known = REQUEST_STATUSES.find((s) => s === status);
    return listFinanceRequests(this.prisma, known);
  }

  @Post('requests/:id/decide')
  @Access('accounting', 'manage')
  async decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decideRequestSchema)) body: z.infer<typeof decideRequestSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const result = await decideFinanceRequest(this.prisma, {
      requestId: id,
      approve: body.approve,
      note: body.note,
      actorUserId: user.sub,
    });
    const entry = result.entryId
      ? await this.prisma.ledgerEntry.findUnique({ where: { id: result.entryId } })
      : null;
    return { ...result, number: entry ? entryNumber(entry.number) : null };
  }

  @Post('requests/:id/cancel')
  cancelRequest(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return cancelFinanceRequest(this.prisma, { requestId: id, actorUserId: user.sub });
  }

  @Post('payouts/:id/approve')
  @Access('accounting', 'manage')
  approve(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return approvePayout(this.prisma, { payoutId: id, actorUserId: user.sub });
  }

  /**
   * Add receipts to a record later: files uploaded with POST /finance/files (photoIds, photos or
   * PDF) or one photo uploaded the earlier way with POST /photos?kind=receipt (photoId).
   */
  @Post('attachments')
  attach(
    @Body(new ZodValidationPipe(attachReceiptSchema)) body: z.infer<typeof attachReceiptSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const { photoId, photoIds, entryId, payoutId, requestId } = body;
    const target = entryId ? { entryId } : payoutId ? { payoutId } : { requestId: requestId! };
    return this.prisma.$transaction(async (tx) => {
      if (photoIds?.length) {
        if (entryId && !(await tx.ledgerEntry.findUnique({ where: { id: entryId } })))
          throw new DomainError('entry_not_found', 404);
        if (payoutId && !(await tx.payout.findUnique({ where: { id: payoutId } })))
          throw new DomainError('payout_not_found', 404);
        if (requestId && !(await tx.financeRequest.findUnique({ where: { id: requestId } })))
          throw new DomainError('request_not_found', 404);
        await linkAttachments(tx, { ids: photoIds, actorUserId: user.sub, target });
      }
      if (photoId) await attachReceipt(tx, { ...target, photoId, actorUserId: user.sub });
      return { attached: (photoIds?.length ?? 0) + (photoId ? 1 : 0) };
    });
  }

  @Get('attachments/missing')
  missing() {
    return missingReceipts(this.prisma);
  }

  @Get('entries/:id/attachments')
  entryAttachments(@Param('id') id: string) {
    return receiptsFor(this.prisma, { entryId: id });
  }

  @Get('payouts/:id/attachments')
  payoutAttachments(@Param('id') id: string) {
    return receiptsFor(this.prisma, { payoutId: id });
  }

  /** The balances the books start from, once (admin only). */
  /** Posted once: owners only (accounting and settings manage). */
  @Post('opening-balances')
  @Access('accounting', 'manage', { also: [['settings', 'manage']] })
  async opening(
    @Body(new ZodValidationPipe(openingBalancesSchema)) body: z.infer<typeof openingBalancesSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const entry = await recordOpeningBalances(this.prisma, { ...body, actorUserId: user.sub });
    return { id: entry.id, number: entryNumber(entry.number) };
  }
}
