import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  createChecklistTemplate,
  createDepartment,
  createDocumentType,
  createGrade,
  createPosition,
  listChecklistTemplates,
  listDepartments,
  listDocumentTypes,
  listGrades,
  listPositions,
  missingDocuments,
  moveGrade,
  openChecklists,
  orgChart,
  pendingDocuments,
  updateChecklistTemplate,
  updateDepartment,
  updateDocumentType,
  updateGrade,
  updatePosition,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  CHECKLIST_STATES,
  type ChecklistTemplateBody,
  checklistTemplateSchema,
  type ChecklistTemplateUpdateBody,
  checklistTemplateUpdateSchema,
  type DepartmentBody,
  departmentSchema,
  type DepartmentUpdateBody,
  departmentUpdateSchema,
  type DocumentState,
  type DocumentTypeBody,
  documentTypeSchema,
  type DocumentTypeUpdateBody,
  documentTypeUpdateSchema,
  employeeCode,
  type GradeBody,
  gradeSchema,
  type GradeUpdateBody,
  gradeUpdateSchema,
  type PositionBody,
  positionSchema,
  type PositionUpdateBody,
  positionUpdateSchema,
} from '@shiplynow/shared';
import type { Response } from 'express';
import { limitedStores } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { csv } from '../finance/finance-csv';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The organisation (docs/HR.md): the org chart, departments, grades, job positions, document
 * types and checklist templates, plus the company wide document and checklist views. Reading
 * needs HR view; changing the structure and the templates needs HR manage.
 */
@ApiTags('hr')
@ApiBearerAuth()
@Access('hr')
@Controller('hr')
export class HrOrgController {
  constructor(private readonly prisma: PrismaService) {}

  /** People with their manager in force, the department tree and open places. */
  @Get('org')
  org() {
    return orgChart(this.prisma);
  }

  /** Suppliers a person may be hired through (outsourcing companies are suppliers). */
  @Get('staffing-companies')
  staffingCompanies() {
    return this.prisma.supplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('departments')
  departments() {
    return listDepartments(this.prisma);
  }

  @Post('departments')
  @Access('hr', 'manage')
  createDepartment(
    @Body(new ZodValidationPipe(departmentSchema)) body: DepartmentBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createDepartment(this.prisma, { body, actorUserId: user.sub });
  }

  @Patch('departments/:id')
  @Access('hr', 'manage')
  updateDepartment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(departmentUpdateSchema)) body: DepartmentUpdateBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateDepartment(this.prisma, { id, body, actorUserId: user.sub });
  }

  @Get('grades')
  grades() {
    return listGrades(this.prisma);
  }

  @Post('grades')
  @Access('hr', 'manage')
  createGrade(
    @Body(new ZodValidationPipe(gradeSchema)) body: GradeBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createGrade(this.prisma, { body, actorUserId: user.sub });
  }

  @Patch('grades/:id')
  @Access('hr', 'manage')
  updateGrade(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(gradeUpdateSchema)) body: GradeUpdateBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateGrade(this.prisma, { id, body, actorUserId: user.sub });
  }

  /** Moves a grade one place up (more senior) or down the list. */
  @Post('grades/:id/move')
  @Access('hr', 'manage')
  @ApiQuery({ name: 'direction', enum: ['up', 'down'] })
  moveGrade(
    @Param('id') id: string,
    @Query('direction') direction: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return moveGrade(this.prisma, {
      id,
      direction: direction === 'down' ? 'down' : 'up',
      actorUserId: user.sub,
    });
  }

  @Get('positions')
  positions() {
    return listPositions(this.prisma);
  }

  @Post('positions')
  @Access('hr', 'manage')
  createPosition(
    @Body(new ZodValidationPipe(positionSchema)) body: PositionBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createPosition(this.prisma, { body, actorUserId: user.sub });
  }

  @Patch('positions/:id')
  @Access('hr', 'manage')
  updatePosition(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(positionUpdateSchema)) body: PositionUpdateBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updatePosition(this.prisma, { id, body, actorUserId: user.sub });
  }

  @Get('document-types')
  documentTypes() {
    return listDocumentTypes(this.prisma);
  }

  @Post('document-types')
  @Access('hr', 'manage')
  createDocumentType(
    @Body(new ZodValidationPipe(documentTypeSchema)) body: DocumentTypeBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createDocumentType(this.prisma, { body, actorUserId: user.sub });
  }

  @Patch('document-types/:id')
  @Access('hr', 'manage')
  updateDocumentType(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(documentTypeUpdateSchema)) body: DocumentTypeUpdateBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateDocumentType(this.prisma, { id, body, actorUserId: user.sub });
  }

  @Get('checklist-templates')
  templates() {
    return listChecklistTemplates(this.prisma);
  }

  @Post('checklist-templates')
  @Access('hr', 'manage')
  createTemplate(
    @Body(new ZodValidationPipe(checklistTemplateSchema)) body: ChecklistTemplateBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createChecklistTemplate(this.prisma, { body, actorUserId: user.sub });
  }

  @Patch('checklist-templates/:id')
  @Access('hr', 'manage')
  updateTemplate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(checklistTemplateUpdateSchema)) body: ChecklistTemplateUpdateBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateChecklistTemplate(this.prisma, { id, body, actorUserId: user.sub });
  }

  /** Onboarding and offboarding checklists still open, with late tasks. */
  @Get('checklists/open')
  openChecklists() {
    return openChecklists(this.prisma);
  }

  private missing(access: AccessProfile, q: Record<string, string | undefined>) {
    return missingDocuments(this.prisma, {
      scope: limitedStores(access),
      departmentId: q.departmentId || undefined,
      typeId: q.typeId || undefined,
      state: CHECKLIST_STATES.includes(q.state as DocumentState)
        ? (q.state as DocumentState)
        : undefined,
    });
  }

  /** Every required document not in order, one row per person and type. */
  @Get('documents/missing')
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'typeId', required: false })
  @ApiQuery({ name: 'state', required: false, enum: CHECKLIST_STATES })
  missingList(@CurrentAccess() access: AccessProfile, @Query() q: Record<string, string>) {
    return this.missing(access, q);
  }

  @Get('documents/missing.csv')
  async missingCsv(
    @CurrentAccess() access: AccessProfile,
    @Query() q: Record<string, string>,
    @Res() res: Response,
  ) {
    const rows = await this.missing(access, q);
    const body = csv(
      ['code', 'name_en', 'name_ar', 'department', 'store', 'document', 'state', 'expires_on'],
      rows.map((r) => [
        employeeCode(r.employee.number),
        r.employee.nameEn,
        r.employee.nameAr,
        r.employee.department?.nameEn ?? null,
        r.employee.homeStore?.code ?? null,
        r.type.nameEn,
        r.state,
        r.expiresOn,
      ]),
    );
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="missing-documents.csv"');
    res.send(body);
  }

  /** Documents people uploaded themselves that wait for HR to verify. */
  @Get('documents/pending')
  pending(@CurrentAccess() access: AccessProfile) {
    return pendingDocuments(this.prisma, limitedStores(access));
  }
}
