import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { Slack, type SlackPost } from '../src/tickets/slack';
import { createTestApp, resetAndSeed } from './helpers';

const SECRET = process.env.SLACK_SIGNING_SECRET ?? '';

/** Records what the app posts; every message lands in a channel with a growing ts. */
class FakeSlack extends Slack {
  enabled = true;
  posts: SlackPost[] = [];
  private n = 0;
  async post(message: SlackPost) {
    this.posts.push(message);
    return {
      channel: message.channel.startsWith('U') ? `D${message.channel}` : message.channel,
      ts: `1700.${++this.n}`,
    };
  }
}

const sign = (body: string, ts = String(Math.floor(Date.now() / 1000))) => ({
  'x-slack-request-timestamp': ts,
  'x-slack-signature': `v0=${createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex')}`,
});

describe('tickets and Slack', () => {
  const slack = new FakeSlack();
  let app: INestApplication;
  let prisma: PrismaService;
  const agent = async (email: string, password = 'demo-password-1') => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ slack }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    slack.posts = [];
    slack.enabled = true;
    await resetAndSeed(prisma);
    await prisma.user.update({
      where: { email: 'admin@test.eg' },
      data: { slackUserId: 'UBOSS01' },
    });
    await prisma.user.update({
      where: { email: 'finance@shiplynow.local' },
      data: { slackUserId: 'UCS0001' },
    });
  });

  const event = (body: object) => {
    const raw = JSON.stringify(body);
    return request(app.getHttpServer())
      .post('/slack/events')
      .set('content-type', 'application/json')
      .set(sign(raw))
      .send(raw);
  };

  it('asks in Shiply, answers in Slack, and the asker sees it in both', async () => {
    expect(SECRET).not.toBe('');
    const boss = await agent('admin@test.eg', 'admin-password-1');
    const cs = await prisma.user.findUniqueOrThrow({ where: { email: 'finance@shiplynow.local' } });
    const created = await boss
      .post('/tickets')
      .send({
        title: 'Refund for order SN-1001',
        body: 'Please check the refund',
        assigneeId: cs.id,
        priority: 'urgent',
      })
      .expect(201);
    expect(created.body.number).toBe('TCK-000001');
    expect(slack.posts[0]).toMatchObject({ channel: 'UCS0001' });
    expect(JSON.stringify(slack.posts[0]!.blocks)).toContain('ticket_ack');

    // The assignee taps "I'm on it".
    const payload = `payload=${encodeURIComponent(JSON.stringify({ user: { id: 'UCS0001' }, actions: [{ action_id: 'ticket_ack', value: created.body.id }] }))}`;
    await request(app.getHttpServer())
      .post('/slack/interactivity')
      .set('content-type', 'application/x-www-form-urlencoded')
      .set(sign(payload))
      .send(payload)
      .expect(200);
    expect(
      (await prisma.ticket.findUniqueOrThrow({ where: { id: created.body.id } })).readAt,
    ).not.toBeNull();

    // They reply in the Slack thread; Slack sends the same event twice.
    const reply = {
      type: 'event_callback',
      event: {
        type: 'message',
        user: 'UCS0001',
        text: 'Refund sent today',
        channel: 'DUCS0001',
        ts: '1800.5',
        thread_ts: '1700.1',
      },
    };
    await event(reply).expect(200);
    await event(reply).expect(200);
    const view = (await boss.get(`/tickets/${created.body.id}`).expect(200)).body;
    expect(view.status).toBe('answered');
    expect(view.messages.map((m: { body: string; source: string }) => [m.source, m.body])).toEqual([
      ['app', 'Please check the refund'],
      ['slack', 'Refund sent today'],
    ]);
    // The asker is told in Slack too.
    expect(
      slack.posts.some((p) => p.channel === 'UBOSS01' && p.text.includes('Refund sent today')),
    ).toBe(true);

    // A follow up from Shiply goes into the same Slack thread and reopens the ticket.
    await boss
      .post(`/tickets/${created.body.id}/messages`)
      .send({ body: 'Thanks, which bank?' })
      .expect(201);
    expect(slack.posts.at(-1)).toMatchObject({ channel: 'DUCS0001', threadTs: '1700.1' });
    expect((await boss.get(`/tickets/${created.body.id}`)).body.status).toBe('open');
    await boss.post(`/tickets/${created.body.id}/close`).expect(201);
    await boss.post(`/tickets/${created.body.id}/close`).expect(409);
  });

  it('refuses unsigned or stale Slack calls and answers the url check', async () => {
    const raw = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
    await request(app.getHttpServer())
      .post('/slack/events')
      .set('content-type', 'application/json')
      .send(raw)
      .expect(401);
    await request(app.getHttpServer())
      .post('/slack/events')
      .set('content-type', 'application/json')
      .set(sign(raw, String(Math.floor(Date.now() / 1000) - 600)))
      .send(raw)
      .expect(401);
    const ok = await event({ type: 'url_verification', challenge: 'abc' }).expect(200);
    expect(ok.body).toEqual({ challenge: 'abc' });
  });

  it('reminds in Slack when not opened, then tells both people when late', async () => {
    const boss = await agent('admin@test.eg', 'admin-password-1');
    const cs = await prisma.user.findUniqueOrThrow({ where: { email: 'finance@shiplynow.local' } });
    const created = await boss
      .post('/tickets')
      .send({ title: 'Count NCR', body: 'Please count A-01', assigneeId: cs.id })
      .expect(201);
    const jobs = app.get(JobsService);
    const later = (min: number) => new Date(Date.now() + min * 60_000);
    await jobs.runTicketReminders(later(16));
    expect(slack.posts.at(-1)!.text).toContain('Reminder');
    await jobs.runTicketReminders(later(17));
    const count = slack.posts.length;
    await jobs.runTicketReminders(later(121));
    const late = slack.posts.slice(count);
    expect(late.map((p) => p.channel).sort()).toEqual(['DUCS0001', 'UBOSS01']);
    expect(await prisma.alert.count({ where: { type: 'ticket_late' } })).toBe(1);
    expect(created.body.id).toBeTruthy();
  });

  it('works without Slack, and only the people on a ticket can see it', async () => {
    slack.enabled = false;
    const finance = await agent('finance@shiplynow.local');
    const staff = await prisma.user.findUniqueOrThrow({
      where: { email: 'staff.newcairo@shiplynow.local' },
    });
    const created = await finance
      .post('/tickets')
      .send({ title: 'Cash short', body: 'Rider RDR-1 is 50 short', assigneeId: staff.id })
      .expect(201);
    const staffAgent = await agent('staff.newcairo@shiplynow.local');
    const inbox = (await staffAgent.get('/tickets').expect(200)).body;
    expect(inbox).toMatchObject({ unread: 1, slack: false });
    await staffAgent.get(`/tickets/${created.body.id}`).expect(200);
    expect((await staffAgent.get('/tickets')).body.unread).toBe(0);
    const rider = await agent('rider.newcairo@shiplynow.local');
    await rider.get(`/tickets/${created.body.id}`).expect(404);
    const merchant = await agent('merchant@evechantelle.example');
    await merchant.get('/tickets').expect(403);
    await finance
      .post('/tickets')
      .send({ title: 'x', body: 'y', assigneeId: 'nobody' })
      .expect(400);
  });
});
