import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  addEmployeeDocument,
  documentChecklist,
  DomainError,
  employeeChecklists,
  employeeHistory,
  getAccessProfile,
  getEmployee,
  getEmployeeDocument,
  getOwnEmployee,
  isInTeam,
  listEmployeeDocuments,
  myDocumentReminders,
  setEmployeePhoto,
  teamOf,
} from '@shiplynow/db';
import { type AccessTokenClaims, canDo, isTeamRole } from '@shiplynow/shared';
import type { Request, Response } from 'express';
import { limitedStores } from '../auth/access-scope';
import { CurrentUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { readUpload, sendDocument, sendPhoto } from './hr-files';

/**
 * My HR: every team member and rider reads their own file, documents, checklists and history,
 * uploads a missing or refused document (it waits for HR to verify) and their photo. Managers
 * (anyone with people below them) see their team and their team's files without pay, bank
 * details or documents. Open to any signed in user (listed in test/route-access.test.ts);
 * merchants have no file.
 */
@ApiTags('hr')
@ApiBearerAuth()
@Controller('me')
export class MyEmployeeController {
  constructor(private readonly prisma: PrismaService) {}

  private async mine(userId: string) {
    const file = await getOwnEmployee(this.prisma, userId);
    if (!file) throw new NotFoundException({ error: 'employee_not_found' });
    return file;
  }

  @Get('employee')
  async file(@CurrentUser() user: AccessTokenClaims) {
    const file = await this.mine(user.sub);
    const [documents, checklist, checklists, team] = await Promise.all([
      listEmployeeDocuments(this.prisma, file.id, { scope: null, confidential: true }),
      documentChecklist(this.prisma, file.id, { confidential: true }),
      employeeChecklists(this.prisma, file.id),
      teamOf(this.prisma, file.id),
    ]);
    return {
      ...file,
      documents,
      checklist,
      checklists,
      team: { direct: team.direct, total: team.total },
    };
  }

  /** HR phase 2: documents HR asked for in the last 14 days and still not in order. */
  @Get('employee/reminders')
  async reminders(@CurrentUser() user: AccessTokenClaims) {
    await this.mine(user.sub);
    return myDocumentReminders(this.prisma, user.sub);
  }

  @Get('employee/history')
  async history(@CurrentUser() user: AccessTokenClaims) {
    const file = await this.mine(user.sub);
    return employeeHistory(this.prisma, { employeeId: file.id, scope: null, pay: true });
  }

  @Get('employee/documents/:documentId')
  @ApiQuery({ name: 'download', required: false })
  async download(
    @Param('documentId') documentId: string,
    @Query('download') asFile: string | undefined,
    @CurrentUser() user: AccessTokenClaims,
    @Res() res: Response,
  ) {
    const file = await this.mine(user.sub);
    const doc = await getEmployeeDocument(this.prisma, {
      employeeId: file.id,
      documentId,
      scope: null,
      confidential: true,
    });
    sendDocument(res, doc, asFile === '1');
  }

  /** A missing, refused or out of date document from the person; it waits for HR. */
  @Post('employee/documents')
  @ApiQuery({ name: 'typeId' })
  @ApiQuery({ name: 'expiresOn', required: false })
  async upload(
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const file = await this.mine(user.sub);
    return addEmployeeDocument(this.prisma, {
      employeeId: file.id,
      ...readUpload(query, req),
      actorUserId: user.sub,
      scope: null,
      self: true,
    });
  }

  @Get('employee/photo')
  async photo(@CurrentUser() user: AccessTokenClaims, @Res() res: Response) {
    const file = await this.mine(user.sub);
    await sendPhoto(this.prisma, res, file.id, false);
  }

  @Put('employee/photo')
  async putPhoto(@Req() req: Request, @CurrentUser() user: AccessTokenClaims) {
    const file = await this.mine(user.sub);
    if (!Buffer.isBuffer(req.body)) throw new DomainError('photo_type_not_allowed', 400);
    return setEmployeePhoto(this.prisma, {
      employeeId: file.id,
      contentType: (req.headers['content-type'] ?? '').split(';')[0]!.trim(),
      data: req.body,
      actorUserId: user.sub,
      scope: null,
    });
  }

  /** The people below me (direct and indirect) with counts by grade and department. */
  @Get('team')
  async team(@CurrentUser() user: AccessTokenClaims) {
    const file = await this.mine(user.sub);
    return teamOf(this.prisma, file.id);
  }

  /** One file of my team, without pay, bank details, ID numbers or documents. */
  @Get('team/:employeeId')
  async member(@Param('employeeId') employeeId: string, @CurrentUser() user: AccessTokenClaims) {
    const me = await this.mine(user.sub);
    if (!(await isInTeam(this.prisma, me.id, employeeId)))
      throw new ForbiddenException({ error: 'not_in_team' });
    const file = await getEmployee(this.prisma, employeeId, { scope: null, bank: false });
    const [team, checklists] = await Promise.all([
      teamOf(this.prisma, employeeId),
      employeeChecklists(this.prisma, employeeId),
    ]);
    return {
      ...file,
      nationalId: null,
      nationalIdExpiresOn: null,
      birthDate: null,
      address: null,
      socialInsuranceNumber: null,
      team: { direct: team.direct, total: team.total },
      checklists,
    };
  }
}

/**
 * Photos of people, for lists, the org chart, team views and the account menu: the person
 * themself, their managers, and people with HR view (within their stores) may see one.
 * Open to any signed in user (listed in test/route-access.test.ts); checked inside.
 */
@ApiTags('hr')
@ApiBearerAuth()
@Controller('people')
export class PeoplePhotoController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':employeeId/photo')
  async photo(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: AccessTokenClaims,
    @Res() res: Response,
  ) {
    const me = await this.prisma.employee.findUnique({
      where: { userId: user.sub },
      select: { id: true },
    });
    let allowed =
      me?.id === employeeId || (me ? await isInTeam(this.prisma, me.id, employeeId) : false);
    if (!allowed && isTeamRole(user.role)) {
      const access = await getAccessProfile(this.prisma, user.sub);
      if (access && canDo(access, 'hr', 'view')) {
        await getEmployee(this.prisma, employeeId, { scope: limitedStores(access), bank: false });
        allowed = true;
      }
    }
    if (!allowed) throw new ForbiddenException({ error: 'no_access' });
    await sendPhoto(this.prisma, res, employeeId);
  }
}
