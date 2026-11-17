import { Injectable, Logger } from '@nestjs/common';
import { dispatchPush, notify, pushIsOn, type DispatchResult } from '@shiplynow/db';
import { ErrorReporter } from '../common/error-reporter';
import { PrismaService } from '../prisma/prisma.service';
import { PushSender } from './push-sender';

/**
 * Runs the push dispatcher (every 10 seconds from the jobs) and the "send me a test" button.
 * A failed send is reported once as a server error and never reaches the business action:
 * the dispatcher only reads what already happened.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('Push');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: PushSender,
    private readonly reporter: ErrorReporter,
  ) {}

  /** Push can be used: VAPID keys set and the push.enabled setting on. */
  configured() {
    return pushIsOn(this.prisma, this.sender);
  }

  get publicKey() {
    return this.sender.publicKey;
  }

  private onError = (error: unknown) => this.reporter.report('push', error);

  async dispatch(now: Date = new Date()): Promise<DispatchResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const result = await dispatchPush(this.prisma, this.sender, { now, onError: this.onError });
      if (result.events > 0)
        this.log.log(
          `Push: ${result.events} events, ${result.sent} sent, ${result.gone} gone, ${result.failed} failed`,
        );
      return result;
    } catch (error) {
      await this.reporter.report('job: push', error);
      return null;
    } finally {
      this.running = false;
    }
  }

  /** Sends a test notification to every device of the person. */
  test(userId: string, now: Date = new Date()) {
    return notify(
      this.prisma,
      this.sender,
      {
        key: `test:${userId}:${now.getTime()}`,
        userIds: [userId],
        type: 'test',
        text: 'test',
        url: '/notifications',
        tag: 'test',
      },
      { now, onError: this.onError },
    );
  }
}
