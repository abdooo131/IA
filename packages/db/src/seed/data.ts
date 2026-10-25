import type { ZoneGeometry } from '../zones';

/** All 27 governorates with their ISO 3166-2 codes. */
export const GOVERNORATES: { id: number; code: string; nameEn: string; nameAr: string }[] = [
  { id: 1, code: 'EG-C', nameEn: 'Cairo', nameAr: 'القاهرة' },
  { id: 2, code: 'EG-GZ', nameEn: 'Giza', nameAr: 'الجيزة' },
  { id: 3, code: 'EG-ALX', nameEn: 'Alexandria', nameAr: 'الإسكندرية' },
  { id: 4, code: 'EG-KB', nameEn: 'Qalyubia', nameAr: 'القليوبية' },
  { id: 5, code: 'EG-PTS', nameEn: 'Port Said', nameAr: 'بورسعيد' },
  { id: 6, code: 'EG-SUZ', nameEn: 'Suez', nameAr: 'السويس' },
  { id: 7, code: 'EG-DK', nameEn: 'Dakahlia', nameAr: 'الدقهلية' },
  { id: 8, code: 'EG-SHR', nameEn: 'Sharqia', nameAr: 'الشرقية' },
  { id: 9, code: 'EG-GH', nameEn: 'Gharbia', nameAr: 'الغربية' },
  { id: 10, code: 'EG-MNF', nameEn: 'Monufia', nameAr: 'المنوفية' },
  { id: 11, code: 'EG-BH', nameEn: 'Beheira', nameAr: 'البحيرة' },
  { id: 12, code: 'EG-KFS', nameEn: 'Kafr El Sheikh', nameAr: 'كفر الشيخ' },
  { id: 13, code: 'EG-DT', nameEn: 'Damietta', nameAr: 'دمياط' },
  { id: 14, code: 'EG-IS', nameEn: 'Ismailia', nameAr: 'الإسماعيلية' },
  { id: 15, code: 'EG-FYM', nameEn: 'Faiyum', nameAr: 'الفيوم' },
  { id: 16, code: 'EG-BNS', nameEn: 'Beni Suef', nameAr: 'بني سويف' },
  { id: 17, code: 'EG-MN', nameEn: 'Minya', nameAr: 'المنيا' },
  { id: 18, code: 'EG-AST', nameEn: 'Asyut', nameAr: 'أسيوط' },
  { id: 19, code: 'EG-SHG', nameEn: 'Sohag', nameAr: 'سوهاج' },
  { id: 20, code: 'EG-KN', nameEn: 'Qena', nameAr: 'قنا' },
  { id: 21, code: 'EG-LX', nameEn: 'Luxor', nameAr: 'الأقصر' },
  { id: 22, code: 'EG-ASN', nameEn: 'Aswan', nameAr: 'أسوان' },
  { id: 23, code: 'EG-BA', nameEn: 'Red Sea', nameAr: 'البحر الأحمر' },
  { id: 24, code: 'EG-WAD', nameEn: 'New Valley', nameAr: 'الوادي الجديد' },
  { id: 25, code: 'EG-MT', nameEn: 'Matrouh', nameAr: 'مطروح' },
  { id: 26, code: 'EG-SIN', nameEn: 'North Sinai', nameAr: 'شمال سيناء' },
  { id: 27, code: 'EG-JS', nameEn: 'South Sinai', nameAr: 'جنوب سيناء' },
];

const CAIRO = 1;

export interface StoreSeed {
  code: string;
  nameEn: string;
  nameAr: string;
  addressEn: string;
  addressAr: string;
  latitude: number;
  longitude: number;
  zones: { code: string; nameEn: string; nameAr: string; area: ZoneGeometry }[];
}

/**
 * Sample stores and zones. The polygons are rough outlines for testing, not the real
 * delivery boundaries; replace them from the admin map in Step 3.
 */
export const STORES: StoreSeed[] = [
  {
    code: 'NCR',
    nameEn: 'New Cairo',
    nameAr: 'القاهرة الجديدة',
    addressEn: 'South 90th Street, Fifth Settlement, New Cairo',
    addressAr: 'شارع التسعين الجنوبي، التجمع الخامس، القاهرة الجديدة',
    latitude: 30.0285,
    longitude: 31.47,
    zones: [
      {
        code: 'NCR-5S',
        nameEn: 'Fifth Settlement',
        nameAr: 'التجمع الخامس',
        area: {
          type: 'Polygon',
          coordinates: [
            [
              [31.4, 30.0],
              [31.52, 30.0],
              [31.52, 30.06],
              [31.4, 30.06],
              [31.4, 30.0],
            ],
          ],
        },
      },
    ],
  },
  {
    code: 'MAA',
    nameEn: 'Maadi',
    nameAr: 'المعادي',
    addressEn: 'Road 9, Maadi',
    addressAr: 'شارع 9، المعادي',
    latitude: 29.96,
    longitude: 31.257,
    zones: [
      {
        code: 'MAA-ALL',
        nameEn: 'Maadi',
        nameAr: 'المعادي',
        area: {
          type: 'Polygon',
          coordinates: [
            [
              [31.24, 29.94],
              [31.3, 29.94],
              [31.3, 29.99],
              [31.24, 29.99],
              [31.24, 29.94],
            ],
          ],
        },
      },
    ],
  },
  {
    code: 'ZAM',
    nameEn: 'Zamalek',
    nameAr: 'الزمالك',
    addressEn: '26th of July Street, Zamalek',
    addressAr: 'شارع 26 يوليو، الزمالك',
    latitude: 30.061,
    longitude: 31.22,
    zones: [
      {
        code: 'ZAM-ALL',
        nameEn: 'Zamalek',
        nameAr: 'الزمالك',
        area: {
          type: 'Polygon',
          coordinates: [
            [
              [31.212, 30.045],
              [31.228, 30.045],
              [31.226, 30.075],
              [31.215, 30.075],
              [31.212, 30.045],
            ],
          ],
        },
      },
    ],
  },
];

export const STORE_GOVERNORATE_ID = CAIRO;

/** Default opening hours for the sample stores: every day, 10:00 until midnight. */
export const DEFAULT_HOURS = { opensMinute: 10 * 60, closesMinute: 24 * 60 };

export const BINS: { code: string; type: 'receiving' | 'pickable' | 'damaged' | 'held' }[] = [
  { code: 'RCV-01', type: 'receiving' },
  { code: 'A-01', type: 'pickable' },
  { code: 'A-02', type: 'pickable' },
  { code: 'A-03', type: 'pickable' },
  { code: 'A-04', type: 'pickable' },
  { code: 'DMG-01', type: 'damaged' },
  { code: 'HLD-01', type: 'held' },
];

export const MERCHANT = {
  name: 'Eve Chantelle',
  contactEmail: 'ops@evechantelle.example',
};

/** 20 sample SKUs. Prices are integer piastres. Shopify ids are filled in Step 5. */
export const SKUS: {
  sku: string;
  titleEn: string;
  titleAr: string;
  pricePiastres: number;
  weightGrams: number;
}[] = [
  {
    sku: 'EC-001',
    titleEn: 'Rose Body Mist 100 ml',
    titleAr: 'بخاخ جسم بالورد 100 مل',
    pricePiastres: 32500,
    weightGrams: 180,
  },
  {
    sku: 'EC-002',
    titleEn: 'Vanilla Body Mist 100 ml',
    titleAr: 'بخاخ جسم بالفانيليا 100 مل',
    pricePiastres: 32500,
    weightGrams: 180,
  },
  {
    sku: 'EC-003',
    titleEn: 'Oud Eau de Parfum 50 ml',
    titleAr: 'عطر عود 50 مل',
    pricePiastres: 89900,
    weightGrams: 220,
  },
  {
    sku: 'EC-004',
    titleEn: 'Musk Eau de Parfum 50 ml',
    titleAr: 'عطر مسك 50 مل',
    pricePiastres: 84900,
    weightGrams: 220,
  },
  {
    sku: 'EC-005',
    titleEn: 'Shea Hand Cream 75 ml',
    titleAr: 'كريم إيدين بزبدة الشيا 75 مل',
    pricePiastres: 18500,
    weightGrams: 100,
  },
  {
    sku: 'EC-006',
    titleEn: 'Argan Hair Oil 100 ml',
    titleAr: 'زيت شعر بالأرجان 100 مل',
    pricePiastres: 27500,
    weightGrams: 160,
  },
  {
    sku: 'EC-007',
    titleEn: 'Coconut Body Lotion 250 ml',
    titleAr: 'لوشن جسم بجوز الهند 250 مل',
    pricePiastres: 24900,
    weightGrams: 300,
  },
  {
    sku: 'EC-008',
    titleEn: 'Lavender Shower Gel 300 ml',
    titleAr: 'شاور جل باللافندر 300 مل',
    pricePiastres: 19900,
    weightGrams: 340,
  },
  {
    sku: 'EC-009',
    titleEn: 'Matte Lipstick Ruby',
    titleAr: 'روج مات روبي',
    pricePiastres: 22500,
    weightGrams: 30,
  },
  {
    sku: 'EC-010',
    titleEn: 'Matte Lipstick Nude',
    titleAr: 'روج مات نود',
    pricePiastres: 22500,
    weightGrams: 30,
  },
  {
    sku: 'EC-011',
    titleEn: 'Volume Mascara Black',
    titleAr: 'ماسكرا كثافة سودا',
    pricePiastres: 29900,
    weightGrams: 40,
  },
  {
    sku: 'EC-012',
    titleEn: 'Liquid Eyeliner Black',
    titleAr: 'آيلاينر سايل أسود',
    pricePiastres: 17500,
    weightGrams: 25,
  },
  {
    sku: 'EC-013',
    titleEn: 'Cushion Foundation 02',
    titleAr: 'كريم أساس كوشن 02',
    pricePiastres: 54900,
    weightGrams: 90,
  },
  {
    sku: 'EC-014',
    titleEn: 'Translucent Setting Powder',
    titleAr: 'بودرة تثبيت شفافة',
    pricePiastres: 39900,
    weightGrams: 70,
  },
  {
    sku: 'EC-015',
    titleEn: 'Micellar Makeup Remover 200 ml',
    titleAr: 'مزيل مكياج ميسيلار 200 مل',
    pricePiastres: 21500,
    weightGrams: 240,
  },
  {
    sku: 'EC-016',
    titleEn: 'Vitamin C Serum 30 ml',
    titleAr: 'سيروم فيتامين سي 30 مل',
    pricePiastres: 64900,
    weightGrams: 80,
  },
  {
    sku: 'EC-017',
    titleEn: 'Hyaluronic Moisturizer 50 ml',
    titleAr: 'مرطب بالهيالورونيك 50 مل',
    pricePiastres: 57500,
    weightGrams: 110,
  },
  {
    sku: 'EC-018',
    titleEn: 'Sunscreen SPF 50, 50 ml',
    titleAr: 'واقي شمس SPF 50، 50 مل',
    pricePiastres: 49900,
    weightGrams: 90,
  },
  {
    sku: 'EC-019',
    titleEn: 'Cherry Lip Balm',
    titleAr: 'مرطب شفايف بالكريز',
    pricePiastres: 9900,
    weightGrams: 15,
  },
  {
    sku: 'EC-020',
    titleEn: 'Rose Collection Gift Set',
    titleAr: 'طقم هدية مجموعة الورد',
    pricePiastres: 149900,
    weightGrams: 650,
  },
];

/** Builds a valid EAN13 barcode from a 12 digit body (Egypt GS1 prefix 622). */
export function ean13(body12: string): string {
  const digits = body12.split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return body12 + String((10 - (sum % 10)) % 10);
}

export const DEMO_USERS: {
  email: string;
  name: string;
  phone: string;
  role: 'store_staff' | 'rider';
  storeCode: string;
  badgeCode?: string;
}[] = [
  {
    email: 'staff.newcairo@shiplynow.local',
    name: 'Mona Adel',
    phone: '+201000000101',
    role: 'store_staff',
    storeCode: 'NCR',
  },
  {
    email: 'staff.maadi@shiplynow.local',
    name: 'Karim Fathy',
    phone: '+201000000102',
    role: 'store_staff',
    storeCode: 'MAA',
  },
  {
    email: 'rider.newcairo@shiplynow.local',
    name: 'Ahmed Samir',
    phone: '+201100000201',
    role: 'rider',
    storeCode: 'NCR',
    badgeCode: 'RDR-0001',
  },
  {
    email: 'rider.maadi@shiplynow.local',
    name: 'Mahmoud Hassan',
    phone: '+201100000202',
    role: 'rider',
    storeCode: 'MAA',
    badgeCode: 'RDR-0002',
  },
];

/**
 * Opening stock per store and SKU index (0 to 19). Zamalek carries only the first 15
 * SKUs so the storefront filter has something to hide.
 */
export function openingStock(storeCode: string, skuIndex: number): number {
  if (storeCode === 'ZAM' && skuIndex >= 15) return 0;
  const base = { NCR: 24, MAA: 16, ZAM: 10 }[storeCode] ?? 10;
  return base + ((skuIndex * 7) % 11);
}
