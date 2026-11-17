import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { getSetting } from '@shiplynow/db';
import { Access, CurrentAccess } from '../auth/decorators';
import { assertMerchant, limitedStores, merchantFilter, storeFilter } from '../auth/access-scope';
import { type AccessProfile, canDo, type DocSmartButton } from '@shiplynow/shared';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Access(['inventory', 'merchants', 'operations'])
@Controller('admin')
export class AdminCatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('skus')
  async skus(@CurrentAccess() access: AccessProfile) {
    const merchants = merchantFilter(access);
    const [skus, totals] = await Promise.all([
      this.prisma.sku.findMany({
        where: merchants ? { merchantId: merchants } : undefined,
        orderBy: { sku: 'asc' },
        include: { merchant: true },
      }),
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
        weightGrams: s.weightGrams,
        isActive: s.isActive,
        shopifyVariantId: s.shopifyVariantId,
        merchant: { id: s.merchant.id, name: s.merchant.name },
        unitsOnHand: t?._sum.onHand ?? 0,
        unitsReserved: t?._sum.reserved ?? 0,
      };
    });
  }

  /**
   * One product as a document page (UX phase C step 3): its details, stock per store (the
   * person's stores) with what can be sold after the store's buffer, the Shopify link and the
   * smart buttons (merchant, stock, damage reports).
   */
  @Get('skus/:id/document')
  async skuDocument(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const s = await this.prisma.sku.findUnique({
      where: { id },
      include: {
        merchant: {
          select: { id: true, name: true, shopifyShop: { select: { shopDomain: true } } },
        },
        stockLevels: {
          include: {
            darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true, kind: true } },
          },
          orderBy: { darkStore: { code: 'asc' } },
        },
        _count: { select: { damageReports: true, orderItems: true } },
      },
    });
    if (!s) throw new NotFoundException({ error: 'sku_not_found' });
    assertMerchant(access, s.merchantId);
    const stores = limitedStores(access);
    const levels = s.stockLevels.filter((l) => !stores || stores.includes(l.darkStoreId));
    const stock = [];
    for (const l of levels) {
      const buffer = await getSetting(this.prisma, 'stock.buffer_units', l.darkStoreId);
      stock.push({
        darkStore: l.darkStore,
        onHand: l.onHand,
        reserved: l.reserved,
        available: Math.max(l.onHand - l.reserved - buffer, 0),
      });
    }
    const shopProduct = s.shopifyProductId
      ? await this.prisma.shopProduct.findUnique({
          where: { shopifyId: s.shopifyProductId },
          select: { title: true, handle: true, imageUrl: true },
        })
      : null;
    const domain = s.merchant.shopifyShop?.shopDomain ?? null;
    const productNumber = s.shopifyProductId?.split('/').pop() ?? null;
    const smart: DocSmartButton[] = [];
    if (canDo(access, 'merchants', 'view'))
      smart.push({
        key: 'merchant',
        count: null,
        value: s.merchant.name,
        href: `/admin/merchants/${s.merchant.id}`,
      });
    if (canDo(access, 'inventory', 'view'))
      smart.push(
        {
          key: 'stock',
          count: stock.reduce((sum, l) => sum + l.onHand, 0),
          href: `/admin/stock?f=&q=${encodeURIComponent(s.sku)}&v=merchant:${s.merchant.id}`,
        },
        {
          key: 'damage',
          count: s._count.damageReports,
          href: `/admin/damage?f=&q=${encodeURIComponent(s.sku)}`,
        },
      );
    smart.push({ key: 'stores', count: stock.filter((l) => l.onHand > 0).length, href: '#stock' });
    return {
      row: {
        id: s.id,
        sku: s.sku,
        barcode: s.barcode,
        titleEn: s.titleEn,
        titleAr: s.titleAr,
        pricePiastres: s.pricePiastres,
        weightGrams: s.weightGrams,
        isActive: s.isActive,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        merchant: { id: s.merchant.id, name: s.merchant.name },
        shopify: s.shopifyVariantId
          ? {
              variantId: s.shopifyVariantId,
              productId: s.shopifyProductId,
              title: shopProduct?.title ?? null,
              imageUrl: shopProduct?.imageUrl ?? null,
              adminUrl:
                domain && productNumber
                  ? `https://${domain}/admin/products/${productNumber}`
                  : null,
            }
          : null,
        orderLines: s._count.orderItems,
        stock,
      },
      smart,
    };
  }

  /** Stock per store and SKU. Available is what Shopify may sell: on hand minus reserved minus the buffer. */
  @Get('stock')
  @Access('inventory')
  @ApiQuery({ name: 'darkStoreId', required: false })
  async stock(@CurrentAccess() access: AccessProfile, @Query('darkStoreId') darkStoreId?: string) {
    const scope = storeFilter(access, darkStoreId);
    const merchants = merchantFilter(access);
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        ...(scope && { darkStoreId: scope }),
        ...(merchants && { sku: { merchantId: merchants } }),
      },
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
