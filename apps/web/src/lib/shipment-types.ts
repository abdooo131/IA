export interface ShipmentDetail {
  id: string;
  reference: string;
  status: 'expected' | 'receiving' | 'received' | 'cancelled';
  note: string | null;
  expectedAt: string | null;
  createdAt: string;
  receivedAt: string | null;
  merchant: { id: string; name: string };
  darkStore: { id: string; code: string; nameEn: string; nameAr: string };
  createdBy: { name: string; email: string } | null;
  timeline: {
    at: string;
    event: 'created' | 'receiving_started' | 'received' | 'cancelled';
    by: string | null;
  }[];
  lines: {
    skuId: string;
    sku: string;
    barcode: string | null;
    titleEn: string;
    titleAr: string;
    expectedQty: number;
    receivedQty: number;
  }[];
  scans: {
    at: string;
    by: string | null;
    sku: string;
    titleEn: string;
    titleAr: string;
    quantity: number;
    bin: string;
  }[];
}
