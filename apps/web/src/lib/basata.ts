// Basata cash deposits (owner, 2026-11-11): what the API answers for the rider app and
// Accounting's screens.

type StoreRef = { id: string; code: string; nameEn: string; nameAr: string };

export type BasataDepositStatus = 'pending' | 'approved' | 'rejected';
export type FreezeReason = 'deposit_deadline' | 'deposit_rejected';

export interface BasataDeposit {
  id: string;
  number: string;
  status: BasataDepositStatus;
  rider: { id: string; name: string; badgeCode: string; userId: string };
  store: StoreRef;
  amountPiastres: number;
  reference: string;
  depositedAt: string;
  photoId: string;
  deadlineDay: string;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  heldPiastres: number | null;
  givenBackPiastres: number;
  settlement: { id: string; number: string; receivedOn: string } | null;
  createdAt: string;
}

/** GET /rider/basata */
export interface RiderBasataView {
  enabled: boolean;
  deadline: { hour: number; at: string } | null;
  toHandInPiastres: number;
  deductedPiastres: number;
  maxPiastres: number;
  pendingPiastres: number;
  deposits: BasataDeposit[];
  frozen: { at: string; reason: FreezeReason | null } | null;
}

/** GET /finance/basata/deposits/:id */
export interface BasataDepositDetail {
  deposit: BasataDeposit;
  rider: {
    frozen: boolean;
    cashHeldPiastres: number;
    deductedPiastres: number;
    office: { id: string; name: string } | null;
  };
}

export interface BasataSettlement {
  id: string;
  number: string;
  receivedOn: string;
  amountPiastres: number;
  depositsPiastres: number;
  feePiastres: number;
  reference: string | null;
  bank: { id: string; code: string; nameEn: string | null; nameAr: string | null };
  entry: { id: string; number: number };
  createdBy: string;
  deposits: number;
  createdAt: string;
}

/** GET /finance/basata/settlements/new */
export interface BasataSettlementForm {
  deposits: BasataDeposit[];
  totalPiastres: number;
  banks: { id: string; code: string; nameEn: string; nameAr: string }[];
  recent: BasataSettlement[];
}

/** GET /finance/frozen-riders */
export interface FrozenRider {
  riderId: string;
  name: string;
  badgeCode: string;
  store: StoreRef;
  frozenAt: string;
  reason: FreezeReason;
  cashPiastres: number;
  deductedPiastres: number;
  pendingPiastres: number;
  office: { id: string; name: string } | null;
}

/** GET /finance/frozen-riders/:riderId */
export interface RiderFreezeState {
  frozen: boolean;
  frozenAt: string | null;
  reason: FreezeReason | null;
  history: {
    id: string;
    reason: FreezeReason;
    day: string | null;
    amountPiastres: number;
    frozenAt: string;
    unfrozenAt: string | null;
    unfrozenBy: string | null;
    unfreezeReason: string | null;
  }[];
}
