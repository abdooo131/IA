import type { ExpenseClaim } from './my-pay-types';
import type {
  CorrectionStatus,
  LeaveBalanceKind,
  LeaveRequestStatus,
  PenaltyKind,
  SuggestionKind,
  ViolationCategory,
  ViolationStatus,
} from '@shiplynow/shared';

// What the HR phase 3 API answers (docs/HR.md "Phase 3 as built"): leave, violations,
// attendance correction requests and the inbox.

export interface Named {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
}
interface StoreRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface LeaveType {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  paid: boolean;
  balance: LeaveBalanceKind;
  yearlyDays: number | null;
  casualAllowance: boolean;
  documentAboveDays: number | null;
  maxDaysPerRequest: number | null;
  noticeDays: number;
  selfRequest: boolean;
  isActive: boolean;
  sort: number;
}

export interface LeaveRequest {
  id: string;
  number: string;
  employee: Named & {
    userId: string;
    store: StoreRef | null;
    department: { id: string; nameEn: string; nameAr: string } | null;
    photoVersion: number | null;
  };
  type: LeaveType;
  from: string;
  to: string;
  halfDay: boolean;
  days: number;
  note: string | null;
  status: LeaveRequestStatus;
  onBehalf: boolean;
  overrideBalance: boolean;
  overrideBackdate: boolean;
  hasDocument: boolean;
  documentName: string | null;
  documentNeeded: boolean;
  managerEmployeeId: string | null;
  managerDecidedAt: string | null;
  hrDecidedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface BalanceLine {
  typeId: string | null;
  entitlement: number;
  carriedIn: number;
  adjustments: number;
  taken: number;
  pending: number;
  remaining: number;
  available: number;
}

export interface TypeBalance {
  type: LeaveType;
  entitlement: number | null;
  adjustments: number;
  taken: number;
  pending: number;
  remaining: number | null;
  available: number | null;
  unpaidTaken: number;
}

export interface LeaveBalances {
  year: number;
  from: string;
  to: string;
  accrual: 'monthly' | 'yearly';
  annualDays: number;
  annualSource: 'position' | 'grade' | 'default';
  hireDate: string | null;
  annual: BalanceLine;
  types: TypeBalance[];
}

export interface PersonRef {
  id: string;
  nameEn: string;
  nameAr: string | null;
  userId: string;
}

export interface LeaveRequestDetail extends LeaveRequest {
  dayRows: { day: string; fraction: number; paid: boolean; inPayroll: boolean }[];
  requestedBy: string | null;
  managerDecidedBy: string | null;
  hrDecidedBy: string | null;
  rejectedBy: string | null;
  cancelledBy: string | null;
  manager: PersonRef | null;
  managerNow: PersonRef | null;
  balance: { year: number; annual: BalanceLine | null; line: TypeBalance | null };
}

export interface MyLeave {
  employeeId: string;
  balances: LeaveBalances;
  requests: LeaveRequest[];
  types: LeaveType[];
  backdateDays: number;
}

export interface CalendarCell {
  requestId: string;
  status: 'approved' | 'pending';
  fraction: number;
  type: { code: string; nameEn: string; nameAr: string };
}
export interface LeaveCalendar {
  month: string;
  days: string[];
  holidays: string[];
  people: {
    employee: Named;
    store: string | null;
    department: { nameEn: string; nameAr: string } | null;
    days: Record<string, CalendarCell>;
    total: number;
  }[];
}

export interface BalancesReport {
  year: number;
  from: string;
  to: string;
  people: {
    employee: Named;
    store: StoreRef | null;
    department: { id: string; nameEn: string; nameAr: string } | null;
    annualDays: number;
    annualSource: 'position' | 'grade' | 'default';
    annual: BalanceLine;
    types: {
      typeId: string;
      nameEn: string;
      nameAr: string;
      taken: number;
      unpaid: number;
      pending: number;
    }[];
  }[];
}

export interface EmployeeLeave {
  balances: LeaveBalances;
  adjustments: {
    id: string;
    typeId: string | null;
    type: { nameEn: string; nameAr: string } | null;
    year: number;
    days: number;
    reason: string;
    by: string | null;
    at: string;
  }[];
  requests: LeaveRequest[];
}

export interface ViolationStep {
  step: number;
  penalty: PenaltyKind;
  days: number | null;
  amountPiastres: number | null;
}
export interface ViolationType {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  category: ViolationCategory;
  isActive: boolean;
  sort: number;
  steps: ViolationStep[];
}

export interface Violation {
  id: string;
  number: string;
  employee: Named & {
    employment: 'employee' | 'outsourced';
    staffingSupplier: { id: string; name: string } | null;
    store: StoreRef | null;
  };
  type: { id: string; code: string; nameEn: string; nameAr: string; category: ViolationCategory };
  occurredOn: string;
  description: string;
  suggestedStep: number;
  step: number;
  stepReason: string | null;
  penalty: PenaltyKind;
  days: number | null;
  amountPiastres: number | null;
  status: ViolationStatus;
  recordedAt: string;
  recordedById: string;
  appealUntil: string;
  canAppeal: boolean;
  appealReason: string | null;
  appealedAt: string | null;
  decision: 'upheld' | 'cancelled' | null;
  decisionNote: string | null;
  decidedAt: string | null;
  finalAt: string | null;
  hasEvidence: boolean;
  inPayroll: boolean;
  deductionPiastres: number | null;
  forSupplier: boolean;
}

export interface ViolationDetail extends Violation {
  recordedBy: string | null;
  decidedBy: string | null;
  others: { id: string; number: string; occurredOn: string; step: number; status: string }[];
}

export interface Suggestion {
  id: string;
  day: string;
  kind: SuggestionKind;
  lateMinutes: number;
  status: string;
  type: { id: string; code: string; nameEn: string; nameAr: string } | null;
  employee: Named & { employment: string; store: StoreRef | null };
  violation: { id: string; number: string } | null;
}

export interface Correction {
  id: string;
  number: string;
  employee: Named & { store: StoreRef | null };
  day: string;
  problem: string;
  proposedIn: string | null;
  proposedOut: string | null;
  status: CorrectionStatus;
  managerDecidedAt: string | null;
  hrDecidedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
}

export interface Inbox {
  isManager: boolean;
  hr: { use: boolean; manage: boolean };
  manager: { leave: LeaveRequest[]; corrections: Correction[]; claims: ExpenseClaim[] };
  hrStep: { leave: LeaveRequest[]; corrections: Correction[] };
  appeals: {
    id: string;
    number: string;
    occurredOn: string;
    appealReason: string | null;
    appealedAt: string | null;
    penalty: PenaltyKind;
    days: number | null;
    amountPiastres: number | null;
    type: { nameEn: string; nameAr: string };
    employee: Named;
  }[];
  suggestions: number;
  total: number;
}
