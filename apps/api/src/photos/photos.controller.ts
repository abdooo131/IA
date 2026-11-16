import { Controller, Get, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DomainError, managerOf, type Prisma, savePhoto } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  canDo,
  canUseMerchant,
  canUseStore,
  isTeamRole,
} from '@shiplynow/shared';
import type { Request, Response } from 'express';
import { loadAccess } from '../auth/access.guard';
import { type AuthedRequest, CurrentUser, Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

const ORDER_LINK = { select: { merchantId: true, darkStoreId: true } } as const;

/** Every record a stored file can belong to, read to decide who may open it. */
const PHOTO_LINKS = {
  packedFor: {
    select: { merchantId: true, darkStoreId: true, deliveries: { select: { riderId: true } } },
  },
  deliveries: { select: { riderId: true, order: ORDER_LINK } },
  failedDeliveries: { select: { riderId: true, order: ORDER_LINK } },
  pettyCash: { select: { darkStoreId: true } },
  expenseClaims: {
    select: { userId: true, employeeId: true, managerEmployeeId: true, managerDecidedById: true },
  },
  basataDeposits: { select: { riderId: true } },
} as const satisfies Prisma.PhotoInclude;

type PhotoWithLinks = Prisma.PhotoGetPayload<{ include: typeof PHOTO_LINKS }>;

/** The first bytes every file of each allowed type starts with. */
function isImage(contentType: string, data: Buffer) {
  const starts = (bytes: number[], at = 0) => bytes.every((b, i) => data[at + i] === b);
  if (contentType === 'image/jpeg') return starts([0xff, 0xd8, 0xff]);
  if (contentType === 'image/png') return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (contentType === 'image/webp')
    return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
  return false;
}

@ApiTags('photos')
@ApiBearerAuth()
@Controller('photos')
export class PhotosController {
  constructor(private readonly prisma: PrismaService) {}

  /** Body: the image itself (image/jpeg, image/png or image/webp), at most about 1.5 MB. */
  @Post()
  @Roles('admin', 'store_staff', 'rider', 'finance')
  @ApiQuery({ name: 'kind', enum: ['pack', 'delivery', 'receipt', 'basata_receipt'] })
  async upload(
    @Query('kind') kind: string,
    @Req() req: Request,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    // Receipts are for accounting (use), store petty cash (store use) and expense claims
    // (anyone with an employee file); pack and delivery proof for the store and riders; Basata
    // deposit receipts for riders.
    const allowed: string[] = [];
    if (user.role === 'rider') allowed.push('pack', 'delivery', 'basata_receipt');
    else {
      const access = await loadAccess(req as AuthedRequest, this.prisma);
      if (canDo(access, 'store', 'use') || canDo(access, 'operations', 'use'))
        allowed.push('pack', 'delivery');
      if (canDo(access, 'accounting', 'use') || canDo(access, 'store', 'use'))
        allowed.push('receipt');
    }
    if (
      !allowed.includes('receipt') &&
      kind === 'receipt' &&
      (await this.prisma.employee.findUnique({ where: { userId: user.sub }, select: { id: true } }))
    )
      allowed.push('receipt');
    if (!allowed.includes(kind)) throw new DomainError('photo_kind_invalid', 400);
    if (!Buffer.isBuffer(req.body)) throw new DomainError('photo_type_not_allowed', 400);
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    // A phone can send any bytes under an image type; only real images become proof.
    if (req.body.length > 0 && !isImage(contentType, req.body))
      throw new DomainError('photo_not_image', 400);
    return savePhoto(this.prisma, {
      kind: kind as 'pack' | 'delivery' | 'receipt' | 'basata_receipt',
      contentType,
      data: req.body,
      actorUserId: user.sub,
    });
  }

  /**
   * A file opens only for the people its record concerns, decided by its kind and links;
   * anyone else gets 404 photo_not_found, so an id reveals nothing. The uploader always may.
   * - pack and delivery proof: operations or store view on the order's store (inside the
   *   person's stores and merchants), the order's rider, or the order's merchant;
   * - receipts (finance attachments, cheques, petty cash, expense claims, purchase order
   *   quotes) and Basata receipts: accounting view, or the record's own people (the rider's
   *   own Basata deposit, the claimant and their manager, staff of the petty cash's store).
   * HR files have their own routes.
   */
  @Get(':id')
  async get(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const photo = await this.prisma.photo.findUnique({ where: { id }, include: PHOTO_LINKS });
    if (!photo || !(await this.mayOpen(photo, user, req as AuthedRequest)))
      throw new NotFoundException({ error: 'photo_not_found' });
    res.setHeader('content-type', photo.contentType);
    // A PDF opens in the browser under its own name (finance attachments keep it).
    if (photo.fileName)
      res.setHeader(
        'content-disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(photo.fileName)}`,
      );
    res.setHeader('cache-control', 'private, max-age=86400');
    res.send(Buffer.from(photo.data));
  }

  private async mayOpen(photo: PhotoWithLinks, user: AccessTokenClaims, req: AuthedRequest) {
    if (photo.createdById === user.sub) return true;
    const orders = [
      ...photo.packedFor.map((o) => ({
        merchantId: o.merchantId,
        darkStoreId: o.darkStoreId,
        riderIds: o.deliveries.map((d) => d.riderId),
      })),
      ...[...photo.deliveries, ...photo.failedDeliveries].map((d) => ({
        ...d.order,
        riderIds: [d.riderId],
      })),
    ];
    const proof = photo.kind === 'pack' || photo.kind === 'delivery';

    if (user.role === 'merchant') {
      if (!proof) return false;
      const me = await this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { merchantId: true },
      });
      return Boolean(me?.merchantId && orders.some((o) => o.merchantId === me.merchantId));
    }
    if (user.role === 'rider') {
      const rider = await this.prisma.rider.findUnique({
        where: { userId: user.sub },
        select: { id: true },
      });
      if (!rider) return false;
      if (proof) return orders.some((o) => o.riderIds.includes(rider.id));
      return photo.basataDeposits.some((d) => d.riderId === rider.id);
    }
    if (!isTeamRole(user.role)) return false;

    const access = await loadAccess(req, this.prisma);
    if (proof)
      return (
        (canDo(access, 'operations', 'view') || canDo(access, 'store', 'view')) &&
        orders.some(
          (o) => canUseStore(access, o.darkStoreId) && canUseMerchant(access, o.merchantId),
        )
      );
    if (canDo(access, 'accounting', 'view')) return true;
    if (
      canDo(access, 'store', 'view') &&
      photo.pettyCash.some((p) => canUseStore(access, p.darkStoreId))
    )
      return true;
    for (const c of photo.expenseClaims) {
      if (c.userId === user.sub || c.managerDecidedById === user.sub) return true;
      const me = await this.prisma.employee.findUnique({
        where: { userId: user.sub },
        select: { id: true },
      });
      if (
        me &&
        (c.managerEmployeeId === me.id ||
          (await managerOf(this.prisma, c.employeeId)).managerId === me.id)
      )
        return true;
    }
    return false;
  }
}
