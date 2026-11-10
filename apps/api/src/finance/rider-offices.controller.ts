import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  DomainError,
  listRiderOffices,
  prepareOfficeBills,
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
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

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
