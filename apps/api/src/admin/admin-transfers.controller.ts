import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
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
} from '@shiplynow/shared';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** Stock moves between locations. Only admin creates, approves and cancels them. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/transfers')
export class AdminTransfersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: TRANSFER_STATUSES })
  list(@Query('status') status?: string) {
    const valid = (TRANSFER_STATUSES as readonly string[]).includes(status ?? '');
    return listTransfers(this.prisma, {
      status: valid ? [status as TransferStatus] : undefined,
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const detail = await getTransferDetail(this.prisma, id);
    if (!detail) throw new NotFoundException({ error: 'transfer_not_found' });
    return detail;
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createTransferSchema)) body: CreateTransferBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const t = await createTransfer(this.prisma, { ...body, actorUserId: user.sub });
    return { id: t.id, reference: t.reference, toId: t.toId };
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approveTransferSchema)) body: z.infer<typeof approveTransferSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return approveTransfer(this.prisma, {
      transferId: id,
      lines: body.lines,
      actorUserId: user.sub,
    });
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelReturnSchema)) body: z.infer<typeof cancelReturnSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return cancelTransfer(this.prisma, {
      transferId: id,
      reason: body.reason,
      actorUserId: user.sub,
    });
  }
}
