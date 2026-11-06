import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { getContract } from '@shiplynow/db';
import type { AccessTokenClaims } from '@shiplynow/shared';
import { CurrentUser, MerchantRight, Roles } from '../auth/decorators';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';

/** The merchant reads their own contract (read only; Shiply changes it). */
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

  @Get('contract')
  async contract(@CurrentUser() user: AccessTokenClaims) {
    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { merchantId: true },
    });
    if (!me?.merchantId) throw new ForbiddenException({ error: 'no_merchant' });
    const view = await getContract(this.prisma, me.merchantId, this.clock.now());
    // The internal note stays with Shiply.
    return {
      ...view,
      contract: view.contract ? { ...view.contract, note: null, updatedBy: null } : null,
    };
  }
}
