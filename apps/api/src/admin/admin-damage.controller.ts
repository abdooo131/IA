import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { listDamageReports, settleDamage } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type SettleDamageBody,
  settleDamageSchema,
  type AccessProfile,
  canDo,
  type DocSmartButton,
  entryNumber,
} from '@shiplynow/shared';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { assertMerchant, assertStore, storeFilter } from '../auth/access-scope';
import { PrismaService } from '../prisma/prisma.service';

/** Damaged units waiting for admin to settle who pays. */
@ApiTags('admin')
@ApiBearerAuth()
@Access('inventory')
@Controller('admin/damage')
export class AdminDamageController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'settled'] })
  list(@CurrentAccess() access: AccessProfile, @Query('status') status?: string) {
    return listDamageReports(this.prisma, {
      status: status === 'pending' || status === 'settled' ? status : undefined,
      darkStoreId: storeFilter(access),
    });
  }

  /**
   * One report for its document page (UX phase C): the report, smart buttons (merchant,
   * store, product, the money entries for accounting) and the entries it booked.
   */
  @Get(':id')
  async one(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const [row] = await listDamageReports(this.prisma, { id });
    if (!row) throw new NotFoundException({ error: 'damage_not_found' });
    assertStore(access, row.darkStore.id);
    assertMerchant(access, row.merchant.id);
    const smart: DocSmartButton[] = [];
    if (canDo(access, 'merchants', 'view'))
      smart.push(
        {
          key: 'merchant',
          count: null,
          value: row.merchant.name,
          href: `/admin/merchants/${row.merchant.id}`,
        },
        {
          key: 'product',
          count: null,
          value: row.sku,
          href: `/admin/products?merchant=${row.merchant.id}&q=${encodeURIComponent(row.sku)}`,
        },
      );
    smart.push({
      key: 'store',
      count: null,
      value: row.darkStore.code,
      href: `/admin/damage?f=&v=store:${row.darkStore.id}`,
    });
    let entries: { id: string; entry: string; kind: string; day: string; amount: number }[] = [];
    if (canDo(access, 'accounting', 'view')) {
      const rows = await this.prisma.ledgerEntry.findMany({
        where: { idempotencyKey: { startsWith: `damage:${id}:` } },
        select: {
          id: true,
          number: true,
          kind: true,
          occurredAt: true,
          lines: { select: { amountPiastres: true } },
        },
        orderBy: { number: 'asc' },
      });
      entries = rows.map((e) => ({
        id: e.id,
        entry: entryNumber(e.number),
        kind: e.kind,
        day: e.occurredAt.toISOString(),
        amount: e.lines.reduce((s, l) => s + Math.max(0, l.amountPiastres), 0),
      }));
      smart.push({
        key: 'entries',
        count: entries.length,
        href: entries.length === 1 ? `/finance/journal/${entries[0]!.id}` : '#lines',
      });
    }
    return { row, smart, entries };
  }

  @Post(':id/settle')
  @Access('inventory', 'manage')
  async settle(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settleDamageSchema)) body: SettleDamageBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const report = await this.prisma.damageReport.findUnique({
      where: { id },
      select: { darkStoreId: true },
    });
    if (report) assertStore(access, report.darkStoreId);
    return settleDamage(this.prisma, { ...body, reportId: id, actorUserId: user.sub });
  }
}
