import type {
  AllowanceKind,
  ChecklistKind,
  ContractType,
  DocumentState,
  EmployeeStatus,
  Employment,
  PayBasis,
} from '@shiplynow/shared';

/** HR (docs/HR.md): what the /hr, /me/employee and /me/team endpoints answer. */

export interface StoreRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}
export interface DepartmentRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}
export interface PositionRef {
  id: string;
  titleEn: string;
  titleAr: string;
}
export interface GradeRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  rank: number;
}
export interface PersonRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
}

export interface EmployeeRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  user: { id: string; role: string; isActive: boolean; email: string };
  mobile: string | null;
  nationalId: string | null;
  jobTitle: string | null;
  department: DepartmentRef | null;
  position: PositionRef | null;
  grade: GradeRef | null;
  manager: PersonRef | null;
  homeStore: StoreRef | null;
  employment: Employment;
  payBasis: PayBasis;
  contractType: ContractType;
  status: EmployeeStatus;
  hireDate: string | null;
  photoVersion: number | null;
  documents: { percent: number; missing: number };
}

export interface EmployeeBank {
  bankName: string | null;
  bankAccountNumber: string | null;
  iban: string | null;
  bankAccountHolder: string | null;
}

export interface SalaryPackage {
  id: string;
  effectiveFrom: string;
  basicPiastres: number;
  insuredWagePiastres: number | null;
  allowances: { kind: AllowanceKind; label: string | null; amountPiastres: number }[];
  grossPiastres: number;
  note: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  current: boolean;
}

export interface EmployeeFile {
  id: string;
  number: number;
  code: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    jobRole: string | null;
  };
  nameEn: string;
  nameAr: string | null;
  nationalId: string | null;
  nationalIdExpiresOn: string | null;
  birthDate: string | null;
  address: string | null;
  mobile: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  jobTitle: string | null;
  department: DepartmentRef | null;
  position:
    (PositionRef & { code: string; minGradeId: string | null; maxGradeId: string | null }) | null;
  grade: (GradeRef & { bandMinPiastres: number | null; bandMaxPiastres: number | null }) | null;
  manager: PersonRef | null;
  effectiveManager: PersonRef | null;
  managerSource: 'set' | 'department' | null;
  homeStore: StoreRef | null;
  storeFromAccount: boolean;
  hireDate: string | null;
  contractType: ContractType;
  contractEndsOn: string | null;
  probationEndsOn: string | null;
  employment: Employment;
  /** monthly_salary: the salary run; per_delivery: riders paid through the rider wallet */
  payBasis: PayBasis;
  staffingSupplier: { id: string; name: string } | null;
  socialInsuranceNumber: string | null;
  bank: EmployeeBank | null;
  photoVersion: number | null;
  status: EmployeeStatus;
  leftOn: string | null;
  leftReason: string | null;
  /** HR detail only */
  completeness?: { percent: number; required: number; done: number };
  team?: { direct: number; total: number };
  /** HR view with the salaries switch: the package in force today */
  salary?: SalaryPackage | null;
  canSeePay?: boolean;
}

export interface DocumentTypeRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  hasExpiry: boolean;
  required: boolean;
  requiredEmployment: string[];
  requiredDepartmentIds: string[];
  requiredPositionIds: string[];
  allowedTypes: string[];
  maxBytes: number;
  confidential: boolean;
  selfUpload: boolean;
  multiple: boolean;
  alertDays: number | null;
  sort: number;
  isActive: boolean;
}

export interface EmployeeDocument {
  id: string;
  typeId: string;
  title: string | null;
  contentType: string;
  sizeBytes: number;
  issuedOn: string | null;
  expiresOn: string | null;
  version: number;
  previousId: string | null;
  isCurrent: boolean;
  status: 'pending' | 'verified' | 'rejected';
  reviewNote: string | null;
  reviewedAt: string | null;
  selfUploaded: boolean;
  createdAt: string;
  uploadedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
  type: { id: string; code: string; nameEn: string; nameAr: string; confidential: boolean };
}

export interface ChecklistItem {
  type: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    hasExpiry: boolean;
    multiple: boolean;
    selfUpload: boolean;
    confidential: boolean;
    allowedTypes: string[];
    maxBytes: number;
  };
  required: boolean;
  state: DocumentState;
  documents: EmployeeDocument[];
}
export interface DocumentChecklist {
  items: ChecklistItem[];
  required: number;
  done: number;
  percent: number;
}

export interface EmployeeChecklist {
  id: string;
  kind: ChecklistKind;
  nameEn: string;
  nameAr: string;
  startsOn: string;
  status: 'open' | 'done' | 'cancelled';
  done: number;
  total: number;
  tasks: {
    id: string;
    titleEn: string;
    titleAr: string;
    ownerRole: string;
    dueOn: string;
    documentTypeId: string | null;
    doneAt: string | null;
    doneBy: string | null;
    note: string | null;
    overdue: boolean;
  }[];
}

export interface PersonCard {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  titleEn: string | null;
  titleAr: string | null;
  status: EmployeeStatus;
  grade: GradeRef | null;
  department: DepartmentRef | null;
  homeStore: StoreRef | null;
  managerId: string | null;
  managerSource: 'set' | 'department' | null;
  photoVersion: number | null;
}

export interface OrgDepartment extends DepartmentRef {
  parentId: string | null;
  headEmployeeId: string | null;
  sort: number;
  headcount: number;
}
export interface Vacancy {
  positionId: string;
  code: string;
  titleEn: string;
  titleAr: string;
  departmentId: string;
  open: number;
  reportsTo: string | null;
}
export interface OrgChartData {
  people: PersonCard[];
  departments: OrgDepartment[];
  vacancies: Vacancy[];
}

export interface TeamData {
  people: (PersonCard & { level: number })[];
  direct: number;
  total: number;
  byGrade: { key: string; count: number }[];
  byDepartment: { key: string; count: number }[];
}

export interface DepartmentRow extends DepartmentRef {
  parentId: string | null;
  sort: number;
  isActive: boolean;
  head: PersonRef | null;
  costStore: StoreRef | null;
  members: number;
  positions: number;
}
export interface GradeRow extends GradeRef {
  bandMinPiastres: number | null;
  bandMaxPiastres: number | null;
  /** Yearly annual leave days (HR phase 3) */
  annualLeaveDays: number | null;
  isActive: boolean;
  people: number;
}
export interface PositionRow {
  id: string;
  code: string;
  titleEn: string;
  titleAr: string;
  departmentId: string;
  minGradeId: string | null;
  maxGradeId: string | null;
  headcountPlanned: number;
  annualLeaveDays: number | null;
  isActive: boolean;
  department: DepartmentRef;
  minGrade: GradeRef | null;
  maxGrade: GradeRef | null;
  filled: number;
  open: number;
}
export interface ChecklistTemplateRow {
  id: string;
  code: string;
  kind: ChecklistKind;
  nameEn: string;
  nameAr: string;
  positionId: string | null;
  isActive: boolean;
  position: { id: string; code: string; titleEn: string; titleAr: string } | null;
  tasks: {
    id: string;
    titleEn: string;
    titleAr: string;
    ownerRole: string;
    dueDays: number;
    documentTypeId: string | null;
  }[];
}

export interface MissingDocumentRow {
  employee: {
    id: string;
    number: number;
    nameEn: string;
    nameAr: string | null;
    department: { id: string; nameEn: string; nameAr: string } | null;
    homeStore: StoreRef | null;
  };
  type: { id: string; code: string; nameEn: string; nameAr: string };
  state: DocumentState;
  documentId: string | null;
  expiresOn: string | null;
}

export interface PendingDocument extends EmployeeDocument {
  employee: { id: string; number: number; nameEn: string; nameAr: string | null };
}

export interface OpenChecklistRow {
  id: string;
  kind: ChecklistKind;
  nameEn: string;
  nameAr: string;
  startsOn: string;
  employee: { id: string; number: number; nameEn: string; nameAr: string | null };
  done: number;
  total: number;
  overdue: number;
}

export interface DocumentAlert {
  id: string;
  type: 'document_expiring' | 'document_expired';
  data: {
    employeeId: string;
    documentId: string | null;
    kind: string;
    typeNameEn?: string | null;
    typeNameAr?: string | null;
    title: string | null;
    nameEn: string;
    nameAr: string | null;
    expiresOn: string;
  };
  createdAt: string;
}

export interface PersonWithoutFile {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** The name in the reader's language when the file has one. */
export function employeeName(e: { nameEn: string; nameAr: string | null }, locale: string) {
  return locale === 'ar' && e.nameAr ? e.nameAr : e.nameEn;
}

/** A position or free title in the reader's language. */
export function titleOf(e: { titleEn?: string | null; titleAr?: string | null }, locale: string) {
  return (locale === 'ar' ? e.titleAr : e.titleEn) ?? e.titleEn ?? null;
}

/** Where a person's photo is served from (null when they have none). */
export function photoUrl(employeeId: string, version: number | null) {
  return version ? `/api/people/${employeeId}/photo?v=${version}` : null;
}

/** Departments in tree order, each with how deep it sits (for indented options). */
export function departmentOptions(departments: DepartmentRow[]) {
  const out: { d: DepartmentRow; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const d of departments.filter((x) => x.parentId === parentId && x.isActive)) {
      out.push({ d, depth });
      if (depth < 8) walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** EMP-0001 from the file number. */
export function employeeCodeOf(number: number) {
  return `EMP-${String(number).padStart(4, '0')}`;
}
