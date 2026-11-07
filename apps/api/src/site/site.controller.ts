import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { createSiteLead, findSiteLeadByKey } from '@shiplynow/db';
import { type SiteLeadBody, siteLeadSchema } from '@shiplynow/shared';
import type { Request } from 'express';
import { clientAddress, LoginThrottleService } from '../auth/login-throttle.service';
import { Public } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** The public website's contact form: each lead opens a deal in the Sales CRM (docs/SALES.md). */
@ApiTags('site')
@Controller('site')
export class SiteController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly throttle: LoginThrottleService,
  ) {}

  /**
   * A merchant asks for rates. At most 5 per address in 15 minutes; a repeat of the same
   * idempotency key answers the lead it already made and is not counted again.
   */
  @Public()
  @Post('leads')
  @ApiTooManyRequestsResponse({ description: 'too_many_attempts' })
  async lead(@Body(new ZodValidationPipe(siteLeadSchema)) body: SiteLeadBody, @Req() req: Request) {
    const existing = await findSiteLeadByKey(this.prisma, body.idempotencyKey);
    if (existing) return { id: existing.id };
    this.throttle.siteLead(clientAddress(req.headers['x-forwarded-for'], req.socket.remoteAddress));
    const { id } = await createSiteLead(this.prisma, body);
    return { id };
  }
}
