import type { PricingZone } from '@shiply/shared';

export const DEMO_PASSWORD = 'Shiply@2026';

export interface AreaSeed {
  gov: string;
  en: string;
  ar: string;
  lat: number;
  lng: number;
  keywords?: string[];
  zone?: PricingZone;
}

export const AREAS: AreaSeed[] = [
  // Cairo
  { gov: 'CAI', en: 'Maadi', ar: 'المعادي', lat: 29.9602, lng: 31.2569, keywords: ['degla', 'دجلة', 'sarayat'] },
  { gov: 'CAI', en: 'Zahraa El Maadi', ar: 'زهراء المعادي', lat: 29.9636, lng: 31.301, keywords: ['zahraa'] },
  { gov: 'CAI', en: 'Nasr City', ar: 'مدينة نصر', lat: 30.0566, lng: 31.3301, keywords: ['nasr', 'نصر'] },
  { gov: 'CAI', en: 'Heliopolis', ar: 'مصر الجديدة', lat: 30.0911, lng: 31.3225, keywords: ['masr el gedida', 'korba'] },
  { gov: 'CAI', en: 'New Cairo', ar: 'القاهرة الجديدة', lat: 30.0074, lng: 31.4913, keywords: ['fifth settlement', 'tagamoa', 'التجمع', '5th settlement'] },
  { gov: 'CAI', en: 'Rehab', ar: 'الرحاب', lat: 30.059, lng: 31.493 },
  { gov: 'CAI', en: 'Madinaty', ar: 'مدينتي', lat: 30.107, lng: 31.638 },
  { gov: 'CAI', en: 'Shorouk', ar: 'الشروق', lat: 30.1404, lng: 31.6206 },
  { gov: 'CAI', en: 'Downtown', ar: 'وسط البلد', lat: 30.0478, lng: 31.2336, keywords: ['wust el balad', 'tahrir'] },
  { gov: 'CAI', en: 'Zamalek', ar: 'الزمالك', lat: 30.0609, lng: 31.2197 },
  { gov: 'CAI', en: 'Garden City', ar: 'جاردن سيتي', lat: 30.0368, lng: 31.2316 },
  { gov: 'CAI', en: 'Mokattam', ar: 'المقطم', lat: 30.0131, lng: 31.3 },
  { gov: 'CAI', en: 'Shubra', ar: 'شبرا', lat: 30.073, lng: 31.245 },
  { gov: 'CAI', en: 'Ain Shams', ar: 'عين شمس', lat: 30.131, lng: 31.329 },
  { gov: 'CAI', en: 'Helwan', ar: 'حلوان', lat: 29.85, lng: 31.334 },
  { gov: 'CAI', en: 'Obour', ar: 'العبور', lat: 30.228, lng: 31.479 },
  // Giza
  { gov: 'GIZ', en: 'Dokki', ar: 'الدقي', lat: 30.0384, lng: 31.2122 },
  { gov: 'GIZ', en: 'Mohandessin', ar: 'المهندسين', lat: 30.0566, lng: 31.2003, keywords: ['mohandeseen'] },
  { gov: 'GIZ', en: 'Agouza', ar: 'العجوزة', lat: 30.056, lng: 31.211 },
  { gov: 'GIZ', en: 'Haram', ar: 'الهرم', lat: 29.993, lng: 31.147, keywords: ['pyramids'] },
  { gov: 'GIZ', en: 'Faisal', ar: 'فيصل', lat: 30.006, lng: 31.17 },
  { gov: 'GIZ', en: '6th of October', ar: 'السادس من أكتوبر', lat: 29.9285, lng: 30.9188, keywords: ['october', 'أكتوبر', '6 october'] },
  { gov: 'GIZ', en: 'Sheikh Zayed', ar: 'الشيخ زايد', lat: 30.044, lng: 30.976, keywords: ['zayed', 'زايد'] },
  { gov: 'GIZ', en: 'Imbaba', ar: 'إمبابة', lat: 30.076, lng: 31.207 },
  { gov: 'GIZ', en: 'Hadayek El Ahram', ar: 'حدائق الأهرام', lat: 29.975, lng: 31.11 },
  // Alexandria
  { gov: 'ALX', en: 'Smouha', ar: 'سموحة', lat: 31.215, lng: 29.944 },
  { gov: 'ALX', en: 'Sidi Gaber', ar: 'سيدي جابر', lat: 31.219, lng: 29.942 },
  { gov: 'ALX', en: 'Miami', ar: 'ميامي', lat: 31.267, lng: 30.003 },
  { gov: 'ALX', en: 'Agami', ar: 'العجمي', lat: 31.095, lng: 29.765 },
  // North Coast (Matrouh governorate, own pricing zone)
  { gov: 'MTR', en: 'El Alamein', ar: 'العلمين', lat: 30.83, lng: 28.955, keywords: ['alamein'], zone: 'NORTH_COAST' },
  { gov: 'MTR', en: 'Marina', ar: 'مارينا', lat: 30.825, lng: 29.0, keywords: ['sahel', 'الساحل', 'north coast'], zone: 'NORTH_COAST' },
  { gov: 'MTR', en: 'Sidi Abdel Rahman', ar: 'سيدي عبد الرحمن', lat: 30.966, lng: 28.68, zone: 'NORTH_COAST' },
  // Upper Egypt
  { gov: 'AST', en: 'Asyut City', ar: 'مدينة أسيوط', lat: 27.1809, lng: 31.1837 },
];

export const HUBS = [
  { code: 'CAI-SF', nameEn: 'Cairo Sorting Facility', nameAr: 'مركز الفرز بالقاهرة', gov: 'CAI', address: 'Industrial Zone, Mokattam', lat: 30.02, lng: 31.31, receivesPickups: true, dispatchesLastMile: false },
  { code: 'MAADI', nameEn: 'Maadi Hub', nameAr: 'مركز المعادي', gov: 'CAI', address: 'Road 233, Degla, Maadi', lat: 29.962, lng: 31.265, receivesPickups: false, dispatchesLastMile: true },
  { code: 'NASR', nameEn: 'Nasr City Hub', nameAr: 'مركز مدينة نصر', gov: 'CAI', address: 'Makram Ebeid St, Nasr City', lat: 30.06, lng: 31.34, receivesPickups: false, dispatchesLastMile: true },
  { code: 'MOHN', nameEn: 'Mohandessin Hub', nameAr: 'مركز المهندسين', gov: 'GIZ', address: 'Gameat El Dowal St, Mohandessin', lat: 30.055, lng: 31.205, receivesPickups: false, dispatchesLastMile: true },
  { code: 'OCT', nameEn: '6th of October Hub', nameAr: 'مركز السادس من أكتوبر', gov: 'GIZ', address: 'Central Axis, 6th of October', lat: 29.97, lng: 30.95, receivesPickups: false, dispatchesLastMile: true },
];

export const ZONE_LEVEL: Record<PricingZone, number> = {
  CAIRO_GIZA: 0,
  ALEX_BEHIRA: 1,
  DELTA_CANAL: 1,
  NEAR_UPPER_EGYPT: 2,
  NORTH_COAST: 2,
  FAR_UPPER_MATROUH: 3,
  SINAI_NEW_VALLEY: 3,
};
/** Seed only: each zone level away from Cairo & Giza adds 15 EGP. Editable afterwards in the pricing tables. */
export const ZONE_LEVEL_STEP = 1500;

export const SIZE_ADD = {
  SMALL_MEDIUM: 0,
  LARGE: 1000,
  XLARGE: 2000,
  XXL_WHITE_BAG: 3500,
  LIGHT_BULKY: 6000,
  HEAVY_BULKY: 15000,
} as const;

export const TIER_BP = { BRONZE: 10000, SILVER: 9500, GOLD: 9000 } as const;

export const MERCHANTS = [
  {
    code: 'EVE',
    nameEn: 'Eve Chantelle',
    nameAr: 'إيف شانتال',
    tier: 'BRONZE' as const,
    owner: { email: 'owner@evechantelle.com', name: 'Eve Chantelle Owner' },
    team: { email: 'team@evechantelle.com', name: 'Eve Chantelle Ops' },
    pickups: [
      { name: 'New Cairo Warehouse', gov: 'CAI', area: 'New Cairo', address: '90th Street, Fifth Settlement', isDefault: true },
      { name: 'Zamalek Store', gov: 'CAI', area: 'Zamalek', address: '26 July St, Zamalek', isDefault: false },
    ],
  },
  {
    code: 'NABTA',
    nameEn: 'Nabta',
    nameAr: 'نبتة',
    tier: 'SILVER' as const,
    owner: { email: 'owner@nabta.com', name: 'Nabta Owner' },
    pickups: [{ name: 'Zamalek Studio', gov: 'CAI', area: 'Zamalek', address: '12 Brazil St, Zamalek', isDefault: true }],
  },
  {
    code: 'ESS',
    nameEn: 'Essentials',
    nameAr: 'إسنشالز',
    tier: 'GOLD' as const,
    owner: { email: 'owner@essentials.com', name: 'Essentials Owner' },
    pickups: [{ name: 'Nasr City Warehouse', gov: 'CAI', area: 'Nasr City', address: 'Abbas El Akkad St, Nasr City', isDefault: true }],
  },
  {
    code: 'HANSER',
    nameEn: 'Hanser',
    nameAr: 'هانسر',
    tier: 'BRONZE' as const,
    owner: { email: 'owner@hanser.com', name: 'Hanser Owner' },
    pickups: [{ name: 'Mohandessin Office', gov: 'GIZ', area: 'Mohandessin', address: 'Shehab St, Mohandessin', isDefault: true }],
  },
];

export const STAFF = [
  { email: 'admin@shiply.eg', name: 'Super Admin', role: 'SUPER_ADMIN' as const },
  { email: 'ops@shiply.eg', name: 'Operations Manager', role: 'OPERATIONS_MANAGER' as const },
  { email: 'dispatch@shiply.eg', name: 'Dispatcher', role: 'DISPATCH' as const },
  { email: 'finance@shiply.eg', name: 'Finance', role: 'FINANCE' as const },
  { email: 'qc@shiply.eg', name: 'QC Agent', role: 'QC_AGENT' as const },
  { email: 'drivers@shiply.eg', name: 'Driver Manager', role: 'DRIVER_MANAGER' as const },
  { email: 'hub.maadi@shiply.eg', name: 'Maadi Hub Staff', role: 'HUB_STAFF' as const, hub: 'MAADI' },
];

/** A few demo orders per merchant so dashboards are not empty. */
export const DEMO_ORDERS = [
  { name: 'Mona Adel', phone: '01012345678', gov: 'CAI', area: 'Maadi', address: '12 Road 9, Maadi', cod: 45000, size: 'SMALL_MEDIUM', type: 'DELIVER', open: true },
  { name: 'Sara Hassan', phone: '01112345678', gov: 'GIZ', area: 'Dokki', address: '5 Tahrir St, Dokki', cod: 120000, size: 'LARGE', type: 'DELIVER', open: false },
  { name: 'Nour Khaled', phone: '01212345678', gov: 'CAI', area: 'Heliopolis', address: '33 Baghdad St, Korba', cod: 0, size: 'SMALL_MEDIUM', type: 'EXCHANGE', open: false },
  { name: 'Yasmin Fathy', phone: '01512345678', gov: 'ALX', area: 'Smouha', address: '14 Victor Emmanuel Sq, Smouha', cod: 350000, size: 'SMALL_MEDIUM', type: 'DELIVER', open: true },
  { name: 'Omar Samir', phone: '01098765432', gov: 'GIZ', area: '6th of October', address: 'District 7, 6th of October', cod: 89900, size: 'XLARGE', type: 'DELIVER', open: false },
] as const;

/** Chart of accounts. Codes: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx revenue, 5xxx expenses. */
export const CHART_OF_ACCOUNTS = [
  { code: '1010', type: 'ASSET', en: 'Bank account', ar: 'الحساب البنكي', d: 'Company bank balance' },
  { code: '1020', type: 'ASSET', en: 'Cash with drivers', ar: 'نقدية مع المناديب', d: 'COD collected by drivers and not yet deposited' },
  { code: '1030', type: 'ASSET', en: 'Fawry receivable', ar: 'مستحقات فوري', d: 'Cash deposited at Fawry, not yet settled to the bank' },
  { code: '1040', type: 'ASSET', en: 'Cash in hub safes', ar: 'نقدية في خزائن المراكز', d: 'Cash handed in by drivers, waiting to be deposited' },
  { code: '1050', type: 'ASSET', en: 'Driver shortages receivable', ar: 'عجز المناديب المستحق', d: 'Cash a driver did not hand in; owed by that driver' },
  { code: '2010', type: 'LIABILITY', en: 'Merchant wallets (COD payable)', ar: 'محافظ التجار (مستحقات التحصيل)', d: 'What Shiply owes merchants; one sub ledger per merchant' },
  { code: '2015', type: 'LIABILITY', en: 'COD awaiting settlement', ar: 'تحصيل في انتظار التسوية', d: 'COD collected today, moved to merchant wallets by the midnight cash cycle' },
  { code: '2020', type: 'LIABILITY', en: 'VAT payable', ar: 'ضريبة القيمة المضافة المستحقة', d: 'VAT charged to merchants, owed to the tax authority' },
  { code: '2030', type: 'LIABILITY', en: 'Driver payable', ar: 'مستحقات المناديب', d: 'Driver earnings owed (Phase 5 points engine)' },
  { code: '2040', type: 'LIABILITY', en: 'Franchise payable', ar: 'مستحقات الامتياز', d: 'Franchise commissions owed (Phase 5)' },
  { code: '3010', type: 'EQUITY', en: 'Owner equity', ar: 'حقوق الملكية', d: 'Capital and retained earnings' },
  { code: '4010', type: 'REVENUE', en: 'Shipping revenue', ar: 'إيرادات الشحن', d: 'Delivery fees excluding VAT' },
  { code: '4020', type: 'REVENUE', en: 'COD fee revenue', ar: 'إيرادات رسوم التحصيل', d: '1% fee on COD above the threshold' },
  { code: '4030', type: 'REVENUE', en: 'Open package fee revenue', ar: 'إيرادات رسوم فتح الشحنة', d: 'Open package fees' },
  { code: '4040', type: 'REVENUE', en: 'Failed delivery revenue', ar: 'إيرادات التوصيل الفاشل', d: 'Charges for failed deliveries' },
  { code: '4050', type: 'REVENUE', en: 'Cashout fee revenue', ar: 'إيرادات رسوم التحويل', d: 'Merchant cashout fees' },
  { code: '4060', type: 'REVENUE', en: 'Other income', ar: 'إيرادات أخرى', d: 'Deductions charged to merchants' },
  { code: '5010', type: 'EXPENSE', en: 'Driver earnings', ar: 'أرباح المناديب', d: 'Points paid to drivers (Phase 5)' },
  { code: '5020', type: 'EXPENSE', en: 'Franchise commission', ar: 'عمولة الامتياز', d: 'Franchise share (Phase 5)' },
  { code: '5030', type: 'EXPENSE', en: 'Merchant compensation', ar: 'تعويضات التجار', d: 'Compensation for lost or damaged parcels' },
  { code: '5040', type: 'EXPENSE', en: 'Payment processing fees', ar: 'رسوم معالجة المدفوعات', d: 'Bank and Fawry charges' },
] as const;

/** Demo drivers. Pickup drivers work from the sorting facility; delivery drivers from each last mile hub. */
export const DRIVERS = [
  { type: 'PICKUP' as const, fullName: 'Mahmoud Hassan', phone: '01000000101', email: 'pickup.driver@shiply.eg', hub: 'CAI-SF', vehicle: 'VAN' },
  { type: 'PICKUP' as const, fullName: 'Ahmed Saeed', phone: '01000000102', hub: 'CAI-SF', vehicle: 'VAN' },
  { type: 'DELIVERY' as const, fullName: 'Karim Mostafa', phone: '01000000201', email: 'delivery.driver@shiply.eg', hub: 'MAADI', vehicle: 'MOTORCYCLE' },
  { type: 'DELIVERY' as const, fullName: 'Youssef Ali', phone: '01000000202', hub: 'NASR', vehicle: 'MOTORCYCLE' },
  { type: 'DELIVERY' as const, fullName: 'Hany Fathy', phone: '01000000203', hub: 'MOHN', vehicle: 'MOTORCYCLE' },
  { type: 'DELIVERY' as const, fullName: 'Tarek Nabil', phone: '01000000204', hub: 'OCT', vehicle: 'MOTORCYCLE' },
];
