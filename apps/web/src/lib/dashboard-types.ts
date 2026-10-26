export interface KpiTotals {
  orders: number;
  delivered: number;
  onTime: number;
  onTimeRate: number | null;
  avgDeliveryMinutes: number | null;
  medianDeliveryMinutes: number | null;
  stageAvgMinutes: Record<'accept' | 'pick' | 'pack' | 'handover' | 'ride', number | null>;
  late: number;
  cancelled: number;
  failed: number;
  movedToStandard: number;
  active: number;
  unitsDelivered: number;
  unitsMissing: number;
  deliveredValuePiastres: number;
  deliveryFeesPiastres: number;
  codExpectedPiastres: number;
  codCollectedPiastres: number;
}

export interface Kpis {
  from: string;
  to: string;
  totals: KpiTotals;
  byStatus: Record<string, number>;
  perStore: (KpiTotals & {
    darkStore: { id: string; code: string; nameEn: string; nameAr: string };
  })[];
  perMerchant: (KpiTotals & { merchant: { id: string; name: string } })[];
  perDay: { date: string; orders: number; delivered: number; onTime: number }[];
}

export interface LiveStore {
  darkStore: { id: string; code: string; nameEn: string; nameAr: string };
  active: number;
  byStatus: Record<string, number>;
  late: number;
  pastPromise: number;
  riders: number;
  ridersOut: number;
  openAlerts: number;
}

export interface SettingRow {
  key: string;
  description: string;
  default: number;
  global: number | null;
  globalUpdatedAt: string | null;
  globalUpdatedBy: string | null;
  /** Which per scope value is allowed: per store, per merchant, or none */
  override: 'store' | 'merchant' | 'none';
  overrides: {
    scope: string;
    darkStoreId: string | null;
    merchantId: string | null;
    value: number | null;
    updatedAt: string;
    updatedBy: string | null;
  }[];
}

export interface SettingsList {
  stores: { id: string; code: string; nameEn: string; nameAr: string }[];
  merchants: { id: string; name: string }[];
  settings: SettingRow[];
}
