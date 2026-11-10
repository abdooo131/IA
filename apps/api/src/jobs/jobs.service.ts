import { ErrorReporter } from '../common/error-reporter';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  chargeStorageDays,
  applyContractSchedules,
  chargeMinimumFees,
  computeCommissions,
  expireProposals,
  checkDocumentExpiry,
  checkRiderCashOverdue,
  closeAttendanceDays,
  runViolationJobs,
  runExitDisables,
  crmReminders,
  checkFailedDeliveries,
  flagLateOrders,
  getSetting,
  lastClosedDay,
  linkDeliveryCustomers,
  locateCustomers,
  planRefill,
  reverseAccruals,
  runMonthlyCharges,
  runRecurring,
  runReceivableReminders,
} from '@shiplynow/db';
import { cairoClock, cairoDay } from '@shiplynow/shared';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { PushService } from '../push/push.service';
import { TicketsService } from '../tickets/tickets.service';

/** Advisory lock id for the SLA check, so only one API instance runs it at a time. */
const SLA_LOCK = 735_001;
/** Advisory lock id for the daily storage charge. */
const STORAGE_LOCK = 735_002;
/** Advisory lock id for recurring expenses, prepayments and depreciation. */
const MONTHLY_LOCK = 735_003;
/** Advisory lock id for the merchant contracts' monthly minimum fees. */
const MINIMUM_FEE_LOCK = 735_021;
/** Advisory lock id for the daily payment reminders to merchants who owe us. */
const REMINDER_LOCK = 735_047;
const EVERY_MS = 30_000;
/** Notifications go out faster than the other jobs: a new order has minutes to be accepted. */
const PUSH_EVERY_MS = 10_000;

/**
 * Background jobs, run inside the API so the pilot needs no extra service. Each run takes
 * a database lock (only one instance works at a time) and the job itself is safe to run
 * twice, so restarts and overlaps are harmless.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Jobs');
  private timer?: NodeJS.Timeout;
  private pushTimer?: NodeJS.Timeout;
  private running = false;
  /** The last Cairo day storage was charged for by this instance, to skip needless work. */
  private storageDone: string | null = null;
  /** The last Cairo day the refill drafts were prepared for by this instance. */
  private refillDone: string | null = null;
  private linking = false;
  /** The last Cairo day recurring expenses and monthly charges ran for in this instance. */
  private monthlyDone: string | null = null;
  /** The last Cairo day contract minimums were charged for in this instance. */
  private minimumDone: string | null = null;
  /** The last hour employee documents were checked in this instance. */
  private documentsDone: string | null = null;
  /** The last ten minute slot the attendance close ran in this instance. */
  private attendanceDone: string | null = null;
  private closingAttendance = false;
  /** The last ten minute slot riders' cash was checked in this instance. */
  private riderCashDone: string | null = null;
  /** The last Cairo day sales commission was worked out in this instance. */
  private commissionDone: string | null = null;
  /** The last Cairo day payment reminders went out from this instance. */
  private remindersDone: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly reporter: ErrorReporter,
    private readonly tickets: TicketsService,
    private readonly push: PushService,
    private readonly email: EmailService,
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
      void this.runMonthlyFinance();
      void this.runContractMinimums();
      void this.runDocumentExpiry();
      void this.runAttendanceClose();
      void this.runRiderCashCheck();
      void this.runEmails();
      void this.runCrmReminders();
      void this.runCommissions();
      void this.runPaymentReminders();
    }, EVERY_MS);
    this.timer.unref();
    this.pushTimer = setInterval(() => void this.runPush(), PUSH_EVERY_MS);
    this.pushTimer.unref();
  }

  /**
   * Web push: notifies the people concerned by what happened in the last minutes. Each event
   * has its own key, so overlaps and other instances send nothing twice.
   */
  runPush(now: Date = new Date()) {
    return this.push.dispatch(now);
  }

  /**
   * Emails to merchants: sends what is due from the outbox. Each row is claimed before it is
   * sent and a sent row is never sent again, so overlaps and other instances are harmless.
   */
  runEmails(now: Date = new Date()) {
    return this.email.dispatch(now);
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
   * Links new delivery orders to the customer with the same mobile (raising cash risk alerts)
   * and places new or changed customers in their district. Both are safe to run twice: a phone
   * belongs to one customer and an alert is unique per order.
   */
  async runCustomerLinks() {
    if (this.linking) return null;
    this.linking = true;
    try {
      const links = await linkDeliveryCustomers(this.prisma);
      const places = await locateCustomers(this.prisma);
      return { ...links, ...places };
    } catch (error) {
      void this.reporter.report('job_customer_links', error);
      return null;
    } finally {
      this.linking = false;
    }
  }

  /**
   * Once an hour (so a document added today is seen the same day): one document_expiring
   * alert per employee document hr.document_alert_days before it runs out, and one
   * document_expired on the day. Every alert has its own key, so repeats and other instances
   * raise nothing twice.
   */
  async runDocumentExpiry(now: Date = new Date()) {
    const hour = now.toISOString().slice(0, 13);
    if (this.documentsDone === hour) return null;
    try {
      const result = await checkDocumentExpiry(this.prisma, now);
      this.documentsDone = hour;
      if (result.raised > 0) this.log.log(`Employee documents: ${result.raised} alerts raised`);
      return result;
    } catch (error) {
      await this.reporter.report('job: document expiry', error);
      return null;
    }
  }

  /**
   * Every ten minutes: plans the coming two weeks from the default shifts and closes every
   * attendance day that is over (a forgotten clock out is closed at the shift end). Each day is
   * closed under a lock on the person and kept once, so overlaps and repeats change nothing.
   */
  async runAttendanceClose(now: Date = new Date()) {
    const slot = now.toISOString().slice(0, 15);
    if (this.attendanceDone === slot || this.closingAttendance) return null;
    this.closingAttendance = true;
    try {
      const result = await closeAttendanceDays(this.prisma, now);
      this.attendanceDone = slot;
      if (result.closed > 0) this.log.log(`Attendance: ${result.closed} days closed`);
      // HR phase 3: violations past their appeal window become final, then the closed days
      // suggest violations (late past the grace, absent without leave). Both run safely twice.
      const hr = await runViolationJobs(this.prisma, now);
      if (hr.finalized + hr.suggested > 0)
        this.log.log(`Violations: ${hr.finalized} final, ${hr.suggested} suggested`);
      // HR phase 2: leavers' accounts close at the end of their last day (each exit once).
      const exits = await runExitDisables(this.prisma, now);
      if (exits.disabled + exits.cancelled > 0)
        this.log.log(`Leavers: ${exits.disabled} accounts disabled, ${exits.cancelled} kept`);
      return { ...result, ...hr, exits };
    } catch (error) {
      await this.reporter.report('job: attendance close', error);
      return null;
    } finally {
      this.closingAttendance = false;
    }
  }

  /**
   * Every ten minutes: one rider_cash_overdue alert per rider and Cairo day while cash older
   * than finance.rider_cash_max_hours is not handed in. The alert key holds the rider and the
   * day, so repeats and other instances raise nothing twice.
   */
  async runRiderCashCheck(now: Date = new Date()) {
    const slot = now.toISOString().slice(0, 15);
    if (this.riderCashDone === slot) return null;
    try {
      const result = await checkRiderCashOverdue(this.prisma, now);
      this.riderCashDone = slot;
      if (result.raised > 0) this.log.log(`Rider cash: ${result.raised} overdue alerts raised`);
      return result;
    } catch (error) {
      await this.reporter.report('job: rider cash', error);
      return null;
    }
  }

  /**
   * Sales CRM reminders (docs/SALES.md): follow ups that became due (the push dispatcher tells
   * their owner), one crm_followup_overdue alert per follow up past sales.overdue_minutes and one
   * crm_deal_stale alert per deal and stage past sales.stale_days. Every mark and alert is
   * claimed once in the database, so overlaps and other instances change nothing.
   */
  async runCrmReminders(now: Date = new Date()) {
    try {
      const result = await crmReminders(this.prisma, now);
      const proposals = await expireProposals(this.prisma, now);
      if (result.overdue + result.stale + proposals.expired > 0)
        this.log.log(
          `Sales: ${result.overdue} overdue follow ups, ${result.stale} stale deals, ${proposals.expired} proposals expired`,
        );
      return { ...result, ...proposals };
    } catch (error) {
      await this.reporter.report('job: sales reminders', error);
      return null;
    }
  }

  /**
   * Once a Cairo day: each rep's commission for the month that ended (from its second day, so
   * the month's minimum fees are booked) as a draft for the sales manager. Keyed per rep and
   * month (commission:<rep>:<month>), so repeats and other instances change nothing.
   */
  async runCommissions(now: Date = new Date()) {
    const day = cairoDay(now);
    if (this.commissionDone === day) return null;
    try {
      const result = await computeCommissions(this.prisma, now);
      this.commissionDone = day;
      if (result.created > 0)
        this.log.log(`Sales commission for ${result.month}: ${result.created} reps`);
      return result;
    } catch (error) {
      await this.reporter.report('job: sales commission', error);
      return null;
    }
  }

  /**
   * Once a Cairo day, after receivables.reminder_hour: payment reminders to merchants whose
   * wallet stays in debit (receivables.* settings). Each reminder is keyed by the merchant, the
   * debit period and its number, so repeats and other instances send nothing twice.
   */
  async runPaymentReminders(now: Date = new Date()) {
    const day = cairoDay(now);
    if (this.remindersDone === day) return null;
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = (await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(${REMINDER_LOCK}) AS locked`) as [{ locked: boolean }];
          if (!locked) return null;
          return runReceivableReminders(tx, now);
        },
        { timeout: 60_000 },
      );
      if (!result) return null;
      // Too early: try again on a later run of the same day.
      if (result.status !== 'too_early') this.remindersDone = day;
      if (result.sent > 0) this.log.log(`Payment reminders: ${result.sent} merchants reminded`);
      return result;
    } catch (error) {
      await this.reporter.report('job: payment reminders', error);
      return null;
    }
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    if (this.pushTimer) clearInterval(this.pushTimer);
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
   * Charges storage for the Cairo day that just ended and any day before it the server missed
   * (up to storage.catch_up_days), each from that day's units snapshot (chargeStorageDays).
   * Safe to run any number of times: every store and merchant pair has its own key per day.
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
          return chargeStorageDays(tx, now);
        },
        { timeout: 60_000 },
      );
      if (result) {
        this.storageDone = day;
        if (result.charged > 0)
          this.log.log(`Storage charged for ${result.days.join(', ')}: ${result.charged} entries`);
      }
      return result;
    } catch (error) {
      await this.reporter.report('job: storage charge', error);
      return null;
    }
  }

  /**
   * Once a Cairo day: prepares the recurring expenses whose day has come (as requests for a
   * second person) and charges the months that are over for prepayments and fixed assets.
   * Both are keyed per item and month, so repeats and overlaps change nothing.
   */
  async runMonthlyFinance(now: Date = new Date()) {
    const day = cairoDay(now);
    if (this.monthlyDone === day) return null;
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = (await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(${MONTHLY_LOCK}) AS locked`) as [{ locked: boolean }];
          if (!locked) return null;
          return {
            recurring: await runRecurring(tx, now),
            charges: await runMonthlyCharges(tx, now),
            accruals: await reverseAccruals(tx, now),
          };
        },
        { timeout: 60_000 },
      );
      if (!result) return null;
      this.monthlyDone = day;
      const failed = [...result.recurring.failed, ...result.charges.failed];
      for (const f of failed)
        await this.reporter.report('job: monthly finance', new Error(`${f.id}: ${f.error}`));
      if (result.recurring.prepared + result.charges.charged + result.accruals.reversed > 0)
        this.log.log(
          `Monthly finance: ${result.recurring.prepared} recurring prepared, ${result.charges.charged} charges posted`,
        );
      return result;
    } catch (error) {
      await this.reporter.report('job: monthly finance', error);
      return null;
    }
  }

  /**
   * Once a Cairo day: sets the agreed payout schedule of contract versions that took effect
   * (once per version), then tops last month's fees up to each merchant contract's minimum.
   * Keyed per merchant and month, so the days after the first change nothing.
   */
  async runContractMinimums(now: Date = new Date()) {
    const day = cairoDay(now);
    if (this.minimumDone === day) return null;
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = (await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(${MINIMUM_FEE_LOCK}) AS locked`) as [
            { locked: boolean },
          ];
          if (!locked) return null;
          await applyContractSchedules(tx, now);
          return chargeMinimumFees(tx, now);
        },
        { timeout: 60_000 },
      );
      if (!result) return null;
      this.minimumDone = day;
      if (result.charged > 0)
        this.log.log(
          `Contract minimums for ${result.month}: ${result.charged} merchants topped up`,
        );
      return result;
    } catch (error) {
      await this.reporter.report('job: contract minimums', error);
      return null;
    }
  }
}
