import { Body, Controller, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  adjustLeaveBalance,
  attachLeaveDocument,
  attachViolationEvidence,
  balancesReport,
  cancelLeave,
  confirmSuggestion,
  createLeaveType,
  createViolationType,
  decideViolation,
  dismissSuggestion,
  DomainError,
  hrDecideCorrection,
  hrDecideLeave,
  leaveBalances,
  leaveCalendar,
  leaveDocument,
  leaveRequestDetail,
  listAdjustments,
  managerDecideLeave,
  listCorrections,
  listLeaveRequests,
  listLeaveTypes,
  listViolationSuggestions,
  listViolations,
  listViolationTypes,
  nextViolationStep,
  recordViolation,
  requestLeave,
  updateLeaveType,
  updateViolationType,
  violationDetail,
  violationEvidence,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  applyCorrectionSchema,
  bulkIdsSchema,
  bulkRejectLeaveSchema,
  cairoDay,
  cancelSchema,
  confirmSuggestionSchema,
  type HrLeaveRequestBody,
  hrLeaveRequestSchema,
  isCalendarDay,
  type LeaveAdjustmentBody,
  leaveAdjustmentSchema,
  type LeaveTypeBody,
  leaveTypeSchema,
  type RecordViolationBody,
  recordViolationSchema,
  rejectSchema,
  type ViolationDecisionBody,
  violationDecisionSchema,
  type ViolationTypeBody,
  violationTypeSchema,
} from '@shiplynow/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { limitedStores } from '../auth/access-scope';
import { eachRecord } from '../common/bulk';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Sends a stored leave note or violation evidence inline (photos and PDFs). */
export function sendStored(
  res: Response,
  file: { contentType: string; data: Uint8Array; name: string | null },
  fallback: string,
) {
  const ext = file.contentType === 'application/pdf' ? 'pdf' : file.contentType.split('/')[1];
  res.setHeader('content-type', file.contentType);
  res.setHeader('content-disposition', `inline; filename="${fallback}.${ext}"`);
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.send(Buffer.from(file.data));
}

/** The raw body of a document upload with its type and an optional name. */
export function rawUpload(req: Request, name?: string) {
  if (!Buffer.isBuffer(req.body)) throw new DomainError('document_type_not_allowed', 400);
  return {
    contentType: (req.headers['content-type'] ?? '').split(';')[0]!.trim(),
    data: req.body,
    name: name ? String(name).slice(0, 200) : null,
  };
}

const applySchema = applyCorrectionSchema;

/**
 * HR phase 3 for HR (docs/HR.md "Phase 3 as built", docs/ACCESS.md): leave types, requests,
 * the calendar and balances; violation types, violations and suggestions; attendance
 * correction requests at the HR step. View reads, use records and approves as HR, manage edits
 * the types and decides appeals. People limited to some stores see and act on those stores'
 * people only.
 */
@ApiTags('hr')
@ApiBearerAuth()
@Access('hr')
@Controller('hr')
export class HrLeaveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  // ─── leave types ──────────────────────────────────────────────────────────────

  @Get('leave/types')
  leaveTypes() {
    return listLeaveTypes(this.prisma);
  }

  @Post('leave/types')
  @Access('hr', 'manage')
  createLeaveType(
    @Body(new ZodValidationPipe(leaveTypeSchema)) body: LeaveTypeBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createLeaveType(this.prisma, { body, actorUserId: user.sub });
  }

  @Put('leave/types/:id')
  @Access('hr', 'manage')
  updateLeaveType(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(leaveTypeSchema)) body: LeaveTypeBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateLeaveType(this.prisma, { typeId: id, body, actorUserId: user.sub });
  }

  // ─── leave requests ───────────────────────────────────────────────────────────

  @Get('leave/requests')
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'typeId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  requests(@CurrentAccess() access: AccessProfile, @Query() q: Record<string, string>) {
    return listLeaveRequests(this.prisma, {
      scope: limitedStores(access),
      status: q.status || undefined,
      employeeId: q.employeeId || undefined,
      typeId: q.typeId || undefined,
      from: q.from && isCalendarDay(q.from) ? q.from : undefined,
      to: q.to && isCalendarDay(q.to) ? q.to : undefined,
      storeId: q.darkStoreId || undefined,
      departmentId: q.departmentId || undefined,
    });
  }

  @Get('leave/requests/:id')
  request(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    return leaveRequestDetail(this.prisma, { requestId: id, scope: limitedStores(access) });
  }

  @Get('leave/requests/:id/document')
  async document(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    await leaveRequestDetail(this.prisma, { requestId: id, scope: limitedStores(access) });
    const doc = await leaveDocument(this.prisma, id);
    sendStored(
      res,
      { contentType: doc.documentContentType!, data: doc.documentData!, name: doc.documentName },
      'leave-note',
    );
  }

  @Put('leave/requests/:id/document')
  @Access('hr', 'use')
  attach(
    @Param('id') id: string,
    @Query('name') name: string | undefined,
    @Req() req: Request,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return attachLeaveDocument(this.prisma, {
      requestId: id,
      actorUserId: user.sub,
      asHr: true,
      scope: limitedStores(access),
      ...rawUpload(req, name),
    });
  }

  /** HR asks for leave on someone's behalf (may go past the balance or further back). */
  @Post('leave/requests')
  @Access('hr', 'use')
  createRequest(
    @Body(new ZodValidationPipe(hrLeaveRequestSchema)) body: HrLeaveRequestBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return requestLeave(this.prisma, {
      employeeId: body.employeeId,
      body,
      actorUserId: user.sub,
      onBehalf: true,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  // ─── UX phase C step 4: bulk decisions of the lists, each under the single rules ───

  /**
   * Approves several requests at the step each waits for: the manager step only by the
   * person's manager in force, the HR step by HR use; nobody decides their own.
   */
  @Post('leave/requests/bulk-approve')
  @Access('hr', 'use')
  bulkApprove(
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return this.bulkDecide(body.ids, true, undefined, user.sub, access);
  }

  /** Refuses several waiting requests with one reason (HR may refuse at either step). */
  @Post('leave/requests/bulk-reject')
  @Access('hr', 'use')
  bulkReject(
    @Body(new ZodValidationPipe(bulkRejectLeaveSchema)) body: z.infer<typeof bulkRejectLeaveSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return this.bulkDecide(body.ids, false, body.note, user.sub, access);
  }

  private bulkDecide(
    ids: string[],
    approve: boolean,
    reason: string | undefined,
    actorUserId: string,
    access: AccessProfile,
  ) {
    const scope = limitedStores(access);
    const now = this.clock.now();
    return eachRecord(ids, async (id) => {
      // Inside the person's stores (a 403 otherwise), then the step it waits for.
      const r = await leaveRequestDetail(this.prisma, { requestId: id, scope });
      // HR may refuse at either step; approving the manager step is the manager's.
      if (approve && r.status === 'pending_manager')
        return managerDecideLeave(this.prisma, {
          requestId: id,
          actorUserId,
          approve,
          reason,
          now,
        });
      return hrDecideLeave(this.prisma, {
        requestId: id,
        actorUserId,
        approve,
        reason,
        scope,
        now,
      });
    });
  }

  @Post('leave/requests/:id/approve')
  @Access('hr', 'use')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return hrDecideLeave(this.prisma, {
      requestId: id,
      actorUserId: user.sub,
      approve: true,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  @Post('leave/requests/:id/reject')
  @Access('hr', 'use')
  reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: { reason: string },
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return hrDecideLeave(this.prisma, {
      requestId: id,
      actorUserId: user.sub,
      approve: false,
      reason: body.reason,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  @Post('leave/requests/:id/cancel')
  @Access('hr', 'use')
  cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelSchema)) body: { reason?: string },
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return cancelLeave(this.prisma, {
      requestId: id,
      actorUserId: user.sub,
      asHr: true,
      reason: body.reason,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  /** Who is off when in a month (Cairo days), by department and store. */
  @Get('leave/calendar')
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  calendar(@CurrentAccess() access: AccessProfile, @Query() q: Record<string, string>) {
    return leaveCalendar(this.prisma, {
      month: q.month && MONTH.test(q.month) ? q.month : cairoDay(this.clock.now()).slice(0, 7),
      scope: limitedStores(access),
      storeId: q.darkStoreId || undefined,
      departmentId: q.departmentId || undefined,
    });
  }

  @Get('leave/balances')
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  balances(@CurrentAccess() access: AccessProfile, @Query() q: Record<string, string>) {
    return balancesReport(this.prisma, {
      scope: limitedStores(access),
      year: q.year && /^\d{4}$/.test(q.year) ? Number(q.year) : undefined,
      storeId: q.darkStoreId || undefined,
      departmentId: q.departmentId || undefined,
    });
  }

  /** One person's balances for a leave year, HR's adjustments and their requests. */
  @Get('employees/:id/leave')
  @ApiQuery({ name: 'year', required: false })
  async employeeLeave(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @Query('year') year?: string,
  ) {
    const e = await this.prisma.employee.findUnique({ where: { id } });
    if (!e) throw new DomainError('employee_not_found', 404);
    const scope = limitedStores(access);
    if (scope && (!e.homeStoreId || !scope.includes(e.homeStoreId)))
      throw new DomainError('store_not_allowed', 403);
    const balances = await leaveBalances(this.prisma, {
      employeeId: id,
      year: year && /^\d{4}$/.test(year) ? Number(year) : undefined,
      asOf: cairoDay(this.clock.now()),
    });
    return {
      balances,
      adjustments: await listAdjustments(this.prisma, id, balances.year),
      requests: await listLeaveRequests(this.prisma, { scope: null, employeeId: id }),
    };
  }

  @Post('leave/adjustments')
  @Access('hr', 'use')
  adjust(
    @Body(new ZodValidationPipe(leaveAdjustmentSchema)) body: LeaveAdjustmentBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return adjustLeaveBalance(this.prisma, {
      body,
      actorUserId: user.sub,
      scope: limitedStores(access),
    });
  }

  // ─── violation types ──────────────────────────────────────────────────────────

  @Get('violations/types')
  violationTypes() {
    return listViolationTypes(this.prisma);
  }

  @Post('violations/types')
  @Access('hr', 'manage')
  createViolationType(
    @Body(new ZodValidationPipe(violationTypeSchema)) body: ViolationTypeBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createViolationType(this.prisma, { body, actorUserId: user.sub });
  }

  @Put('violations/types/:id')
  @Access('hr', 'manage')
  updateViolationType(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(violationTypeSchema)) body: ViolationTypeBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateViolationType(this.prisma, { typeId: id, body, actorUserId: user.sub });
  }

  // ─── violations ───────────────────────────────────────────────────────────────

  @Get('violations')
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'typeId', required: false })
  @ApiQuery({ name: 'employment', required: false, enum: ['employee', 'outsourced'] })
  @ApiQuery({ name: 'forSupplier', required: false })
  violations(@CurrentAccess() access: AccessProfile, @Query() q: Record<string, string>) {
    return listViolations(
      this.prisma,
      {
        scope: limitedStores(access),
        status: q.status || undefined,
        employeeId: q.employeeId || undefined,
        typeId: q.typeId || undefined,
        employment:
          q.employment === 'employee' || q.employment === 'outsourced' ? q.employment : undefined,
        forSupplier: q.forSupplier === '1',
      },
      this.clock.now(),
    );
  }

  /** The step the ladder would give a new violation, for the record form. */
  @Get('violations/next-step')
  @ApiQuery({ name: 'employeeId' })
  @ApiQuery({ name: 'typeId' })
  @ApiQuery({ name: 'occurredOn' })
  nextStep(@Query() q: Record<string, string>) {
    if (!q.employeeId || !q.typeId || !q.occurredOn || !isCalendarDay(q.occurredOn))
      throw new DomainError('validation_failed', 400);
    return nextViolationStep(this.prisma, {
      employeeId: q.employeeId,
      typeId: q.typeId,
      occurredOn: q.occurredOn,
    });
  }

  @Get('violations/suggestions')
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'confirmed', 'dismissed'] })
  suggestions(@CurrentAccess() access: AccessProfile, @Query('status') status?: string) {
    return listViolationSuggestions(this.prisma, {
      scope: limitedStores(access),
      status: status && ['open', 'confirmed', 'dismissed'].includes(status) ? status : 'open',
    });
  }

  /** Confirms several suggestions onto each person's ladder with the suggested type. */
  @Post('violations/suggestions/bulk-confirm')
  @Access('hr', 'use')
  bulkConfirm(
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const scope = limitedStores(access);
    return eachRecord(body.ids, async (id) => {
      const s = await this.prisma.violationSuggestion.findUnique({
        where: { id },
        select: { employee: { select: { homeStoreId: true } } },
      });
      if (!s) throw new DomainError('suggestion_not_found', 404);
      if (scope && !(s.employee.homeStoreId && scope.includes(s.employee.homeStoreId)))
        throw new DomainError('store_not_allowed', 403);
      return confirmSuggestion(this.prisma, {
        suggestionId: id,
        actorUserId: user.sub,
        scope,
        // One violation per suggestion: confirming it again finds the same one.
        idempotencyKey: `suggestion:${id}`,
        now: this.clock.now(),
      });
    });
  }

  /** Dismisses several suggestions (audited on each person). */
  @Post('violations/suggestions/bulk-dismiss')
  @Access('hr', 'use')
  bulkDismiss(
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const scope = limitedStores(access);
    return eachRecord(body.ids, (id) =>
      dismissSuggestion(this.prisma, {
        suggestionId: id,
        actorUserId: user.sub,
        scope,
        now: this.clock.now(),
      }),
    );
  }

  @Post('violations/suggestions/:id/confirm')
  @Access('hr', 'use')
  confirm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmSuggestionSchema))
    body: z.infer<typeof confirmSuggestionSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return confirmSuggestion(this.prisma, {
      suggestionId: id,
      actorUserId: user.sub,
      scope: limitedStores(access),
      typeId: body.typeId,
      description: body.description,
      idempotencyKey: body.idempotencyKey,
      now: this.clock.now(),
    });
  }

  @Post('violations/suggestions/:id/dismiss')
  @Access('hr', 'use')
  dismiss(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return dismissSuggestion(this.prisma, {
      suggestionId: id,
      actorUserId: user.sub,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  @Get('violations/:id')
  violation(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    return violationDetail(this.prisma, {
      violationId: id,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  @Get('violations/:id/evidence')
  async evidence(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    await violationDetail(this.prisma, { violationId: id, scope: limitedStores(access) });
    const file = await violationEvidence(this.prisma, id);
    sendStored(
      res,
      { contentType: file.evidenceContentType!, data: file.evidenceData!, name: file.evidenceName },
      'evidence',
    );
  }

  @Put('violations/:id/evidence')
  @Access('hr', 'use')
  attachEvidence(
    @Param('id') id: string,
    @Query('name') name: string | undefined,
    @Req() req: Request,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return attachViolationEvidence(this.prisma, {
      violationId: id,
      actorUserId: user.sub,
      scope: limitedStores(access),
      ...rawUpload(req, name),
    });
  }

  @Post('violations')
  @Access('hr', 'use')
  record(
    @Body(new ZodValidationPipe(recordViolationSchema)) body: RecordViolationBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return recordViolation(this.prisma, {
      body,
      actorUserId: user.sub,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  /** HR manage upholds or cancels (never the person who recorded it). */
  @Post('violations/:id/decide')
  @Access('hr', 'manage')
  decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(violationDecisionSchema)) body: ViolationDecisionBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return decideViolation(this.prisma, {
      violationId: id,
      actorUserId: user.sub,
      decision: body.decision,
      note: body.note,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  // ─── attendance correction requests at the HR step ─────────────────────────────

  @Get('corrections')
  @ApiQuery({ name: 'status', required: false })
  corrections(@CurrentAccess() access: AccessProfile, @Query('status') status?: string) {
    return listCorrections(this.prisma, { scope: limitedStores(access), status });
  }

  @Post('corrections/:id/apply')
  @Access('hr', 'use')
  apply(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(applySchema)) body: z.infer<typeof applySchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return hrDecideCorrection(this.prisma, {
      correctionId: id,
      actorUserId: user.sub,
      approve: true,
      proposedIn: body.proposedIn,
      proposedOut: body.proposedOut,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  @Post('corrections/:id/reject')
  @Access('hr', 'use')
  rejectCorrection(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: { reason: string },
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return hrDecideCorrection(this.prisma, {
      correctionId: id,
      actorUserId: user.sub,
      approve: false,
      reason: body.reason,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }
}
