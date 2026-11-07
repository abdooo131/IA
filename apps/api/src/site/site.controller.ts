import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { createSiteLead, findSiteLeadByKey, listSiteLeads, updateSiteLead } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  SITE_LEAD_STATUSES,
  type SiteLeadBody,
  siteLeadSchema,
  type SiteLeadStatus,
  type SiteLeadUpdateBody,
  siteLeadUpdateSchema,
} from '@shiplynow/shared';
import type { Request } from 'express';
import { clientAddress, LoginThrottleService } from '../auth/login-throttle.service';
import { Access, CurrentUser, Public } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** The public website's contact form. */
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

/** Admin follows the leads up (Merchants app, /admin/leads). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/site-leads')
export class AdminSiteLeadsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Access('merchants', 'view')
  @ApiQuery({ name: 'status', required: false, enum: SITE_LEAD_STATUSES })
  list(@Query('status') status?: string) {
    const known = (SITE_LEAD_STATUSES as readonly string[]).includes(status ?? '');
    return listSiteLeads(this.prisma, { status: known ? (status as SiteLeadStatus) : undefined });
  }

  @Patch(':id')
  @Access('merchants', 'use')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(siteLeadUpdateSchema)) body: SiteLeadUpdateBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateSiteLead(this.prisma, { ...body, id, actorUserId: user.sub });
  }
}
