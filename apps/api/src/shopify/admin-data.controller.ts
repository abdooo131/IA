import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DomainError, marketInsights, merchantInsights, recordAudit } from '@shiplynow/db';
import type { AccessTokenClaims } from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { ShopDataService } from './shop-data.service';

/** What the merchants' Shopify stores tell us, one merchant at a time and all together. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/data')
export class AdminDataController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopData: ShopDataService,
  ) {}

  @Get('market')
  market() {
    return marketInsights(this.prisma);
  }

  @Get('merchants/:merchantId')
  async merchant(@Param('merchantId') merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    return {
      merchant: { id: merchant.id, name: merchant.name },
      ...(await merchantInsights(this.prisma, merchantId)),
    };
  }

  /** Collect the whole store again from the start (the next runs take everything). */
  @Post('merchants/:merchantId/refresh')
  async refresh(@Param('merchantId') merchantId: string, @CurrentUser() user: AccessTokenClaims) {
    const shop = await this.prisma.shopifyShop.findUnique({ where: { merchantId } });
    if (!shop) throw new DomainError('shop_not_found', 404);
    await this.shopData.refreshAll(shop.id);
    await recordAudit(this.prisma, {
      actorUserId: user.sub,
      action: 'shopify.data_refresh',
      entityType: 'shopify_shop',
      entityId: shop.id,
    });
    return { queued: true };
  }
}
