import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  closeTransfer,
  DomainError,
  getTransferDetail,
  listTransfers,
  pickForTransfer,
  receiveTransfer,
  sendTransfer,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type TransferScanBody,
  transferScanSchema,
} from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from './store-access.service';

/** Staff send transfers (pick by scan, then send) and receive them (scan, then close). */
@ApiTags('store')
@ApiBearerAuth()
@Roles('admin', 'store_staff')
@Controller('stores/:storeId/transfers')
export class StoreTransfersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StoreAccessService,
  ) {}

  @Get()
  async list(@Param('storeId') storeId: string, @CurrentUser() user: AccessTokenClaims) {
    await this.access.check(user, storeId);
    const [outgoing, incoming] = await Promise.all([
      listTransfers(this.prisma, { fromId: storeId, status: ['approved', 'picking'] }),
      listTransfers(this.prisma, { toId: storeId, status: ['in_transit'] }),
    ]);
    return { outgoing, incoming };
  }

  @Get(':id')
  async detail(
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    const detail = await getTransferDetail(this.prisma, id);
    if (!detail || (detail.from.id !== storeId && detail.to.id !== storeId))
      throw new DomainError('transfer_not_found', 404);
    return detail;
  }

  @Post(':id/pick')
  async pick(
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transferScanSchema)) body: TransferScanBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return pickForTransfer(this.prisma, {
      ...body,
      transferId: id,
      darkStoreId: storeId,
      actorUserId: user.sub,
    });
  }

  @Post(':id/send')
  async send(
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return sendTransfer(this.prisma, {
      transferId: id,
      darkStoreId: storeId,
      actorUserId: user.sub,
    });
  }

  @Post(':id/receive')
  async receive(
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transferScanSchema)) body: TransferScanBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return receiveTransfer(this.prisma, {
      transferId: id,
      darkStoreId: storeId,
      skuId: body.skuId,
      quantity: body.quantity,
      actorUserId: user.sub,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post(':id/close')
  async close(
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return closeTransfer(this.prisma, {
      transferId: id,
      darkStoreId: storeId,
      actorUserId: user.sub,
    });
  }
}
