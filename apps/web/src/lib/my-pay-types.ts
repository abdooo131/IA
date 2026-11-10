import type { ExpenseClaimStatus } from '@shiplynow/shared';

// What the My HR pay screens read: payslips (GET /me/payslips, /me/payslips/<month>) and
// expense claims (GET /me/expense-claims); Accounting's claim page (GET /finance/expense-claims/<id>).

type Named = { nameEn: string; nameAr: string | null };

export interface MyPayslipList {
  payBasis: 'monthly_salary' | 'per_delivery';
  payslips: { month: string; entryNumber: string; paidAt: string; gross: number; net: number }[];
}

export interface MyPayslip {
  month: string;
  entryNumber: string;
  paidAt: string;
  paidFrom: { code: string; type: string; nameEn: string; nameAr: string } | null;
  userId: string;
  name: string;
  base: number;
  basic: number | null;
  allowances: { kind: string; label: string | null; amountPiastres: number }[];
  bonus: number;
  commission: number;
  deduction: number;
  hrDeduction: number;
  hrItems: { kind: string; label: string; days: number | null; amountPiastres: number }[];
  gross: number;
  insuredWage: number;
  siEmployee: number;
  siEmployer: number;
  martyrs: number;
  incomeTax: number;
  recovery: number;
  net: number;
  note: string | null;
  employee: {
    number: number;
    nameEn: string;
    nameAr: string | null;
    nationalId: string | null;
    socialInsuranceNumber: string | null;
    department: Named | null;
    position: { titleEn: string; titleAr: string | null } | null;
    homeStore: (Named & { code: string }) | null;
  } | null;
}

export interface ExpenseClaim {
  id: string;
  number: string;
  status: ExpenseClaimStatus;
  employee: { id: string; code: string; nameEn: string; nameAr: string | null };
  userId: string;
  store: (Named & { id: string; code: string }) | null;
  darkStoreId: string | null;
  category: { id: string; code: string; nameEn: string; nameAr: string };
  amountPiastres: number;
  paidOn: string;
  note: string;
  photoId: string;
  hasManager: boolean;
  managerDecidedBy: string | null;
  managerDecidedAt: string | null;
  paidBy: string | null;
  paidAt: string | null;
  paidFrom: { id: string; code: string; nameEn: string; nameAr: string } | null;
  reference: string | null;
  entry: { id: string; number: number } | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  rejectedStep: 'manager' | 'accounting' | null;
  cancelledAt: string | null;
  cancellable: boolean;
  createdAt: string;
}

export interface MyExpenseClaims {
  claims: ExpenseClaim[];
  categories: { id: string; code: string; nameEn: string; nameAr: string }[];
  stores: (Named & { id: string; code: string })[];
  maxAgeDays: number;
  earliestDay: string;
  today: string;
}

export interface FinanceClaimPage {
  claim: ExpenseClaim;
  moneyAccounts: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    balancePiastres: number;
  }[];
}
