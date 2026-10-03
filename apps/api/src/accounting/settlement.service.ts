import { ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { ConfigService } from '../config/config.service';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService, SYSTEM_CONTEXT } from '../prisma/prisma.service';
import { CashoutService } from './cashout.service';
import { LedgerService } from './ledger.service';
import { deliveredSettlement, failedSettlement } from './posting';

const FREQUENCY_DAYS: Record<string, number> = { DAILY: 1, EVERY_2_DAYS: 2, WEEKLY: 7 };
const STALE_RUN_MS = 60 * 60 * 1000;
const DEFAULT_CRON = '5 0 * * *';
const DEFAULT_TZ = 'Africa/Cairo';

/**
 * Midnight cash cycle (spec 11.1): settles every finalized, unsettled order into its merchant wallet,
 * one order per transaction, then opens automatic cashout requests for merchants whose cashout day it is.
 * Safe to run again at any time: each order settles once (settled_at guard + journal idempotency key),
 * and a unique index allows only one RUNNING run across all API instances.
 */
@Injectable()
export class SettlementService implements OnModuleInit {
  private readonly log = new Logger('CashCycle');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly cashouts: CashoutService,
    private readonly config: ConfigService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    this.jobs.register('settlement', async () => this.run({ triggeredBy: 'schedule' }));
    if (process.env.REDIS_URL) {
      // On a fresh database the config rows may not exist yet (seed runs after the API starts),
      // so fall back to the documented defaults instead of leaving the cash cycle unscheduled.
      let cron = DEFAULT_CRON;
      let tz = DEFAULT_TZ;
      try {
        const cfg = await this.config.getMany(['finance.settlement_cron', 'finance.timezone']);
        cron = String(cfg['finance.settlement_cron']);
        tz = String(cfg['finance.timezone']);
      } catch {
        this.log.log(`Cash cycle config not found yet, using defaults (${DEFAULT_CRON}, ${DEFAULT_TZ})`);
      }
      try {
        await this.jobs.schedule('settlement', cron, tz);
      } catch (e) {
        this.log.warn(`Cash cycle not scheduled: ${(e as Error).message}`);
      }
    }
  }

  async run(opts: { asOf?: Date; triggeredBy: string; ctx?: RequestContext }) {
    const asOf = opts.asOf ?? new Date();
    const run = await this.startRun(asOf, opts.triggeredBy);
    let ordersSettled = 0;
    let ordersCharged = 0;
    let cashoutsCreated = 0;
    try {
      const ids = await this.prisma.asSystem((tx) =>
        tx.order.findMany({
          where: { settledAt: null, finalizedAt: { lte: asOf }, status: { in: ['DELIVERED', 'RETURNED', 'UNSUCCESSFUL'] } },
          select: { id: true },
          orderBy: { finalizedAt: 'asc' },
        }),
      );
      for (const { id } of ids) {
        const result = await this.prisma.asSystem((tx) => this.settleOrder(tx, id, asOf));
        if (result === 'delivered') ordersSettled++;
        if (result === 'failed') ordersCharged++;
      }
      if (await this.autoCashoutEnabled()) cashoutsCreated = await this.cashouts.createDueAutoCashouts(asOf, FREQUENCY_DAYS);
      const done = await this.prisma.asSystem((tx) =>
        tx.settlementRun.update({
          where: { id: run.id },
          data: { status: 'DONE', ordersSettled, ordersCharged, cashoutsCreated, finishedAt: new Date() },
        }),
      );
      await this.prisma.asSystem((tx) =>
        this.audit.record(tx, opts.ctx ?? SYSTEM_CONTEXT, {
          action: 'finance.settlement_run',
          entityType: 'settlement_run',
          entityId: run.id,
          after: { asOf, ordersSettled, ordersCharged, cashoutsCreated, triggeredBy: opts.triggeredBy },
        }),
      );
      this.log.log(`Settled ${ordersSettled} delivered, charged ${ordersCharged} failed, ${cashoutsCreated} auto cashouts`);
      return done;
    } catch (e) {
      await this.prisma.asSystem((tx) =>
        tx.settlementRun.update({
          where: { id: run.id },
          data: { status: 'FAILED', error: (e as Error).message.slice(0, 500), ordersSettled, ordersCharged, finishedAt: new Date() },
        }),
      );
      throw e;
    }
  }

  /** Settles one order exactly once. Returns what happened. */
  private async settleOrder(tx: Prisma.TransactionClient, orderId: string, asOf: Date): Promise<'delivered' | 'failed' | 'skipped'> {
    const claimed = await tx.order.updateMany({ where: { id: orderId, settledAt: null }, data: { settledAt: asOf } });
    if (claimed.count !== 1) return 'skipped';
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (o.status === 'DELIVERED') {
      if (o.codAmount === 0 && o.totalFees === 0) return 'delivered';
      await this.ledger.post(tx, {
        type: 'ORDER_SETTLEMENT',
        description: `Settlement ${o.trackingNumber}`,
        idempotencyKey: `settle:${o.id}`,
        lines: deliveredSettlement(o),
        merchantId: o.merchantId,
        orderId: o.id,
        referenceType: 'order',
        referenceId: o.id,
        occurredAt: asOf,
      });
      return 'delivered';
    }
    if (o.failedDeliveryFee === 0) return 'failed';
    await this.ledger.post(tx, {
      type: 'FAILED_DELIVERY_FEE',
      description: `Failed delivery charge ${o.trackingNumber}`,
      idempotencyKey: `settle:${o.id}`,
      lines: failedSettlement(o),
      merchantId: o.merchantId,
      orderId: o.id,
      referenceType: 'order',
      referenceId: o.id,
      occurredAt: asOf,
    });
    return 'failed';
  }

  private async startRun(asOf: Date, triggeredBy: string) {
    return this.prisma.asSystem(async (tx) => {
      // Clear a run that crashed without finishing so the lock cannot stick forever.
      await tx.settlementRun.updateMany({
        where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
        data: { status: 'FAILED', error: 'Marked stale', finishedAt: new Date() },
      });
      try {
        return await tx.settlementRun.create({ data: { asOf, status: 'RUNNING', triggeredBy } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('A cash cycle is already running');
        }
        throw e;
      }
    });
  }

  private async autoCashoutEnabled() {
    const v = (await this.config.getMany(['finance.auto_cashout_enabled']))['finance.auto_cashout_enabled'];
    return v === true;
  }

  listRuns() {
    return this.prisma.asSystem((tx) => tx.settlementRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }));
  }
}
