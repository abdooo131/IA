export type TransferStatus =
  'draft' | 'approved' | 'picking' | 'in_transit' | 'received' | 'cancelled';

export interface LocationRef {
  id: string;
  kind: 'dark_store' | 'hub';
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface TransferListItem {
  id: string;
  reference: string;
  status: TransferStatus;
  origin: 'manual' | 'refill';
  from: LocationRef;
  to: LocationRef;
  finalDestination: LocationRef | null;
  onward: boolean;
  units: number;
  pickedUnits: number;
  receivedUnits: number;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
}

export interface TransferDetail {
  id: string;
  reference: string;
  status: TransferStatus;
  origin: 'manual' | 'refill';
  note: string | null;
  from: LocationRef;
  to: LocationRef;
  finalDestination: LocationRef | null;
  previous: { id: string; reference: string } | null;
  next: { id: string; reference: string }[];
  createdBy: string | null;
  approvedBy: string | null;
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  lines: {
    skuId: string;
    sku: string;
    barcode: string | null;
    titleEn: string;
    titleAr: string;
    merchant: string;
    quantity: number;
    pickedQty: number;
    receivedQty: number;
    bins: { code: string; type: string; quantity: number }[];
  }[];
}
