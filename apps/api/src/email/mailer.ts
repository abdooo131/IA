import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MailMessage, Mailer as MailerShape } from '@shiplynow/db';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env';

/**
 * Everything emailed to merchants goes through this boundary, so tests use a fake and
 * nothing is sent while SMTP is not configured (SMTP_HOST and SMTP_FROM at least).
 */
export abstract class Mailer implements MailerShape {
  abstract readonly enabled: boolean;
  abstract send(message: MailMessage): Promise<void>;
}

@Injectable()
export class SmtpMailer extends Mailer {
  private readonly log = new Logger('Email');
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    const host = config.get('SMTP_HOST', { infer: true }) || '';
    this.from = config.get('SMTP_FROM', { infer: true }) || '';
    const user = config.get('SMTP_USER', { infer: true }) || '';
    const pass = config.get('SMTP_PASS', { infer: true }) || '';
    const port = config.get('SMTP_PORT', { infer: true });
    if (!host || !this.from) {
      if (host || this.from) this.log.warn('Email is off: SMTP_HOST and SMTP_FROM are both needed');
      this.transport = null;
      return;
    }
    this.transport = nodemailer.createTransport({
      host,
      port,
      // 465 is TLS from the start; 587 and 25 upgrade with STARTTLS.
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  get enabled() {
    return this.transport !== null;
  }

  async send(message: MailMessage) {
    if (!this.transport) throw new Error('email is not configured');
    try {
      await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          content: a.content,
        })),
      });
    } catch (error) {
      // Only the server's answer code: never the addresses or the content.
      const e = error as { responseCode?: number; code?: string; message?: string };
      throw new Error(
        `email server answered ${e.responseCode ?? e.code ?? (e.message ?? 'error').slice(0, 80)}`,
      );
    }
  }
}
