import { Controller, Headers, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators';
import { ErrorReporter } from '../common/error-reporter';
import type { Env } from '../config/env';
import { verifySlackSignature } from './slack';
import { TicketsService } from './tickets.service';

interface SlackEvent {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    subtype?: string;
    bot_id?: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  };
}

/**
 * Slack calls these (Events API and interactivity). Every request must carry Slack's
 * signature; anything else is refused. Slack expects an answer within three seconds, so the
 * work is quick and failures are reported, never thrown back at Slack (which would retry).
 */
@ApiExcludeController()
@Public()
@Controller('slack')
export class SlackController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly config: ConfigService<Env, true>,
    private readonly reporter: ErrorReporter,
  ) {}

  private verified(req: Request, ts?: string, sig?: string) {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const ok = verifySlackSignature(
      raw,
      ts,
      sig,
      this.config.get('SLACK_SIGNING_SECRET', { infer: true }),
    );
    return ok ? raw : null;
  }

  @Post('events')
  @HttpCode(200)
  async events(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-slack-request-timestamp') ts?: string,
    @Headers('x-slack-signature') sig?: string,
  ) {
    const raw = this.verified(req, ts, sig);
    if (!raw) return res.status(401).send();
    let body: SlackEvent;
    try {
      body = JSON.parse(raw.toString('utf8')) as SlackEvent;
    } catch {
      return res.status(400).send();
    }
    if (body.type === 'url_verification') return res.json({ challenge: body.challenge });
    const e = body.event;
    // Replies in a ticket's thread, written by a person (not by our own bot).
    if (
      e?.type === 'message' &&
      !e.subtype &&
      !e.bot_id &&
      e.thread_ts &&
      e.thread_ts !== e.ts &&
      e.channel &&
      e.user &&
      e.ts &&
      e.text?.trim()
    ) {
      await this.tickets
        .fromSlack({
          channel: e.channel,
          threadTs: e.thread_ts,
          ts: e.ts,
          slackUser: e.user,
          text: e.text.trim(),
        })
        .catch((error: unknown) => this.reporter.report('slack_event', error));
    }
    return res.status(200).send();
  }

  @Post('interactivity')
  @HttpCode(200)
  async interactivity(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-slack-request-timestamp') ts?: string,
    @Headers('x-slack-signature') sig?: string,
  ) {
    const raw = this.verified(req, ts, sig);
    if (!raw) return res.status(401).send();
    const payload = new URLSearchParams(raw.toString('utf8')).get('payload');
    try {
      const data = JSON.parse(payload ?? '{}') as {
        user?: { id?: string };
        actions?: { action_id?: string; value?: string }[];
      };
      const action = data.actions?.[0];
      if (action?.action_id === 'ticket_ack' && action.value && data.user?.id)
        await this.tickets.acknowledged(action.value, data.user.id);
    } catch (error) {
      void this.reporter.report('slack_interactivity', error);
    }
    return res.status(200).send();
  }
}
