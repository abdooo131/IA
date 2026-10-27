export type DamageCause =
  'arrived_damaged' | 'store_handling' | 'delivery' | 'customer' | 'expired';

export interface DamageReportRow {
  id: string;
  status: 'pending' | 'settled';
  cause: DamageCause;
  note: string | null;
  quantity: number;
  sku: string;
  titleEn: string;
  titleAr: string;
  valuePiastres: number;
  merchant: { id: string; name: string };
  darkStore: { id: string; code: string; nameEn: string; nameAr: string };
  rider: { badgeCode: string; name: string } | null;
  reportedBy: string;
  settledBy: string | null;
  settledAt: string | null;
  settleNote: string | null;
  compensationPiastres: number;
  riderChargePiastres: number;
  createdAt: string;
}

/** Causes for which the company pays the merchant (same rule as the API). */
export const COMPANY_CAUSES: DamageCause[] = ['store_handling', 'delivery'];
