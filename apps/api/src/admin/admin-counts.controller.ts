import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { approveCount, type CountStatus, rejectCount } from '@shiplynow/db';
import { type AccessTokenClaims, reviewCountSchema, type AccessProfile } from '@shiplynow/shared';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { assertStore, storeFilter } from '../auth/access-scope';
import { PrismaService } from '../prisma/prisma.service';

const STATUSES: CountStatus[] = ['submitted', 'approved', 'rejected', 'stale'];

@ApiTags('admin')
@ApiBearerAuth()
@Access('inventory')
@Controller('admin/stock-counts')
export class AdminCountsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  async list(@CurrentAccess() access: AccessProfile, @Query('status') status?: string) {
    const counts = await this.prisma.stockCount.findMany({
      where: {
        ...(STATUSES.includes(status as CountStatus) && { status: status as CountStatus }),
        darkStoreId: storeFilter(access),
      },
      include: {
        darkStore: true,
        bin: true,
        submittedBy: true,
        reviewedBy: true,
        lines: { include: { sku: true }, orderBy: { sku: { sku: 'asc' } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return counts.map((c) => ({
      id: c.id,
      status: c.status,
      createdAt: c.createdAt,
      reviewedAt: c.reviewedAt,
      reviewNote: c.reviewNote,
      darkStore: {
        id: c.darkStore.id,
        code: c.darkStore.code,
        nameEn: c.darkStore.nameEn,
        nameAr: c.darkStore.nameAr,
      },
      bin: { id: c.bin.id, code: c.bin.code, type: c.bin.type },
      submittedBy: c.submittedBy.name,
      reviewedBy: c.reviewedBy?.name ?? null,
      lines: c.lines.map((l) => ({
        sku: l.sku.sku,
        titleEn: l.sku.titleEn,
        titleAr: l.sku.titleAr,
        expectedQty: l.expectedQty,
        countedQty: l.countedQty,
      })),
    }));
  }

  @Post(':id/approve')
  @Access('inventory', 'manage')
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.checkStore(id, access);
    return approveCount(this.prisma, { countId: id, actorUserId: user.sub });
  }

  @Post(':id/reject')
  @Access('inventory', 'manage')
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewCountSchema)) body: { note?: string },
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.checkStore(id, access);
    await rejectCount(this.prisma, { countId: id, actorUserId: user.sub, note: body.note });
    return { status: 'rejected' };
  }

  private async checkStore(id: string, access: AccessProfile) {
    const count = await this.prisma.stockCount.findUnique({
      where: { id },
      select: { darkStoreId: true },
    });
    if (count) assertStore(access, count.darkStoreId);
  }
}
