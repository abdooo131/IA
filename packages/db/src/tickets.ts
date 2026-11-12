import type { Prisma, TicketPriority } from '@prisma/client';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { nextNumber } from './finance/ledger';
import { getSetting } from './settings';

// Internal tickets: one team member asks another. The ticket lives here and, when Slack is
// connected, also as a Slack thread (the API mirrors messages both ways).
//
//   open ──assignee answers──▶ answered ──asker writes again──▶ open
//     └────────────── either closes ──────────────▶ closed ──reopen──▶ open
//
// The answer is due by dueAt (ticket.normal_answer_minutes or ticket.urgent_answer_minutes).
// The reminder job (ticketReminders) sends each reminder once.

const INTERNAL_ROLES = ['admin', 'finance', 'store_staff', 'rider'] as const;

export function ticketNumber(n: number) {
  return `TCK-${String(n).padStart(6, '0')}`;
}

async function answerMinutes(db: Db, priority: TicketPriority) {
  return getSetting(
    db,
    priority === 'urgent' ? 'ticket.urgent_answer_minutes' : 'ticket.normal_answer_minutes',
  );
}

export function createTicket(
  db: Db,
  input: {
    title: string;
    body: string;
    assigneeId: string;
    priority: TicketPriority;
    relatedType?: string;
    relatedId?: string;
    actorUserId: string;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const [actor, assignee] = await Promise.all([
      tx.user.findUnique({ where: { id: input.actorUserId } }),
      tx.user.findUnique({ where: { id: input.assigneeId } }),
    ]);
    if (!actor) throw new DomainError('user_not_found', 404);
    if (
      !assignee ||
      !assignee.isActive ||
      !(INTERNAL_ROLES as readonly string[]).includes(assignee.role)
    )
      throw new DomainError('assignee_not_found', 404);
    if (assignee.id === actor.id) throw new DomainError('cannot_assign_self', 400);
    const now = input.now ?? new Date();
    const due = new Date(now.getTime() + (await answerMinutes(tx, input.priority)) * 60_000);
    const ticket = await tx.ticket.create({
      data: {
        number: await nextNumber(tx, 'tickets'),
        title: input.title,
        priority: input.priority,
        createdById: actor.id,
        assigneeId: assignee.id,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        dueAt: due,
        createdAt: now,
        messages: {
          create: {
            authorId: actor.id,
            authorName: actor.name,
            source: 'app',
            body: input.body,
            createdAt: now,
          },
        },
      },
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      action: 'ticket.create',
      entityType: 'ticket',
      entityId: ticket.id,
      after: { number: ticket.number, assignee: assignee.name, priority: ticket.priority },
    });
    return ticket;
  });
}

/** Who may see a ticket: the two people on it, and admins. */
export async function ticketFor(db: Db, ticketId: string, viewer: { id: string; role: string }) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      createdBy: { select: { id: true, name: true, role: true, slackUserId: true } },
      assignee: { select: { id: true, name: true, role: true, slackUserId: true } },
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!ticket) throw new DomainError('ticket_not_found', 404);
  const onIt = ticket.createdById === viewer.id || ticket.assigneeId === viewer.id;
  if (!onIt && viewer.role !== 'admin') throw new DomainError('ticket_not_found', 404);
  return ticket;
}

/** The assignee has seen it (opened in Shiply, tapped "I'm on it" in Slack, or replied). */
export async function markTicketRead(db: Db, ticketId: string, userId: string, at = new Date()) {
  const updated = await db.ticket.updateMany({
    where: { id: ticketId, assigneeId: userId, readAt: null },
    data: { readAt: at },
  });
  return updated.count === 1;
}

/**
 * Adds a message. From the assignee it is the answer (open becomes answered); from the asker
 * it reopens a closed or answered ticket and restarts the answer clock.
 */
export function addTicketMessage(
  db: Db,
  input: {
    ticketId: string;
    body: string;
    authorId: string | null;
    authorName: string;
    source: 'app' | 'slack';
    slackTs?: string;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) throw new DomainError('ticket_not_found', 404);
    if (input.slackTs) {
      const seen = await tx.ticketMessage.findUnique({
        where: { ticketId_slackTs: { ticketId: ticket.id, slackTs: input.slackTs } },
      });
      if (seen) return { message: seen, ticket, replayed: true };
    }
    const now = input.now ?? new Date();
    const message = await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: input.authorId,
        authorName: input.authorName,
        source: input.source,
        body: input.body,
        slackTs: input.slackTs ?? null,
        createdAt: now,
      },
    });
    const data: Prisma.TicketUpdateInput = {};
    if (input.authorId === ticket.assigneeId) {
      data.readAt = ticket.readAt ?? now;
      if (ticket.status === 'open') {
        data.status = 'answered';
        data.answeredAt = ticket.answeredAt ?? now;
      }
    } else if (input.authorId === ticket.createdById && ticket.status !== 'open') {
      // A new question: the assignee owes an answer again.
      data.status = 'open';
      data.closedAt = null;
      data.readAt = null;
      data.readReminderAt = null;
      data.lateNoticeAt = null;
      data.dueAt = new Date(now.getTime() + (await answerMinutes(tx, ticket.priority)) * 60_000);
    }
    const updated = Object.keys(data).length
      ? await tx.ticket.update({ where: { id: ticket.id }, data })
      : ticket;
    return { message, ticket: updated, replayed: false };
  });
}

export function setTicketClosed(
  db: Db,
  input: { ticketId: string; closed: boolean; actorUserId: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) throw new DomainError('ticket_not_found', 404);
    if (input.closed === (ticket.status === 'closed'))
      throw new DomainError(input.closed ? 'ticket_closed' : 'ticket_not_closed');
    const now = input.now ?? new Date();
    const updated = await tx.ticket.update({
      where: { id: ticket.id },
      data: input.closed
        ? { status: 'closed', closedAt: now }
        : {
            status: 'open',
            closedAt: null,
            readAt: null,
            readReminderAt: null,
            lateNoticeAt: null,
            dueAt: new Date(now.getTime() + (await answerMinutes(tx, ticket.priority)) * 60_000),
          },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: input.closed ? 'ticket.close' : 'ticket.reopen',
      entityType: 'ticket',
      entityId: ticket.id,
      before: { status: ticket.status },
      after: { status: updated.status },
    });
    return updated;
  });
}

export async function listTickets(
  db: Db,
  input: { userId: string; role: string; box: 'inbox' | 'sent' | 'all'; status?: string },
) {
  const where: Prisma.TicketWhereInput =
    input.box === 'inbox'
      ? { assigneeId: input.userId }
      : input.box === 'sent'
        ? { createdById: input.userId }
        : input.role === 'admin'
          ? {}
          : { OR: [{ assigneeId: input.userId }, { createdById: input.userId }] };
  if (input.status === 'open' || input.status === 'answered' || input.status === 'closed')
    where.status = input.status;
  const rows = await db.ticket.findMany({
    where,
    include: {
      createdBy: { select: { name: true } },
      assignee: { select: { name: true } },
      _count: { select: { messages: true } },
    },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    take: 200,
  });
  return rows.map((t) => ({
    id: t.id,
    number: ticketNumber(t.number),
    title: t.title,
    priority: t.priority,
    status: t.status,
    createdBy: t.createdBy.name,
    assignee: t.assignee.name,
    dueAt: t.dueAt,
    readAt: t.readAt,
    answeredAt: t.answeredAt,
    messages: t._count.messages,
    createdAt: t.createdAt,
  }));
}

/** People a ticket can be sent to: active team members (not merchants). */
export function ticketAssignees(db: Db) {
  return db.user.findMany({
    where: { isActive: true, role: { in: [...INTERNAL_ROLES] } },
    select: { id: true, name: true, role: true, slackUserId: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * What the reminder job must send now: tickets not opened after the read reminder time, and
 * tickets past their answer time. Each is claimed once (the stamp is set here), so running
 * the job twice sends nothing twice.
 */
export async function ticketReminders(db: Db, now: Date = new Date()) {
  const readAfter = await getSetting(db, 'ticket.read_reminder_minutes');
  const unread = await db.ticket.findMany({
    where: {
      status: 'open',
      readAt: null,
      readReminderAt: null,
      createdAt: { lte: new Date(now.getTime() - readAfter * 60_000) },
    },
    select: { id: true },
  });
  const late = await db.ticket.findMany({
    where: { status: 'open', lateNoticeAt: null, dueAt: { lte: now } },
    select: { id: true },
  });
  const claim = async (id: string, field: 'readReminderAt' | 'lateNoticeAt') => {
    const done = await db.ticket.updateMany({
      where: { id, [field]: null },
      data: { [field]: now },
    });
    return done.count === 1;
  };
  const readIds: string[] = [];
  for (const t of unread) if (await claim(t.id, 'readReminderAt')) readIds.push(t.id);
  const lateIds: string[] = [];
  for (const t of late)
    if (await claim(t.id, 'lateNoticeAt')) {
      lateIds.push(t.id);
      await db.alert.create({ data: { type: 'ticket_late', data: { ticketId: t.id } } });
    }
  return { unread: readIds, late: lateIds };
}
