import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  addHireDraftFile,
  assignNewOwner,
  confirmLeaving,
  createHireFromDraft,
  deleteHireDraftFile,
  discardHireDraft,
  documentsExpiring,
  DomainError,
  getHireDraft,
  getHireDraftFile,
  type HireActor,
  issueEmployeeSetupLink,
  latestExit,
  leavingPreview,
  listHireDrafts,
  needsNewOwner,
  ownerCandidates,
  payPendingHires,
  remindAllMissing,
  remindDocument,
  requiredDocumentTypes,
  saveHireDraft,
  startHireDraft,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  cairoDay,
  canDo,
  daySchema,
  documentRemindSchema,
  hireCreateSchema,
  type HireDraftSaveBody,
  hireDraftSaveSchema,
  type LeavingBody,
  leavingSchema,
  reassignSchema,
} from '@shiplynow/shared';
import type { Request, Response } from 'express';
import { limitedStores } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { readUpload, sendDocument } from './hr-files';

const day = (v: string | undefined) => (v && daySchema.safeParse(v).success ? v : undefined);

/**
 * HR phase 2 (docs/HR.md "Phase 2 as built"): guided flows. The new hire wizard (drafts, their
 * photo and documents, and the create step) is HR use; its pay step needs the salaries switch.
 * The leaving wizard and giving a leaver's things a new owner are HR manage. Document reminders
 * are HR use; the expiry calendar and the lists are HR view. People limited to some stores work
 * only on those stores' people.
 */
@ApiTags('hr')
@ApiBearerAuth()
@Access('hr')
@Controller('hr')
export class HrFlowsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private actor(user: AccessTokenClaims, access: AccessProfile): HireActor {
    return { userId: user.sub, access, scope: limitedStores(access) };
  }

  // ─── new hire wizard ───────────────────────────────────────────────────────

  /** Open drafts (HR can come back to them), for the HR home. */
  @Get('hire-drafts')
  @Access('hr', 'use')
  drafts(@CurrentUser() user: AccessTokenClaims, @CurrentAccess() access: AccessProfile) {
    return listHireDrafts(this.prisma, this.actor(user, access));
  }

  /** People hired without the pay step whose salary package is still missing. */
  @Get('hire-drafts/pay-pending')
  @Access('hr', 'view', { salaries: true })
  payPending(@CurrentAccess() access: AccessProfile) {
    return payPendingHires(this.prisma, limitedStores(access));
  }

  @Post('hire-drafts')
  @Access('hr', 'use')
  start(
    @Body(new ZodValidationPipe(hireDraftSaveSchema)) body: HireDraftSaveBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return startHireDraft(this.prisma, { body, actor: this.actor(user, access) });
  }

  @Get('hire-drafts/:id')
  @Access('hr', 'use')
  draft(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return getHireDraft(this.prisma, id, this.actor(user, access));
  }

  @Put('hire-drafts/:id')
  @Access('hr', 'use')
  save(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hireDraftSaveSchema)) body: HireDraftSaveBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return saveHireDraft(this.prisma, { draftId: id, body, actor: this.actor(user, access) });
  }

  @Delete('hire-drafts/:id')
  @Access('hr', 'use')
  discard(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return discardHireDraft(this.prisma, { draftId: id, actor: this.actor(user, access) });
  }

  /** The document types required of the person as placed on the job step. */
  @Get('hire-drafts/:id/required-documents')
  @Access('hr', 'use')
  async required(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const d = await getHireDraft(this.prisma, id, this.actor(user, access));
    return requiredDocumentTypes(
      this.prisma,
      {
        employment: d.data.job.employment ?? 'employee',
        departmentId: d.data.job.departmentId || null,
        positionId: d.data.job.positionId || null,
      },
      { confidential: canDo(access, 'hr', 'use') },
    );
  }

  /** Body: the document itself (photo or PDF); its type and dates in the query. */
  @Post('hire-drafts/:id/files')
  @Access('hr', 'use')
  @ApiQuery({ name: 'typeId' })
  @ApiQuery({ name: 'expiresOn', required: false })
  addFile(
    @Param('id') id: string,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const upload = readUpload(query, req);
    return addHireDraftFile(this.prisma, {
      draftId: id,
      kind: 'document',
      typeId: upload.typeId,
      title: upload.title,
      issuedOn: upload.issuedOn,
      expiresOn: upload.expiresOn,
      contentType: upload.contentType,
      data: upload.data,
      actor: this.actor(user, access),
    });
  }

  @Get('hire-drafts/:id/files/:fileId')
  @Access('hr', 'use')
  async file(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    const f = await getHireDraftFile(this.prisma, {
      draftId: id,
      fileId,
      actor: this.actor(user, access),
    });
    sendDocument(res, {
      id: f.id,
      type: { code: 'new-hire' },
      contentType: f.contentType,
      data: f.data,
      version: 1,
    });
  }

  @Delete('hire-drafts/:id/files/:fileId')
  @Access('hr', 'use')
  removeFile(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return deleteHireDraftFile(this.prisma, {
      draftId: id,
      fileId,
      actor: this.actor(user, access),
    });
  }

  /** Body: the square photo made on the phone. */
  @Put('hire-drafts/:id/photo')
  @Access('hr', 'use')
  async setPhoto(
    @Param('id') id: string,
    @Req() req: Request,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    if (!Buffer.isBuffer(req.body)) throw new DomainError('photo_type_not_allowed', 400);
    const f = await addHireDraftFile(this.prisma, {
      draftId: id,
      kind: 'photo',
      contentType: (req.headers['content-type'] ?? '').split(';')[0]!.trim(),
      data: req.body,
      actor: this.actor(user, access),
    });
    return { photoVersion: new Date(f.createdAt).getTime() };
  }

  @Get('hire-drafts/:id/photo')
  @Access('hr', 'use')
  async photo(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    const f = await getHireDraftFile(this.prisma, { draftId: id, actor: this.actor(user, access) });
    res.setHeader('content-type', f.contentType);
    res.setHeader('cache-control', 'private, no-cache');
    res.send(Buffer.from(f.data));
  }

  /**
   * Review and create: the login (or none), access, file, package, photo, documents, roster
   * and onboarding in one transaction. The setup link is in the answer once.
   */
  @Post('hire-drafts/:id/create')
  @Access('hr', 'use')
  create(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hireCreateSchema)) body: { idempotencyKey: string },
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return createHireFromDraft(this.prisma, {
      draftId: id,
      idempotencyKey: body.idempotencyKey,
      actor: this.actor(user, access),
      now: this.clock.now(),
    });
  }

  /** A new one time setup link for a hire who has not chosen a password yet. */
  @Post('employees/:id/setup-link')
  @Access('hr', 'use')
  setupLink(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return issueEmployeeSetupLink(this.prisma, {
      employeeId: id,
      actorUserId: user.sub,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  // ─── leaving wizard ────────────────────────────────────────────────────────

  /** What the wizard shows for a last day (the settlement's money with the salaries switch). */
  @Get('employees/:id/leaving')
  @Access('hr', 'manage')
  @ApiQuery({ name: 'lastDay', required: false })
  @ApiQuery({ name: 'noticeGivenOn', required: false })
  preview(
    @Param('id') id: string,
    @Query() q: Record<string, string>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const today = cairoDay(this.clock.now());
    return leavingPreview(this.prisma, {
      employeeId: id,
      lastDay: day(q.lastDay) ?? today,
      noticeGivenOn: day(q.noticeGivenOn),
      scope: limitedStores(access),
      pay: access.salaries,
      actorUserId: user.sub,
    });
  }

  @Post('employees/:id/leaving')
  @Access('hr', 'manage')
  leave(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(leavingSchema)) body: LeavingBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return confirmLeaving(this.prisma, {
      employeeId: id,
      body,
      actorUserId: user.sub,
      scope: limitedStores(access),
      pay: access.salaries,
      now: this.clock.now(),
    });
  }

  /** The person's latest exit (when the account closes, the settlement figures). */
  @Get('employees/:id/exit')
  async exit(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const scope = limitedStores(access);
    const e = await this.prisma.employee.findUnique({
      where: { id },
      select: { homeStoreId: true },
    });
    if (!e) throw new DomainError('employee_not_found', 404);
    if (scope && !(e.homeStoreId && scope.includes(e.homeStoreId)))
      throw new DomainError('store_not_allowed', 403);
    return latestExit(this.prisma, id, access.salaries);
  }

  /** What leavers looked after that still needs a new owner, with who could take it. */
  @Get('reassignments')
  async reassignments(@CurrentAccess() access: AccessProfile) {
    const [rows, candidates] = await Promise.all([
      needsNewOwner(this.prisma, limitedStores(access)),
      ownerCandidates(this.prisma, ''),
    ]);
    return { rows, candidates };
  }

  @Put('reassignments/:id')
  @Access('hr', 'manage')
  reassign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reassignSchema)) body: { newOwnerId: string },
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return assignNewOwner(this.prisma, {
      reassignmentId: id,
      newOwnerId: body.newOwnerId,
      actorUserId: user.sub,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  // ─── documents ─────────────────────────────────────────────────────────────

  /** Asks the person for one missing or expiring document (push and My HR; once a day). */
  @Post('employees/:id/documents/remind')
  @Access('hr', 'use')
  remind(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(documentRemindSchema)) body: { typeId: string },
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return remindDocument(this.prisma, {
      employeeId: id,
      typeId: body.typeId,
      actorUserId: user.sub,
      scope: limitedStores(access),
      confidential: true,
      now: this.clock.now(),
    });
  }

  @Post('employees/:id/documents/remind-all')
  @Access('hr', 'use')
  remindAll(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return remindAllMissing(this.prisma, {
      employeeId: id,
      actorUserId: user.sub,
      scope: limitedStores(access),
      confidential: true,
      now: this.clock.now(),
    });
  }

  /** The expiry calendar: documents running out in a month (YYYY-MM, default this month). */
  @Get('documents/expiring')
  @ApiQuery({ name: 'month', required: false })
  expiring(@Query('month') month: string | undefined, @CurrentAccess() access: AccessProfile) {
    const today = cairoDay(this.clock.now());
    return documentsExpiring(this.prisma, {
      month: month || today.slice(0, 7),
      scope: limitedStores(access),
      confidential: canDo(access, 'hr', 'use'),
      now: this.clock.now(),
    });
  }
}
