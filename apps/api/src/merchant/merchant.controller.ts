import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { cancelManifest, createManifest, DomainError } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type CreateManifestBody,
  createManifestSchema,
} from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** The merchant panel. Every query is limited to the signed in user's merchant. */
@ApiTags('merchant')
@ApiBearerAuth()
@Roles('merchant')
@Controller('merchant')
export class MerchantController {
  constructor(private readonly prisma: PrismaService) {}

  private async merchantOf(user: AccessTokenClaims) {
    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: { merchant: true },
    });
    if (!me?.merchant) throw new ForbiddenException({ error: 'no_merchant' });
    return me.merchant;
  }

  @Get('me')
  async me(@CurrentUser() user: AccessTokenClaims) {
    const merchant = await this.merchantOf(user);
    const unread = await this.prisma.notification.count({
      where: { merchantId: merchant.id, readAt: null },
    });
    return { merchant: { id: merchant.id, name: merchant.name }, unreadNotifications: unread };
  }

  @Get('skus')
  async skus(@CurrentUser() user: AccessTokenClaims) {
    const merchant = await this.merchantOf(user);
    const skus = await this.prisma.sku.findMany({
      where: { merchantId: merchant.id, isActive: true },
      orderBy: { sku: 'asc' },
      include: { stockLevels: { include: { darkStore: true } } },
    });
    return skus.map((s) => ({
      id: s.id,
      sku: s.sku,
      titleEn: s.titleEn,
      titleAr: s.titleAr,
      stock: s.stockLevels.map((l) => ({
        darkStore: {
          code: l.darkStore.code,
          nameEn: l.darkStore.nameEn,
          nameAr: l.darkStore.nameAr,
        },
        onHand: l.onHand,
        reserved: l.reserved,
      })),
    }));
  }

  @Get('dark-stores')
  async stores() {
    const stores = await this.prisma.darkStore.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    return stores.map((s) => ({ id: s.id, code: s.code, nameEn: s.nameEn, nameAr: s.nameAr }));
  }

  @Get('manifests')
  async manifests(@CurrentUser() user: AccessTokenClaims) {
    const merchant = await this.merchantOf(user);
    const list = await this.prisma.inboundManifest.findMany({
      where: { merchantId: merchant.id },
      include: {
        darkStore: true,
        lines: { include: { sku: true }, orderBy: { sku: { sku: 'asc' } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return list.map((m) => ({
      id: m.id,
      reference: m.reference,
      status: m.status,
      note: m.note,
      expectedAt: m.expectedAt,
      receivedAt: m.receivedAt,
      createdAt: m.createdAt,
      darkStore: { code: m.darkStore.code, nameEn: m.darkStore.nameEn, nameAr: m.darkStore.nameAr },
      lines: m.lines.map((l) => ({
        sku: l.sku.sku,
        titleEn: l.sku.titleEn,
        titleAr: l.sku.titleAr,
        expectedQty: l.expectedQty,
        receivedQty: l.receivedQty,
      })),
    }));
  }

  @Post('manifests')
  async create(
    @Body(new ZodValidationPipe(createManifestSchema)) body: CreateManifestBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const merchant = await this.merchantOf(user);
    const manifest = await createManifest(this.prisma, {
      ...body,
      merchantId: merchant.id,
      actorUserId: user.sub,
    });
    return { id: manifest.id };
  }

  @Post('manifests/:id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    const merchant = await this.merchantOf(user);
    await cancelManifest(this.prisma, {
      manifestId: id,
      merchantId: merchant.id,
      actorUserId: user.sub,
    });
    return { status: 'cancelled' };
  }

  @Get('notifications')
  async notifications(@CurrentUser() user: AccessTokenClaims) {
    const merchant = await this.merchantOf(user);
    const list = await this.prisma.notification.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return list.map((n) => ({
      id: n.id,
      type: n.type,
      data: n.data as Record<string, unknown>,
      readAt: n.readAt,
      createdAt: n.createdAt,
    }));
  }

  @Post('notifications/:id/read')
  async read(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    const merchant = await this.merchantOf(user);
    const updated = await this.prisma.notification.updateMany({
      where: { id, merchantId: merchant.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (
      updated.count === 0 &&
      !(await this.prisma.notification.findFirst({ where: { id, merchantId: merchant.id } }))
    ) {
      throw new DomainError('notification_not_found', 404);
    }
    return { ok: true };
  }
}
