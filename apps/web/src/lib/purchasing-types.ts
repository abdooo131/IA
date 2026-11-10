// Emails to merchants, packaging stock and purchase orders, as the API answers them.

export type EmailStatus = 'pending' | 'sent' | 'failed';
export type EmailKind = 'statement' | 'payout_paid' | 'invoice' | 'payment_reminder';

export interface EmailRow {
  id: string;
  kind: EmailKind;
  merchant: { id: string; name: string } | null;
  toEmails: string[];
  language: 'en' | 'ar';
  subject: string;
  status: EmailStatus;
  attempts: number;
  nextAttemptAt: string;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string;
  attachments: string[];
}

export interface EmailOutboxPage {
  configured: boolean;
  counts: Partial<Record<EmailStatus, number>>;
  rows: EmailRow[];
}

export interface MerchantEmailSettings {
  configured?: boolean;
  billingEmails: string[];
  contactEmail: string | null;
  language: 'en' | 'ar';
  optOuts: EmailKind[];
}

export interface PackagingItem {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  unit: string;
  unitCostPiastres: number;
  isBox: boolean;
  isActive: boolean;
}

export interface NamedStore {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface PackagingStockRow {
  store: NamedStore;
  item: { id: string; code: string; nameEn: string; nameAr: string; unit: string };
  onHand: number;
  valuePiastres: number;
  averageCostPiastres: number | null;
  low: boolean;
  limit: number;
}

export interface PackagingStock {
  rows: PackagingStockRow[];
  totalValuePiastres: number;
}

export interface PackagingRecipe {
  darkStoreId: string | null;
  merchantId: string | null;
  lines: { itemId: string; code: string; nameEn: string; nameAr: string; quantity: number }[];
}

export interface PackagingMovementRow {
  id: string;
  darkStoreId: string;
  type: 'receive' | 'consume' | 'adjust' | 'count';
  quantity: number;
  valuePiastres: number;
  orderId: string | null;
  reason: string | null;
  createdAt: string;
  item: { code: string; nameEn: string; nameAr: string };
}

export type PurchaseOrderStatus =
  | 'requested'
  | 'approved'
  | 'ordered'
  | 'received'
  | 'billed'
  | 'closed'
  | 'rejected'
  | 'cancelled';

export interface PurchaseOrderRow {
  id: string;
  number: number;
  label: string;
  supplier: { id: string; name: string };
  darkStore: NamedStore | null;
  status: PurchaseOrderStatus;
  totalPiastres: number;
  requestedBy: { id: string; name: string };
  createdAt: string;
  partlyReceived: boolean;
  receivedShare: number;
}

export interface PurchaseOrderLine {
  id: string;
  lineNo: number;
  description: string;
  quantity: number;
  unitPricePiastres: number;
  receivedQty: number;
  billedQty: number;
  packagingItem: { id: string; code: string; nameEn: string; nameAr: string } | null;
  expenseAccount: { id: string; code: string; nameEn: string; nameAr: string } | null;
}

export interface PurchaseOrderDetail {
  id: string;
  number: number;
  label: string;
  status: PurchaseOrderStatus;
  supplier: { id: string; name: string; whtBp: number };
  darkStore: NamedStore | null;
  totalPiastres: number;
  note: string | null;
  quotePhotoId: string | null;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  orderedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  lines: PurchaseOrderLine[];
  bills: {
    id: string;
    numberLabel: string;
    reference: string;
    netPiastres: number;
    vatPiastres: number;
    totalPiastres: number;
    paidPiastres: number;
    status: 'open' | 'paid' | 'cancelled';
    billDate: string;
  }[];
  receipts: { id: string; valuePiastres: number; createdAt: string }[];
  unbilledPiastres: number;
  maxBillPiastres: number;
  toleranceBp: number;
}
