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
  approvedBy: string | null;
  needsApproval: boolean;
}

export interface FinanceRequestRow {
  id: string;
  kind:
    | 'expense'
    | 'drawings'
    | 'capital_in'
    | 'other_income'
    | 'merchant_receipt'
    | 'merchant_adjustment';
  amountPiastres: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reference: string;
  memo: string | null;
  day: string | null;
  requestedBy: { id: string; name: string };
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  entryNumber: number | null;
  receipts: number;
}

export interface FinanceControls {
  lock: { closedThrough: string; updatedAt: string; updatedBy: string } | null;
  approvalThresholdPiastres: number;
  waiting: number;
  payoutsToApprove: number;
  missingReceipts: number;
}

export interface MissingReceipt {
  id: string;
  number: number;
  kind: string;
  at: string;
  memo: string | null;
  amountPiastres: number;
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
  /** EGP, or the currency of a bank account held in another one */
  currency?: string;
  /** The balance in the account's own currency (cents); null for EGP accounts */
  foreignBalanceCents?: number | null;
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

export interface StoreOption {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  kind: 'dark_store' | 'hub';
}

export interface ProfitRow {
  id: string | null;
  name: string | null;
  incomePiastres: number;
  costsPiastres: number;
  profitPiastres: number;
}

export interface CostPerOrderRow {
  store: { id: string; code: string; nameEn: string; nameAr: string };
  deliveredOrders: number;
  incomePiastres: number;
  directCostsPiastres: number;
  sharedCostsPiastres: number;
  incomePerOrderPiastres: number | null;
  directCostPerOrderPiastres: number | null;
  fullCostPerOrderPiastres: number | null;
  profitPerOrderPiastres: number | null;
}

export interface StaffPayRow {
  userId: string;
  employeeId: string | null;
  name: string;
  role: string;
  darkStore: { id: string; code: string; nameEn: string; nameAr: string } | null;
  department: { id: string; nameEn: string; nameAr: string } | null;
  position: { id: string; titleEn: string; titleAr: string } | null;
  grade: { id: string; nameEn: string; nameAr: string } | null;
  employment: 'employee' | 'outsourced';
  staffingSupplier: { id: string; name: string } | null;
  /** The gross of the HR package in force today (basic plus allowances) */
  monthlyPiastres: number | null;
  basicPiastres: number | null;
  allowancesPiastres: number | null;
  packageFrom: string | null;
  insuredWagePiastres: number | null;
  nationalId: string | null;
  insuranceNumber: string | null;
  advanceOwedPiastres: number;
}

export interface PayslipRun {
  month: string;
  entryNumber: string | null;
  paidAt: string | null;
  people: {
    userId: string;
    name: string;
    base: number;
    bonus: number;
    /** Sales commission paid with the salary (older runs have none) */
    commission?: number;
    /** Unpaid leave and final penalties from HR (HR phase 3; older runs have none) */
    hrDeduction?: number;
    hrItems?: { kind: string; label: string; days: number | null; amountPiastres: number }[];
    deduction: number;
    gross: number;
    insuredWage: number;
    siEmployee: number;
    siEmployer: number;
    martyrs: number;
    incomeTax: number;
    recovery: number;
    net: number;
    note: string | null;
  }[];
}

type Named = { code: string; nameEn: string; nameAr: string };
type StoreOrNone = StoreRef | null;

export interface SupplierRow {
  id: string;
  name: string;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  whtBp: number;
  defaultExpenseAccountId: string | null;
  isActive: boolean;
  /** A rider supply office and its commission on rider pay (basis points) */
  isRiderOffice: boolean;
  commissionBp: number;
  accountCode: string | null;
  owedPiastres: number;
  openBills: number;
  staff: { id: string; name: string }[];
}

export interface BillRow {
  id: string;
  number: number;
  numberLabel: string;
  supplier: { id: string; name: string };
  reference: string;
  billDate: string;
  dueDate: string;
  expenseAccount: Named;
  darkStore: StoreOrNone;
  netPiastres: number;
  vatPiastres: number;
  totalPiastres: number;
  whtBp: number;
  paidPiastres: number;
  leftPiastres: number;
  status: 'open' | 'paid' | 'cancelled';
  person: { id: string; name: string } | null;
  currency: string;
  foreignTotalCents: number | null;
  foreignLeftCents: number | null;
  fxRate: number | null;
  overdue: boolean;
  memo: string | null;
  /** A rider office's commission bill: the month it clears */
  officeMonth: string | null;
}

export const AGEING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'over_90'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];
export interface BillAgeing {
  asOf: string;
  rows: {
    supplier: { id: string; name: string };
    buckets: Record<AgeingBucket, number>;
    total: number;
  }[];
  total: { buckets: Record<AgeingBucket, number>; total: number };
}

export interface TaxesOwed {
  vatPiastres: number;
  whtPiastres: number;
  payrollTaxPiastres: number;
  socialInsurancePiastres: number;
  martyrsFundPiastres: number;
}

export interface WhtReport {
  year: number;
  quarter: number;
  from: string;
  to: string;
  rows: {
    supplierId: string;
    name: string;
    taxId: string | null;
    netPiastres: number;
    whtPiastres: number;
    payments: number;
  }[];
  totalWhtPiastres: number;
  missingTaxId: number;
}

export interface RecurringRow {
  id: string;
  name: string;
  amountPiastres: number;
  vatPiastres: number;
  dayOfMonth: number;
  startMonth: string;
  endMonth: string | null;
  isActive: boolean;
  darkStoreId: string | null;
  expenseAccount: Named | null;
  paidFrom: Named | null;
  createdBy: string;
  preparedThisMonth: boolean;
}

export interface PrepaymentRow {
  id: string;
  name: string;
  expenseAccount: Named;
  darkStore: StoreOrNone;
  totalPiastres: number;
  months: number;
  startMonth: string;
  monthlyPiastres: number;
  monthsCharged: number;
  chargedPiastres: number;
  leftPiastres: number;
}

export interface FixedAssetRow {
  id: string;
  name: string;
  darkStore: StoreOrNone;
  costPiastres: number;
  salvagePiastres: number;
  lifeMonths: number;
  startMonth: string;
  monthlyPiastres: number;
  monthsCharged: number;
  depreciatedPiastres: number;
  bookValuePiastres: number;
  disposedAt: string | null;
}

export interface ReceivableRow {
  merchantId: string;
  name: string;
  phone: string | null;
  owesPiastres: number;
  since: string | null;
  lastRequestedAt: string | null;
}

export interface BankStatementRow {
  id: string;
  number: number;
  account: Named;
  fileName: string;
  fromDay: string;
  toDay: string;
  lines: number;
  skipped: number;
  createdBy: string;
  createdAt: string;
}

export interface BankReconciliation {
  account: { id: string; code: string; nameEn: string | null; nameAr: string | null };
  day: string;
  bookBalancePiastres: number;
  bankBalancePiastres: number | null;
  bankBalanceDay: string | null;
  differencePiastres: number | null;
  matched: number;
  ignored: number;
  checkedSince: string | null;
  bankOnly: {
    id: string;
    statement: number;
    lineNo: number;
    day: string;
    description: string;
    reference: string | null;
    amountPiastres: number;
    balancePiastres: number | null;
  }[];
  booksOnly: {
    id: string;
    entryNumber: number;
    kind: string;
    memo: string | null;
    at: string;
    amountPiastres: number;
  }[];
}

export interface VatReport {
  year: number;
  months: {
    month: string;
    outputPiastres: number;
    inputPiastres: number;
    duePiastres: number;
    paidPiastres: number;
  }[];
  total: {
    outputPiastres: number;
    inputPiastres: number;
    duePiastres: number;
    paidPiastres: number;
  };
}

export interface BudgetReport {
  month: string;
  darkStoreId: string | null;
  rows: {
    accountId: string;
    code: string;
    category: 'revenue' | 'expense';
    nameEn: string;
    nameAr: string;
    budgetPiastres: number;
    actualPiastres: number;
    variancePiastres: number;
  }[];
  income: { budgetPiastres: number; actualPiastres: number };
  costs: { budgetPiastres: number; actualPiastres: number };
}

export interface BudgetCell {
  budgetPiastres: number;
  actualPiastres: number;
  /** Better than plan is positive */
  variancePiastres: number;
  /** Variance as a share of the budget, null without a budget */
  percentBp: number | null;
}

export interface BudgetMonthCell extends BudgetCell {
  month: string;
  quarter: number;
  /** Changed by hand after the quarter was split */
  manual: boolean;
}

export interface BudgetQuarterCell extends BudgetCell {
  quarter: number;
  edited: boolean;
  uneven: boolean;
}

export interface BudgetTotals {
  months: (BudgetCell & { month: string })[];
  quarters: (BudgetCell & { quarter: number })[];
  year: BudgetCell;
}

export interface BudgetYearReport {
  year: number;
  /** 'all', 'company' or a store id */
  scope: string;
  groupCode: number | null;
  groups: number[];
  rows: {
    accountId: string;
    code: string;
    groupCode: number;
    category: 'revenue' | 'expense';
    nameEn: string;
    nameAr: string;
    isActive: boolean;
    months: BudgetMonthCell[];
    quarters: BudgetQuarterCell[];
    year: BudgetCell;
  }[];
  income: BudgetTotals;
  costs: BudgetTotals;
  profit: BudgetTotals;
}

export interface CashFlowReport {
  from: string;
  to: string;
  openingPiastres: number;
  closingPiastres: number;
  sections: {
    section: 'operating' | 'investing' | 'financing';
    rows: { kind: string; inPiastres: number; outPiastres: number }[];
    netPiastres: number;
  }[];
}

export interface CashForecast {
  today: string;
  moneyPiastres: number;
  weeklyTradingPiastres: number;
  weeks: {
    from: string;
    to: string;
    openingPiastres: number;
    tradingPiastres: number;
    billsPiastres: number;
    recurringPiastres: number;
    salariesPiastres: number;
    taxesPiastres: number;
    closingPiastres: number;
  }[];
}

export interface YearStatus {
  year: number;
  over: boolean;
  closed: boolean;
  entryNumber: number | null;
}

export type EtaState = 'not_sent' | 'signed' | 'submitted' | 'valid' | 'invalid' | 'rejected';

export interface InvoiceRow {
  id: string;
  type: 'invoice' | 'credit_note' | 'debit_note';
  label: string;
  merchant: { id: string; name: string; legalName: string | null };
  periodMonth: string | null;
  issuedAt: string;
  original: string | null;
  reason: string | null;
  netPiastres: number;
  vatPiastres: number;
  totalPiastres: number;
  etaStatus: EtaState;
  etaUuid: string | null;
  etaLongId: string | null;
  etaError: unknown;
}

export interface InvoiceDetail extends InvoiceRow {
  receiver: { name: string; taxRegistrationNumber: string | null; address: string };
  lines: {
    id: string;
    lineNo: number;
    kind: string;
    descriptionEn: string;
    descriptionAr: string;
    quantity: number;
    netPiastres: number;
    vatPiastres: number;
  }[];
  creditNotes: { id: string; label: string; totalPiastres: number }[];
  /** DN-000001...: charges added after the invoice */
  debitNotes?: { id: string; label: string; totalPiastres: number }[];
  company: {
    legalNameEn: string;
    legalNameAr: string;
    taxRegistrationNumber: string;
    governorate: string;
    regionCity: string;
    street: string;
    buildingNumber: string;
  };
}

export interface EtaReadiness {
  ready: boolean;
  missing: string[];
  missingCodes: string[];
  connected: boolean;
  feeKinds: Record<string, { en: string; ar: string }>;
  counts: Partial<Record<EtaState, number>>;
}

export interface CompanyProfile {
  legalNameEn: string;
  legalNameAr: string;
  taxRegistrationNumber: string;
  activityCode: string;
  branchId: string;
  governorate: string;
  regionCity: string;
  street: string;
  buildingNumber: string;
  itemCodes: Record<string, string>;
  etaEnabled: boolean;
  hasSignerKey: boolean;
  signerKeyCreatedAt: string | null;
}

export interface MerchantTax {
  id: string;
  name: string;
  bankName: string | null;
  bankAccountNumber: string | null;
  iban: string | null;
  beneficiaryName: string | null;
  legalName: string | null;
  taxRegistrationNumber: string | null;
  taxGovernorate: string | null;
  taxRegionCity: string | null;
  taxStreet: string | null;
  taxBuildingNumber: string | null;
}

export interface VatReturn {
  month: string;
  salesPiastres: number;
  outputVatPiastres: number;
  creditNotesPiastres: number;
  creditNoteVatPiastres: number;
  /** Debit notes, already counted in sales and output VAT ("of which") */
  debitNotesPiastres?: number;
  debitNoteVatPiastres?: number;
  purchasesPiastres: number;
  inputVatPiastres: number;
  carriedInPiastres: number;
  duePiastres: number;
  carriedOutPiastres: number;
  paidSincePiastres: number;
}

export interface WithholdingRow {
  day: string;
  entryNumber: number;
  supplier: string;
  taxId: string;
  netPiastres: number;
  rateBp: number;
  whtPiastres: number;
  reference: string;
}

export interface PayrollForms {
  month: string;
  entryNumber: string | null;
  rows: (PayslipRun['people'][number] & {
    nationalId: string | null;
    insuranceNumber: string | null;
  })[];
  totals: {
    grossPiastres: number;
    incomeTaxPiastres: number;
    insuredWagesPiastres: number;
    siEmployeePiastres: number;
    siEmployerPiastres: number;
    martyrsPiastres: number;
  };
  missingIds: number;
}

export interface CorporateTax {
  year: number;
  profitBeforeTaxPiastres: number;
  rateBp: number;
  estimatePiastres: number;
  bookedPiastres: number;
}

interface PlReport {
  income: { code: string; nameEn: string; nameAr: string; amountPiastres: number }[];
  expenses: { code: string; nameEn: string; nameAr: string; amountPiastres: number }[];
  totalIncomePiastres: number;
  totalExpensesPiastres: number;
  profitPiastres: number;
}
interface BsRow {
  code: string;
  groupCode: number;
  nameEn: string;
  nameAr: string;
  amountPiastres: number;
  wallets?: number;
}
interface BsReport {
  assets: BsRow[];
  liabilities: BsRow[];
  equity: BsRow[];
  earningsPiastres: number;
  totalAssetsPiastres: number;
}
export interface ComparativeStatements {
  current: { from: string; to: string; pl: PlReport; bs: BsReport };
  previous: { from: string; to: string; pl: PlReport; bs: BsReport };
}

// ─── rider supply offices ──────────────────────────────────────────────────────

export interface RiderOfficeWallet {
  /** What we owe the office today, this month's commission included (negative: it owes us) */
  owedPiastres: number;
  openBills: number;
  openBillsPiastres: number;
  /** What the office owes us beyond its open bills, set off when paying them */
  owesUsPiastres: number;
  /** Commission earned and not billed yet (already part of owedPiastres) */
  unbilledPiastres: number;
}

export interface RiderOfficeRow extends RiderOfficeWallet {
  id: string;
  name: string;
  taxId: string | null;
  whtBp: number;
  commissionBp: number;
  isActive: boolean;
  riders: number;
  deliveries: number;
  riderPayPiastres: number;
  commissionPiastres: number;
  shortagesPiastres: number;
  bill: { id: string; number: number; status: string } | null;
}

export interface RiderOfficeList {
  month: string;
  rows: RiderOfficeRow[];
}

export interface RiderOfficeDetail {
  office: {
    id: string;
    name: string;
    taxId: string | null;
    phone: string | null;
    email: string | null;
    whtBp: number;
    commissionBp: number;
    isActive: boolean;
  };
  wallet: RiderOfficeWallet;
  riders: {
    employeeId: string;
    userId: string;
    riderId: string;
    name: string;
    nameAr: string | null;
    badgeCode: string;
    status: string;
    darkStore: { id: string; code: string; nameEn: string; nameAr: string | null };
    deliveriesThisMonth: number;
    commissionThisMonthPiastres: number;
    owesPiastres: number;
    walletPiastres: number;
  }[];
  months: {
    month: string;
    over: boolean;
    deliveries: number;
    riderPayPiastres: number;
    commissionPiastres: number;
    shortagesPiastres: number;
    bill: { id: string; number: number; status: string } | null;
  }[];
  bills: {
    id: string;
    number: number;
    reference: string;
    officeMonth: string | null;
    billDate: string;
    netPiastres: number;
    vatPiastres: number;
    totalPiastres: number;
    paidPiastres: number;
    leftPiastres: number;
    status: 'open' | 'paid' | 'cancelled';
  }[];
}

export interface OfficeAccountDay {
  day: string;
  deliveries: number;
  commissionPiastres: number;
  shortagesPiastres: number;
  billedPiastres: number;
  paymentsPiastres: number;
  otherPiastres: number;
  /** What we owe the office at the end of the day (negative: what it owes us) */
  balancePiastres: number;
}

/** The office's account day by day for a month (GET /finance/rider-offices/:id/account). */
export interface RiderOfficeAccount {
  office: { id: string; name: string };
  month: string;
  openingPiastres: number;
  closingPiastres: number;
  days: OfficeAccountDay[];
  totals: Omit<OfficeAccountDay, 'day' | 'balancePiastres'>;
}

export interface OfficeBillResult {
  supplierId: string;
  name: string;
  month: string;
  status: 'billed' | 'already_billed' | 'nothing_to_bill' | 'refused';
  error?: string;
  billId?: string;
  billLabel: string | null;
  commissionPiastres: number;
  vatPiastres: number;
  totalPiastres: number;
  shortagesPiastres: number;
}
