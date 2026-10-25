export interface StoreRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface StoreSummary {
  store: StoreRef;
  openManifests: number;
  unitsToPutAway: number;
  pendingCounts: number;
}

export interface ManifestListItem {
  id: string;
  reference: string;
  status: 'expected' | 'receiving';
  expectedAt: string | null;
  merchant: { id: string; name: string };
  expectedUnits: number;
  receivedUnits: number;
}

export interface ManifestDetail {
  id: string;
  reference: string;
  status: 'expected' | 'receiving' | 'received' | 'cancelled';
  note: string | null;
  expectedAt: string | null;
  merchant: { id: string; name: string };
  lines: {
    skuId: string;
    sku: string;
    barcode: string | null;
    titleEn: string;
    titleAr: string;
    expectedQty: number;
    receivedQty: number;
  }[];
}

export interface BinWithItems {
  id: string;
  code: string;
  type: 'receiving' | 'pickable' | 'damaged' | 'held';
  items: {
    skuId: string;
    sku: string;
    barcode: string | null;
    titleEn: string;
    titleAr: string;
    quantity: number;
  }[];
}

export function title(item: { titleEn: string; titleAr: string }, locale: string) {
  return locale === 'ar' ? item.titleAr : item.titleEn;
}
