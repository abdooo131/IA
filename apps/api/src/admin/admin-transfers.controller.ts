import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  approveTransfer,
  DomainError,
  cancelTransfer,
  createTransfer,
  getTransferDetail,
  listTransfers,
  type TransferStatus,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  approveTransferSchema,
  cancelReturnSchema,
  type CreateTransferBody,
  createTransferSchema,
  TRANSFER_STATUSES,
  type AccessProfile,
  bulkIdsSchema,
  type DocSmartButton,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { assertAnyStore, assertStore, limitedStores } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { eachRecord } from '../common/bulk';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** Stock moves between locations. Only admin creates, approves and cancels them. */
@ApiTags('admin')
@ApiBearerAuth()
@Access('inventory')
@Controller('admin/transfers')
export class AdminTransfersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: TRANSFER_STATUSES })
  list(@CurrentAccess() access: AccessProfile, @Query('status') status?: string) {
    const valid = (TRANSFER_STATUSES as readonly string[]).includes(status ?? '');
    return listTransfers(this.prisma, {
      status: valid ? [status as TransferStatus] : undefined,
      locationIds: limitedStores(access) ?? undefined,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const detail = await getTransferDetail(this.prisma, id);
    if (!detail) throw new NotFoundException({ error: 'transfer_not_found' });
    await this.checkStores(id, access);
    return detail;
  }

  /**
   * The transfer's document frame (UX phase C step 2): smart buttons for its sender, receiver
   * and final destination (their transfers), the leg before and after it, its lines and units.
   */
  @Get(':id/document')
  async document(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const t = await this.prisma.transfer.findUnique({
      where: { id },
      select: {
        fromId: true,
        toId: true,
        finalDestinationId: true,
        from: { select: { code: true } },
        to: { select: { code: true } },
        finalDestination: { select: { code: true } },
        previous: { select: { id: true, reference: true } },
        next: { select: { id: true, reference: true } },
        lines: { select: { quantity: true, pickedQty: true, receivedQty: true } },
      },
    });
    if (!t) throw new NotFoundException({ error: 'transfer_not_found' });
    await this.checkStores(id, access);
    const lines = t.lines;
    const units = (of: (l: (typeof lines)[number]) => number) =>
      lines.reduce((s, l) => s + of(l), 0);
    const smart: DocSmartButton[] = [
      {
        key: 'sender',
        count: null,
        value: t.from.code,
        href: `/admin/transfers?f=&v=sender:${t.fromId}`,
      },
      {
        key: 'receiver',
        count: null,
        value: t.to.code,
        href: `/admin/transfers?f=&v=receiver:${t.toId}`,
      },
    ];
    if (t.finalDestinationId && t.finalDestination)
      smart.push({
        key: 'destination',
        count: null,
        value: t.finalDestination.code,
        href: `/admin/transfers?f=&v=destination:${t.finalDestinationId}`,
      });
    if (t.previous)
      smart.push({
        key: 'previousLeg',
        count: null,
        value: t.previous.reference,
        href: `/admin/transfers/${t.previous.id}`,
      });
    for (const n of t.next)
      smart.push({
        key: 'nextLeg',
        count: null,
        value: n.reference,
        href: `/admin/transfers/${n.id}`,
      });
    smart.push(
      { key: 'lines', count: t.lines.length, href: '#lines' },
      {
        key: 'unitsMoved',
        count: null,
        value: `${units((l) => l.quantity)} → ${units((l) => l.pickedQty)} → ${units((l) => l.receivedQty)}`,
        href: '#lines',
      },
    );
    return { smart };
  }

  /**
   * Approves several draft transfers with their quantities as drafted, each on its own and
   * under the single approve rules (stock is held at the sender; not enough refuses that row).
   */
  @Post('bulk-approve')
  @Access('inventory', 'manage')
  bulkApprove(
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return eachRecord(body.ids, async (id) => {
      if (!(await this.prisma.transfer.count({ where: { id } })))
        throw new DomainError('transfer_not_found', 404);
      await this.checkStores(id, access);
      await approveTransfer(this.prisma, { transferId: id, actorUserId: user.sub });
    });
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createTransferSchema)) body: CreateTransferBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    // Stock leaves the sender: it must be one of the person's stores.
    assertStore(access, body.fromId);
    const t = await createTransfer(this.prisma, { ...body, actorUserId: user.sub });
    return { id: t.id, reference: t.reference, toId: t.toId };
  }

  @Post(':id/approve')
  @Access('inventory', 'manage')
  async approve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approveTransferSchema)) body: z.infer<typeof approveTransferSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.checkStores(id, access);
    return approveTransfer(this.prisma, {
      transferId: id,
      lines: body.lines,
      actorUserId: user.sub,
    });
  }

  @Post(':id/cancel')
  @Access('inventory', 'manage')
  async cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelReturnSchema)) body: z.infer<typeof cancelReturnSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.checkStores(id, access);
    return cancelTransfer(this.prisma, {
      transferId: id,
      reason: body.reason,
      actorUserId: user.sub,
    });
  }

  /** A transfer is visible to people working in its sender, receiver or final store. */
  private async checkStores(id: string, access: AccessProfile) {
    if (!limitedStores(access)) return;
    const t = await this.prisma.transfer.findUnique({
      where: { id },
      select: { fromId: true, toId: true, finalDestinationId: true },
    });
    if (!t) return;
    assertAnyStore(
      access,
      [t.fromId, t.toId, t.finalDestinationId].filter((x): x is string => !!x),
    );
  }
}
