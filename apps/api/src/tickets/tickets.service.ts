import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { addTicketMessage, createTicket, ticketNumber, ticketReminders } from '@shiplynow/db';
import { ErrorReporter } from '../common/error-reporter';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { Slack } from './slack';

/** Slack texts in both languages: Slack has no idea which one the person reads. */
const TEXT = {
  newTicket: (n: string, from: string) =>
    `🎫 ${n} · New ticket from ${from} · تذكرة جديدة من ${from}`,
  urgent: '⚠️ Urgent · عاجل',
  onIt: "I'm on it · أنا عليها",
  open: 'Open in Shiply · افتح في شيبلي',
  replyHint: 'Reply in this thread to answer. · رد في الثريد ده عشان ترد.',
  acknowledged: (name: string) => `👀 ${name} is on it · ${name} شغال عليها`,
  readReminder: (n: string) =>
    `⏰ Reminder: ${n} is waiting for you to open it. · تذكير: ${n} مستنية تفتحها.`,
  lateAssignee: (n: string) =>
    `🔴 ${n} is late: the answer time has passed. · ${n} اتأخرت: وقت الرد عدى.`,
  lateAsker: (n: string, who: string) =>
    `🔴 ${n}: ${who} has not answered in time. · ${n}: ${who} ما ردش في الوقت.`,
  answered: (n: string, who: string) => `💬 ${n} · ${who} answered · ${who} رد`,
  closed: (n: string) => `✅ ${n} closed · اتقفلت`,
};

/**
 * Tickets with their Slack side. Shiply is the record; Slack is where people are told and can
 * answer. A Slack failure never loses a ticket or a message: it is reported and the ticket
 * keeps working inside Shiply.
 */
@Injectable()
export class TicketsService {
  private readonly log = new Logger('Tickets');

  constructor(
    private readonly prisma: PrismaService,
    private readonly slack: Slack,
    private readonly config: ConfigService<Env, true>,
    private readonly reporter: ErrorReporter,
  ) {}

  private link(ticketId: string) {
    return `${this.config.get('WEB_ORIGIN', { infer: true }).replace(/\/$/, '')}/tickets/${ticketId}`;
  }

  private async safely<T>(what: string, work: () => Promise<T>) {
    if (!this.slack.enabled) return null;
    try {
      return await work();
    } catch (error) {
      void this.reporter.report(`slack_${what}`, error);
      return null;
    }
  }

  async create(input: Parameters<typeof createTicket>[1]) {
    const ticket = await createTicket(this.prisma, input);
    const full = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: { createdBy: true, assignee: true },
    });
    const to = full.assignee.slackUserId;
    if (to) {
      const n = ticketNumber(full.number);
      const posted = await this.safely('new_ticket', () =>
        this.slack.post({
          channel: to,
          text: TEXT.newTicket(n, full.createdBy.name),
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${TEXT.newTicket(n, full.createdBy.name)}*${full.priority === 'urgent' ? `\n${TEXT.urgent}` : ''}\n*${full.title}*\n${input.body}`,
              },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  action_id: 'ticket_ack',
                  value: full.id,
                  style: 'primary',
                  text: { type: 'plain_text', text: TEXT.onIt },
                },
                {
                  type: 'button',
                  action_id: 'ticket_open',
                  url: this.link(full.id),
                  text: { type: 'plain_text', text: TEXT.open },
                },
              ],
            },
            { type: 'context', elements: [{ type: 'mrkdwn', text: TEXT.replyHint }] },
          ],
        }),
      );
      if (posted)
        await this.prisma.ticket.update({
          where: { id: full.id },
          data: { slackChannel: posted.channel, slackThreadTs: posted.ts },
        });
    }
    return ticket;
  }

  /** A message written in Shiply: kept, then sent to the Slack thread and to the asker. */
  async reply(ticketId: string, author: { id: string; name: string }, body: string) {
    const result = await addTicketMessage(this.prisma, {
      ticketId,
      body,
      authorId: author.id,
      authorName: author.name,
      source: 'app',
    });
    await this.relay(result.ticket.id, author, body, 'app');
    return result;
  }

  /** A reply written in the Slack thread. */
  async fromSlack(input: {
    channel: string;
    threadTs: string;
    ts: string;
    slackUser: string;
    text: string;
  }) {
    const ticket = await this.prisma.ticket.findUnique({
      where: {
        slackChannel_slackThreadTs: { slackChannel: input.channel, slackThreadTs: input.threadTs },
      },
    });
    if (!ticket) return null;
    const author = await this.prisma.user.findUnique({ where: { slackUserId: input.slackUser } });
    const result = await addTicketMessage(this.prisma, {
      ticketId: ticket.id,
      body: input.text,
      authorId: author?.id ?? null,
      authorName: author?.name ?? 'Slack',
      source: 'slack',
      slackTs: input.ts,
    });
    if (!result.replayed && author)
      await this.relay(ticket.id, { id: author.id, name: author.name }, input.text, 'slack');
    return result;
  }

  /** Tells the other person: the asker by direct message, the assignee in the ticket thread. */
  private async relay(
    ticketId: string,
    author: { id: string; name: string },
    body: string,
    from: 'app' | 'slack',
  ) {
    const t = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: { createdBy: true },
    });
    const n = ticketNumber(t.number);
    if (author.id === t.assigneeId) {
      const asker = t.createdBy.slackUserId;
      if (asker)
        await this.safely('answered', () =>
          this.slack.post({
            channel: asker,
            text: `${TEXT.answered(n, author.name)}\n>${body}\n<${this.link(t.id)}|${TEXT.open}>`,
          }),
        );
    }
    // Anything written in Shiply also lands in the Slack thread, so the thread is complete.
    if (from === 'app' && t.slackChannel && t.slackThreadTs)
      await this.safely('thread', () =>
        this.slack.post({
          channel: t.slackChannel!,
          threadTs: t.slackThreadTs!,
          text: `*${author.name}:* ${body}`,
        }),
      );
  }

  async acknowledged(ticketId: string, slackUser: string) {
    const user = await this.prisma.user.findUnique({ where: { slackUserId: slackUser } });
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!user || !ticket || ticket.assigneeId !== user.id) return false;
    const first = await this.prisma.ticket.updateMany({
      where: { id: ticket.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (first.count && ticket.slackChannel && ticket.slackThreadTs)
      await this.safely('ack', () =>
        this.slack.post({
          channel: ticket.slackChannel!,
          threadTs: ticket.slackThreadTs!,
          text: TEXT.acknowledged(user.name),
        }),
      );
    return true;
  }

  async closedNotice(ticketId: string) {
    const t = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (t?.slackChannel && t.slackThreadTs)
      await this.safely('closed', () =>
        this.slack.post({
          channel: t.slackChannel!,
          threadTs: t.slackThreadTs!,
          text: TEXT.closed(ticketNumber(t.number)),
        }),
      );
  }

  /** The reminder job: each reminder goes out once (the database claims it first). */
  async remind(now = new Date()) {
    const due = await ticketReminders(this.prisma, now);
    const ids = [...due.unread, ...due.late];
    if (ids.length === 0) return due;
    const tickets = await this.prisma.ticket.findMany({
      where: { id: { in: ids } },
      include: { createdBy: true, assignee: true },
    });
    for (const t of tickets) {
      const n = ticketNumber(t.number);
      const to = t.assignee.slackUserId;
      const where =
        t.slackChannel && t.slackThreadTs
          ? { channel: t.slackChannel, threadTs: t.slackThreadTs }
          : to
            ? { channel: to }
            : null;
      if (due.unread.includes(t.id) && where)
        await this.safely('reminder', () =>
          this.slack.post({ ...where, text: TEXT.readReminder(n) }),
        );
      if (due.late.includes(t.id)) {
        if (where)
          await this.safely('late', () =>
            this.slack.post({ ...where, text: TEXT.lateAssignee(n) }),
          );
        const asker = t.createdBy.slackUserId;
        if (asker)
          await this.safely('late_asker', () =>
            this.slack.post({
              channel: asker,
              text: `${TEXT.lateAsker(n, t.assignee.name)}\n<${this.link(t.id)}|${TEXT.open}>`,
            }),
          );
      }
    }
    this.log.log(`reminders: ${due.unread.length} not opened, ${due.late.length} late`);
    return due;
  }
}
