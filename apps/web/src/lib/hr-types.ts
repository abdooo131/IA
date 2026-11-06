import type { ContractType, DocumentKind, EmployeeStatus } from '@shiplynow/shared';

/** HR step 1 (docs/HR.md): what the /hr and /me/employee endpoints answer. */

export interface StoreRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface EmployeeRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  user: { id: string; role: string; isActive: boolean; email: string };
  mobile: string | null;
  jobTitle: string | null;
  department: string | null;
  homeStore: StoreRef | null;
  contractType: ContractType;
  status: EmployeeStatus;
  hireDate: string | null;
  documents: number;
  expiredDocuments: number;
}

export interface EmployeeBank {
  bankName: string | null;
  bankAccountNumber: string | null;
  iban: string | null;
  bankAccountHolder: string | null;
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
  department: string | null;
  manager: { id: string; code: string; nameEn: string; nameAr: string | null } | null;
  homeStore: StoreRef | null;
  storeFromAccount: boolean;
  hireDate: string | null;
  contractType: ContractType;
  contractEndsOn: string | null;
  probationEndsOn: string | null;
  employment: 'employee' | 'outsourced';
  staffingSupplier: { id: string; name: string } | null;
  socialInsuranceNumber: string | null;
  bank: EmployeeBank | null;
  status: EmployeeStatus;
  leftOn: string | null;
  leftReason: string | null;
  /** HR view only, with the salaries switch */
  salary?: { monthlyPiastres: number; insuredWagePiastres: number | null } | null;
  canSeePay?: boolean;
}

export interface EmployeeDocument {
  id: string;
  kind: DocumentKind;
  title: string | null;
  contentType: string;
  sizeBytes: number;
  issuedOn: string | null;
  expiresOn: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string };
}

export interface DocumentAlert {
  id: string;
  type: 'document_expiring' | 'document_expired';
  data: {
    employeeId: string;
    documentId: string | null;
    kind: string;
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
