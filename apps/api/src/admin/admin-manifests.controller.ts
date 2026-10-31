import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { getManifestDetail, type ManifestStatus, type Prisma } from '@shiplynow/db';
import { Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

const STATUSES: ManifestStatus[] = ['expected', 'receiving', 'received', 'cancelled'];

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminManifestsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('merchants')
  async merchants() {
    const merchants = await this.prisma.merchant.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { skus: true, inboundManifests: true } } },
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
    }));
  }

  @Get('manifests')
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'merchantId', required: false })
  @ApiQuery({ name: 'q', required: false, description: 'Search in the reference' })
  async list(
    @Query('status') status?: string,
    @Query('darkStoreId') darkStoreId?: string,
    @Query('merchantId') merchantId?: string,
    @Query('q') q?: string,
  ) {
    const where: Prisma.InboundManifestWhereInput = {
      ...(STATUSES.includes(status as ManifestStatus) && { status: status as ManifestStatus }),
      ...(darkStoreId && { darkStoreId }),
      ...(merchantId && { merchantId }),
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
  async detail(@Param('id') id: string) {
    const detail = await getManifestDetail(this.prisma, id);
    if (!detail) throw new NotFoundException({ error: 'manifest_not_found' });
    return detail;
  }
}
