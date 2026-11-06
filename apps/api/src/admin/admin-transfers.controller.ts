import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  approveTransfer,
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
} from '@shiplynow/shared';
import type { z } from 'zod';
import { assertStore, limitedStores } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
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
    const stores = limitedStores(access);
    if (!stores) return;
    const t = await this.prisma.transfer.findUnique({
      where: { id },
      select: { fromId: true, toId: true, finalDestinationId: true },
    });
    if (!t) return;
    const ids = [t.fromId, t.toId, t.finalDestinationId].filter((x): x is string => !!x);
    if (!ids.some((x) => stores.includes(x)))
      throw new ForbiddenException({ error: 'store_not_allowed' });
  }
}
