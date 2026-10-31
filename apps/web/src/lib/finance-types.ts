export type PayoutSchedule = 'daily' | 'twice_weekly' | 'weekly';
type StoreRef = { id: string; code: string; nameEn: string; nameAr: string };

export interface FinanceOverview {
  merchants: {
    id: string;
    name: string;
    isActive: boolean;
    payoutSchedule: PayoutSchedule;
    owedPiastres: number;
    draftPayout: { id: string; amountPiastres: number } | null;
  }[];
  riders: {
    id: string;
    name: string;
    badgeCode: string;
    isActive: boolean;
    darkStore: StoreRef;
    cashPiastres: number;
    bonusOwedPiastres: number;
    pendingHandovers: number;
  }[];
  stores: (StoreRef & { cashPiastres: number })[];
  company: {
    bankPiastres: number;
    revenuePiastres: number;
    vatPayablePiastres: number;
    riderBonusExpensePiastres: number;
    cashDifferencePiastres: number;
  };
  totals: {
    owedToMerchantsPiastres: number;
    owedByMerchantsPiastres: number;
    cashWithRidersPiastres: number;
    cashInStoresPiastres: number;
    riderBonusOwedPiastres: number;
    pendingHandovers: number;
    draftPayouts: number;
    draftPayoutsPiastres: number;
  };
}

export interface CashHandoverRow {
  id: string;
  number: string;
  at: string;
  status: 'balanced' | 'pending' | 'written_off' | 'charged_to_rider';
  rider: { id: string; name: string; badgeCode: string };
  darkStore: StoreRef;
  expectedPiastres: number;
  countedPiastres: number;
  differencePiastres: number;
  note: string | null;
  receivedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface PayoutRow {
  id: string;
  number: string;
  merchant: { id: string; name: string; payoutSchedule: PayoutSchedule };
  cutoffAt: string;
  amountPiastres: number;
  status: 'draft' | 'paid' | 'cancelled';
  reference: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string;
  paidAt: string | null;
  paidBy: string | null;
}

export interface Statement {
  merchant: { id: string; name: string; payoutSchedule: PayoutSchedule };
  from: string;
  to: string;
  openingOwedPiastres: number;
  closingOwedPiastres: number;
  byKind: Record<string, number>;
  lines: {
    at: string;
    kind: string;
    memo: string | null;
    orderId: string | null;
    orderNumber: string | null;
    amountPiastres: number;
    balanceAfterPiastres: number;
  }[];
}

export interface JournalPage {
  rows: {
    id: string;
    number: string;
    at: string;
    kind: string;
    memo: string | null;
    orderId: string | null;
    orderNumber: string | null;
    by: string | null;
    lines: {
      accountKey: string;
      accountId: string;
      accountCode: string;
      accountName: string | null;
      accountType: string;
      owner: string | null;
      amountPiastres: number;
    }[];
  }[];
  nextCursor: string | null;
}

export type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface BookAccount {
  id: string;
  code: string;
  type: string;
  category: AccountCategory;
  groupCode: number;
  nameEn: string;
  nameAr: string;
  bankName: string | null;
  accountNumber: string | null;
  iban: string | null;
  note: string | null;
  isActive: boolean;
  wallet: boolean;
  locked: boolean;
  money: boolean;
  balancePiastres: number;
}

export interface AccountStatement {
  account: Pick<
    BookAccount,
    | 'id'
    | 'code'
    | 'category'
    | 'groupCode'
    | 'nameEn'
    | 'nameAr'
    | 'bankName'
    | 'accountNumber'
    | 'iban'
  >;
  from: string;
  to: string;
  openingPiastres: number;
  closingPiastres: number;
  totalDebitPiastres: number;
  totalCreditPiastres: number;
  lines: {
    at: string;
    number: string;
    entryId: string;
    kind: string;
    memo: string | null;
    reference: string | null;
    orderNumber: string | null;
    by: string | null;
    against: { code: string; nameEn: string; nameAr: string }[];
    debitPiastres: number;
    creditPiastres: number;
    balancePiastres: number;
  }[];
}

export interface TrialBalance {
  rows: {
    id: string;
    code: string;
    category: AccountCategory;
    groupCode: number;
    nameEn: string;
    nameAr: string;
    debitPiastres: number;
    creditPiastres: number;
    balancePiastres: number;
  }[];
  totalDebitPiastres: number;
  totalCreditPiastres: number;
}

interface ReportLine {
  id?: string;
  code: string;
  groupCode?: number;
  nameEn: string;
  nameAr: string;
  amountPiastres: number;
  wallets?: number;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  income: ReportLine[];
  expenses: ReportLine[];
  totalIncomePiastres: number;
  totalExpensesPiastres: number;
  profitPiastres: number;
}

export interface BalanceSheet {
  day: string;
  assets: ReportLine[];
  liabilities: ReportLine[];
  equity: ReportLine[];
  earningsPiastres: number;
  totalAssetsPiastres: number;
  totalLiabilitiesPiastres: number;
  totalEquityPiastres: number;
}
