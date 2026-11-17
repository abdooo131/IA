import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  DomainError,
  marketInsights,
  merchantCategoryGaps,
  merchantInsights,
  orderHistoryCoverage,
  recordAudit,
} from '@shiplynow/db';
import type { AccessProfile, AccessTokenClaims } from '@shiplynow/shared';
import { limitedMerchants } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { ShopDataService } from './shop-data.service';

/** What the merchants' Shopify stores tell us, one merchant at a time and all together. */
@ApiTags('admin')
@ApiBearerAuth()
@Access('customers')
@Controller('admin/data')
export class AdminDataController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopData: ShopDataService,
  ) {}

  /** Every merchant together, with the order history we hold of each store. */
  @Get('market')
  async market(@CurrentAccess() access: AccessProfile | undefined) {
    const market = await marketInsights(this.prisma);
    const history = await orderHistoryCoverage(this.prisma);
    const merchants = limitedMerchants(access);
    if (!merchants) return { ...market, orderHistory: history };
    // Account managers: the market totals (no names) and only their merchants by name.
    const mine = new Set(merchants);
    return {
      ...market,
      merchants: market.merchants.filter((m) => mine.has(m.id)),
      orderHistory: history.filter((h) => mine.has(h.merchantId)),
    };
  }

  @Get('merchants/:merchantId')
  async merchant(@Param('merchantId') merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    return {
      merchant: { id: merchant.id, name: merchant.name },
      ...(await merchantInsights(this.prisma, merchantId)),
      // Admin only: what this merchant's customers buy elsewhere that it does not sell.
      crossSell: await merchantCategoryGaps(this.prisma, merchantId),
      orderHistory: await orderHistoryCoverage(this.prisma, merchantId),
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
