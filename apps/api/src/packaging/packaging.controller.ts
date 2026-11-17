import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  adjustPackaging,
  countPackaging,
  createPackagingItem,
  listPackagingItems,
  listPackagingMovements,
  listPackagingRecipes,
  packagingStock,
  setPackagingRecipe,
  submitPackagingPurchase,
  updatePackagingItem,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  packagingAdjustSchema,
  packagingCountSchema,
  packagingItemSchema,
  packagingPurchaseSchema,
  packagingRecipeSchema,
  updatePackagingItemSchema,
} from '@shiplynow/shared';
import { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { submitted } from '../finance/books.controller';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from '../store/store-access.service';

const adjustBody = packagingAdjustSchema;
const countBody = packagingCountSchema;
const purchaseBody = packagingPurchaseSchema;

/**
 * Packaging stock (bags, boxes, labels, tape): our own consumables, kept apart from merchant
 * stock. Inventory looks after items, counts and recipes; buying it paid now is accounting's
 * (second person rule above the limit); receiving against a purchase order is in Purchasing.
 */
@ApiTags('packaging')
@ApiBearerAuth()
@Access(['inventory', 'accounting'])
@Controller('packaging')
export class PackagingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('items')
  items() {
    return listPackagingItems(this.prisma);
  }

  @Post('items')
  @Access('inventory', 'manage')
  createItem(
    @Body(new ZodValidationPipe(packagingItemSchema)) body: z.infer<typeof packagingItemSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createPackagingItem(this.prisma, { ...body, actorUserId: user.sub });
  }

  @Patch('items/:id')
  @Access('inventory', 'manage')
  updateItem(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePackagingItemSchema))
    body: z.infer<typeof updatePackagingItemSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updatePackagingItem(this.prisma, { ...body, itemId: id, actorUserId: user.sub });
  }

  @Get('stock')
  @ApiQuery({ name: 'darkStoreId', required: false })
  stock(@Query('darkStoreId') darkStoreId?: string) {
    return packagingStock(this.prisma, { darkStoreId: darkStoreId || undefined });
  }

  @Get('movements')
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'itemId', required: false })
  movements(@Query('darkStoreId') darkStoreId?: string, @Query('itemId') itemId?: string) {
    return listPackagingMovements(this.prisma, {
      darkStoreId: darkStoreId || undefined,
      itemId: itemId || undefined,
    });
  }

  @Get('recipes')
  recipes() {
    return listPackagingRecipes(this.prisma);
  }

  @Put('recipes')
  @Access('inventory', 'manage')
  setRecipe(
    @Body(new ZodValidationPipe(packagingRecipeSchema)) body: z.infer<typeof packagingRecipeSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return setPackagingRecipe(this.prisma, { ...body, actorUserId: user.sub });
  }

  /** Lost, damaged or found units, with a reason (booked at average cost). */
  @Post('stores/:storeId/adjust')
  @Access('inventory', 'manage')
  adjust(
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(adjustBody)) body: z.infer<typeof adjustBody>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return adjustPackaging(this.prisma, { ...body, darkStoreId: storeId, actorUserId: user.sub });
  }

  @Post('stores/:storeId/count')
  @Access('inventory', 'use')
  count(
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(countBody)) body: z.infer<typeof countBody>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return countPackaging(this.prisma, { ...body, darkStoreId: storeId, actorUserId: user.sub });
  }

  /** Bought and paid now from a bank or cash box: posted, or waiting for a second person. */
  @Post('stores/:storeId/purchases')
  @Access('accounting', 'use')
  async purchase(
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(purchaseBody)) body: z.infer<typeof purchaseBody>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(
      await submitPackagingPurchase(this.prisma, {
        ...body,
        darkStoreId: storeId,
        actorUserId: user.sub,
      }),
    );
  }
}

/** The box sizes staff may choose when packing, with what the store holds. */
@ApiTags('store orders')
@ApiBearerAuth()
@Access('store')
@Controller('stores/:storeId/packaging')
export class StorePackagingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StoreAccessService,
  ) {}

  @Get('boxes')
  async boxes(@Param('storeId') storeId: string, @CurrentUser() user: AccessTokenClaims) {
    await this.access.check(user, storeId);
    const items = await this.prisma.packagingItem.findMany({
      where: { isActive: true, isBox: true },
      include: { levels: { where: { darkStoreId: storeId }, select: { onHand: true } } },
      orderBy: { code: 'asc' },
    });
    return items.map((i) => ({
      id: i.id,
      code: i.code,
      nameEn: i.nameEn,
      nameAr: i.nameAr,
      onHand: i.levels[0]?.onHand ?? 0,
    }));
  }
}
