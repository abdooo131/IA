import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { getSetting } from '@shiplynow/db';
import { Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminCatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('skus')
  async skus() {
    const [skus, totals] = await Promise.all([
      this.prisma.sku.findMany({ orderBy: { sku: 'asc' }, include: { merchant: true } }),
      this.prisma.stockLevel.groupBy({ by: ['skuId'], _sum: { onHand: true, reserved: true } }),
    ]);
    return skus.map((s) => {
      const t = totals.find((x) => x.skuId === s.id);
      return {
        id: s.id,
        sku: s.sku,
        barcode: s.barcode,
        titleEn: s.titleEn,
        titleAr: s.titleAr,
        pricePiastres: s.pricePiastres,
        isActive: s.isActive,
        shopifyVariantId: s.shopifyVariantId,
        merchant: { id: s.merchant.id, name: s.merchant.name },
        unitsOnHand: t?._sum.onHand ?? 0,
        unitsReserved: t?._sum.reserved ?? 0,
      };
    });
  }

  /** Stock per store and SKU. Available is what Shopify may sell: on hand minus reserved minus the buffer. */
  @Get('stock')
  @ApiQuery({ name: 'darkStoreId', required: false })
  async stock(@Query('darkStoreId') darkStoreId?: string) {
    const levels = await this.prisma.stockLevel.findMany({
      where: darkStoreId ? { darkStoreId } : undefined,
      include: { darkStore: true, sku: true },
      orderBy: [{ darkStore: { code: 'asc' } }, { sku: { sku: 'asc' } }],
    });
    const storeIds = [...new Set(levels.map((l) => l.darkStoreId))];
    const rules = new Map(
      await Promise.all(
        storeIds.map(
          async (id) =>
            [
              id,
              {
                buffer: await getSetting(this.prisma, 'stock.buffer_units', id),
                threshold: await getSetting(this.prisma, 'stock.low_stock_threshold', id),
              },
            ] as const,
        ),
      ),
    );
    return levels.map((l) => {
      const { buffer, threshold } = rules.get(l.darkStoreId)!;
      const available = Math.max(l.onHand - l.reserved - buffer, 0);
      return {
        darkStore: {
          id: l.darkStore.id,
          code: l.darkStore.code,
          nameEn: l.darkStore.nameEn,
          nameAr: l.darkStore.nameAr,
        },
        sku: { id: l.sku.id, sku: l.sku.sku, titleEn: l.sku.titleEn, titleAr: l.sku.titleAr },
        onHand: l.onHand,
        reserved: l.reserved,
        available,
        lowStock: available <= threshold,
      };
    });
  }
}
