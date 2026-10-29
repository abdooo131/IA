import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  customerProfile,
  customersOverview,
  DomainError,
  listCustomers,
  recordAudit,
} from '@shiplynow/db';
import type { AccessTokenClaims } from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

/**
 * One customer base across every merchant: each person with what they buy, from whom and
 * when. Names, phones and emails are personal data: admin only, and opening a profile is
 * written to the audit log.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('segment') segment?: string,
    @Query('governorate') governorate?: string,
    @Query('merchantId') merchantId?: string,
    @Query('page') page?: string,
  ) {
    return listCustomers(this.prisma, {
      q: q?.slice(0, 100),
      segment,
      governorate,
      merchantId,
      page: Number.parseInt(page ?? '1', 10) || 1,
    });
  }

  @Get('overview')
  overview() {
    return customersOverview(this.prisma);
  }

  @Get(':id')
  async profile(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    const profile = await customerProfile(this.prisma, id);
    if (!profile) throw new DomainError('customer_not_found', 404);
    await recordAudit(this.prisma, {
      actorUserId: user.sub,
      action: 'customer.view',
      entityType: 'customer',
      entityId: id,
    });
    return profile;
  }
}
