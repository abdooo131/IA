import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  approveWithdrawal,
  DomainError,
  listRiderWithdrawals,
  payWithdrawal,
  rejectWithdrawal,
  riderCash,
  riderWallet,
  riderWalletSummaries,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  WITHDRAWAL_METHODS,
  WITHDRAWAL_STATUSES,
  withdrawalPaySchema,
  withdrawalRejectSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { assertStore, limitedStores } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const pick = <T extends string>(list: readonly T[], value?: string) =>
  list.includes(value as T) ? (value as T) : undefined;

/**
 * Rider pay (CLAUDE.md "Rider pay"): riders' wallets and their withdrawal requests. Accounting
 * view reads; accounting use approves, rejects and pays (the second person rule applies from
 * finance.approval_threshold_piastres). People limited to some stores see only their riders.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class RiderWithdrawalsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('rider-withdrawals')
  @ApiQuery({ name: 'status', required: false, enum: WITHDRAWAL_STATUSES })
  @ApiQuery({ name: 'method', required: false, enum: WITHDRAWAL_METHODS })
  @ApiQuery({ name: 'darkStoreId', required: false })
  async list(
    @CurrentAccess() access: AccessProfile,
    @Query('status') status?: string,
    @Query('method') method?: string,
    @Query('darkStoreId') darkStoreId?: string,
  ) {
    if (darkStoreId) assertStore(access, darkStoreId);
    return listRiderWithdrawals(this.prisma, {
      status: pick(WITHDRAWAL_STATUSES, status),
      method: pick(WITHDRAWAL_METHODS, method),
      darkStoreId: darkStoreId || undefined,
      storeIds: limitedStores(access),
    });
  }

  /** Every rider with their wallet in a few numbers and the cash they carry. */
  @Get('rider-wallets')
  async wallets(@CurrentAccess() access: AccessProfile) {
    const stores = limitedStores(access);
    const riders = await this.prisma.rider.findMany({
      where: stores ? { darkStoreId: { in: stores } } : {},
      include: {
        user: { select: { name: true, isActive: true } },
        darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      },
      orderBy: { badgeCode: 'asc' },
    });
    const totals = await riderWalletSummaries(
      this.prisma,
      riders.map((r) => r.id),
    );
    return Promise.all(
      riders.map(async (r) => ({
        id: r.id,
        name: r.user.name,
        isActive: r.user.isActive,
        badgeCode: r.badgeCode,
        darkStore: r.darkStore,
        cashPiastres: await riderCash(this.prisma, r.id),
        wallet: totals.get(r.id)!,
      })),
    );
  }

  /** One rider's wallet as the rider sees it. */
  @Get('rider-wallets/:riderId')
  async wallet(@Param('riderId') riderId: string, @CurrentAccess() access: AccessProfile) {
    const rider = await this.prisma.rider.findUnique({ where: { id: riderId } });
    if (!rider) throw new DomainError('rider_not_found', 404);
    assertStore(access, rider.darkStoreId);
    return riderWallet(this.prisma, riderId);
  }

  private async checkStore(id: string, access: AccessProfile) {
    const w = await this.prisma.riderWithdrawal.findUnique({ where: { id } });
    if (!w) throw new DomainError('withdrawal_not_found', 404);
    assertStore(access, w.darkStoreId);
  }

  @Post('rider-withdrawals/:id/approve')
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.checkStore(id, access);
    return approveWithdrawal(this.prisma, { withdrawalId: id, actorUserId: user.sub });
  }

  @Post('rider-withdrawals/:id/reject')
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(withdrawalRejectSchema))
    body: z.infer<typeof withdrawalRejectSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.checkStore(id, access);
    return rejectWithdrawal(this.prisma, {
      withdrawalId: id,
      reason: body.reason,
      actorUserId: user.sub,
    });
  }

  @Post('rider-withdrawals/:id/pay')
  async pay(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(withdrawalPaySchema)) body: z.infer<typeof withdrawalPaySchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.checkStore(id, access);
    return payWithdrawal(this.prisma, {
      withdrawalId: id,
      moneyAccountId: body.moneyAccountId,
      reference: body.reference,
      actorUserId: user.sub,
    });
  }
}
