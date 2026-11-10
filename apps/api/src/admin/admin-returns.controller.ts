import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { cancelReturn, getReturnDetail, listReturns, type ReturnStatus } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  cancelReturnSchema,
  RETURN_STATUSES,
  type AccessProfile,
  canDo,
  type DocSmartButton,
} from '@shiplynow/shared';
import { documentEntries, type DocEntry } from './doc-entries';
import type { z } from 'zod';
import { assertMerchant, assertStore, storeFilter } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** Returns to merchants across all stores. */
@ApiTags('admin')
@ApiBearerAuth()
@Access('inventory')
@Controller('admin/returns')
export class AdminReturnsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: RETURN_STATUSES })
  list(@CurrentAccess() access: AccessProfile, @Query('status') status?: string) {
    const valid = (RETURN_STATUSES as readonly string[]).includes(status ?? '');
    return listReturns(this.prisma, {
      status: valid ? [status as ReturnStatus] : undefined,
      darkStoreId: storeFilter(access),
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const detail = await getReturnDetail(this.prisma, id);
    if (!detail) throw new NotFoundException({ error: 'return_not_found' });
    await this.checkStore(id, access);
    return detail;
  }

  /**
   * The return's document frame (UX phase C step 2): smart buttons (merchant, store, its lines,
   * units picked, the return fee entries for accounting) and the entries it booked.
   */
  @Get(':id/document')
  async document(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const r = await this.prisma.merchantReturn.findUnique({
      where: { id },
      select: {
        darkStoreId: true,
        merchantId: true,
        merchant: { select: { name: true } },
        darkStore: { select: { code: true } },
        lines: { select: { quantity: true, pickedQty: true } },
      },
    });
    if (!r) throw new NotFoundException({ error: 'return_not_found' });
    await this.checkStore(id, access);
    const smart: DocSmartButton[] = [];
    if (canDo(access, 'merchants', 'view'))
      smart.push({
        key: 'merchant',
        count: null,
        value: r.merchant.name,
        href: `/admin/merchants/${r.merchantId}`,
      });
    smart.push(
      {
        key: 'store',
        count: null,
        value: r.darkStore.code,
        href: `/admin/returns?f=&v=store:${r.darkStoreId}`,
      },
      { key: 'lines', count: r.lines.length, href: '#lines' },
      {
        key: 'picked',
        count: null,
        value: `${r.lines.reduce((s, l) => s + l.pickedQty, 0)} / ${r.lines.reduce((s, l) => s + l.quantity, 0)}`,
        href: '#lines',
      },
    );
    let entries: DocEntry[] = [];
    if (canDo(access, 'accounting', 'view')) {
      const booked = await documentEntries(this.prisma, `return:${id}:`);
      entries = booked.entries;
      smart.push(booked.button);
    }
    return { smart, entries };
  }

  @Post(':id/cancel')
  @Access('inventory', 'manage')
  async cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelReturnSchema)) body: z.infer<typeof cancelReturnSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.checkStore(id, access);
    return cancelReturn(this.prisma, { returnId: id, actorUserId: user.sub, reason: body.reason });
  }

  private async checkStore(id: string, access: AccessProfile) {
    const row = await this.prisma.merchantReturn.findUnique({
      where: { id },
      select: { darkStoreId: true, merchantId: true },
    });
    if (!row) return;
    assertStore(access, row.darkStoreId);
    assertMerchant(access, row.merchantId);
  }
}
