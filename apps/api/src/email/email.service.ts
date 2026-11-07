import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { dispatchEmails, type EmailDispatchResult } from '@shiplynow/db';
import { ErrorReporter } from '../common/error-reporter';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { Mailer } from './mailer';

/**
 * Sends the email outbox every 30 seconds from the jobs. A failed send waits longer each
 * time and is reported once as a server error; the event that queued it never fails.
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger('Email');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
    private readonly reporter: ErrorReporter,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get configured() {
    return this.mailer.enabled;
  }

  /** The web address links and the logo in emails point to. */
  get baseUrl() {
    return this.config.get('WEB_ORIGIN', { infer: true });
  }

  async dispatch(now: Date = new Date()): Promise<EmailDispatchResult | null> {
    if (this.running || !this.mailer.enabled) return null;
    this.running = true;
    try {
      const result = await dispatchEmails(this.prisma, this.mailer, {
        now,
        baseUrl: this.baseUrl,
        onError: (error) => void this.reporter.report('email', error),
      });
      if (result.sent + result.failed + result.gaveUp > 0)
        this.log.log(
          `Email: ${result.sent} sent, ${result.failed} to retry, ${result.gaveUp} failed`,
        );
      return result;
    } catch (error) {
      await this.reporter.report('job: email', error);
      return null;
    } finally {
      this.running = false;
    }
  }
}
