import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { setSetting } from '../src/settings';
import {
  addTicketMessage,
  createTicket,
  listTickets,
  markTicketRead,
  setTicketClosed,
  ticketFor,
  ticketReminders,
} from '../src/tickets';
import { prisma, resetDatabase } from './helpers';

let asker: { id: string; name: string };
let cs: { id: string; name: string };
let other: { id: string };
const T0 = new Date('2026-10-29T08:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

beforeEach(async () => {
  await resetDatabase();
  const user = (email: string, name: string, role: 'admin' | 'finance' | 'merchant') =>
    prisma.user.create({ data: { email, name, role, passwordHash: 'x' } });
  asker = await user('boss@t.eg', 'Boss', 'admin');
  cs = await user('cs@t.eg', 'Customer Service', 'finance');
  other = await user('m@t.eg', 'Merchant', 'merchant');
});

afterAll(() => prisma.$disconnect());

const open = (priority: 'normal' | 'urgent' = 'normal') =>
  createTicket(prisma, {
    title: 'Customer asks about order SN-1001',
    body: 'Can you call her?',
    assigneeId: cs.id,
    priority,
    actorUserId: asker.id,
    now: T0,
  });

describe('tickets', () => {
  it('numbers tickets, sets the answer time from settings and starts the thread', async () => {
    await setSetting(prisma, {
      key: 'ticket.urgent_answer_minutes',
      value: 20,
      actorUserId: asker.id,
    });
    const a = await open();
    const b = await open('urgent');
    expect([a.number, b.number]).toEqual([1, 2]);
    expect(a.dueAt).toEqual(at(120));
    expect(b.dueAt).toEqual(at(20));
    const full = await ticketFor(prisma, a.id, { id: cs.id, role: 'finance' });
    expect(full.messages).toEqual([expect.objectContaining({ body: 'Can you call her?' })]);
  });

  it('refuses merchants, inactive people and yourself as assignee', async () => {
    const base = { title: 'x', body: 'y', priority: 'normal' as const, actorUserId: asker.id };
    await expect(createTicket(prisma, { ...base, assigneeId: other.id })).rejects.toMatchObject({
      code: 'assignee_not_found',
    });
    await expect(createTicket(prisma, { ...base, assigneeId: asker.id })).rejects.toMatchObject({
      code: 'cannot_assign_self',
    });
    await prisma.user.update({ where: { id: cs.id }, data: { isActive: false } });
    await expect(createTicket(prisma, { ...base, assigneeId: cs.id })).rejects.toMatchObject({
      code: 'assignee_not_found',
    });
  });

  it('only the two people on it, and admins, can see it', async () => {
    const t = await open();
    await expect(ticketFor(prisma, t.id, { id: other.id, role: 'merchant' })).rejects.toMatchObject(
      {
        code: 'ticket_not_found',
      },
    );
    const inbox = await listTickets(prisma, { userId: cs.id, role: 'finance', box: 'inbox' });
    expect(inbox.map((x) => x.number)).toEqual(['TCK-000001']);
    expect(await listTickets(prisma, { userId: cs.id, role: 'finance', box: 'sent' })).toEqual([]);
  });

  it('answer, follow up, close and reopen move the status the right way', async () => {
    const t = await open();
    const reply = await addTicketMessage(prisma, {
      ticketId: t.id,
      body: 'Called her, all good',
      authorId: cs.id,
      authorName: cs.name,
      source: 'slack',
      slackTs: '1700.1',
      now: at(10),
    });
    expect(reply.ticket).toMatchObject({ status: 'answered', answeredAt: at(10), readAt: at(10) });
    // The same Slack message delivered twice is kept once.
    const again = await addTicketMessage(prisma, {
      ticketId: t.id,
      body: 'Called her, all good',
      authorId: cs.id,
      authorName: cs.name,
      source: 'slack',
      slackTs: '1700.1',
    });
    expect(again.replayed).toBe(true);
    expect(await prisma.ticketMessage.count({ where: { ticketId: t.id } })).toBe(2);

    const follow = await addTicketMessage(prisma, {
      ticketId: t.id,
      body: 'And the refund?',
      authorId: asker.id,
      authorName: asker.name,
      source: 'app',
      now: at(30),
    });
    expect(follow.ticket).toMatchObject({ status: 'open', readAt: null, dueAt: at(150) });

    await setTicketClosed(prisma, { ticketId: t.id, closed: true, actorUserId: asker.id });
    await expect(
      setTicketClosed(prisma, { ticketId: t.id, closed: true, actorUserId: asker.id }),
    ).rejects.toMatchObject({ code: 'ticket_closed' });
    const reopened = await setTicketClosed(prisma, {
      ticketId: t.id,
      closed: false,
      actorUserId: asker.id,
    });
    expect(reopened.status).toBe('open');
  });

  it('reminds once when not opened, and once when the answer is late', async () => {
    const t = await open();
    expect(await ticketReminders(prisma, at(10))).toEqual({ unread: [], late: [] });
    expect(await ticketReminders(prisma, at(16))).toEqual({ unread: [t.id], late: [] });
    expect(await ticketReminders(prisma, at(17))).toEqual({ unread: [], late: [] });
    expect(await ticketReminders(prisma, at(121))).toEqual({ unread: [], late: [t.id] });
    expect(await ticketReminders(prisma, at(200))).toEqual({ unread: [], late: [] });
    expect(await prisma.alert.count({ where: { type: 'ticket_late' } })).toBe(1);

    // Opened in time: no read reminder.
    const u = await open();
    expect(await markTicketRead(prisma, u.id, cs.id, at(5))).toBe(true);
    expect(await markTicketRead(prisma, u.id, asker.id, at(6))).toBe(false);
    expect((await ticketReminders(prisma, at(16))).unread).toEqual([]);
  });
});
