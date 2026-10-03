import type { PricingZone } from './statuses';

export interface GovernorateSeed {
  code: string;
  nameEn: string;
  nameAr: string;
  defaultZone: PricingZone;
  lat: number;
  lng: number;
}

/** All 27 Egyptian governorates. This is seed data only; the database is the source of truth. */
export const GOVERNORATES: GovernorateSeed[] = [
  { code: 'CAI', nameEn: 'Cairo', nameAr: 'القاهرة', defaultZone: 'CAIRO_GIZA', lat: 30.0444, lng: 31.2357 },
  { code: 'GIZ', nameEn: 'Giza', nameAr: 'الجيزة', defaultZone: 'CAIRO_GIZA', lat: 30.0131, lng: 31.2089 },
  { code: 'ALX', nameEn: 'Alexandria', nameAr: 'الإسكندرية', defaultZone: 'ALEX_BEHIRA', lat: 31.2001, lng: 29.9187 },
  { code: 'BEH', nameEn: 'Beheira', nameAr: 'البحيرة', defaultZone: 'ALEX_BEHIRA', lat: 31.0341, lng: 30.4682 },
  { code: 'QLY', nameEn: 'Qalyubia', nameAr: 'القليوبية', defaultZone: 'DELTA_CANAL', lat: 30.4106, lng: 31.1063 },
  { code: 'DAK', nameEn: 'Dakahlia', nameAr: 'الدقهلية', defaultZone: 'DELTA_CANAL', lat: 31.0409, lng: 31.3785 },
  { code: 'SHR', nameEn: 'Sharqia', nameAr: 'الشرقية', defaultZone: 'DELTA_CANAL', lat: 30.5877, lng: 31.502 },
  { code: 'GHR', nameEn: 'Gharbia', nameAr: 'الغربية', defaultZone: 'DELTA_CANAL', lat: 30.7865, lng: 31.0004 },
  { code: 'MNF', nameEn: 'Monufia', nameAr: 'المنوفية', defaultZone: 'DELTA_CANAL', lat: 30.5972, lng: 30.9876 },
  { code: 'KFS', nameEn: 'Kafr El Sheikh', nameAr: 'كفر الشيخ', defaultZone: 'DELTA_CANAL', lat: 31.1107, lng: 30.9388 },
  { code: 'DAM', nameEn: 'Damietta', nameAr: 'دمياط', defaultZone: 'DELTA_CANAL', lat: 31.4165, lng: 31.8133 },
  { code: 'PTS', nameEn: 'Port Said', nameAr: 'بورسعيد', defaultZone: 'DELTA_CANAL', lat: 31.2653, lng: 32.3019 },
  { code: 'ISM', nameEn: 'Ismailia', nameAr: 'الإسماعيلية', defaultZone: 'DELTA_CANAL', lat: 30.5965, lng: 32.2715 },
  { code: 'SUZ', nameEn: 'Suez', nameAr: 'السويس', defaultZone: 'DELTA_CANAL', lat: 29.9668, lng: 32.5498 },
  { code: 'FYM', nameEn: 'Faiyum', nameAr: 'الفيوم', defaultZone: 'NEAR_UPPER_EGYPT', lat: 29.3084, lng: 30.8428 },
  { code: 'BNS', nameEn: 'Beni Suef', nameAr: 'بني سويف', defaultZone: 'NEAR_UPPER_EGYPT', lat: 29.0661, lng: 31.0994 },
  { code: 'MNY', nameEn: 'Minya', nameAr: 'المنيا', defaultZone: 'NEAR_UPPER_EGYPT', lat: 28.0871, lng: 30.7618 },
  { code: 'AST', nameEn: 'Asyut', nameAr: 'أسيوط', defaultZone: 'NEAR_UPPER_EGYPT', lat: 27.1783, lng: 31.1859 },
  { code: 'SHG', nameEn: 'Sohag', nameAr: 'سوهاج', defaultZone: 'FAR_UPPER_MATROUH', lat: 26.5591, lng: 31.6957 },
  { code: 'QNA', nameEn: 'Qena', nameAr: 'قنا', defaultZone: 'FAR_UPPER_MATROUH', lat: 26.1551, lng: 32.716 },
  { code: 'LXR', nameEn: 'Luxor', nameAr: 'الأقصر', defaultZone: 'FAR_UPPER_MATROUH', lat: 25.6872, lng: 32.6396 },
  { code: 'ASN', nameEn: 'Aswan', nameAr: 'أسوان', defaultZone: 'FAR_UPPER_MATROUH', lat: 24.0889, lng: 32.8998 },
  { code: 'RSE', nameEn: 'Red Sea', nameAr: 'البحر الأحمر', defaultZone: 'FAR_UPPER_MATROUH', lat: 27.2579, lng: 33.8116 },
  { code: 'MTR', nameEn: 'Matrouh', nameAr: 'مطروح', defaultZone: 'FAR_UPPER_MATROUH', lat: 31.3543, lng: 27.2373 },
  { code: 'NSN', nameEn: 'North Sinai', nameAr: 'شمال سيناء', defaultZone: 'SINAI_NEW_VALLEY', lat: 31.1316, lng: 33.7984 },
  { code: 'SSN', nameEn: 'South Sinai', nameAr: 'جنوب سيناء', defaultZone: 'SINAI_NEW_VALLEY', lat: 28.2377, lng: 33.6176 },
  { code: 'NWV', nameEn: 'New Valley', nameAr: 'الوادي الجديد', defaultZone: 'SINAI_NEW_VALLEY', lat: 25.4519, lng: 30.5464 },
];
