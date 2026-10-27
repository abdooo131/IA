import { ErrorReporter } from '../common/error-reporter';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { accrueStorage, flagLateOrders, lastClosedDay } from '@shiplynow/db';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Advisory lock id for the SLA check, so only one API instance runs it at a time. */
const SLA_LOCK = 735_001;
/** Advisory lock id for the daily storage charge. */
const STORAGE_LOCK = 735_002;
const EVERY_MS = 30_000;

/**
 * Background jobs, run inside the API so the pilot needs no extra service. Each run takes
 * a database lock (only one instance works at a time) and the job itself is safe to run
 * twice, so restarts and overlaps are harmless.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Jobs');
  private timer?: NodeJS.Timeout;
  private running = false;
  /** The last Cairo day storage was charged for by this instance, to skip needless work. */
  private storageDone: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly reporter: ErrorReporter,
  ) {}

  onApplicationBootstrap() {
    const setting = this.config.get('JOBS_ENABLED', { infer: true });
    const enabled = setting
      ? setting === 'true'
      : this.config.get('NODE_ENV', { infer: true }) !== 'test';
    if (!enabled) return;
    this.timer = setInterval(() => {
      void this.runSlaCheck();
      void this.runStorageCharge();
    }, EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Flags late order stages. Returns null when another instance holds the lock. */
  async runSlaCheck(now: Date = new Date()) {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = (await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(${SLA_LOCK}) AS locked`) as [{ locked: boolean }];
          if (!locked) return null;
          const result = await flagLateOrders(tx, now);
          if (result.flagged > 0)
            this.log.log(
              `SLA check: ${result.flagged} newly late of ${result.checked} active orders`,
            );
          return result;
        },
        { timeout: 25_000 },
      );
    } catch (error) {
      await this.reporter.report('job: SLA check', error);
      return null;
    } finally {
      this.running = false;
    }
  }

  /**
   * Charges storage once for the Cairo day that just ended. Safe to run any number of times:
   * every store and merchant pair has its own key for the day.
   */
  async runStorageCharge(now: Date = new Date()) {
    const day = lastClosedDay(now);
    if (this.storageDone === day) return null;
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = (await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(${STORAGE_LOCK}) AS locked`) as [{ locked: boolean }];
          if (!locked) return null;
          return accrueStorage(tx, day);
        },
        { timeout: 60_000 },
      );
      if (result) {
        this.storageDone = day;
        if (result.charged > 0)
          this.log.log(`Storage charged for ${day}: ${result.charged} entries`);
      }
      return result;
    } catch (error) {
      await this.reporter.report('job: storage charge', error);
      return null;
    }
  }
}
