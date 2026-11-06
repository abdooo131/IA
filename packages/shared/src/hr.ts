import { z } from 'zod';
import { isCalendarDay } from './hours';
import { egyptianPhoneSchema } from './phone';

/**
 * HR step 1 (docs/HR.md): one employee file per person who works for us, linked 1:1 to their
 * user account, with documents and a history built from the audit log.
 */

export const EMPLOYEE_STATUSES = ['active', 'on_leave', 'suspended', 'left'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** outsourced follows users.employment, which is set in Payroll (it changes who is paid). */
export const CONTRACT_TYPES = ['permanent', 'fixed_term', 'part_time', 'outsourced'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const DEPARTMENTS = [
  'management',
  'operations',
  'store',
  'delivery',
  'merchants',
  'finance',
  'hr',
  'quality',
  'other',
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DOCUMENT_KINDS = [
  'national_id',
  'contract',
  'criminal_record',
  'military_status',
  'qualification',
  'medical',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Photos (shrunk by the phone) or PDFs, at most 3 MB. */
export const DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const MAX_DOCUMENT_BYTES = 3_000_000;

/** The roles that have an employee file: team members and riders. */
export const EMPLOYEE_ROLES = ['admin', 'finance', 'store_staff', 'rider'] as const;

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
  department: z.enum(DEPARTMENTS).nullable().optional(),
  managerId: z.string().min(1).max(64).nullable().optional(),
  homeStoreId: z.string().min(1).max(64).nullable().optional(),
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
  userId: z.string().min(1).max(64),
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

/** Query of an upload: the file itself is the body. */
export const documentUploadSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  title: z.string().trim().max(120).optional(),
  issuedOn: daySchema.optional(),
  expiresOn: daySchema.optional(),
});
export type DocumentUploadQuery = z.infer<typeof documentUploadSchema>;

/** PUT /admin/merchants/:id/account-manager */
export const accountManagerSchema = z.object({
  userId: z.string().min(1).max(64).nullable(),
});

/** EMP-0001 */
export function employeeCode(number: number) {
  return `EMP-${String(number).padStart(4, '0')}`;
}
