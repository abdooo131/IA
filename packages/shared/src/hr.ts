import { z } from 'zod';
import { isCalendarDay } from './hours';
import { egyptianPhoneSchema } from './phone';

/**
 * HR (docs/HR.md): one employee file per person who works for us, linked 1:1 to their user
 * account. HR owns the people (structure, grades, contract, employment, salary package,
 * documents, checklists); Accounting only reads the package to run payroll.
 */

export const EMPLOYEE_STATUSES = ['active', 'on_leave', 'suspended', 'left'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** outsourced follows the employment set in HR (it changes who is paid). */
export const CONTRACT_TYPES = ['permanent', 'fixed_term', 'part_time', 'outsourced'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const EMPLOYMENTS = ['employee', 'outsourced'] as const;
export type Employment = (typeof EMPLOYMENTS)[number];

/** Photos (shrunk by the phone) or PDFs, at most 3 MB (a type may allow less). */
export const DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type DocumentContentType = (typeof DOCUMENT_TYPES)[number];
export const MAX_DOCUMENT_BYTES = 3_000_000;
/** The square photo of a person, made on the phone. */
export const MAX_PHOTO_BYTES = 1_000_000;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** The roles that have an employee file: team members and riders. */
// Shiply's hub staff and couriers have files too (docs/MERGE.md step 6); agents are suppliers.
export const EMPLOYEE_ROLES = [
  'admin',
  'finance',
  'store_staff',
  'rider',
  'hub_staff',
  'courier',
] as const;

/** A calendar day YYYY-MM-DD, or null to clear it. */
export const daySchema = z
  .string()
  .trim()
  .refine((v) => isCalendarDay(v), 'invalid_date');

const optionalDay = daySchema.nullable().optional();
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();
const id = z.string().min(1).max(64);
const optionalId = id.nullable().optional();

export const nationalIdSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{14}$/.test(v), 'invalid_national_id')
  .transform((v) => v || null);

const ibanSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, '').toUpperCase())
  .refine((v) => v === '' || /^EG\d{27}$/.test(v), 'invalid_iban')
  .transform((v) => v || null);

/** The file's fields HR edits. Bank details need the salaries switch as well. */
export const employeeFileSchema = z.object({
  nameEn: z.string().trim().min(2).max(120).optional(),
  nameAr: text(120),
  nationalId: nationalIdSchema.nullable().optional(),
  nationalIdExpiresOn: optionalDay,
  birthDate: optionalDay,
  address: text(300),
  /** The sign in mobile of the account (users.phone) */
  mobile: egyptianPhoneSchema.nullable().optional(),
  emergencyName: text(120),
  emergencyPhone: egyptianPhoneSchema.nullable().optional(),
  jobTitle: text(120),
  departmentId: optionalId,
  positionId: optionalId,
  gradeId: optionalId,
  managerId: optionalId,
  homeStoreId: optionalId,
  hireDate: optionalDay,
  contractType: z.enum(['permanent', 'fixed_term', 'part_time']).optional(),
  contractEndsOn: optionalDay,
  probationEndsOn: optionalDay,
  socialInsuranceNumber: text(30),
  bankName: text(80),
  bankAccountNumber: text(40),
  iban: ibanSchema.nullable().optional(),
  bankAccountHolder: text(120),
});
export type EmployeeFileBody = z.infer<typeof employeeFileSchema>;

export const BANK_FIELDS = ['bankName', 'bankAccountNumber', 'iban', 'bankAccountHolder'] as const;

/** POST /hr/employees: opens a file for a team member or rider who has none yet. */
export const createEmployeeSchema = employeeFileSchema.extend({
  userId: id,
});
export type CreateEmployeeBody = z.infer<typeof createEmployeeSchema>;

export const employeeStatusSchema = z
  .object({
    status: z.enum(EMPLOYEE_STATUSES),
    /** The last working day, for left */
    leftOn: daySchema.optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'left' && !v.leftOn)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['leftOn'],
        message: 'left_date_required',
      });
    if (v.status === 'left' && (!v.reason || v.reason.length < 2))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'reason_required' });
  });
export type EmployeeStatusBody = z.infer<typeof employeeStatusSchema>;

/** PUT /hr/employees/:id/employment: on our payroll, or hired through an outsourcing company. */
export const employmentSchema = z
  .object({
    employment: z.enum(EMPLOYMENTS),
    staffingSupplierId: id.optional(),
  })
  .refine((v) => v.employment === 'employee' || Boolean(v.staffingSupplierId), {
    path: ['staffingSupplierId'],
    message: 'staffing_company_required',
  });
export type EmploymentBody = z.infer<typeof employmentSchema>;

// ─── documents ─────────────────────────────────────────────────────────────────

/** Query of an upload: the file itself is the body. */
export const documentUploadSchema = z.object({
  typeId: id,
  title: z.string().trim().max(120).optional(),
  issuedOn: daySchema.optional(),
  expiresOn: daySchema.optional(),
  /** A new version of this document (otherwise of the current one of a single type) */
  replacesId: id.optional(),
});
export type DocumentUploadQuery = z.infer<typeof documentUploadSchema>;

export const documentReviewSchema = z
  .object({
    status: z.enum(['verified', 'rejected']),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.status === 'verified' || (v.note ?? '').length >= 2, {
    path: ['note'],
    message: 'note_required',
  });
export type DocumentReviewBody = z.infer<typeof documentReviewSchema>;

/** Where a required document stands on one file. */
export const CHECKLIST_STATES = [
  'missing',
  'pending',
  'rejected',
  'verified',
  'expiring',
  'expired',
] as const;
export type DocumentState = (typeof CHECKLIST_STATES)[number];

const nameSchema = {
  nameEn: z.string().trim().min(2).max(120),
  nameAr: z.string().trim().min(2).max(120),
};

export const documentTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'invalid_code'),
  ...nameSchema,
  hasExpiry: z.boolean().default(false),
  required: z.boolean().default(false),
  requiredEmployment: z.array(z.enum(EMPLOYMENTS)).max(2).default([]),
  requiredDepartmentIds: z.array(id).max(100).default([]),
  requiredPositionIds: z.array(id).max(200).default([]),
  allowedTypes: z
    .array(z.enum(DOCUMENT_TYPES))
    .min(1)
    .max(4)
    .default([...DOCUMENT_TYPES]),
  maxBytes: z.number().int().min(10_000).max(MAX_DOCUMENT_BYTES).default(MAX_DOCUMENT_BYTES),
  confidential: z.boolean().default(false),
  selfUpload: z.boolean().default(true),
  multiple: z.boolean().default(false),
  alertDays: z.number().int().min(0).max(365).nullable().default(null),
  sort: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
});
export type DocumentTypeBody = z.infer<typeof documentTypeSchema>;
export const documentTypeUpdateSchema = documentTypeSchema.partial().omit({ code: true });
export type DocumentTypeUpdateBody = z.infer<typeof documentTypeUpdateSchema>;

// ─── structure ────────────────────────────────────────────────────────────────

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{0,23}$/, 'invalid_code');

export const departmentSchema = z.object({
  code: codeSchema,
  ...nameSchema,
  parentId: optionalId,
  headEmployeeId: optionalId,
  costStoreId: optionalId,
  sort: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});
export type DepartmentBody = z.infer<typeof departmentSchema>;
export const departmentUpdateSchema = departmentSchema.partial().omit({ code: true });
export type DepartmentUpdateBody = z.infer<typeof departmentUpdateSchema>;

const band = z.number().int().min(0).max(1_000_000_000).nullable().optional();
/** Yearly annual leave days of a grade or position (HR phase 3); null: not set */
const annualLeaveDays = z.number().int().min(0).max(60).nullable().optional();

export const gradeSchema = z
  .object({
    code: codeSchema,
    ...nameSchema,
    rank: z.number().int().min(1).max(99),
    bandMinPiastres: band,
    bandMaxPiastres: band,
    annualLeaveDays,
    isActive: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.bandMinPiastres == null ||
      v.bandMaxPiastres == null ||
      v.bandMinPiastres <= v.bandMaxPiastres,
    {
      path: ['bandMaxPiastres'],
      message: 'band_min_above_max',
    },
  );
export type GradeBody = z.infer<typeof gradeSchema>;
export const gradeUpdateSchema = z.object({
  nameEn: nameSchema.nameEn.optional(),
  nameAr: nameSchema.nameAr.optional(),
  rank: z.number().int().min(1).max(99).optional(),
  bandMinPiastres: band,
  bandMaxPiastres: band,
  annualLeaveDays,
  isActive: z.boolean().optional(),
});
export type GradeUpdateBody = z.infer<typeof gradeUpdateSchema>;

export const positionSchema = z.object({
  code: codeSchema,
  titleEn: z.string().trim().min(2).max(120),
  titleAr: z.string().trim().min(2).max(120),
  departmentId: id,
  minGradeId: optionalId,
  maxGradeId: optionalId,
  headcountPlanned: z.number().int().min(0).max(10_000).default(0),
  annualLeaveDays,
  isActive: z.boolean().optional(),
});
export type PositionBody = z.infer<typeof positionSchema>;
export const positionUpdateSchema = positionSchema.partial().omit({ code: true });
export type PositionUpdateBody = z.infer<typeof positionUpdateSchema>;

// ─── salary package ────────────────────────────────────────────────────────────

export const ALLOWANCE_KINDS = ['housing', 'transport', 'phone', 'other'] as const;
export type AllowanceKind = (typeof ALLOWANCE_KINDS)[number];

const piastres = z.number().int().min(0).max(1_000_000_000);
export const salaryPackageSchema = z.object({
  /** The first day it is paid from; empty: today (the first package: the hire date) */
  effectiveFrom: daySchema.optional(),
  basicPiastres: piastres,
  /** The wage social insurance is counted on; null means the gross itself */
  insuredWagePiastres: piastres.nullable().optional(),
  allowances: z
    .array(
      z.object({
        kind: z.enum(ALLOWANCE_KINDS),
        label: z.string().trim().max(60).optional(),
        amountPiastres: piastres,
      }),
    )
    .max(12)
    .default([]),
  note: z.string().trim().max(300).optional(),
});
export type SalaryPackageBody = z.infer<typeof salaryPackageSchema>;

// ─── checklists ────────────────────────────────────────────────────────────────

export const CHECKLIST_KINDS = ['onboarding', 'offboarding'] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];
export const TASK_OWNERS = ['hr', 'manager', 'employee', 'it', 'finance', 'store'] as const;
export type TaskOwner = (typeof TASK_OWNERS)[number];

export const checklistTemplateSchema = z.object({
  code: codeSchema,
  kind: z.enum(CHECKLIST_KINDS),
  ...nameSchema,
  positionId: optionalId,
  isActive: z.boolean().optional(),
  tasks: z
    .array(
      z.object({
        titleEn: z.string().trim().min(2).max(160),
        titleAr: z.string().trim().min(2).max(160),
        ownerRole: z.enum(TASK_OWNERS),
        dueDays: z.number().int().min(-90).max(365).default(0),
        documentTypeId: optionalId,
      }),
    )
    .min(1)
    .max(60),
});
export type ChecklistTemplateBody = z.infer<typeof checklistTemplateSchema>;
export const checklistTemplateUpdateSchema = checklistTemplateSchema.omit({ code: true }).partial();
export type ChecklistTemplateUpdateBody = z.infer<typeof checklistTemplateUpdateSchema>;

export const startChecklistSchema = z.object({
  kind: z.enum(CHECKLIST_KINDS),
  /** Empty: the template of the person's position, else the default one */
  templateId: id.optional(),
  /** Empty: the hire date (onboarding) or the last day (offboarding), else today */
  startsOn: daySchema.optional(),
});
export type StartChecklistBody = z.infer<typeof startChecklistSchema>;

export const checklistTaskSchema = z.object({
  done: z.boolean(),
  note: z.string().trim().max(300).optional(),
});
export type ChecklistTaskBody = z.infer<typeof checklistTaskSchema>;

/** PUT /admin/merchants/:id/account-manager */
export const accountManagerSchema = z.object({
  userId: id.nullable(),
});

/** EMP-0001 */
export function employeeCode(number: number) {
  return `EMP-${String(number).padStart(4, '0')}`;
}

/** Whole years and months between a hire day and a day (YYYY-MM-DD), for "tenure". */
export function tenure(from: string, to: string): { years: number; months: number } {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  if (months < 0) months = 0;
  return { years: Math.floor(months / 12), months: months % 12 };
}
