import { Controller, Get, Query } from '@nestjs/common';
import { ORDER_STATUSES, ORDER_TYPES, PACKAGE_SIZES, STATUS_GROUP_OF, FAILED_ATTEMPT_REASONS } from '@shiply/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Lookup data for forms (any signed in user). */
@Controller('reference')
export class ReferenceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('governorates')
  governorates() {
    return this.prisma.governorate.findMany({ orderBy: { nameEn: 'asc' } });
  }

  @Get('areas')
  areas(@Query('governorateCode') governorateCode?: string) {
    return this.prisma.area.findMany({ where: { governorateCode: governorateCode || undefined }, orderBy: { nameEn: 'asc' } });
  }

  @Get('enums')
  enums() {
    return { statuses: ORDER_STATUSES, statusGroups: STATUS_GROUP_OF, types: ORDER_TYPES, sizes: PACKAGE_SIZES, failedReasons: FAILED_ATTEMPT_REASONS };
  }
}
