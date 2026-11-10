import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  payablesAging,
  receivablesAging,
  reminderRules,
  sendReminderNow,
  submitDebitNote,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  type AgingQuery,
  agingQuerySchema,
  debitNoteSchema,
  sendReminderSchema,
} from '@shiplynow/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { assertMerchant, assertStore, limitedMerchants, limitedStores } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { payablesAgingPdf, receivablesAgingPdf } from './aging-pdf';
import { submitted } from './books.controller';

/**
 * Aging reports (who owes us, what we owe suppliers, by age, as of a Cairo day) with their
 * PDFs, the Send reminder now button for merchants who owe us, and debit notes.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class AgingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /**
   * Merchants who owe us (first in, first out) and cheques under collection, by age, with the
   * reminder rules in force (receivables.* settings) for the page to explain.
   */
  @Get('aging/receivables')
  async receivables(
    @Query(new ZodValidationPipe(agingQuerySchema)) q: AgingQuery,
    @CurrentAccess() access: AccessProfile,
  ) {
    return {
      ...(await this.receivablesReport(q, access)),
      reminderRules: await reminderRules(this.prisma),
    };
  }

  private receivablesReport(q: AgingQuery, access: AccessProfile) {
    return receivablesAging(this.prisma, {
      day: q.day,
      q: q.q,
      now: this.clock.now(),
      merchantIds: limitedMerchants(access),
    });
  }

  @Get('aging/receivables/export.pdf')
  async receivablesPdf(
    @Query(new ZodValidationPipe(agingQuerySchema)) q: AgingQuery,
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    const report = await this.receivablesReport(q, access);
    const lang = q.lang ?? 'en';
    send(
      res,
      await receivablesAgingPdf(report, lang, q.q),
      `receivables-aging-${report.asOf}-${lang}`,
    );
  }

  /** Open supplier bills by how late they are; a store filter keeps that store's bills. */
  @Get('aging/payables')
  payables(
    @Query(new ZodValidationPipe(agingQuerySchema)) q: AgingQuery,
    @CurrentAccess() access: AccessProfile,
  ) {
    if (q.store) assertStore(access, q.store);
    return payablesAging(this.prisma, {
      day: q.day,
      q: q.q,
      storeId: q.store ?? null,
      now: this.clock.now(),
      storeIds: limitedStores(access),
    });
  }

  @Get('aging/payables/export.pdf')
  async payablesPdf(
    @Query(new ZodValidationPipe(agingQuerySchema)) q: AgingQuery,
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    const report = await this.payables(q, access);
    const lang = q.lang ?? 'en';
    const store = q.store
      ? await this.prisma.darkStore.findUnique({ where: { id: q.store } })
      : null;
    send(
      res,
      await payablesAgingPdf(report, lang, {
        store: store ? (lang === 'ar' ? store.nameAr : store.nameEn) : null,
        q: q.q,
      }),
      `payables-aging-${report.asOf}-${lang}`,
    );
  }

  /**
   * Send reminder now: a payment reminder to a merchant who owes us (notification, email,
   * push). It counts toward receivables.reminder_max and is sent even past it.
   */
  @Post('receivables/:merchantId/remind')
  remind(
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(sendReminderSchema)) body: z.infer<typeof sendReminderSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    assertMerchant(access, merchantId);
    return sendReminderNow(this.prisma, {
      merchantId,
      actorUserId: user.sub,
      idempotencyKey: body.idempotencyKey,
      now: this.clock.now(),
    });
  }

  /**
   * A debit note against an invoice: charges the merchant more (fees before VAT, VAT at the
   * global rate). It raises what the merchant owes, so it waits for a second person while
   * finance.approve_money_in is on.
   */
  @Post('invoices/:id/debit-notes')
  async debitNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(debitNoteSchema)) body: z.infer<typeof debitNoteSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const invoice = await this.prisma.taxInvoice.findUnique({
      where: { id },
      select: { merchantId: true },
    });
    if (invoice) assertMerchant(access, invoice.merchantId);
    if (body.darkStoreId) assertStore(access, body.darkStoreId);
    return submitted(
      await submitDebitNote(this.prisma, { ...body, invoiceId: id, actorUserId: user.sub }),
    );
  }
}

function send(res: Response, pdf: Buffer, name: string) {
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${name}.pdf"`);
  res.setHeader('cache-control', 'private, no-store');
  res.send(pdf);
}
