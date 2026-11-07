import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  addEmployeeDocument,
  cancelChecklist,
  completenessFor,
  createEmployee,
  currentPackage,
  deleteEmployeeDocument,
  deleteEmployeePhoto,
  documentChecklist,
  DomainError,
  employeeChecklists,
  employeeDirectory,
  employeeFileCompleteness,
  employeeFlagsFor,
  employeeHistory,
  getEmployee,
  getEmployeeDocument,
  hrOverview,
  listDocumentAlerts,
  listEmployeeDocuments,
  listEmployees,
  listPeopleWithoutFile,
  listSalaryPackages,
  resolveDocumentAlert,
  reviewEmployeeDocument,
  setChecklistTask,
  setEmployeePhoto,
  setEmployeeStatus,
  setEmployment,
  setSalaryPackage,
  startChecklistFor,
  teamOf,
  updateEmployee,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  canDo,
  type ChecklistTaskBody,
  checklistTaskSchema,
  type CreateEmployeeBody,
  createEmployeeSchema,
  DIRECTORY_SORTS,
  type DirectorySort,
  type DocumentReviewBody,
  documentReviewSchema,
  EMPLOYEE_FLAGS,
  EMPLOYEE_STATUSES,
  type EmployeeFileBody,
  employeeFileSchema,
  type EmployeeFlag,
  type EmployeeStatus,
  type EmployeeStatusBody,
  employeeStatusSchema,
  type EmploymentBody,
  employmentSchema,
  type SalaryPackageBody,
  salaryPackageSchema,
  type StartChecklistBody,
  startChecklistSchema,
} from '@shiplynow/shared';
import type { Request, Response } from 'express';
import { limitedStores } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { csv } from '../finance/finance-csv';
import { PrismaService } from '../prisma/prisma.service';
import { readUpload, sendDocument, sendPhoto } from './hr-files';

const confidential = (access: AccessProfile) => canDo(access, 'hr', 'use');

/**
 * Employee files (docs/HR.md). Reading needs HR view, changing a file, its employment,
 * documents, photo and checklists HR use, opening a file for an account, status changes and
 * deleting documents HR manage. The salary package and the salary bank account need the
 * salaries switch too. People limited to some stores see only the files of those stores.
 */
@ApiTags('hr')
@ApiBearerAuth()
@Access('hr')
@Controller('hr')
export class HrController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private filter(access: AccessProfile, q: Record<string, string | undefined>) {
    return {
      scope: limitedStores(access),
      q: q.q?.trim() || undefined,
      storeId: q.darkStoreId || undefined,
      departmentId: q.departmentId || undefined,
      positionId: q.positionId || undefined,
      gradeId: q.gradeId || undefined,
      employment:
        q.employment === 'employee' || q.employment === 'outsourced' ? q.employment : undefined,
      status: EMPLOYEE_STATUSES.includes(q.status as EmployeeStatus)
        ? (q.status as EmployeeStatus)
        : undefined,
      flag: EMPLOYEE_FLAGS.includes(q.flag as EmployeeFlag) ? (q.flag as EmployeeFlag) : undefined,
      sort: DIRECTORY_SORTS.includes(q.sort as DirectorySort)
        ? (q.sort as DirectorySort)
        : undefined,
      desc: q.dir === 'desc',
    } as const;
  }

  private async rows(access: AccessProfile, q: Record<string, string | undefined>) {
    const rows = await listEmployees(this.prisma, {
      scope: limitedStores(access),
      q: q.q?.trim() || undefined,
      storeId: q.darkStoreId || undefined,
      departmentId: q.departmentId || undefined,
      positionId: q.positionId || undefined,
      gradeId: q.gradeId || undefined,
      employment:
        q.employment === 'employee' || q.employment === 'outsourced' ? q.employment : undefined,
      status: EMPLOYEE_STATUSES.includes(q.status as EmployeeStatus)
        ? (q.status as EmployeeStatus)
        : undefined,
    });
    const done = await completenessFor(
      this.prisma,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      ...r,
      documents: done.get(r.id) ?? { percent: 100, missing: 0 },
    }));
  }

  @Get('employees')
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'positionId', required: false })
  @ApiQuery({ name: 'gradeId', required: false })
  @ApiQuery({ name: 'employment', required: false })
  @ApiQuery({ name: 'status', required: false, enum: EMPLOYEE_STATUSES })
  list(@CurrentAccess() access: AccessProfile, @Query() q: Record<string, string>) {
    return this.rows(access, q);
  }

  /**
   * HR phase 1: the HR home, what needs attention today in the person's stores (the Today
   * board, the inbox, documents, checklists, probation and contract ends, birthdays,
   * anniversaries and headcount).
   */
  @Get('overview')
  overview(@CurrentAccess() access: AccessProfile, @CurrentUser() user: AccessTokenClaims) {
    return hrOverview(this.prisma, {
      scope: limitedStores(access),
      userId: user.sub,
      access,
      now: this.clock.now(),
    });
  }

  /** HR phase 1: the employee list with flags, a flag filter, sort and pages. */
  @Get('directory')
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'positionId', required: false })
  @ApiQuery({ name: 'gradeId', required: false })
  @ApiQuery({ name: 'employment', required: false })
  @ApiQuery({ name: 'status', required: false, enum: EMPLOYEE_STATUSES })
  @ApiQuery({ name: 'flag', required: false, enum: EMPLOYEE_FLAGS })
  @ApiQuery({ name: 'sort', required: false, enum: DIRECTORY_SORTS })
  @ApiQuery({ name: 'dir', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page', required: false })
  directory(@CurrentAccess() access: AccessProfile, @Query() q: Record<string, string>) {
    const page = Number(q.page);
    return employeeDirectory(
      this.prisma,
      { ...this.filter(access, q), page: Number.isInteger(page) && page > 0 ? page : 1 },
      this.clock.now(),
    );
  }

  /** The employee list as CSV (Excel friendly), with the same filters and sort, every page. */
  @Get('employees.csv')
  async listCsv(
    @CurrentAccess() access: AccessProfile,
    @Query() q: Record<string, string>,
    @Res() res: Response,
  ) {
    const { rows } = await employeeDirectory(
      this.prisma,
      { ...this.filter(access, q), pageSize: null },
      this.clock.now(),
    );
    const body = csv(
      [
        'code',
        'name_en',
        'name_ar',
        'mobile',
        'department',
        'position',
        'grade',
        'manager',
        'store',
        'employment',
        'contract',
        'hire_date',
        'probation_ends_on',
        'status',
        'documents_percent',
        'flags',
      ],
      rows.map((r) => [
        r.code,
        r.nameEn,
        r.nameAr,
        r.mobile,
        r.department?.nameEn ?? null,
        r.position?.titleEn ?? r.jobTitle,
        r.grade?.nameEn ?? null,
        r.manager?.nameEn ?? null,
        r.homeStore?.code ?? null,
        r.employment,
        r.contractType,
        r.hireDate,
        r.probationEndsOn,
        r.status,
        r.documents.percent,
        r.flags.join(' '),
      ]),
    );
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="employees.csv"');
    res.send(body);
  }

  /** Team members and riders whose account has no file yet. */
  @Get('people-without-file')
  async withoutFile(@CurrentAccess() access: AccessProfile) {
    // Every store's people: only for those who see every store.
    if (limitedStores(access)) return [];
    return listPeopleWithoutFile(this.prisma);
  }

  @Post('employees')
  @Access('hr', 'manage')
  create(
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployeeBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return createEmployee(this.prisma, {
      body,
      actorUserId: user.sub,
      bank: access.salaries,
      scope: limitedStores(access),
    });
  }

  @Get('employees/:id')
  async detail(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const file = await getEmployee(this.prisma, id, {
      scope: limitedStores(access),
      bank: access.salaries,
    });
    const [documents, team, whole, flags] = await Promise.all([
      documentChecklist(this.prisma, id, { confidential: confidential(access) }),
      teamOf(this.prisma, id),
      employeeFileCompleteness(this.prisma, id, {
        scope: limitedStores(access),
        confidential: confidential(access),
        bank: access.salaries,
      }),
      employeeFlagsFor(this.prisma, [file], this.clock.now()),
    ]);
    const extra = flags.get(id)!;
    return {
      ...file,
      completeness: {
        percent: documents.percent,
        required: documents.required,
        done: documents.done,
      },
      // HR phase 1: the whole file (fields and documents) and the list's flags.
      fileCompleteness: whole,
      flags: extra.flags,
      probationEnd: extra.probationEndsOn,
      openViolations: extra.openViolations,
      team: { direct: team.direct, total: team.total },
      salary: access.salaries ? await currentPackage(this.prisma, id) : null,
      canSeePay: access.salaries,
    };
  }

  @Patch('employees/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(employeeFileSchema)) body: EmployeeFileBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return updateEmployee(this.prisma, {
      employeeId: id,
      body,
      actorUserId: user.sub,
      bank: access.salaries,
      scope: limitedStores(access),
    });
  }

  /** Active, on leave, suspended or left (with the last day and the reason). */
  @Post('employees/:id/status')
  @Access('hr', 'manage')
  status(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(employeeStatusSchema)) body: EmployeeStatusBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return setEmployeeStatus(this.prisma, {
      employeeId: id,
      body,
      actorUserId: user.sub,
      scope: limitedStores(access),
    });
  }

  /** On our payroll, or hired through an outsourcing company (a supplier). */
  @Put('employees/:id/employment')
  async employment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(employmentSchema)) body: EmploymentBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const file = await getEmployee(this.prisma, id, {
      scope: limitedStores(access),
      bank: false,
    });
    return setEmployment(this.prisma, { ...body, userId: file.user.id, actorUserId: user.sub });
  }

  // ─── salary package (salaries switch) ──────────────────────────────────────

  @Get('employees/:id/package')
  @Access('hr', 'view', { salaries: true })
  async salaryPackage(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const file = await getEmployee(this.prisma, id, {
      scope: limitedStores(access),
      bank: false,
    });
    return {
      employment: file.employment,
      grade: file.grade,
      history: await listSalaryPackages(this.prisma, id),
    };
  }

  @Post('employees/:id/package')
  @Access('hr', 'use', { salaries: true })
  async setPackage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(salaryPackageSchema)) body: SalaryPackageBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await getEmployee(this.prisma, id, { scope: limitedStores(access), bank: false });
    return setSalaryPackage(this.prisma, { employeeId: id, body, actorUserId: user.sub });
  }

  // ─── documents ─────────────────────────────────────────────────────────────

  /** The checklist (required, missing, verified, expiring...) and every version on file. */
  @Get('employees/:id/documents')
  async documents(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const scope = limitedStores(access);
    const documents = await listEmployeeDocuments(this.prisma, id, {
      scope,
      confidential: confidential(access),
    });
    const checklist = await documentChecklist(this.prisma, id, {
      confidential: confidential(access),
    });
    return { checklist, documents };
  }

  /** Body: the file itself (photo or PDF); type, dates and the version it replaces in the query. */
  @Post('employees/:id/documents')
  @ApiQuery({ name: 'typeId' })
  @ApiQuery({ name: 'title', required: false })
  @ApiQuery({ name: 'issuedOn', required: false })
  @ApiQuery({ name: 'expiresOn', required: false })
  @ApiQuery({ name: 'replacesId', required: false })
  upload(
    @Param('id') id: string,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return addEmployeeDocument(this.prisma, {
      employeeId: id,
      ...readUpload(query, req),
      actorUserId: user.sub,
      scope: limitedStores(access),
    });
  }

  /** HR marks the current version verified, or rejected with a note. */
  @Post('employees/:id/documents/:documentId/review')
  review(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Body(new ZodValidationPipe(documentReviewSchema)) body: DocumentReviewBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return reviewEmployeeDocument(this.prisma, {
      employeeId: id,
      documentId,
      body,
      actorUserId: user.sub,
      scope: limitedStores(access),
    });
  }

  @Get('employees/:id/documents/:documentId')
  @ApiQuery({ name: 'download', required: false })
  async download(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Query('download') asFile: string | undefined,
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    const doc = await getEmployeeDocument(this.prisma, {
      employeeId: id,
      documentId,
      scope: limitedStores(access),
      confidential: confidential(access),
    });
    sendDocument(res, doc, asFile === '1');
  }

  @Delete('employees/:id/documents/:documentId')
  @Access('hr', 'manage')
  removeDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return deleteEmployeeDocument(this.prisma, {
      employeeId: id,
      documentId,
      actorUserId: user.sub,
      scope: limitedStores(access),
    });
  }

  // ─── photo ─────────────────────────────────────────────────────────────────

  @Get('employees/:id/photo')
  async photo(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    await getEmployee(this.prisma, id, { scope: limitedStores(access), bank: false });
    await sendPhoto(this.prisma, res, id);
  }

  /** Body: the square JPEG made on the phone (at most 1 MB). */
  @Put('employees/:id/photo')
  putPhoto(
    @Param('id') id: string,
    @Req() req: Request,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    if (!Buffer.isBuffer(req.body)) throw new DomainError('photo_type_not_allowed', 400);
    return setEmployeePhoto(this.prisma, {
      employeeId: id,
      contentType: (req.headers['content-type'] ?? '').split(';')[0]!.trim(),
      data: req.body,
      actorUserId: user.sub,
      scope: limitedStores(access),
    });
  }

  @Delete('employees/:id/photo')
  removePhoto(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return deleteEmployeePhoto(this.prisma, {
      employeeId: id,
      actorUserId: user.sub,
      scope: limitedStores(access),
    });
  }

  // ─── checklists ────────────────────────────────────────────────────────────

  @Get('employees/:id/checklists')
  async checklists(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    await getEmployee(this.prisma, id, { scope: limitedStores(access), bank: false });
    return employeeChecklists(this.prisma, id);
  }

  @Post('employees/:id/checklists')
  async startChecklist(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(startChecklistSchema)) body: StartChecklistBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await getEmployee(this.prisma, id, { scope: limitedStores(access), bank: false });
    return startChecklistFor(this.prisma, { employeeId: id, body, actorUserId: user.sub });
  }

  @Patch('employees/:id/checklist-tasks/:taskId')
  async task(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(checklistTaskSchema)) body: ChecklistTaskBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await getEmployee(this.prisma, id, { scope: limitedStores(access), bank: false });
    return setChecklistTask(this.prisma, { employeeId: id, taskId, body, actorUserId: user.sub });
  }

  @Post('employees/:id/checklists/:checklistId/cancel')
  @Access('hr', 'manage')
  async cancel(
    @Param('id') id: string,
    @Param('checklistId') checklistId: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await getEmployee(this.prisma, id, { scope: limitedStores(access), bank: false });
    return cancelChecklist(this.prisma, { employeeId: id, checklistId, actorUserId: user.sub });
  }

  /** Everyone below this person (direct and indirect), with counts by grade and department. */
  @Get('employees/:id/team')
  async team(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    await getEmployee(this.prisma, id, { scope: limitedStores(access), bank: false });
    return teamOf(this.prisma, id);
  }

  /** One timeline: the file, the account, access and (with salaries) pay changes. */
  @Get('employees/:id/history')
  history(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    return employeeHistory(this.prisma, {
      employeeId: id,
      scope: limitedStores(access),
      pay: access.salaries,
    });
  }

  /** Open document_expiring and document_expired alerts. */
  @Get('alerts')
  alerts(@CurrentAccess() access: AccessProfile) {
    return listDocumentAlerts(this.prisma, limitedStores(access));
  }

  @Post('alerts/:id/resolve')
  resolve(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return resolveDocumentAlert(this.prisma, {
      alertId: id,
      actorUserId: user.sub,
      scope: limitedStores(access),
    });
  }
}
