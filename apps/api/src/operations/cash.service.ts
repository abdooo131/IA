import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerService } from '../accounting/ledger.service';
import { ACC, driverHandover, shortageRepaid } from '../accounting/posting';
import { applyBp } from '../pricing/pricing.engine';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { ConfigService } from '../config/config.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AlertsService } from './alerts.service';

/**
 * End of day cash: each delivery driver hands in the COD they collected. What they should hand in
 * comes from the ledger (cash with drivers, per driver), so it always matches the books.
 */
@Injectable()
export class DriverCashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly alerts: AlertsService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private async driverBalance(tx: Tx, driverId: string, account: string) {
    const r = await tx.ledgerEntry.aggregate({ where: { driverId, accountCode: account }, _sum: { debit: true, credit: true } });
    return (r._sum.debit ?? 0) - (r._sum.credit ?? 0);
  }

  async summary(ctx: RequestContext) {
    return this.prisma.withContext(ctx, async (tx) => {
      const drivers = await tx.driver.findMany({ where: { type: 'DELIVERY', status: { not: 'ARCHIVED' } }, include: { hub: { select: { code: true } } }, orderBy: { fullName: 'asc' } });
      const out = [];
      for (const d of drivers) {
        const pending = await tx.order.findMany({
          where: { deliveryDriverId: d.id, status: 'DELIVERED', cashHandoverId: null, codAmount: { gt: 0 } },
          select: { id: true, trackingNumber: true, codAmount: true, finalizedAt: true, customerName: true },
          orderBy: { finalizedAt: 'asc' },
        });
        out.push({
          id: d.id,
          fullName: d.fullName,
          phone: d.phone,
          hub: d.hub?.code ?? null,
          cashHeld: await this.driverBalance(tx, d.id, ACC.CASH_WITH_DRIVERS),
          shortageOwed: await this.driverBalance(tx, d.id, ACC.DRIVER_SHORTAGES),
          pendingOrders: pending,
        });
      }
      const [safe] = await Promise.all([this.ledger.accountBalances(tx)]);
      return { drivers: out, hubSafes: safe.find((a) => a.code === ACC.CASH_IN_HUBS)?.balance ?? 0 };
    });
  }

  async handover(ctx: RequestContext, input: { driverId: string; receivedAmount: number; note?: string; hubId?: string | null }) {
    return this.prisma.withContext(ctx, async (tx) => {
      const d = await tx.driver.findUnique({ where: { id: input.driverId } });
      if (!d) throw new NotFoundException('Driver not found');
      const expected = await this.driverBalance(tx, d.id, ACC.CASH_WITH_DRIVERS);
      if (expected <= 0 && input.receivedAmount <= 0) throw new BadRequestException(`${d.fullName} has no cash to hand in`);
      const diff = input.receivedAmount - expected;
      const status = diff === 0 ? 'BALANCED' : diff < 0 ? 'SHORT' : 'OVER';
      const memo = `Handover ${d.fullName}`;
      const handover = await tx.cashHandover.create({
        data: { driverId: d.id, hubId: input.hubId ?? d.hubId, expectedAmount: expected, receivedAmount: input.receivedAmount, difference: diff, status, note: input.note ?? null, receivedById: ctx.userId },
      });
      const { journal } = await this.ledger.post(tx, {
        type: 'DRIVER_HANDOVER',
        description: `${memo}${input.note ? `: ${input.note}` : ''}`,
        idempotencyKey: `handover:${handover.id}`,
        lines: driverHandover(d.id, expected, input.receivedAmount, memo),
        referenceType: 'cash_handover',
        referenceId: handover.id,
        createdById: ctx.userId,
      });
      await tx.cashHandover.update({ where: { id: handover.id }, data: { journalId: journal.id } });
      await tx.order.updateMany({ where: { deliveryDriverId: d.id, status: 'DELIVERED', cashHandoverId: null }, data: { cashHandoverId: handover.id } });

      // Fraud rule 11.2: a handover differing from the expected cash by more than the tolerance.
      const toleranceBp = await this.config.getInt('fraud.deposit_tolerance_bp', tx);
      if (diff !== 0) {
        const big = Math.abs(diff) > applyBp(Math.max(expected, 1), toleranceBp);
        await this.alerts.raise(tx, {
          kind: diff < 0 ? 'CASH_SHORTAGE' : 'CASH_OVERAGE',
          severity: big ? 'HIGH' : 'MEDIUM',
          message: `${d.fullName} handed in ${(input.receivedAmount / 100).toFixed(2)} EGP, expected ${(expected / 100).toFixed(2)} EGP`,
          entityType: 'cash_handover',
          entityId: handover.id,
          data: { driverId: d.id, expected, received: input.receivedAmount },
        });
      }
      await this.audit.record(tx, ctx, { action: 'cash.handover', entityType: 'cash_handover', entityId: handover.id, after: { expected, received: input.receivedAmount, status } });
      return { ...handover, journalId: String(journal.id) };
    });
  }

  async repayShortage(ctx: RequestContext, driverId: string, amount: number, note?: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const d = await tx.driver.findUnique({ where: { id: driverId } });
      if (!d) throw new NotFoundException('Driver not found');
      const owed = await this.driverBalance(tx, d.id, ACC.DRIVER_SHORTAGES);
      if (amount > owed) throw new BadRequestException(`${d.fullName} owes ${(owed / 100).toFixed(2)} EGP`);
      const { journal } = await this.ledger.post(tx, {
        type: 'DRIVER_HANDOVER',
        description: `Shortage repaid by ${d.fullName}${note ? `: ${note}` : ''}`,
        idempotencyKey: `shortage:${d.id}:${Date.now()}`,
        lines: shortageRepaid(d.id, amount, `Shortage repaid ${d.fullName}`),
        createdById: ctx.userId,
      });
      await this.audit.record(tx, ctx, { action: 'cash.shortage_repaid', entityType: 'driver', entityId: d.id, after: { amount } });
      return { journalId: String(journal.id) };
    });
  }

  history(ctx: RequestContext, driverId?: string) {
    return this.prisma.withContext(ctx, (tx) =>
      tx.cashHandover.findMany({
        where: driverId ? { driverId } : {},
        include: { driver: { select: { fullName: true } }, _count: { select: { orders: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }
}
