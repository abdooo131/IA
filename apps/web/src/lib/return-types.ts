export type ReturnStatus = 'requested' | 'picking' | 'ready' | 'collected' | 'cancelled';
export type StockSource = 'sellable' | 'damaged' | 'held';

interface StoreRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface ReturnListItem {
  id: string;
  reference: string;
  status: ReturnStatus;
  merchant: { id: string; name: string };
  darkStore: StoreRef;
  units: number;
  pickedUnits: number;
  createdAt: string;
  collectedAt: string | null;
}

export interface ReturnDetail {
  id: string;
  reference: string;
  status: ReturnStatus;
  note: string | null;
  merchant: { id: string; name: string };
  darkStore: StoreRef;
  createdAt: string;
  readyAt: string | null;
  collectedAt: string | null;
  collectedBy: string | null;
  handedOverBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: {
    skuId: string;
    sku: string;
    barcode: string | null;
    titleEn: string;
    titleAr: string;
    source: StockSource;
    quantity: number;
    pickedQty: number;
    bins: { code: string; quantity: number }[];
  }[];
}

export interface ReturnableRow {
  skuId: string;
  sku: string;
  titleEn: string;
  titleAr: string;
  sellable: number;
  damaged: number;
  held: number;
}
