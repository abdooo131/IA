import type { MonthEndItem, PayoutScheduleName, PettyCashStatus } from '@shiplynow/shared';

// Answers of the cash control routes (rider cash, petty cash, cash position, month end).

interface StoreRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface CashPosition {
  asOf: string;
  today: string;
  scope: 'all' | 'stores';
  warnHours: number;
  money: {
    rows: {
      id: string;
      code: string;
      nameEn: string;
      nameAr: string;
      kind: 'bank' | 'cash_box' | 'store_box' | 'basata';
      darkStoreId: string | null;
      balancePiastres: number;
      /** A bank held in another currency: its currency and balance in its cents */
      currency?: string;
      foreignBalanceCents?: number | null;
    }[];
    bankPiastres: number;
    boxPiastres: number;
    totalPiastres: number;
  };
  /** Basata deposits: approved and on their way to the bank, and still waiting for review */
  basata?: {
    atBasataPiastres: number;
    atBasataCount: number;
    waitingPiastres: number;
    waitingCount: number;
  };
  riders: {
    rows: {
      riderId: string;
      name: string;
      badgeCode: string;
      store: StoreRef;
      cashPiastres: number;
      freshPiastres: number;
      agingPiastres: number;
      overduePiastres: number;
      heldSince: string;
      maxHours: number;
    }[];
    totalPiastres: number;
    freshPiastres: number;
    agingPiastres: number;
    overduePiastres: number;
  };
  merchants: {
    rows: {
      id: string;
      name: string;
      owedPiastres: number;
      schedule: PayoutScheduleName;
      nextPayoutDay: string;
      draftPiastres: number;
    }[];
    totalPiastres: number;
    owingUsPiastres: number;
  } | null;
  bills: {
    rows: {
      id: string;
      number: number;
      supplier: string;
      reference: string;
      dueDate: string;
      overdue: boolean;
      leftPiastres: number;
    }[];
    totalPiastres: number;
  } | null;
  netPiastres: number | null;
}

export interface PettyCashRow {
  id: string;
  number: number;
  label: string;
  store: StoreRef;
  category: { code: string; nameEn: string | null; nameAr: string | null };
  amountPiastres: number;
  note: string;
  photoId: string;
  status: PettyCashStatus;
  createdAt: string;
  by: string;
  entryNumber: number | null;
  requestId: string | null;
  decisionNote: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
  reverseReason: string | null;
  reversalNumber: number | null;
}

export interface PettyCategory {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  petty: boolean;
}

export interface StorePettyCash {
  categories: Omit<PettyCategory, 'petty'>[];
  boxPiastres: number;
  limitPiastres: number;
  floatPiastres: number;
  recent: PettyCashRow[];
  /** Active cost tags (a campaign, a project) an expense may carry */
  costTags?: { id: string; nameEn: string; nameAr: string }[];
}

export interface MonthEndChecklist {
  month: string;
  lastDay: string;
  over: boolean;
  closedThrough: string | null;
  readyToClose: boolean;
  items: {
    id: MonthEndItem;
    automatic: boolean;
    left: number;
    notYet: boolean;
    done: boolean;
    mark: { note: string; by: string; at: string } | null;
  }[];
}

export interface StoreRiderCashRow {
  id: string;
  name: string;
  badgeCode: string;
  cashPiastres: number;
  heldSince: string | null;
  overdue: boolean;
  outNow: number;
}
