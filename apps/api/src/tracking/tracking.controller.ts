import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { getTracking, getTrackingPhoto, rateOrder } from '@shiplynow/db';
import { orderRatingSchema } from '@shiplynow/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { Public } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The customer's tracking page. Public: the unguessable token in the link is the only key,
 * and the answers hold nothing the customer does not already know.
 */
@ApiTags('tracking')
@Controller('track')
export class TrackingController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get(':token')
  get(@Param('token') token: string) {
    return getTracking(this.prisma, token);
  }

  @Public()
  @Get(':token/photo')
  async photo(@Param('token') token: string, @Res() res: Response) {
    const photo = await getTrackingPhoto(this.prisma, token);
    res.setHeader('content-type', photo.contentType);
    res.setHeader('cache-control', 'private, max-age=86400');
    res.send(Buffer.from(photo.data));
  }

  @Public()
  @Post(':token/rating')
  rate(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(orderRatingSchema)) body: z.infer<typeof orderRatingSchema>,
  ) {
    return rateOrder(this.prisma, { token, ...body });
  }
}
