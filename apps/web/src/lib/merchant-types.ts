export interface MerchantShipment {
  id: string;
  reference: string;
  status: 'expected' | 'receiving' | 'received' | 'cancelled';
  note: string | null;
  expectedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  darkStore: { code: string; nameEn: string; nameAr: string };
  lines: {
    sku: string;
    titleEn: string;
    titleAr: string;
    expectedQty: number;
    receivedQty: number;
  }[];
}

export interface MerchantSku {
  id: string;
  sku: string;
  titleEn: string;
  titleAr: string;
  stock: {
    darkStore: { code: string; nameEn: string; nameAr: string };
    onHand: number;
    reserved: number;
  }[];
}

export interface MerchantNotification {
  id: string;
  type: 'manifest_received' | 'stock_count_adjusted';
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}
