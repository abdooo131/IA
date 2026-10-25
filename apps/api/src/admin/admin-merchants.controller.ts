import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createMerchant,
  createSku,
  importSkus,
  type SkuImportResult,
  updateMerchant,
  updateSku,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type MerchantBody,
  merchantSchema,
  type SkuBody,
  type SkuImportRow,
  skuImportRowSchema,
  skuImportSchema,
  skuSchema,
  type UpdateSkuBody,
  updateSkuSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminMerchantsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('merchants')
  async createMerchant(
    @Body(new ZodValidationPipe(merchantSchema)) body: MerchantBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const merchant = await createMerchant(this.prisma, { ...body, actorUserId: user.sub });
    return { id: merchant.id };
  }

  @Patch('merchants/:id')
  async updateMerchant(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(merchantSchema.partial())) body: Partial<MerchantBody>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await updateMerchant(this.prisma, { ...body, merchantId: id, actorUserId: user.sub });
    return { id };
  }

  @Post('skus')
  async createSku(
    @Body(new ZodValidationPipe(skuSchema)) body: SkuBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const sku = await createSku(this.prisma, { ...body, actorUserId: user.sub });
    return { id: sku.id };
  }

  @Patch('skus/:id')
  async updateSku(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSkuSchema)) body: UpdateSkuBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await updateSku(this.prisma, { ...body, skuId: id, actorUserId: user.sub });
    return { id };
  }

  /**
   * Rows come from a CSV the browser has already split into objects keyed by header.
   * Every row is checked; with any error nothing is written and every error is listed.
   */
  @Post('skus/import')
  async importSkus(
    @Body(new ZodValidationPipe(skuImportSchema)) body: z.infer<typeof skuImportSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ): Promise<SkuImportResult> {
    const rows: { row: number; data: SkuImportRow }[] = [];
    const errors: SkuImportResult['errors'] = [];
    body.rows.forEach((raw, index) => {
      // Row 1 of the file is the header, so data starts on row 2.
      const row = index + 2;
      const parsed = skuImportRowSchema.safeParse(raw);
      if (parsed.success) rows.push({ row, data: parsed.data });
      else
        errors.push({
          row,
          sku: typeof raw.sku === 'string' ? raw.sku : undefined,
          // Our own rules answer a plain code the screen can translate; zod's
          // generic messages keep the column name so the row is easy to fix.
          error: parsed.error.issues
            .map((i) =>
              /^[a-z_]+$/.test(i.message)
                ? i.message
                : `${i.path.join('.') || 'row'}: ${i.message}`,
            )
            .join('; '),
        });
    });
    if (errors.length) return { created: 0, updated: 0, unchanged: 0, errors };
    return importSkus(this.prisma, { merchantId: body.merchantId, rows, actorUserId: user.sub });
  }
}
