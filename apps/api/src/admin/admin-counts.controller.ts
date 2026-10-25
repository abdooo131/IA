import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { approveCount, type CountStatus, rejectCount } from '@shiplynow/db';
import { type AccessTokenClaims, reviewCountSchema } from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const STATUSES: CountStatus[] = ['submitted', 'approved', 'rejected', 'stale'];

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/stock-counts')
export class AdminCountsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  async list(@Query('status') status?: string) {
    const counts = await this.prisma.stockCount.findMany({
      where: STATUSES.includes(status as CountStatus)
        ? { status: status as CountStatus }
        : undefined,
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
  approve(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return approveCount(this.prisma, { countId: id, actorUserId: user.sub });
  }

  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewCountSchema)) body: { note?: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await rejectCount(this.prisma, { countId: id, actorUserId: user.sub, note: body.note });
    return { status: 'rejected' };
  }
}
