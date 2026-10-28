import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  closeManifest,
  DomainError,
  move,
  receiveOnManifest,
  reportDamage,
  submitCount,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type CountInput,
  countSchema,
  lookupQuerySchema,
  type MoveInput,
  moveSchema,
  type PutAwayInput,
  putAwaySchema,
  type ReportDamageBody,
  reportDamageSchema,
  type ReceiveScanInput,
  receiveScanSchema,
} from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from './store-access.service';

/** Which bin types each move reason may go between. */
const MOVE_RULES: Record<MoveInput['reason'], { from: string[]; to: string[] }> = {
  damaged: { from: ['pickable', 'receiving', 'held'], to: ['damaged'] },
  held: { from: ['pickable', 'receiving'], to: ['held'] },
  release: { from: ['held'], to: ['pickable'] },
  relocate: { from: ['pickable'], to: ['pickable'] },
};

@ApiTags('store')
@ApiBearerAuth()
@Roles('admin', 'store_staff')
@Controller('stores')
export class StoreController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StoreAccessService,
  ) {}

  @Get()
  async mine(@CurrentUser() user: AccessTokenClaims) {
    const stores = await this.access.storesFor(user);
    return stores.map((s) => ({ id: s.id, code: s.code, nameEn: s.nameEn, nameAr: s.nameAr }));
  }

  @Get(':storeId/summary')
  async summary(@Param('storeId') storeId: string, @CurrentUser() user: AccessTokenClaims) {
    const store = await this.access.check(user, storeId);
    const [openManifests, receivingUnits, pendingCounts, activeOrders, lateOrders, openReturns] =
      await Promise.all([
        this.prisma.inboundManifest.count({
          where: { darkStoreId: storeId, status: { in: ['expected', 'receiving'] } },
        }),
        this.prisma.binStock.aggregate({
          _sum: { quantity: true },
          where: { bin: { darkStoreId: storeId, type: 'receiving' } },
        }),
        this.prisma.stockCount.count({ where: { darkStoreId: storeId, status: 'submitted' } }),
        this.prisma.order.count({
          where: { darkStoreId: storeId, status: { in: ['new', 'accepted', 'picking', 'packed'] } },
        }),
        this.prisma.order.count({
          where: {
            darkStoreId: storeId,
            status: { in: ['new', 'accepted', 'picking', 'packed'] },
            lateStage: { not: null },
          },
        }),
        this.prisma.merchantReturn.count({
          where: { darkStoreId: storeId, status: { in: ['requested', 'picking', 'ready'] } },
        }),
      ]);
    return {
      store: {
        id: store.id,
        kind: store.kind,
        code: store.code,
        nameEn: store.nameEn,
        nameAr: store.nameAr,
      },
      openManifests,
      unitsToPutAway: receivingUnits._sum.quantity ?? 0,
      pendingCounts,
      activeOrders,
      lateOrders,
      openReturns,
    };
  }

  /** Resolves a scanned or typed code to a product (barcode or SKU) or a bin of this store. */
  @Get(':storeId/lookup')
  async lookup(
    @Param('storeId') storeId: string,
    @Query(new ZodValidationPipe(lookupQuerySchema)) { code }: { code: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    const bin = await this.prisma.bin.findFirst({
      where: { darkStoreId: storeId, code: { equals: code, mode: 'insensitive' }, isActive: true },
    });
    if (bin) return { kind: 'bin', bin: { id: bin.id, code: bin.code, type: bin.type } };
    const sku = await this.prisma.sku.findFirst({
      where: {
        OR: [{ barcode: code }, { sku: { equals: code, mode: 'insensitive' } }],
        isActive: true,
      },
    });
    if (sku) {
      return {
        kind: 'sku',
        sku: {
          id: sku.id,
          sku: sku.sku,
          barcode: sku.barcode,
          titleEn: sku.titleEn,
          titleAr: sku.titleAr,
        },
      };
    }
    throw new NotFoundException({ error: 'code_not_found' });
  }

  @Get(':storeId/manifests')
  async manifests(@Param('storeId') storeId: string, @CurrentUser() user: AccessTokenClaims) {
    await this.access.check(user, storeId);
    const list = await this.prisma.inboundManifest.findMany({
      where: { darkStoreId: storeId, status: { in: ['expected', 'receiving'] } },
      include: { merchant: true, lines: true },
      orderBy: [{ expectedAt: 'asc' }, { createdAt: 'asc' }],
    });
    return list.map((m) => ({
      id: m.id,
      reference: m.reference,
      status: m.status,
      expectedAt: m.expectedAt,
      merchant: { id: m.merchant.id, name: m.merchant.name },
      expectedUnits: m.lines.reduce((sum, l) => sum + l.expectedQty, 0),
      receivedUnits: m.lines.reduce((sum, l) => sum + l.receivedQty, 0),
    }));
  }

  @Get(':storeId/manifests/:manifestId')
  async manifest(
    @Param('storeId') storeId: string,
    @Param('manifestId') manifestId: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    const m = await this.prisma.inboundManifest.findUnique({
      where: { id: manifestId },
      include: {
        merchant: true,
        lines: { include: { sku: true }, orderBy: { sku: { sku: 'asc' } } },
      },
    });
    if (!m || m.darkStoreId !== storeId)
      throw new NotFoundException({ error: 'manifest_not_found' });
    return {
      id: m.id,
      reference: m.reference,
      status: m.status,
      note: m.note,
      expectedAt: m.expectedAt,
      merchant: { id: m.merchant.id, name: m.merchant.name },
      lines: m.lines.map((l) => ({
        skuId: l.skuId,
        sku: l.sku.sku,
        barcode: l.sku.barcode,
        titleEn: l.sku.titleEn,
        titleAr: l.sku.titleAr,
        expectedQty: l.expectedQty,
        receivedQty: l.receivedQty,
      })),
    };
  }

  @Post(':storeId/manifests/:manifestId/receive')
  async receive(
    @Param('storeId') storeId: string,
    @Param('manifestId') manifestId: string,
    @Body(new ZodValidationPipe(receiveScanSchema)) body: ReceiveScanInput,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return receiveOnManifest(this.prisma, {
      manifestId,
      darkStoreId: storeId,
      skuId: body.skuId,
      quantity: body.quantity,
      actorUserId: user.sub,
      idempotencyKey: `receive:${body.idempotencyKey}`,
    });
  }

  @Post(':storeId/manifests/:manifestId/close')
  async close(
    @Param('storeId') storeId: string,
    @Param('manifestId') manifestId: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return closeManifest(this.prisma, { manifestId, darkStoreId: storeId, actorUserId: user.sub });
  }

  /** Bins with what is in them, for put away, counts and labels. */
  @Get(':storeId/bins')
  async bins(@Param('storeId') storeId: string, @CurrentUser() user: AccessTokenClaims) {
    await this.access.check(user, storeId);
    const bins = await this.prisma.bin.findMany({
      where: { darkStoreId: storeId, isActive: true },
      include: { stock: { where: { quantity: { gt: 0 } }, include: { sku: true } } },
      orderBy: { code: 'asc' },
    });
    return bins.map((b) => ({
      id: b.id,
      code: b.code,
      type: b.type,
      items: b.stock
        .map((s) => ({
          skuId: s.skuId,
          sku: s.sku.sku,
          barcode: s.sku.barcode,
          titleEn: s.sku.titleEn,
          titleAr: s.sku.titleAr,
          quantity: s.quantity,
        }))
        .sort((x, y) => x.sku.localeCompare(y.sku)),
    }));
  }

  /** From the receiving bin to a shelf. The units become sellable. */
  @Post(':storeId/put-away')
  async putAway(
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(putAwaySchema)) body: PutAwayInput,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    const [from, to] = await Promise.all([
      this.prisma.bin.findFirst({
        where: {
          darkStoreId: storeId,
          type: 'receiving',
          isActive: true,
          stock: { some: { skuId: body.skuId, quantity: { gte: body.quantity } } },
        },
        orderBy: { code: 'asc' },
      }),
      this.prisma.bin.findUnique({ where: { id: body.toBinId } }),
    ]);
    if (!to || to.darkStoreId !== storeId) throw new DomainError('bin_not_found', 404);
    if (to.type !== 'pickable') throw new DomainError('bin_not_pickable', 400);
    if (!from) throw new DomainError('nothing_to_put_away');
    return move(this.prisma, {
      skuId: body.skuId,
      fromBinId: from.id,
      toBinId: to.id,
      quantity: body.quantity,
      reason: 'put_away',
      actorUserId: user.sub,
      idempotencyKey: `putaway:${body.idempotencyKey}`,
    });
  }

  /** Damaged, held, released from hold, or moved between shelves. */
  @Post(':storeId/move')
  async move(
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(moveSchema)) body: MoveInput,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    // Damage always goes through a damage report, so admin can settle who pays.
    if (body.reason === 'damaged') throw new DomainError('cause_required', 400);
    const bins = await this.prisma.bin.findMany({
      where: { id: { in: [body.fromBinId, body.toBinId] } },
    });
    const from = bins.find((b) => b.id === body.fromBinId);
    const to = bins.find((b) => b.id === body.toBinId);
    if (!from || !to || from.darkStoreId !== storeId || to.darkStoreId !== storeId) {
      throw new DomainError('bin_not_found', 404);
    }
    const rule = MOVE_RULES[body.reason];
    if (!rule.from.includes(from.type) || !rule.to.includes(to.type)) {
      throw new DomainError('move_not_allowed', 400);
    }
    return move(this.prisma, {
      skuId: body.skuId,
      fromBinId: from.id,
      toBinId: to.id,
      quantity: body.quantity,
      reason: body.reason,
      actorUserId: user.sub,
      idempotencyKey: `move:${body.idempotencyKey}`,
    });
  }

  /** Units to the damaged bin with the cause; admin then settles who pays. */
  @Post(':storeId/damage')
  async damage(
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(reportDamageSchema)) body: ReportDamageBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    const { report } = await reportDamage(this.prisma, {
      ...body,
      darkStoreId: storeId,
      actorUserId: user.sub,
    });
    return { id: report.id, status: report.status };
  }

  @Post(':storeId/counts')
  async count(
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(countSchema)) body: CountInput,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return submitCount(this.prisma, {
      darkStoreId: storeId,
      binId: body.binId,
      lines: body.lines,
      actorUserId: user.sub,
    });
  }
}
