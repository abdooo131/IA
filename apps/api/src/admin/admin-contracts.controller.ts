import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  activateContractVersion,
  addContractFile,
  contractForPrint,
  createContractDraft,
  deleteContractDraft,
  deleteContractFile,
  DomainError,
  getContract,
  getContractFile,
  merchantOverview,
  updateContractDraft,
  updateMerchantBank,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type ContractActivateBody,
  contractActivateSchema,
  contractDraftSchema,
  contractFileNameSchema,
  contractVersionSchema,
  type ContractVersionBody,
  merchantBankSchema,
} from '@shiplynow/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { renderContractPdf } from '../contracts/contract-pdf';
import { sendContractFile, sendContractPdf } from '../contracts/contract-files';
import { PrismaService } from '../prisma/prisma.service';

/**
 * One merchant's page and contract (merchant contracts v2). Merchants view and Accounting view
 * read the contract, its versions, files and printed copies; only merchants manage writes
 * drafts, activates them, attaches signed files and edits the payout bank account from it.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/merchants')
export class AdminContractsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** The Overview, Products and Users tabs of the merchant's page. */
  @Get(':id/overview')
  @Access('merchants', 'view', { merchantParam: 'id' })
  overview(@Param('id') id: string) {
    return merchantOverview(this.prisma, id, this.clock.now());
  }

  @Get(':id/contract')
  @Access(['merchants', 'accounting'], 'view', { merchantParam: 'id' })
  contract(@Param('id') id: string) {
    return getContract(this.prisma, id, this.clock.now());
  }

  /** A new draft version (Edit): the screen sends the current terms changed. */
  @Post(':id/contract/versions')
  @Access('merchants', 'manage', { merchantParam: 'id' })
  async draft(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(contractDraftSchema)) body: z.infer<typeof contractDraftSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const { idempotencyKey, ...terms } = body;
    const created = await createContractDraft(this.prisma, {
      merchantId: id,
      body: terms,
      idempotencyKey,
      actorUserId: user.sub,
    });
    return { id: created.id, version: created.version };
  }

  @Put(':id/contract/versions/:versionId')
  @Access('merchants', 'manage', { merchantParam: 'id' })
  async update(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(contractVersionSchema)) body: ContractVersionBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const v = await updateContractDraft(this.prisma, {
      merchantId: id,
      versionId,
      body,
      actorUserId: user.sub,
    });
    return { id: v.id, version: v.version };
  }

  @Delete(':id/contract/versions/:versionId')
  @Access('merchants', 'manage', { merchantParam: 'id' })
  remove(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return deleteContractDraft(this.prisma, { merchantId: id, versionId, actorUserId: user.sub });
  }

  /** Activates a draft from a Cairo day (today or later); audited with before and after. */
  @Post(':id/contract/versions/:versionId/activate')
  @Access('merchants', 'manage', { merchantParam: 'id' })
  async activate(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(contractActivateSchema)) body: ContractActivateBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await activateContractVersion(this.prisma, {
      merchantId: id,
      versionId,
      effectiveFrom: body.effectiveFrom,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
    return getContract(this.prisma, id, this.clock.now());
  }

  /** The printed contract: the version asked (or the one in force), in English or Arabic. */
  @Get(':id/contract/pdf')
  @Access(['merchants', 'accounting'], 'view', { merchantParam: 'id' })
  @ApiQuery({ name: 'lang', required: false, enum: ['en', 'ar'] })
  @ApiQuery({ name: 'version', required: false })
  async pdf(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('lang') lang?: string,
    @Query('version') versionId?: string,
  ) {
    const print = await contractForPrint(this.prisma, {
      merchantId: id,
      versionId: versionId || null,
      now: this.clock.now(),
    });
    const language = lang === 'ar' ? 'ar' : 'en';
    sendContractPdf(res, await renderContractPdf(print, language), print.version.label, language);
  }

  /** Body: the signed file itself (PDF, JPG or PNG, at most 5 MB); its name in the query. */
  @Post(':id/contract/files')
  @Access('merchants', 'manage', { merchantParam: 'id' })
  @ApiQuery({ name: 'name' })
  @ApiQuery({ name: 'versionId', required: false })
  async upload(
    @Param('id') id: string,
    @Query('name') name: string | undefined,
    @Query('versionId') versionId: string | undefined,
    @Req() req: Request,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const fileName = contractFileNameSchema.safeParse(name ?? '');
    if (!fileName.success) throw new DomainError('validation_failed', 400);
    if (!Buffer.isBuffer(req.body)) throw new DomainError('file_type_not_allowed', 400);
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    return addContractFile(this.prisma, {
      merchantId: id,
      versionId: versionId || null,
      fileName: fileName.data,
      contentType,
      data: req.body,
      actorUserId: user.sub,
    });
  }

  @Get(':id/contract/files/:fileId')
  @Access(['merchants', 'accounting'], 'view', { merchantParam: 'id' })
  async file(@Param('id') id: string, @Param('fileId') fileId: string, @Res() res: Response) {
    sendContractFile(res, await getContractFile(this.prisma, id, fileId));
  }

  @Delete(':id/contract/files/:fileId')
  @Access('merchants', 'manage', { merchantParam: 'id' })
  removeFile(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return deleteContractFile(this.prisma, { merchantId: id, fileId, actorUserId: user.sub });
  }

  /** The payout bank account, shown and edited from the contract's payment terms. */
  @Put(':id/bank')
  @Access('merchants', 'manage', { merchantParam: 'id' })
  async bank(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(merchantBankSchema)) body: z.infer<typeof merchantBankSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const m = await updateMerchantBank(this.prisma, {
      ...body,
      merchantId: id,
      actorUserId: user.sub,
    });
    return {
      bankName: m.bankName,
      bankAccountNumber: m.bankAccountNumber,
      iban: m.iban,
      beneficiaryName: m.beneficiaryName,
    };
  }
}
