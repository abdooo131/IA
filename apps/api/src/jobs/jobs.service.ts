import { ErrorReporter } from '../common/error-reporter';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  accrueStorage,
  checkFailedDeliveries,
  flagLateOrders,
  getSetting,
  lastClosedDay,
  linkDeliveryCustomers,
  planRefill,
} from '@shiplynow/db';
import { cairoClock, cairoDay } from '@shiplynow/shared';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';

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
  /** The last Cairo day the refill drafts were prepared for by this instance. */
  private refillDone: string | null = null;
  private linking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly reporter: ErrorReporter,
    private readonly tickets: TicketsService,
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
      void this.runRefill();
      void this.runTicketReminders();
      void this.runCustomerLinks();
    }, EVERY_MS);
    this.timer.unref();
  }

  /** Ticket reminders; each is claimed in the database first, so overlaps send nothing twice. */
  async runTicketReminders(now: Date = new Date()) {
    try {
      return await this.tickets.remind(now);
    } catch (error) {
      void this.reporter.report('job_ticket_reminders', error);
      return null;
    }
  }

  /**
   * Links new delivery orders to the customer with the same mobile. Matching is safe to run
   * twice (a unique phone per customer), so two instances at once change nothing extra.
   */
  async runCustomerLinks() {
    if (this.linking) return null;
    this.linking = true;
    try {
      return await linkDeliveryCustomers(this.prisma);
    } catch (error) {
      void this.reporter.report('job_customer_links', error);
      return null;
    } finally {
      this.linking = false;
    }
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Flags late order stages and follows up failed delivery attempts. Returns null when another
   * instance holds the lock.
   */
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
          // Failed attempts: holds that ran out, and goods the rider has not brought back.
          const failed = await checkFailedDeliveries(tx, now);
          if (failed.closed + failed.alerted > 0)
            this.log.log(
              `Failed deliveries: ${failed.closed} closed after the hold, ${failed.alerted} goods not back`,
            );
          return { ...result, ...failed };
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
   * Prepares the day's automatic refill drafts once the Cairo clock passes refill.run_hour.
   * planRefill itself takes a lock and plans a day only once, so overlaps are harmless.
   */
  async runRefill(now: Date = new Date()) {
    const day = cairoDay(now);
    if (this.refillDone === day) return null;
    try {
      const hour = await getSetting(this.prisma, 'refill.run_hour');
      if (cairoClock(now).minute < hour * 60) return null;
      const result = await planRefill(this.prisma, { day });
      this.refillDone = day;
      if (result.created.length > 0)
        this.log.log(`Refill drafts for ${day}: ${result.created.length} waiting for approval`);
      return result;
    } catch (error) {
      await this.reporter.report('job: refill', error);
      return null;
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
