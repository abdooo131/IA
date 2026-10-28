import type { DayHours } from '@shiplynow/shared';

// Shapes returned by the /admin API endpoints.

export interface AdminStore {
  id: string;
  kind: 'dark_store' | 'hub';
  code: string;
  nameEn: string;
  nameAr: string;
  addressEn: string;
  addressAr: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
  hours: DayHours[];
  zoneCount: number;
  skusInStock: number;
  unitsOnHand: number;
  unitsReserved: number;
  openNow: boolean;
  nextOpenAt: string | null;
  ordersLastHour: number;
  capacityPerHour: number;
  atCapacity: boolean;
}

export interface AdminSku {
  id: string;
  sku: string;
  barcode: string | null;
  titleEn: string;
  titleAr: string;
  pricePiastres: number;
  weightGrams: number | null;
  isActive: boolean;
  shopifyVariantId: string | null;
  merchant: { id: string; name: string };
  unitsOnHand: number;
  unitsReserved: number;
}

export interface AdminStockRow {
  darkStore: { id: string; code: string; nameEn: string; nameAr: string };
  sku: { id: string; sku: string; titleEn: string; titleAr: string };
  onHand: number;
  reserved: number;
  available: number;
  lowStock: boolean;
}

export interface AdminZone {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  darkStoreId: string;
  area: { type: 'MultiPolygon'; coordinates: number[][][][] } | null;
  center: [number, number] | null;
}

/** Picks the Arabic or English field of a bilingual record. */
export function localized<T extends { nameEn: string; nameAr: string }>(item: T, locale: string) {
  return locale === 'ar' ? item.nameAr : item.nameEn;
}
