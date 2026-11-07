import { Body, Controller, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  attachLeaveDocument,
  cancelCorrection,
  cancelLeave,
  getAccessProfile,
  hrBadges,
  hrInbox,
  leaveCalendar,
  leaveDocument,
  leaveRequestDetail,
  listCorrections,
  managerDecideCorrection,
  managerDecideLeave,
  myLeave,
  myViolations,
  appealViolation,
  ownFileId,
  requestCorrection,
  requestLeave,
  teamEmployeeIds,
  violationDetail,
  violationEvidence,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  appealSchema,
  cairoDay,
  type CorrectionRequestBody,
  correctionRequestSchema,
  isTeamRole,
  type LeaveRequestBody,
  leaveRequestSchema,
  rejectSchema,
} from '@shiplynow/shared';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { rawUpload, sendStored } from './hr-leave.controller';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * HR phase 3, self service and the manager inbox: every team member and rider asks for leave,
 * reads their balances, appeals a violation and asks to fix an attendance day; managers (anyone
 * with people below them) approve their direct reports' requests at the first step and see
 * their team's calendar. Open to any signed in user (listed in test/route-access.test.ts); every
 * call touches only the person's own rows or their team's (checked inside); merchants have no
 * file (404).
 */
@ApiTags('hr')
@ApiBearerAuth()
@Controller('me')
export class MyLeaveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private async access(user: AccessTokenClaims) {
    return isTeamRole(user.role) ? getAccessProfile(this.prisma, user.sub) : null;
  }

  // ─── leave ────────────────────────────────────────────────────────────────────

  @Get('leave')
  leave(@CurrentUser() user: AccessTokenClaims) {
    return myLeave(this.prisma, { userId: user.sub, now: this.clock.now() });
  }

  @Post('leave/requests')
  async ask(
    @Body(new ZodValidationPipe(leaveRequestSchema)) body: LeaveRequestBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return requestLeave(this.prisma, {
      employeeId: await ownFileId(this.prisma, user.sub),
      body,
      actorUserId: user.sub,
      onBehalf: false,
      now: this.clock.now(),
    });
  }

  @Get('leave/requests/:id')
  request(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return leaveRequestDetail(this.prisma, {
      requestId: id,
      scope: 'self',
      viewerUserId: user.sub,
    });
  }

  @Post('leave/requests/:id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return cancelLeave(this.prisma, {
      requestId: id,
      actorUserId: user.sub,
      asHr: false,
      now: this.clock.now(),
    });
  }

  @Put('leave/requests/:id/document')
  attach(
    @Param('id') id: string,
    @Query('name') name: string | undefined,
    @Req() req: Request,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return attachLeaveDocument(this.prisma, {
      requestId: id,
      actorUserId: user.sub,
      asHr: false,
      ...rawUpload(req, name),
    });
  }

  @Get('leave/requests/:id/document')
  async document(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @Res() res: Response,
  ) {
    await leaveRequestDetail(this.prisma, { requestId: id, scope: 'self', viewerUserId: user.sub });
    const doc = await leaveDocument(this.prisma, id);
    sendStored(
      res,
      { contentType: doc.documentContentType!, data: doc.documentData!, name: doc.documentName },
      'leave-note',
    );
  }

  // ─── violations ───────────────────────────────────────────────────────────────

  @Get('violations')
  violations(@CurrentUser() user: AccessTokenClaims) {
    return myViolations(this.prisma, { userId: user.sub, now: this.clock.now() });
  }

  @Get('violations/:id')
  violation(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return violationDetail(this.prisma, {
      violationId: id,
      scope: 'self',
      viewerUserId: user.sub,
      now: this.clock.now(),
    });
  }

  @Get('violations/:id/evidence')
  async evidence(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @Res() res: Response,
  ) {
    await violationDetail(this.prisma, { violationId: id, scope: 'self', viewerUserId: user.sub });
    const file = await violationEvidence(this.prisma, id);
    sendStored(
      res,
      { contentType: file.evidenceContentType!, data: file.evidenceData!, name: file.evidenceName },
      'evidence',
    );
  }

  @Post('violations/:id/appeal')
  appeal(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(appealSchema)) body: { reason: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return appealViolation(this.prisma, {
      violationId: id,
      actorUserId: user.sub,
      reason: body.reason,
      now: this.clock.now(),
    });
  }

  // ─── attendance corrections ───────────────────────────────────────────────────

  @Get('corrections')
  async corrections(@CurrentUser() user: AccessTokenClaims) {
    return listCorrections(this.prisma, {
      scope: null,
      employeeId: await ownFileId(this.prisma, user.sub),
    });
  }

  @Post('corrections')
  askCorrection(
    @Body(new ZodValidationPipe(correctionRequestSchema)) body: CorrectionRequestBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return requestCorrection(this.prisma, { userId: user.sub, body, now: this.clock.now() });
  }

  @Post('corrections/:id/cancel')
  cancelCorrection(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return cancelCorrection(this.prisma, {
      correctionId: id,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
  }

  // ─── the inbox ────────────────────────────────────────────────────────────────

  /** What waits for me: my direct reports' requests, and (with HR access) the HR step. */
  @Get('inbox')
  async inbox(@CurrentUser() user: AccessTokenClaims) {
    return hrInbox(this.prisma, { userId: user.sub, access: await this.access(user) });
  }

  /** The menu counts (0 for people with nothing waiting). */
  @Get('hr-badges')
  async badges(@CurrentUser() user: AccessTokenClaims) {
    return hrBadges(this.prisma, { userId: user.sub, access: await this.access(user) });
  }

  @Post('inbox/leave/:id/approve')
  approveLeave(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return managerDecideLeave(this.prisma, {
      requestId: id,
      actorUserId: user.sub,
      approve: true,
      now: this.clock.now(),
    });
  }

  @Post('inbox/leave/:id/reject')
  rejectLeave(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: { reason: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return managerDecideLeave(this.prisma, {
      requestId: id,
      actorUserId: user.sub,
      approve: false,
      reason: body.reason,
      now: this.clock.now(),
    });
  }

  @Post('inbox/corrections/:id/approve')
  approveCorrection(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return managerDecideCorrection(this.prisma, {
      correctionId: id,
      actorUserId: user.sub,
      approve: true,
      now: this.clock.now(),
    });
  }

  @Post('inbox/corrections/:id/reject')
  rejectCorrection(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: { reason: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return managerDecideCorrection(this.prisma, {
      correctionId: id,
      actorUserId: user.sub,
      approve: false,
      reason: body.reason,
      now: this.clock.now(),
    });
  }

  /** A team member's request, read only for their managers (direct and indirect). */
  @Get('team-leave/:id')
  teamRequest(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return leaveRequestDetail(this.prisma, {
      requestId: id,
      scope: 'team',
      viewerUserId: user.sub,
    });
  }

  /** Who of my team is off when (managers only see their own people). */
  @Get('team-leave-calendar')
  @ApiQuery({ name: 'month', required: false })
  async teamCalendar(@CurrentUser() user: AccessTokenClaims, @Query('month') month?: string) {
    const ids = await teamEmployeeIds(this.prisma, user.sub);
    return leaveCalendar(this.prisma, {
      month: month && MONTH.test(month) ? month : cairoDay(this.clock.now()).slice(0, 7),
      scope: null,
      employeeIds: ids,
    });
  }
}
