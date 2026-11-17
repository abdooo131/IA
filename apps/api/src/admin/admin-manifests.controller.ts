import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { getManifestDetail, type ManifestStatus, type Prisma } from '@shiplynow/db';
import { Access, ANY_APP, CurrentAccess } from '../auth/decorators';
import { assertMerchant, assertStore, merchantFilter, storeFilter } from '../auth/access-scope';
import { type AccessProfile, canDo, type DocSmartButton } from '@shiplynow/shared';
import { documentEntries, type DocEntry } from './doc-entries';
import { PrismaService } from '../prisma/prisma.service';

const STATUSES: ManifestStatus[] = ['expected', 'receiving', 'received', 'cancelled'];

@ApiTags('admin')
@ApiBearerAuth()
@Access('inventory')
@Controller('admin')
export class AdminManifestsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Every merchant: a lookup the pages of every app read. */
  @Get('merchants')
  @Access(ANY_APP)
  async merchants(@CurrentAccess() access: AccessProfile) {
    const mine = merchantFilter(access);
    const merchants = await this.prisma.merchant.findMany({
      where: mine ? { id: mine } : undefined,
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { skus: true, inboundManifests: true } },
        accountManager: { select: { id: true, name: true } },
      },
    });
    return merchants.map((m) => ({
      id: m.id,
      name: m.name,
      isActive: m.isActive,
      approval: m.approval,
      rejectReason: m.rejectReason,
      createdAt: m.createdAt.toISOString(),
      contactEmail: m.contactEmail,
      contactPhone: m.contactPhone,
      shopifyShopDomain: m.shopifyShopDomain,
      skuCount: m._count.skus,
      shipmentCount: m._count.inboundManifests,
      accountManager: m.accountManager,
    }));
  }

  @Get('manifests')
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'merchantId', required: false })
  @ApiQuery({ name: 'q', required: false, description: 'Search in the reference' })
  async list(
    @CurrentAccess() access: AccessProfile,
    @Query('status') status?: string,
    @Query('darkStoreId') darkStoreId?: string,
    @Query('merchantId') merchantId?: string,
    @Query('q') q?: string,
  ) {
    const where: Prisma.InboundManifestWhereInput = {
      ...(STATUSES.includes(status as ManifestStatus) && { status: status as ManifestStatus }),
      darkStoreId: storeFilter(access, darkStoreId),
      merchantId: merchantFilter(access, merchantId || undefined),
      ...(q && { reference: { contains: q, mode: 'insensitive' } }),
    };
    const list = await this.prisma.inboundManifest.findMany({
      where,
      include: { merchant: true, darkStore: true, lines: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return list.map((m) => ({
      id: m.id,
      reference: m.reference,
      status: m.status,
      createdAt: m.createdAt,
      expectedAt: m.expectedAt,
      receivedAt: m.receivedAt,
      merchant: { id: m.merchant.id, name: m.merchant.name },
      darkStore: {
        id: m.darkStore.id,
        code: m.darkStore.code,
        nameEn: m.darkStore.nameEn,
        nameAr: m.darkStore.nameAr,
      },
      expectedUnits: m.lines.reduce((s, l) => s + l.expectedQty, 0),
      receivedUnits: m.lines.reduce((s, l) => s + l.receivedQty, 0),
    }));
  }

  @Get('manifests/:id')
  async detail(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const detail = await getManifestDetail(this.prisma, id);
    if (!detail) throw new NotFoundException({ error: 'manifest_not_found' });
    const row = await this.prisma.inboundManifest.findUnique({
      where: { id },
      select: { darkStoreId: true, merchantId: true },
    });
    assertStore(access, row?.darkStoreId ?? null);
    assertMerchant(access, row?.merchantId ?? null);
    return detail;
  }

  /**
   * The shipment's document frame (UX phase C step 2): smart buttons (merchant, store, its
   * lines, units received against listed, the receiving fee entries for accounting) and the
   * entries it booked.
   */
  @Get('manifests/:id/document')
  async document(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const m = await this.prisma.inboundManifest.findUnique({
      where: { id },
      select: {
        darkStoreId: true,
        merchantId: true,
        merchant: { select: { name: true } },
        darkStore: { select: { code: true } },
        lines: { select: { expectedQty: true, receivedQty: true } },
      },
    });
    if (!m) throw new NotFoundException({ error: 'manifest_not_found' });
    assertStore(access, m.darkStoreId);
    assertMerchant(access, m.merchantId);
    const smart: DocSmartButton[] = [];
    if (canDo(access, 'merchants', 'view'))
      smart.push({
        key: 'merchant',
        count: null,
        value: m.merchant.name,
        href: `/admin/merchants/${m.merchantId}`,
      });
    smart.push(
      {
        key: 'store',
        count: null,
        value: m.darkStore.code,
        href: `/admin/shipments?f=&v=store:${m.darkStoreId}`,
      },
      { key: 'lines', count: m.lines.length, href: '#lines' },
      {
        key: 'received',
        count: null,
        value: `${m.lines.reduce((s, l) => s + l.receivedQty, 0)} / ${m.lines.reduce((s, l) => s + l.expectedQty, 0)}`,
        href: '#lines',
      },
    );
    let entries: DocEntry[] = [];
    if (canDo(access, 'accounting', 'view')) {
      const booked = await documentEntries(this.prisma, `manifest:${id}:`);
      entries = booked.entries;
      smart.push(booked.button);
    }
    return { smart, entries };
  }
}
