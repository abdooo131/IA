import { Body, Controller, Get, HttpException, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { parseCsv } from '@shiply/address';
import type { PrismaClient } from '@shiply/db';
import { toPiastres } from '@shiply/shared';
import { AuditService, DB, NeedAccess, parse } from '../platform';

const sku = z.string().trim().min(1).max(60).transform((s) => s.toUpperCase().replace(/\s+/g, ''));
const price = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return toPiastres(String(v));
  } catch {
    ctx.addIssue({ code: 'custom', message: 'price' });
    return z.NEVER;
  }
});
const ProductBody = z.object({
  sku,
  barcode: z.string().trim().max(60).optional(),
  nameEn: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().min(1).max(200),
  price,
  weightGrams: z.number().int().min(0).max(1_000_000).optional(),
  shopifyVariantId: z.string().trim().max(60).optional(),
  active: z.boolean().optional(),
});

@Controller('merchants')
export class ProductsController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async merchant(id: string) {
    if (!(await this.db.merchant.findUnique({ where: { id } }))) throw new HttpException({ error: 'not_found' }, 404);
  }

  @Get('shops')
  @NeedAccess('merchants', 'view')
  allShops() {
    return this.db.shopifyShop.findMany({ orderBy: { connectedAt: 'desc' }, include: { merchant: { select: { id: true, code: true, name: true } } } });
  }

  @Get(':id/products')
  @NeedAccess('merchants', 'view')
  async list(@Param('id') id: string, @Query('q') q?: string, @Query('active') active?: string, @Query('page') page = '1') {
    const p = Math.max(1, Number(page) || 1);
    const where = {
      merchantId: id,
      ...(active ? { active: active === 'true' } : {}),
      ...(q?.trim() ? { OR: [{ sku: { contains: q.trim().toUpperCase() } }, { nameEn: { contains: q.trim(), mode: 'insensitive' as const } }, { nameAr: { contains: q.trim() } }] } : {}),
    };
    const [rows, total] = await Promise.all([this.db.product.findMany({ where, orderBy: { sku: 'asc' }, skip: (p - 1) * 50, take: 50 }), this.db.product.count({ where })]);
    return { rows, total, page: p, pageSize: 50 };
  }

  @Post(':id/products')
  @NeedAccess('merchants', 'use')
  async create(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    await this.merchant(id);
    const p = parse(ProductBody, body);
    if (await this.db.product.findUnique({ where: { merchantId_sku: { merchantId: id, sku: p.sku } } })) throw new HttpException({ error: 'sku_taken' }, 409);
    return this.db.$transaction(async (tx) => {
      const product = await tx.product.create({ data: { ...p, merchantId: id } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'product.created', entity: 'product', entityId: product.id, after: product });
      return product;
    });
  }

  @Patch('products/:productId')
  @NeedAccess('merchants', 'use')
  async edit(@Param('productId') productId: string, @Body() body: unknown, @Req() req: Request) {
    const e = parse(ProductBody.omit({ sku: true }).partial(), body);
    const before = await this.db.product.findUnique({ where: { id: productId } });
    if (!before) throw new HttpException({ error: 'not_found' }, 404);
    return this.db.$transaction(async (tx) => {
      const after = await tx.product.update({ where: { id: productId }, data: e });
      await this.audit.record(tx, { userId: req.user!.id, action: 'product.changed', entity: 'product', entityId: productId, before, after });
      return after;
    });
  }

  /** Columns sku, barcode, name_en, name_ar, price, weight_grams. Existing SKUs are updated. */
  @Post(':id/products/import')
  @HttpCode(200)
  @NeedAccess('merchants', 'use')
  async import(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    await this.merchant(id);
    const { csv } = parse(z.object({ csv: z.string().max(10_000_000) }), body);
    const [header, ...rows] = parseCsv(csv.replace(/^\uFEFF/, ''));
    const col = (name: string) => (header ?? []).findIndex((h) => h.trim().toLowerCase() === name);
    const idx = { sku: col('sku'), barcode: col('barcode'), nameEn: col('name_en'), nameAr: col('name_ar'), price: col('price'), weight: col('weight_grams') };
    let created = 0;
    let updated = 0;
    const refused: { row: number; reason: string }[] = [];
    await this.db.$transaction(async (tx) => {
      for (const [i, r] of rows.entries()) {
        const cell = (k: keyof typeof idx) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
        const parsed = ProductBody.safeParse({
          sku: cell('sku'),
          barcode: cell('barcode') || undefined,
          nameEn: cell('nameEn'),
          nameAr: cell('nameAr') || cell('nameEn'),
          price: cell('price'),
          weightGrams: cell('weight') ? Number(cell('weight')) : undefined,
        });
        if (!parsed.success) {
          refused.push({ row: i + 2, reason: String(parsed.error.issues[0]?.path[0] ?? 'row') });
          continue;
        }
        const existing = await tx.product.findUnique({ where: { merchantId_sku: { merchantId: id, sku: parsed.data.sku } } });
        await tx.product.upsert({ where: { merchantId_sku: { merchantId: id, sku: parsed.data.sku } }, update: parsed.data, create: { ...parsed.data, merchantId: id } });
        if (existing) updated++;
        else created++;
      }
      await this.audit.record(tx, { userId: req.user!.id, action: 'product.imported', entity: 'merchant', entityId: id, after: { created, updated, refused: refused.length } });
    });
    return { created, updated, refused };
  }

  @Get(':id/shopify')
  @NeedAccess('merchants', 'view')
  shops(@Param('id') id: string) {
    return this.db.shopifyShop.findMany({ where: { merchantId: id } });
  }

  /** Records which Shopify shop belongs to the merchant; the live connection comes later. */
  @Post(':id/shopify')
  @NeedAccess('merchants', 'use')
  async addShop(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    await this.merchant(id);
    const { domain } = parse(z.object({ domain: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+\.myshopify\.com$/) }), body);
    if (await this.db.shopifyShop.findUnique({ where: { domain } })) throw new HttpException({ error: 'shop_taken' }, 409);
    return this.db.$transaction(async (tx) => {
      const shop = await tx.shopifyShop.create({ data: { merchantId: id, domain } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'shopify.recorded', entity: 'merchant', entityId: id, after: { domain } });
      return shop;
    });
  }
}
