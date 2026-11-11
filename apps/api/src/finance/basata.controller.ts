import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  approveBasataDeposit,
  basataDepositDetail,
  DomainError,
  listBasataSettlements,
  listFrozenRiders,
  moneyAccounts,
  recordBasataSettlement,
  rejectBasataDeposit,
  riderFreezeState,
  unfreezeRider,
  unsettledBasataDeposits,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  basataRejectSchema,
  basataSettlementSchema,
  bulkIdsSchema,
  unfreezeRiderSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { assertStore, limitedStores } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { eachRecord } from '../common/bulk';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Basata cash deposits for Accounting (owner, 2026-11-11). View reads (the list is
 * /lists/accounting/basata_deposits, the page /finance/documents/basata_deposit/<id>); use
 * approves or rejects a deposit after checking its receipt, records Basata's daily transfer and
 * unfreezes riders. Deposits and riders stay inside the reader's stores. Nobody decides a
 * deposit they sent; only Accounting unfreezes (never a store manager).
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class BasataController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private async depositInScope(id: string, access: AccessProfile) {
    const d = await this.prisma.basataDeposit.findUnique({
      where: { id },
      select: { darkStoreId: true },
    });
    if (!d) throw new DomainError('basata_deposit_not_found', 404);
    assertStore(access, d.darkStoreId);
  }

  private async riderInScope(riderId: string, access: AccessProfile) {
    const r = await this.prisma.rider.findUnique({
      where: { id: riderId },
      select: { darkStoreId: true },
    });
    if (!r) throw new DomainError('rider_not_found', 404);
    assertStore(access, r.darkStoreId);
  }

  /** One deposit with the rider's cash figures (held now, taken by a deadline, office). */
  @Get('basata/deposits/:id')
  async deposit(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    await this.depositInScope(id, access);
    return basataDepositDetail(this.prisma, id);
  }

  @Post('basata/deposits/:id/approve')
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.depositInScope(id, access);
    return approveBasataDeposit(this.prisma, {
      depositId: id,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
  }

  @Post('basata/deposits/:id/reject')
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(basataRejectSchema)) body: z.infer<typeof basataRejectSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.depositInScope(id, access);
    return rejectBasataDeposit(this.prisma, {
      depositId: id,
      actorUserId: user.sub,
      reason: body.reason,
      now: this.clock.now(),
    });
  }

  /** Approves several deposits, each checked on its own (scope, own deposit, cash held). */
  @Post('basata/deposits/bulk-approve')
  bulkApprove(
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return eachRecord(body.ids, async (id) => {
      await this.depositInScope(id, access);
      await approveBasataDeposit(this.prisma, {
        depositId: id,
        actorUserId: user.sub,
        now: this.clock.now(),
      });
    });
  }

  /**
   * The Record Basata transfer form: approved deposits not settled yet (optionally deposited
   * up to a Cairo day), the banks to choose from, and Basata's recent transfers.
   */
  @Get('basata/settlements/new')
  @ApiQuery({ name: 'upTo', required: false })
  async newSettlement(@CurrentAccess() access: AccessProfile, @Query('upTo') upTo?: string) {
    const [open, money, recent] = await Promise.all([
      unsettledBasataDeposits(this.prisma, {
        upToDay: upTo || undefined,
        stores: limitedStores(access),
      }),
      moneyAccounts(this.prisma),
      listBasataSettlements(this.prisma, 10),
    ]);
    return {
      ...open,
      banks: money
        .filter((a) => a.groupCode === 1100 && a.isActive && (a.currency ?? 'EGP') === 'EGP')
        .map((a) => ({ id: a.id, code: a.code, nameEn: a.nameEn, nameAr: a.nameAr })),
      recent,
    };
  }

  /**
   * Basata's daily transfer reached the bank: books the bank, Basata's fee and settles the
   * chosen deposits. Money already ours moving between our accounts: no second person.
   */
  @Post('basata/settlements')
  async settle(
    @Body(new ZodValidationPipe(basataSettlementSchema))
    body: z.infer<typeof basataSettlementSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    for (const id of new Set(body.depositIds)) await this.depositInScope(id, access);
    return recordBasataSettlement(this.prisma, {
      body,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
  }

  @Get('basata/settlements')
  settlements() {
    return listBasataSettlements(this.prisma, 50);
  }

  /** Riders frozen for cash not handed in by the deadline, inside the reader's stores. */
  @Get('frozen-riders')
  frozen(@CurrentAccess() access: AccessProfile) {
    return listFrozenRiders(this.prisma, limitedStores(access));
  }

  /** A rider's freeze state and history (the rider's page). */
  @Get('frozen-riders/:riderId')
  async freezeState(@Param('riderId') riderId: string, @CurrentAccess() access: AccessProfile) {
    await this.riderInScope(riderId, access);
    return riderFreezeState(this.prisma, riderId);
  }

  /** Only Accounting (use) unfreezes, with a written reason; audited. */
  @Post('frozen-riders/:riderId/unfreeze')
  async unfreeze(
    @Param('riderId') riderId: string,
    @Body(new ZodValidationPipe(unfreezeRiderSchema)) body: z.infer<typeof unfreezeRiderSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.riderInScope(riderId, access);
    return unfreezeRider(this.prisma, {
      riderId,
      actorUserId: user.sub,
      reason: body.reason,
      now: this.clock.now(),
    });
  }
}
