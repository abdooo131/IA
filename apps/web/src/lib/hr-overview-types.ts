import type { ExitView } from './hr-phase2';
import type { EmployeeFlag, FileCompleteness } from '@shiplynow/shared';
import type { EmployeeRow } from './hr-types';

// HR phase 1: what GET /hr/overview and GET /hr/directory answer.

export interface PersonLite {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
}
interface StoreLite {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface HrOverview {
  day: string;
  now: {
    day: string;
    holiday: { nameEn: string; nameAr: string } | null;
    in: number;
    late: number;
    absent: number;
    onLeave: number;
    notYet: number;
    left: number;
    off: number;
    attention: {
      employee: PersonLite;
      store: StoreLite | null;
      state: string;
      lateMinutes: number;
      missingMinutes: number;
    }[];
    onLeaveList: { employee: PersonLite; store: StoreLite | null }[];
  };
  inbox: { total: number; leave: number; corrections: number; appeals: number };
  violations: { suggested: number; open: number };
  documents: {
    missing: number;
    waiting: number;
    expiring: number;
    expired: number;
    people: number;
    soon: {
      employee: PersonLite;
      type: { id: string; nameEn: string; nameAr: string };
      state: string;
      expiresOn: string | null;
    }[];
  };
  checklists: {
    onboarding: number;
    offboarding: number;
    overdue: number;
    list: {
      id: string;
      kind: string;
      nameEn: string;
      nameAr: string;
      employee: PersonLite;
      done: number;
      total: number;
      overdue: number;
    }[];
  };
  probation: { employee: PersonLite; on: string }[];
  contracts: { employee: PersonLite; on: string }[];
  birthdays: { employee: PersonLite; photoVersion: number | null; on: string; years: number }[];
  anniversaries: { employee: PersonLite; photoVersion: number | null; on: string; years: number }[];
  headcount: {
    total: number;
    active: number;
    onLeave: number;
    suspended: number;
    byDepartment: {
      department: { id: string; code: string; nameEn: string; nameAr: string } | null;
      count: number;
    }[];
    byEmployment: { employee: number; outsourced: number };
  };
}

export interface DirectoryRow extends EmployeeRow {
  leftOn: string | null;
  probationEndsOn: string | null;
  contractEndsOn: string | null;
  openViolations: number;
  flags: EmployeeFlag[];
}

export interface Directory {
  rows: DirectoryRow[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  flagCounts: Partial<Record<EmployeeFlag, number>>;
}

export interface FileExtras {
  fileCompleteness: FileCompleteness;
  flags: EmployeeFlag[];
  probationEnd: string | null;
  openViolations: number;
  /** HR phase 2: the login waits for its setup link (pending), works, is off, or none at all */
  login?: 'active' | 'pending' | 'disabled' | 'none';
  /** HR phase 2: the latest exit through the leaving wizard */
  exit?: ExitView | null;
}
