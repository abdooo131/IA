import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { NeedAccess, parse } from '../platform';
import { LocationService } from './location.service';

@Controller('location/queue')
export class QueueController {
  constructor(@Inject(LocationService) private readonly location: LocationService) {}

  @Get()
  @NeedAccess('location', 'view')
  list(@Query('page') page = '1') {
    return this.location.queue(Math.max(1, Number(page) || 1));
  }

  @Post(':id/pick')
  @HttpCode(200)
  @NeedAccess('location', 'use')
  pick(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { placeId } = parse(z.object({ placeId: z.string().min(1) }), body);
    return this.location.pick(id, placeId, req.user!.id);
  }
}
