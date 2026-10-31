import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  listTickets,
  markTicketRead,
  setTicketClosed,
  ticketAssignees,
  ticketFor,
  ticketNumber,
} from '@shiplynow/db';
import type { AccessTokenClaims } from '@shiplynow/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { Slack } from './slack';
import { TicketsService } from './tickets.service';

const createSchema = z.object({
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(1).max(4000),
  assigneeId: z.string().min(1).max(64),
  priority: z.enum(['normal', 'urgent']).default('normal'),
  relatedType: z.string().trim().max(40).optional(),
  relatedId: z.string().trim().max(64).optional(),
});
const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) });

/** Tickets between team members (merchants use support through admin for now). */
@ApiTags('tickets')
@ApiBearerAuth()
@Roles('admin', 'finance', 'store_staff', 'rider')
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly slack: Slack,
  ) {}

  @Get()
  @ApiQuery({ name: 'box', required: false, enum: ['inbox', 'sent', 'all'] })
  @ApiQuery({ name: 'status', required: false })
  async list(
    @CurrentUser() user: AccessTokenClaims,
    @Query('box') box?: string,
    @Query('status') status?: string,
  ) {
    const which = box === 'sent' || box === 'all' ? box : 'inbox';
    const [rows, unread] = await Promise.all([
      listTickets(this.prisma, { userId: user.sub, role: user.role, box: which, status }),
      this.prisma.ticket.count({
        where: { assigneeId: user.sub, status: 'open', readAt: null },
      }),
    ]);
    return { rows, unread, slack: this.slack.enabled };
  }

  @Get('assignees')
  assignees(@CurrentUser() user: AccessTokenClaims) {
    return ticketAssignees(this.prisma).then((list) => list.filter((u) => u.id !== user.sub));
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const ticket = await this.tickets.create({ ...body, actorUserId: user.sub });
    return { id: ticket.id, number: ticketNumber(ticket.number) };
  }

  /** Opening it as the assignee counts as reading it. */
  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    await ticketFor(this.prisma, id, { id: user.sub, role: user.role });
    await markTicketRead(this.prisma, id, user.sub);
    const t = await ticketFor(this.prisma, id, { id: user.sub, role: user.role });
    return {
      id: t.id,
      number: ticketNumber(t.number),
      title: t.title,
      priority: t.priority,
      status: t.status,
      relatedType: t.relatedType,
      relatedId: t.relatedId,
      dueAt: t.dueAt,
      readAt: t.readAt,
      answeredAt: t.answeredAt,
      closedAt: t.closedAt,
      createdAt: t.createdAt,
      inSlack: Boolean(t.slackThreadTs),
      createdBy: { id: t.createdBy.id, name: t.createdBy.name, role: t.createdBy.role },
      assignee: {
        id: t.assignee.id,
        name: t.assignee.name,
        role: t.assignee.role,
        inSlack: Boolean(t.assignee.slackUserId),
      },
      messages: t.messages.map((m) => ({
        id: m.id,
        authorName: m.authorName,
        mine: m.authorId === user.sub,
        source: m.source,
        body: m.body,
        at: m.createdAt,
      })),
    };
  }

  @Post(':id/messages')
  async message(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(messageSchema)) body: z.infer<typeof messageSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const t = await ticketFor(this.prisma, id, { id: user.sub, role: user.role });
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    const { ticket } = await this.tickets.reply(t.id, { id: me.id, name: me.name }, body.body);
    return { status: ticket.status };
  }

  @Post(':id/close')
  async close(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    await ticketFor(this.prisma, id, { id: user.sub, role: user.role });
    const t = await setTicketClosed(this.prisma, {
      ticketId: id,
      closed: true,
      actorUserId: user.sub,
    });
    await this.tickets.closedNotice(id);
    return { status: t.status };
  }

  @Post(':id/reopen')
  async reopen(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    await ticketFor(this.prisma, id, { id: user.sub, role: user.role });
    const t = await setTicketClosed(this.prisma, {
      ticketId: id,
      closed: false,
      actorUserId: user.sub,
    });
    return { status: t.status };
  }
}
