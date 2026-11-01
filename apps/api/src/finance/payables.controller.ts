import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  billAgeing,
  cancelBill,
  createRecurring,
  createSupplier,
  DomainError,
  listBills,
  listFixedAssets,
  listPrepayments,
  listRecurring,
  listSuppliers,
  merchantsOwingUs,
  recordBill,
  requestMerchantPayment,
  setRecurringActive,
  submitAssetPurchase,
  submitBillPayment,
  submitPrepayment,
  submitTaxPayment,
  taxesOwed,
  updateSupplier,
  whtReport,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  assetSchema,
  billNumber,
  billPaymentSchema,
  billSchema,
  cairoDay,
  cancelBillSchema,
  isCalendarDay,
  paymentRequestSchema,
  prepaymentSchema,
  recurringSchema,
  supplierSchema,
  taxPaymentSchema,
  updateSupplierSchema,
} from '@shiplynow/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { submitted } from './books.controller';

const STATUSES = ['open', 'paid', 'cancelled'] as const;
const activeSchema = z.object({ isActive: z.boolean() });

/**
 * Suppliers and their bills, taxes owed and paid, recurring expenses, prepayments, fixed
 * assets and merchants who owe us. Payments go through the second person rule.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Roles('admin', 'finance')
@Controller('finance')
export class PayablesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  // ─── suppliers and bills ───────────────────────────────────────────────────

  @Get('suppliers')
  suppliers() {
    return listSuppliers(this.prisma);
  }

  @Post('suppliers')
  createSupplier(
    @Body(new ZodValidationPipe(supplierSchema)) body: z.infer<typeof supplierSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createSupplier(this.prisma, { ...body, actorUserId: user.sub });
  }

  @Patch('suppliers/:id')
  updateSupplier(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: z.infer<typeof updateSupplierSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateSupplier(this.prisma, { ...body, supplierId: id, actorUserId: user.sub });
  }

  @Get('bills')
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiQuery({ name: 'supplierId', required: false })
  async bills(@Query('status') status?: string, @Query('supplierId') supplierId?: string) {
    const rows = await listBills(this.prisma, {
      status: STATUSES.find((s) => s === status),
      supplierId: supplierId || undefined,
    });
    return rows.map((b) => ({ ...b, numberLabel: billNumber(b.number) }));
  }

  @Post('bills')
  async createBill(
    @Body(new ZodValidationPipe(billSchema)) body: z.infer<typeof billSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const bill = await recordBill(this.prisma, { ...body, actorUserId: user.sub });
    return { id: bill.id, number: billNumber(bill.number) };
  }

  @Post('bills/:id/cancel')
  async cancelBill(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelBillSchema)) body: z.infer<typeof cancelBillSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const bill = await cancelBill(this.prisma, {
      billId: id,
      reason: body.reason,
      actorUserId: user.sub,
    });
    return { id: bill.id, status: bill.status };
  }

  @Post('bills/:id/payments')
  async payBill(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(billPaymentSchema)) body: z.infer<typeof billPaymentSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(
      await submitBillPayment(this.prisma, { ...body, billId: id, actorUserId: user.sub }),
    );
  }

  @Get('bills-ageing')
  @ApiQuery({ name: 'day', required: false })
  ageing(@Query('day') day?: string) {
    if (day && !isCalendarDay(day)) throw new DomainError('invalid_date', 400);
    return billAgeing(this.prisma, day || cairoDay(this.clock.now()));
  }

  // ─── taxes ─────────────────────────────────────────────────────────────────

  @Get('taxes')
  taxes() {
    return taxesOwed(this.prisma);
  }

  @Get('taxes/withholding')
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'quarter', required: false })
  withholding(@Query('year') year?: string, @Query('quarter') quarter?: string) {
    const today = cairoDay(this.clock.now());
    return whtReport(this.prisma, {
      year: year ? Number(year) : Number(today.slice(0, 4)),
      quarter: quarter ? Number(quarter) : Math.ceil(Number(today.slice(5, 7)) / 3),
    });
  }

  @Post('taxes/payments')
  async payTax(
    @Body(new ZodValidationPipe(taxPaymentSchema)) body: z.infer<typeof taxPaymentSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(await submitTaxPayment(this.prisma, { ...body, actorUserId: user.sub }));
  }

  // ─── recurring expenses ────────────────────────────────────────────────────

  @Get('recurring')
  recurring() {
    return listRecurring(this.prisma);
  }

  @Post('recurring')
  async createRecurring(
    @Body(new ZodValidationPipe(recurringSchema)) body: z.infer<typeof recurringSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const { name, dayOfMonth, startMonth, endMonth, ...expense } = body;
    const row = await createRecurring(this.prisma, {
      name,
      dayOfMonth,
      startMonth,
      endMonth,
      expense,
      actorUserId: user.sub,
    });
    return { id: row.id, name: row.name };
  }

  @Patch('recurring/:id')
  async setRecurring(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(activeSchema)) body: z.infer<typeof activeSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const row = await setRecurringActive(this.prisma, {
      id,
      isActive: body.isActive,
      actorUserId: user.sub,
    });
    return { id: row.id, isActive: row.isActive };
  }

  // ─── prepayments and fixed assets ──────────────────────────────────────────

  @Get('prepayments')
  prepayments() {
    return listPrepayments(this.prisma);
  }

  @Post('prepayments')
  async prepay(
    @Body(new ZodValidationPipe(prepaymentSchema)) body: z.infer<typeof prepaymentSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(await submitPrepayment(this.prisma, { ...body, actorUserId: user.sub }));
  }

  @Get('assets')
  assets() {
    return listFixedAssets(this.prisma);
  }

  @Post('assets')
  async buyAsset(
    @Body(new ZodValidationPipe(assetSchema)) body: z.infer<typeof assetSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(await submitAssetPurchase(this.prisma, { ...body, actorUserId: user.sub }));
  }

  // ─── merchants who owe us ──────────────────────────────────────────────────

  @Get('receivables')
  receivables() {
    return merchantsOwingUs(this.prisma);
  }

  @Post('receivables/:merchantId/request')
  requestPayment(
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(paymentRequestSchema)) body: z.infer<typeof paymentRequestSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return requestMerchantPayment(this.prisma, {
      merchantId,
      note: body.note,
      actorUserId: user.sub,
    });
  }
}
