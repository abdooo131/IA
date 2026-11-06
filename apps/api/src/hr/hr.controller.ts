import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  addEmployeeDocument,
  createEmployee,
  deleteEmployeeDocument,
  DomainError,
  employeeHistory,
  getEmployee,
  getEmployeeDocument,
  getOwnEmployee,
  listDocumentAlerts,
  listEmployeeDocuments,
  listEmployees,
  listPeopleWithoutFile,
  resolveDocumentAlert,
  setEmployeeStatus,
  updateEmployee,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  type CreateEmployeeBody,
  createEmployeeSchema,
  documentUploadSchema,
  EMPLOYEE_STATUSES,
  type EmployeeFileBody,
  employeeFileSchema,
  type EmployeeStatus,
  type EmployeeStatusBody,
  employeeStatusSchema,
} from '@shiplynow/shared';
import type { Request, Response } from 'express';
import { limitedStores } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** Sends a stored document: photos open in the browser, PDFs download. */
function sendDocument(
  res: Response,
  doc: { kind: string; contentType: string; data: Uint8Array; id: string },
) {
  const ext = doc.contentType === 'application/pdf' ? 'pdf' : doc.contentType.split('/')[1];
  const disposition = doc.contentType === 'application/pdf' ? 'attachment' : 'inline';
  res.setHeader('content-type', doc.contentType);
  res.setHeader('content-disposition', `${disposition}; filename="${doc.kind}-${doc.id}.${ext}"`);
  res.setHeader('cache-control', 'private, no-store');
  res.send(Buffer.from(doc.data));
}

/**
 * Employee files (docs/HR.md, step 1). Reading needs HR view, changing a file HR use, opening
 * a file for an account, status changes and deleting documents HR manage. Bank details and
 * salary need the salaries switch too. People limited to some stores see only the files of
 * those stores.
 */
@ApiTags('hr')
@ApiBearerAuth()
@Access('hr')
@Controller('hr')
export class HrController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('employees')
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'status', required: false, enum: EMPLOYEE_STATUSES })
  list(
    @CurrentAccess() access: AccessProfile,
    @Query('q') q?: string,
    @Query('darkStoreId') darkStoreId?: string,
    @Query('department') department?: string,
    @Query('status') status?: string,
  ) {
    return listEmployees(this.prisma, {
      scope: limitedStores(access),
      q: q?.trim() || undefined,
      storeId: darkStoreId || undefined,
      department: department || undefined,
      status: EMPLOYEE_STATUSES.includes(status as EmployeeStatus)
        ? (status as EmployeeStatus)
        : undefined,
    });
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
    const salary = access.salaries
      ? await this.prisma.staffSalary.findUnique({
          where: { userId: file.user.id },
          select: { monthlyPiastres: true, insuredWagePiastres: true, updatedAt: true },
        })
      : null;
    return { ...file, salary, canSeePay: access.salaries };
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

  @Get('employees/:id/documents')
  documents(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    return listEmployeeDocuments(this.prisma, id, limitedStores(access));
  }

  /** Body: the file itself (a photo or a PDF, at most 3 MB); its details in the query. */
  @Post('employees/:id/documents')
  @ApiQuery({ name: 'kind' })
  @ApiQuery({ name: 'title', required: false })
  @ApiQuery({ name: 'issuedOn', required: false })
  @ApiQuery({ name: 'expiresOn', required: false })
  upload(
    @Param('id') id: string,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const parsed = documentUploadSchema.safeParse({
      kind: query.kind,
      title: query.title || undefined,
      issuedOn: query.issuedOn || undefined,
      expiresOn: query.expiresOn || undefined,
    });
    if (!parsed.success) throw new DomainError('validation_failed', 400);
    if (!Buffer.isBuffer(req.body)) throw new DomainError('document_type_not_allowed', 400);
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    return addEmployeeDocument(this.prisma, {
      employeeId: id,
      ...parsed.data,
      contentType,
      data: req.body,
      actorUserId: user.sub,
      scope: limitedStores(access),
    });
  }

  @Get('employees/:id/documents/:documentId')
  async download(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    const doc = await getEmployeeDocument(this.prisma, {
      employeeId: id,
      documentId,
      scope: limitedStores(access),
    });
    sendDocument(res, doc);
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

/**
 * My HR: every team member and rider reads their own file, documents and history (read only).
 * Open to any signed in user (listed in test/route-access.test.ts); merchants have no file.
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
    const documents = await listEmployeeDocuments(this.prisma, file.id, null);
    return { ...file, documents };
  }

  @Get('employee/history')
  async history(@CurrentUser() user: AccessTokenClaims) {
    const file = await this.mine(user.sub);
    return employeeHistory(this.prisma, { employeeId: file.id, scope: null, pay: true });
  }

  @Get('employee/documents/:documentId')
  async download(
    @Param('documentId') documentId: string,
    @CurrentUser() user: AccessTokenClaims,
    @Res() res: Response,
  ) {
    const file = await this.mine(user.sub);
    const doc = await getEmployeeDocument(this.prisma, {
      employeeId: file.id,
      documentId,
      scope: null,
    });
    sendDocument(res, doc);
  }
}
