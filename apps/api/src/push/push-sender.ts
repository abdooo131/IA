import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PushMessage,
  PushOutcome,
  PushSender as PushSenderShape,
  PushTarget,
} from '@shiplynow/db';
import webpush from 'web-push';
import type { Env } from '../config/env';

/**
 * Everything sent to the browsers' push services (Google, Mozilla, Apple) goes through this
 * boundary, so tests use a fake and nothing is sent while the VAPID keys are not set.
 */
export abstract class PushSender implements PushSenderShape {
  abstract readonly enabled: boolean;
  /** The VAPID public key browsers subscribe with (null when push is not configured). */
  abstract readonly publicKey: string | null;
  abstract send(target: PushTarget, message: PushMessage): Promise<PushOutcome>;
}

/** How long a push service keeps a message for a phone that is off (seconds). */
const TTL_SECONDS = 60 * 60;

@Injectable()
export class HttpPush extends PushSender {
  private readonly log = new Logger('Push');
  private readonly details: { subject: string; publicKey: string; privateKey: string } | null;

  constructor(config: ConfigService<Env, true>) {
    super();
    const publicKey = config.get('VAPID_PUBLIC_KEY', { infer: true }) || '';
    const privateKey = config.get('VAPID_PRIVATE_KEY', { infer: true }) || '';
    const subject = config.get('VAPID_SUBJECT', { infer: true }) || '';
    this.details = publicKey && privateKey && subject ? { subject, publicKey, privateKey } : null;
    if (!this.details && (publicKey || privateKey))
      this.log.warn(
        'Push is off: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are all needed',
      );
  }

  get enabled() {
    return this.details !== null;
  }

  get publicKey() {
    return this.details?.publicKey ?? null;
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    if (!this.details) throw new Error('push is not configured');
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        {
          vapidDetails: this.details,
          TTL: TTL_SECONDS,
          urgency: message.urgent ? 'high' : 'normal',
          topic: topicOf(message.tag),
          timeout: 10_000,
        },
      );
      return 'sent';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      // Never the endpoint or the body: they identify the device.
      throw new Error(`push service answered ${status ?? (error as Error).message}`);
    }
  }
}

/** A push service topic replaces a waiting message with the same topic: at most 32 url safe characters. */
function topicOf(tag: string) {
  return tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined;
}
