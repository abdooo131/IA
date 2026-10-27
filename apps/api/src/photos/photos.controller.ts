import { Controller, Get, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DomainError, savePhoto } from '@shiplynow/db';
import type { AccessTokenClaims } from '@shiplynow/shared';
import type { Request, Response } from 'express';
import { CurrentUser, Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('photos')
@ApiBearerAuth()
@Controller('photos')
export class PhotosController {
  constructor(private readonly prisma: PrismaService) {}

  /** Body: the image itself (image/jpeg, image/png or image/webp), at most about 1.5 MB. */
  @Post()
  @Roles('admin', 'store_staff', 'rider')
  @ApiQuery({ name: 'kind', enum: ['pack', 'delivery'] })
  async upload(
    @Query('kind') kind: string,
    @Req() req: Request,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    if (kind !== 'pack' && kind !== 'delivery') throw new DomainError('photo_kind_invalid', 400);
    if (!Buffer.isBuffer(req.body)) throw new DomainError('photo_type_not_allowed', 400);
    return savePhoto(this.prisma, {
      kind,
      contentType: (req.headers['content-type'] ?? '').split(';')[0]!.trim(),
      data: req.body,
      actorUserId: user.sub,
    });
  }

  /** Staff, riders and admin see any proof photo; a merchant only those of their own orders. */
  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims, @Res() res: Response) {
    const photo = await this.prisma.photo.findUnique({
      where: { id },
      include: {
        packedFor: { select: { merchantId: true } },
        deliveries: { select: { order: { select: { merchantId: true } } } },
        failedDeliveries: { select: { order: { select: { merchantId: true } } } },
      },
    });
    if (!photo) throw new NotFoundException({ error: 'photo_not_found' });
    if (user.role === 'merchant') {
      const me = await this.prisma.user.findUnique({ where: { id: user.sub } });
      const owners = [
        ...photo.packedFor.map((o) => o.merchantId),
        ...photo.deliveries.map((d) => d.order.merchantId),
        ...photo.failedDeliveries.map((d) => d.order.merchantId),
      ];
      if (!me?.merchantId || !owners.includes(me.merchantId))
        throw new NotFoundException({ error: 'photo_not_found' });
    }
    res.setHeader('content-type', photo.contentType);
    res.setHeader('cache-control', 'private, max-age=86400');
    res.send(Buffer.from(photo.data));
  }
}
