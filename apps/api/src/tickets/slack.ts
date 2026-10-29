import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

export interface SlackPost {
  /** A channel id, or a member id (U...) to send a direct message from the app */
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: unknown[];
}

/**
 * Everything the app asks of Slack goes through this boundary, so tests use a fake and the
 * app keeps working (inside Shiply only) when Slack is not connected.
 */
export abstract class Slack {
  abstract readonly enabled: boolean;
  /** Posts a message; answers where it landed, or null when Slack is off. */
  abstract post(message: SlackPost): Promise<{ channel: string; ts: string } | null>;
}

@Injectable()
export class HttpSlack extends Slack {
  private readonly log = new Logger('Slack');
  private readonly token: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.token = config.get('SLACK_BOT_TOKEN', { infer: true }) || undefined;
  }

  get enabled() {
    return Boolean(this.token);
  }

  async post(message: SlackPost) {
    if (!this.token) return null;
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        channel: message.channel,
        text: message.text,
        thread_ts: message.threadTs,
        blocks: message.blocks,
        unfurl_links: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      channel?: string;
      ts?: string;
      error?: string;
    };
    if (!body.ok || !body.channel || !body.ts) {
      this.log.warn(`chat.postMessage failed: ${body.error ?? res.status}`);
      throw new Error(`slack ${body.error ?? res.status}`);
    }
    return { channel: body.channel, ts: body.ts };
  }
}

/**
 * Slack signs every request: v0=hex(HMAC_SHA256(secret, "v0:<timestamp>:<raw body>")).
 * Requests older than five minutes are refused so a captured one cannot be replayed.
 */
export function verifySlackSignature(
  raw: Buffer,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string | undefined,
  now: number = Date.now(),
) {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const expected = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:`).update(raw).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
