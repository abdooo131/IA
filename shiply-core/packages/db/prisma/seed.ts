// Starting data. Safe to run again: it only adds what is missing and never overwrites edits.
import { PrismaClient } from '@prisma/client';
import { SETTINGS } from '@shiply/shared';
import { hashPassword } from '../src/password';

const prisma = new PrismaClient();
const EGP = 100;

// Prices are placeholders for the business to confirm. All editable in admin.
const ZONES = [
  { code: 'GC', name: 'Greater Cairo', transitDays: 1, priceS: 50 * EGP, priceM: 60 * EGP, priceL: 75 * EGP, priceXL: 100 * EGP },
  { code: 'ALX', name: 'Alexandria', transitDays: 1, priceS: 60 * EGP, priceM: 70 * EGP, priceL: 85 * EGP, priceXL: 110 * EGP },
  { code: 'DELTA', name: 'Delta and Canal', transitDays: 2, priceS: 65 * EGP, priceM: 75 * EGP, priceL: 90 * EGP, priceXL: 120 * EGP },
  { code: 'UPPER', name: 'Upper Egypt', transitDays: 2, priceS: 75 * EGP, priceM: 85 * EGP, priceL: 100 * EGP, priceXL: 135 * EGP },
  { code: 'REMOTE', name: 'Remote areas', transitDays: 3, priceS: 90 * EGP, priceM: 100 * EGP, priceL: 120 * EGP, priceXL: 160 * EGP },
];

// code, English, Arabic, zone, hub code that delivers there (null = not served yet)
const GOVERNORATES: [string, string, string, string, string | null][] = [
  ['CAI', 'Cairo', 'القاهرة', 'GC', 'CAI-E'],
  ['GIZ', 'Giza', 'الجيزة', 'GC', 'GIZ'],
  ['QAL', 'Qalyubia', 'القليوبية', 'GC', 'CAI-E'],
  ['ALX', 'Alexandria', 'الإسكندرية', 'ALX', 'ALX'],
  ['BEH', 'Beheira', 'البحيرة', 'DELTA', 'ALX'],
  ['GHR', 'Gharbia', 'الغربية', 'DELTA', 'DLT'],
  ['MNF', 'Monufia', 'المنوفية', 'DELTA', 'DLT'],
  ['DAK', 'Dakahlia', 'الدقهلية', 'DELTA', 'DLT'],
  ['SHR', 'Sharqia', 'الشرقية', 'DELTA', 'DLT'],
  ['KFS', 'Kafr El Sheikh', 'كفر الشيخ', 'DELTA', 'DLT'],
  ['DMT', 'Damietta', 'دمياط', 'DELTA', 'DLT'],
  ['PTS', 'Port Said', 'بورسعيد', 'DELTA', 'DLT'],
  ['ISM', 'Ismailia', 'الإسماعيلية', 'DELTA', 'DLT'],
  ['SUZ', 'Suez', 'السويس', 'DELTA', 'DLT'],
  ['FYM', 'Faiyum', 'الفيوم', 'UPPER', 'AST'],
  ['BNS', 'Beni Suef', 'بني سويف', 'UPPER', 'AST'],
  ['MNY', 'Minya', 'المنيا', 'UPPER', 'AST'],
  ['AST', 'Assiut', 'أسيوط', 'UPPER', 'AST'],
  ['SHG', 'Sohag', 'سوهاج', 'UPPER', 'AST'],
  ['QNA', 'Qena', 'قنا', 'UPPER', 'AST'],
  ['LXR', 'Luxor', 'الأقصر', 'UPPER', 'AST'],
  ['ASN', 'Aswan', 'أسوان', 'UPPER', 'AST'],
  ['RED', 'Red Sea', 'البحر الأحمر', 'REMOTE', null],
  ['NWV', 'New Valley', 'الوادي الجديد', 'REMOTE', null],
  ['MTR', 'Matrouh', 'مطروح', 'REMOTE', null],
  ['NSN', 'North Sinai', 'شمال سيناء', 'REMOTE', null],
  ['SSN', 'South Sinai', 'جنوب سيناء', 'REMOTE', null],
];

const HUBS = [
  { code: 'SORT', name: 'Obour Sorting Center', address: 'Obour City, Industrial Zone', isSorting: true },
  { code: 'CAI-E', name: 'Nasr City Hub', address: 'Nasr City, Cairo', isSorting: false },
  { code: 'CAI-S', name: 'Maadi Hub', address: 'Maadi, Cairo', isSorting: false },
  { code: 'GIZ', name: 'Dokki Hub', address: 'Dokki, Giza', isSorting: false },
  { code: 'ALX', name: 'Alexandria Hub', address: 'Smouha, Alexandria', isSorting: false },
  { code: 'DLT', name: 'Tanta Hub', address: 'Tanta, Gharbia', isSorting: false },
  { code: 'AST', name: 'Assiut Hub', address: 'Assiut', isSorting: false },
];

// Areas with their own hub. Anything not listed uses the governorate's hub.
const AREAS: [string, string, string, string][] = [
  ['CAI', 'Nasr City', 'مدينة نصر', 'CAI-E'],
  ['CAI', 'Heliopolis', 'مصر الجديدة', 'CAI-E'],
  ['CAI', 'New Cairo', 'القاهرة الجديدة', 'CAI-E'],
  ['CAI', 'Shorouk', 'الشروق', 'CAI-E'],
  ['CAI', 'Madinaty', 'مدينتي', 'CAI-E'],
  ['CAI', 'Maadi', 'المعادي', 'CAI-S'],
  ['CAI', 'Mokattam', 'المقطم', 'CAI-S'],
  ['CAI', 'Downtown', 'وسط البلد', 'CAI-S'],
  ['CAI', 'Zamalek', 'الزمالك', 'CAI-S'],
  ['CAI', 'Helwan', 'حلوان', 'CAI-S'],
  ['GIZ', 'Dokki', 'الدقي', 'GIZ'],
  ['GIZ', 'Mohandessin', 'المهندسين', 'GIZ'],
  ['GIZ', 'Haram', 'الهرم', 'GIZ'],
  ['GIZ', '6th of October', 'السادس من أكتوبر', 'GIZ'],
  ['GIZ', 'Sheikh Zayed', 'الشيخ زايد', 'GIZ'],
];

async function main() {
  const demoPassword = process.env.SEED_DEMO_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword || adminPassword.length < 8) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (8 characters or more) in .env');
  }

  for (const z of ZONES) await prisma.zone.upsert({ where: { code: z.code }, update: {}, create: z });

  const hubIds = new Map<string, string>();
  for (const h of HUBS) {
    const hub = await prisma.hub.upsert({ where: { code: h.code }, update: {}, create: h });
    hubIds.set(h.code, hub.id);
  }
  const hubId = (code: string | null) => (code ? hubIds.get(code)! : null);

  for (const [code, nameEn, nameAr, zoneCode, hub] of GOVERNORATES) {
    await prisma.governorate.upsert({
      where: { code },
      update: {},
      create: { code, nameEn, nameAr, zoneCode, hubId: hubId(hub) },
    });
  }
  for (const [governorateCode, nameEn, nameAr, hub] of AREAS) {
    await prisma.area.upsert({
      where: { governorateCode_nameEn: { governorateCode, nameEn } },
      update: {},
      create: { governorateCode, nameEn, nameAr, hubId: hubId(hub) },
    });
  }

  for (const [key, def] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: def.default as never } });
  }

  const addUser = async (data: {
    email: string;
    name: string;
    role: 'ADMIN' | 'HUB_STAFF' | 'COURIER' | 'MERCHANT';
    password: string;
    phone?: string;
    hubId?: string | null;
    merchantId?: string | null;
  }) => {
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) return;
    const { password, ...rest } = data;
    await prisma.user.create({ data: { ...rest, passwordHash: await hashPassword(password) } });
  };

  await addUser({ email: adminEmail.toLowerCase(), name: 'Admin', role: 'ADMIN', password: adminPassword });

  if (demoPassword) {
    for (const h of HUBS) {
      const slug = h.code.toLowerCase().replace(/[^a-z]/g, '');
      await addUser({ email: `staff.${slug}@shiply.local`, name: `${h.name} staff`, role: 'HUB_STAFF', password: demoPassword, hubId: hubId(h.code) });
      if (!h.isSorting) {
        await addUser({ email: `courier.${slug}@shiply.local`, name: `${h.name} courier`, role: 'COURIER', password: demoPassword, hubId: hubId(h.code), phone: '+201000000000' });
      }
    }
    const area = await prisma.area.findFirst({ where: { nameEn: 'Heliopolis' } });
    const merchant = await prisma.merchant.upsert({
      where: { code: 'EVE' },
      update: {},
      create: {
        code: 'EVE',
        name: 'Eve Chantelle',
        phone: '+201001234567',
        email: 'ops@evechantelle.example',
        pickupAddress: '12 Baghdad St, Heliopolis',
        governorateCode: 'CAI',
        areaId: area?.id ?? null,
        homeHubId: hubId('CAI-E')!,
      },
    });
    await addUser({ email: 'merchant@evechantelle.example', name: 'Eve Chantelle', role: 'MERCHANT', password: demoPassword, merchantId: merchant.id });
  }

  console.log('Seed done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
