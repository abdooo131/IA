import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  companyProfile,
  createSignerKey,
  documentsToSign,
  etaReadiness,
  FEE_KINDS,
  getInvoice,
  listInvoices,
  prepareInvoices,
  resendInvoice,
  saveSignatures,
  signerKeyValid,
  submitCreditNote,
  updateCompanyProfile,
  updateMerchantTax,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  companyProfileSchema,
  creditNoteSchema,
  merchantTaxSchema,
  prepareInvoicesSchema,
  signaturesSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { Access, CurrentUser, Public } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { submitted } from './books.controller';
import { EtaClient, EtaSync } from './eta';

/** Tax invoices to merchants, credit notes, and our tax details for the e-invoice system. */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class InvoicesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly eta: EtaClient,
    private readonly sync: EtaSync,
  ) {}

  @Get('invoices')
  @ApiQuery({ name: 'merchantId', required: false })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'status', required: false })
  invoices(
    @Query('merchantId') merchantId?: string,
    @Query('month') month?: string,
    @Query('status') status?: string,
  ): Promise<unknown> {
    return listInvoices(this.prisma, {
      merchantId: merchantId || undefined,
      month: month || undefined,
      status: status || undefined,
    });
  }

  @Get('invoices/:id')
  async invoice(@Param('id') id: string): Promise<unknown> {
    const { company, ...invoice } = await getInvoice(this.prisma, id);
    const { signerKeyHash: _hidden, ...publicCompany } = company;
    return { ...invoice, company: publicCompany };
  }

  /** Issues last month's (or the given month's) invoice for every merchant charged fees. */
  @Post('invoices/prepare')
  prepare(
    @Body(new ZodValidationPipe(prepareInvoicesSchema)) body: z.infer<typeof prepareInvoicesSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return prepareInvoices(this.prisma, {
      month: body.month,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
  }

  /** A credit note waits for a second person: it lowers what the merchant owes us. */
  @Post('invoices/:id/credit-notes')
  async creditNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(creditNoteSchema)) body: z.infer<typeof creditNoteSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(
      await submitCreditNote(this.prisma, { ...body, invoiceId: id, actorUserId: user.sub }),
    );
  }

  @Post('invoices/:id/resend')
  resend(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return resendInvoice(this.prisma, { id, actorUserId: user.sub });
  }

  /** Sends signed documents and checks submitted ones now, instead of waiting a minute. */
  @Post('eta/sync')
  async syncNow() {
    if (!this.eta.enabled) return { configured: false };
    return { configured: true, ...(await this.sync.run()) };
  }

  @Get('eta/readiness')
  async readiness() {
    const counts = await this.prisma.taxInvoice.groupBy({
      by: ['etaStatus'],
      _count: { _all: true },
    });
    return {
      ...(await etaReadiness(this.prisma)),
      connected: this.eta.enabled,
      feeKinds: FEE_KINDS,
      counts: Object.fromEntries(counts.map((c) => [c.etaStatus, c._count._all])),
    };
  }

  @Get('company-profile')
  async profile(): Promise<unknown> {
    const { signerKeyHash, ...rest } = await companyProfile(this.prisma);
    return { ...rest, hasSignerKey: Boolean(signerKeyHash) };
  }

  @Put('company-profile')
  @Access('accounting', 'manage')
  async setProfile(
    @Body(new ZodValidationPipe(companyProfileSchema)) body: z.infer<typeof companyProfileSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ): Promise<unknown> {
    const { signerKeyHash, ...rest } = await updateCompanyProfile(this.prisma, {
      ...body,
      actorUserId: user.sub,
    });
    return { ...rest, hasSignerKey: Boolean(signerKeyHash) };
  }

  /** A new key for the signing program, shown once. Admin only. */
  /** The signing program's key: owners only (accounting and settings manage). */
  @Post('company-profile/signer-key')
  @Access('accounting', 'manage', { also: [['settings', 'manage']] })
  signerKey(@CurrentUser() user: AccessTokenClaims) {
    return createSignerKey(this.prisma, { actorUserId: user.sub });
  }

  @Put('merchants/:id/tax')
  async merchantTax(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(merchantTaxSchema)) body: z.infer<typeof merchantTaxSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const m = await updateMerchantTax(this.prisma, {
      ...body,
      merchantId: id,
      actorUserId: user.sub,
    });
    return {
      id: m.id,
      legalName: m.legalName,
      taxRegistrationNumber: m.taxRegistrationNumber,
      taxGovernorate: m.taxGovernorate,
      taxRegionCity: m.taxRegionCity,
      taxStreet: m.taxStreet,
      taxBuildingNumber: m.taxBuildingNumber,
    };
  }

  @Get('merchants-tax')
  merchantsTax() {
    return this.prisma.merchant.findMany({
      where: { approval: 'approved' },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        legalName: true,
        taxRegistrationNumber: true,
        taxGovernorate: true,
        taxRegionCity: true,
        taxStreet: true,
        taxBuildingNumber: true,
        bankName: true,
        bankAccountNumber: true,
        iban: true,
        beneficiaryName: true,
      },
    });
  }
}

/**
 * The signing program on the finance PC (where the company's USB token is) asks for the
 * documents to sign and sends the signatures back. It signs in with its own key, not a
 * person's password.
 */
@ApiTags('finance')
@ApiHeader({ name: 'x-signer-key', required: true })
@Public()
@Controller('eta-signer')
export class EtaSignerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: EtaSync,
  ) {}

  private async check(key: string | undefined) {
    if (!(await signerKeyValid(this.prisma, key)))
      throw new UnauthorizedException({ error: 'signer_key_invalid' });
  }

  @Get('documents')
  async documents(@Headers('x-signer-key') key?: string) {
    await this.check(key);
    return documentsToSign(this.prisma);
  }

  @Post('signatures')
  async signatures(
    @Body(new ZodValidationPipe(signaturesSchema)) body: z.infer<typeof signaturesSchema>,
    @Headers('x-signer-key') key?: string,
  ) {
    await this.check(key);
    const saved = await saveSignatures(this.prisma, body);
    // Send them on at once rather than at the next minute.
    void this.sync.run();
    return saved;
  }
}
