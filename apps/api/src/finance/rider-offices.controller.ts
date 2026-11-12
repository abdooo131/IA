import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  DomainError,
  listRiderOffices,
  prepareOfficeBills,
  riderOfficeAccount,
  riderOfficeDetail,
  setRiderOffice,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  billNumber,
  cairoDay,
  prepareOfficeBillsSchema,
  riderOfficeSchema,
} from '@shiplynow/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { csv, egp } from './finance-csv';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Rider supply offices (Accounting > Money out > Rider offices): suppliers that supply riders
 * and earn a commission on their pay per delivered order. Accounting view reads, use prepares
 * the monthly bills, manage marks offices and sets their rate.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance/rider-offices')
export class RiderOfficesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get()
  @ApiQuery({ name: 'month', required: false })
  list(@Query('month') month?: string) {
    if (month && !MONTH.test(month)) throw new DomainError('invalid_month', 400);
    return listRiderOffices(this.prisma, {
      month: month || cairoDay(this.clock.now()).slice(0, 7),
    });
  }

  /** The office's account day by day for a month (default this month), with its balance. */
  @Get(':id/account')
  @ApiQuery({ name: 'month', required: false })
  account(@Param('id') id: string, @Query('month') month?: string) {
    return riderOfficeAccount(this.prisma, {
      supplierId: id,
      month: this.month(month),
      now: this.clock.now(),
    });
  }

  /** The same daily account as CSV (house rules), headers in English or Arabic. */
  @Get(':id/account.csv')
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'lang', required: false })
  async accountCsv(
    @Res() res: Response,
    @Param('id') id: string,
    @Query('month') month?: string,
    @Query('lang') lang?: string,
  ) {
    const data = await riderOfficeAccount(this.prisma, {
      supplierId: id,
      month: this.month(month),
      now: this.clock.now(),
    });
    const header =
      lang === 'ar'
        ? [
            'اليوم',
            'التوصيلات',
            'العمولة',
            'عجز منقول',
            'فواتير (ضريبة)',
            'مدفوعات',
            'أخرى',
            'الرصيد',
          ]
        : [
            'Day',
            'Deliveries',
            'Commission',
            'Shortages moved',
            'Bills (VAT)',
            'Payments',
            'Other',
            'Balance we owe',
          ];
    const opening = lang === 'ar' ? 'رصيد أول الشهر' : 'Opening balance';
    const total = lang === 'ar' ? 'الإجمالي' : 'Total';
    const t = data.totals;
    const body = csv(header, [
      [opening, null, null, null, null, null, null, egp(data.openingPiastres)],
      ...data.days.map((d) => [
        d.day,
        d.deliveries,
        egp(d.commissionPiastres),
        egp(d.shortagesPiastres),
        egp(d.billedPiastres),
        egp(d.paymentsPiastres),
        egp(d.otherPiastres),
        egp(d.balancePiastres),
      ]),
      [
        total,
        t.deliveries,
        egp(t.commissionPiastres),
        egp(t.shortagesPiastres),
        egp(t.billedPiastres),
        egp(t.paymentsPiastres),
        egp(t.otherPiastres),
        egp(data.closingPiastres),
      ],
    ]);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader(
      'content-disposition',
      `attachment; filename="rider-office-account-${data.month}.csv"`,
    );
    res.send(body);
  }

  private month(month?: string) {
    if (month && !MONTH.test(month)) throw new DomainError('invalid_month', 400);
    return month || cairoDay(this.clock.now()).slice(0, 7);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return riderOfficeDetail(this.prisma, { supplierId: id, now: this.clock.now() });
  }

  /** Marks a supplier as a rider office (or not) and sets its commission. Audited. */
  @Patch(':id')
  @Access('accounting', 'manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(riderOfficeSchema)) body: z.infer<typeof riderOfficeSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const office = await setRiderOffice(this.prisma, {
      supplierId: id,
      ...body,
      actorUserId: user.sub,
    });
    return {
      id: office.id,
      isRiderOffice: office.isRiderOffice,
      commissionBp: office.commissionBp,
    };
  }

  /** The month's bills of every office (or one), with the shortages moved onto them. */
  @Post('prepare-bills')
  @Access('accounting', 'use')
  async prepare(
    @Body(new ZodValidationPipe(prepareOfficeBillsSchema))
    body: z.infer<typeof prepareOfficeBillsSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const result = await prepareOfficeBills(this.prisma, {
      ...body,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
    return {
      month: result.month,
      offices: result.offices.map((o) => ({
        ...o,
        billLabel: o.billNumber ? billNumber(o.billNumber) : null,
      })),
    };
  }
}
