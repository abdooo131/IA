import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  emailPreview,
  listEmails,
  merchantEmailSettings,
  retryEmail,
  updateMerchantEmailSettings,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type MerchantEmailSettings,
  merchantEmailSettingsSchema,
} from '@shiplynow/shared';
import { Access, CurrentUser, MerchantRight, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

const STATUSES = ['pending', 'sent', 'failed'] as const;

/** The email outbox for finance and admin: what was sent, what failed, send again. */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance/emails')
export class EmailsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiQuery({ name: 'merchantId', required: false })
  async list(@Query('status') status?: string, @Query('merchantId') merchantId?: string) {
    const page = await listEmails(this.prisma, {
      status: STATUSES.find((s) => s === status),
      merchantId: merchantId || undefined,
    });
    return { configured: this.email.configured, ...page };
  }

  /** The email as the merchant sees it (shown in a sandboxed frame). */
  @Get(':id/preview')
  preview(@Param('id') id: string) {
    return emailPreview(this.prisma, id, this.email.baseUrl);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return retryEmail(this.prisma, { emailId: id, actorUserId: user.sub });
  }
}

/** Finance keeps a merchant's billing emails and choices too. */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance/merchants/:merchantId/email-settings')
export class MerchantEmailSettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  get(@Param('merchantId') merchantId: string) {
    return merchantEmailSettings(this.prisma, merchantId);
  }

  @Put()
  update(
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(merchantEmailSettingsSchema)) body: MerchantEmailSettings,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateMerchantEmailSettings(this.prisma, {
      merchantId,
      ...body,
      actorUserId: user.sub,
    });
  }
}

/** A merchant chooses where statements, invoices and payout notices go, and which they get. */
@ApiTags('merchant')
@ApiBearerAuth()
@Roles('merchant')
@MerchantRight('money')
@Controller('merchant/email-settings')
export class OwnEmailSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  private async merchantId(user: AccessTokenClaims) {
    const me = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!me?.merchantId) throw new ForbiddenException({ error: 'no_merchant' });
    return me.merchantId;
  }

  @Get()
  async get(@CurrentUser() user: AccessTokenClaims) {
    return {
      configured: this.email.configured,
      ...(await merchantEmailSettings(this.prisma, await this.merchantId(user))),
    };
  }

  @Put()
  @MerchantRight('settings')
  async update(
    @Body(new ZodValidationPipe(merchantEmailSettingsSchema)) body: MerchantEmailSettings,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateMerchantEmailSettings(this.prisma, {
      merchantId: await this.merchantId(user),
      ...body,
      actorUserId: user.sub,
    });
  }
}
