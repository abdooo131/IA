// Starting data. Safe to run again: it only adds what is missing and never overwrites edits.
import { PrismaClient } from '@prisma/client';
import { ACCOUNT_LIST, SETTINGS, nearest } from '@shiply/shared';
import { hashPassword } from '../src/password';

const prisma = new PrismaClient();
const EGP = 100;

// Prices are placeholders for the business to confirm. All editable in admin.
// Placeholder prices (VAT included) until the business sends the real price list.
const ZONES = [
  { code: 'GC', name: 'Greater Cairo', transitDays: 1, priceS: 50 * EGP, priceM: 60 * EGP, priceL: 75 * EGP, priceXL: 100 * EGP, priceXXL: 140 * EGP, priceBulky: 200 * EGP },
  { code: 'ALX', name: 'Alexandria', transitDays: 1, priceS: 60 * EGP, priceM: 70 * EGP, priceL: 85 * EGP, priceXL: 110 * EGP, priceXXL: 150 * EGP, priceBulky: 220 * EGP },
  { code: 'DELTA', name: 'Delta', transitDays: 2, priceS: 65 * EGP, priceM: 75 * EGP, priceL: 90 * EGP, priceXL: 120 * EGP, priceXXL: 165 * EGP, priceBulky: 240 * EGP },
  { code: 'CANAL', name: 'Canal cities', transitDays: 2, priceS: 65 * EGP, priceM: 75 * EGP, priceL: 90 * EGP, priceXL: 120 * EGP, priceXXL: 165 * EGP, priceBulky: 240 * EGP },
  { code: 'UPPER', name: 'Upper Egypt', transitDays: 2, priceS: 75 * EGP, priceM: 85 * EGP, priceL: 100 * EGP, priceXL: 135 * EGP, priceXXL: 185 * EGP, priceBulky: 270 * EGP },
  { code: 'RED_SEA', name: 'Red Sea and Sinai', transitDays: 3, priceS: 85 * EGP, priceM: 95 * EGP, priceL: 115 * EGP, priceXL: 150 * EGP, priceXXL: 205 * EGP, priceBulky: 300 * EGP },
  { code: 'REMOTE', name: 'Remote areas', transitDays: 3, priceS: 90 * EGP, priceM: 100 * EGP, priceL: 120 * EGP, priceXL: 160 * EGP, priceXXL: 220 * EGP, priceBulky: 320 * EGP },
];

// Monthly volume tiers (placeholders): parcels last month and the discount they earn.
const TIERS = [
  { name: 'Starter', minParcels: 0, discountBp: 0 },
  { name: 'Growing', minParcels: 300, discountBp: 500 },
  { name: 'Established', minParcels: 1000, discountBp: 1000 },
  { name: 'Key account', minParcels: 3000, discountBp: 1500 },
];

// code, English, Arabic, zone, last mile hub that delivers there (null = not served yet), lat, lng (capital city)
const GOVERNORATES: [string, string, string, string, string | null, number, number][] = [
  ['CAI', 'Cairo', 'القاهرة', 'GC', 'CAI-E', 30.0444, 31.2357],
  ['GIZ', 'Giza', 'الجيزة', 'GC', 'GIZ', 30.0131, 31.2089],
  ['QAL', 'Qalyubia', 'القليوبية', 'GC', 'CAI-E', 30.466, 31.1848],
  ['ALX', 'Alexandria', 'الإسكندرية', 'ALX', 'ALX', 31.2001, 29.9187],
  ['BEH', 'Beheira', 'البحيرة', 'DELTA', 'DMN', 31.0341, 30.4682],
  ['GHR', 'Gharbia', 'الغربية', 'DELTA', 'DLT', 30.7865, 31.0004],
  ['MNF', 'Monufia', 'المنوفية', 'DELTA', 'DLT', 30.559, 31.0119],
  ['DAK', 'Dakahlia', 'الدقهلية', 'DELTA', 'DLT', 31.0409, 31.3785],
  ['SHR', 'Sharqia', 'الشرقية', 'DELTA', 'DLT', 30.5877, 31.502],
  ['KFS', 'Kafr El Sheikh', 'كفر الشيخ', 'DELTA', 'DLT', 31.1107, 30.9388],
  ['DMT', 'Damietta', 'دمياط', 'DELTA', 'DLT', 31.4165, 31.8133],
  ['PTS', 'Port Said', 'بورسعيد', 'CANAL', 'DLT', 31.2653, 32.3019],
  ['ISM', 'Ismailia', 'الإسماعيلية', 'CANAL', 'DLT', 30.5965, 32.2715],
  ['SUZ', 'Suez', 'السويس', 'CANAL', 'DLT', 29.9668, 32.5498],
  ['FYM', 'Faiyum', 'الفيوم', 'UPPER', 'AST', 29.3084, 30.8428],
  ['BNS', 'Beni Suef', 'بني سويف', 'UPPER', 'AST', 29.0661, 31.0994],
  ['MNY', 'Minya', 'المنيا', 'UPPER', 'AST', 28.0871, 30.7618],
  ['AST', 'Assiut', 'أسيوط', 'UPPER', 'AST', 27.1809, 31.1837],
  ['SHG', 'Sohag', 'سوهاج', 'UPPER', 'AST', 26.5591, 31.6957],
  ['QNA', 'Qena', 'قنا', 'UPPER', 'AST', 26.1551, 32.716],
  ['LXR', 'Luxor', 'الأقصر', 'UPPER', 'AST', 25.6872, 32.6396],
  ['ASN', 'Aswan', 'أسوان', 'UPPER', 'AST', 24.0889, 32.8998],
  ['RED', 'Red Sea', 'البحر الأحمر', 'RED_SEA', null, 27.2579, 33.8116],
  ['NWV', 'New Valley', 'الوادي الجديد', 'REMOTE', null, 25.439, 30.5586],
  ['MTR', 'Matrouh', 'مطروح', 'REMOTE', null, 31.3543, 27.2373],
  ['NSN', 'North Sinai', 'شمال سيناء', 'RED_SEA', null, 31.1316, 33.7984],
  ['SSN', 'South Sinai', 'جنوب سيناء', 'RED_SEA', null, 28.2417, 33.6222],
];

// Sorting facilities: receive pickups from the merchants nearest to them, sort, send line haul.
const FACILITIES = [
  { code: 'OBR', name: 'Obour Sorting Center', address: 'Obour City, Industrial Zone', lat: 30.228, lng: 31.479 },
  { code: 'ALXSF', name: 'Alexandria Sorting Center', address: 'Amreya, Alexandria', lat: 31.057, lng: 29.8 },
];

// Last mile hubs: deliver to consumers. Each is fed by its nearest sorting facility.
const LAST_MILE = [
  { code: 'CAI-E', name: 'Nasr City Hub', address: 'Nasr City, Cairo', lat: 30.0566, lng: 31.3301 },
  { code: 'CAI-S', name: 'Maadi Hub', address: 'Maadi, Cairo', lat: 29.9602, lng: 31.2569 },
  { code: 'GIZ', name: 'Dokki Hub', address: 'Dokki, Giza', lat: 30.0384, lng: 31.2124 },
  { code: 'DLT', name: 'Tanta Hub', address: 'Tanta, Gharbia', lat: 30.7865, lng: 31.0004 },
  { code: 'AST', name: 'Assiut Hub', address: 'Assiut', lat: 27.1809, lng: 31.1837 },
  { code: 'ALX', name: 'Smouha Hub', address: 'Smouha, Alexandria', lat: 31.2156, lng: 29.9553 },
  { code: 'DMN', name: 'Damanhour Hub', address: 'Damanhour, Beheira', lat: 31.0341, lng: 30.4682 },
];

// Areas with their own last mile hub. Anything not listed uses the governorate's hub.
const AREAS: [string, string, string, string, number, number][] = [
  ['CAI', 'Nasr City', 'مدينة نصر', 'CAI-E', 30.0566, 31.3301],
  ['CAI', 'Heliopolis', 'مصر الجديدة', 'CAI-E', 30.0911, 31.3225],
  ['CAI', 'New Cairo', 'القاهرة الجديدة', 'CAI-E', 30.0074, 31.4913],
  ['CAI', 'Shorouk', 'الشروق', 'CAI-E', 30.129, 31.607],
  ['CAI', 'Madinaty', 'مدينتي', 'CAI-E', 30.107, 31.6385],
  ['CAI', 'Maadi', 'المعادي', 'CAI-S', 29.9602, 31.2569],
  ['CAI', 'Mokattam', 'المقطم', 'CAI-S', 30.0222, 31.3006],
  ['CAI', 'Downtown', 'وسط البلد', 'CAI-S', 30.0459, 31.2421],
  ['CAI', 'Zamalek', 'الزمالك', 'CAI-S', 30.0609, 31.2197],
  ['CAI', 'Helwan', 'حلوان', 'CAI-S', 29.85, 31.3342],
  ['GIZ', 'Dokki', 'الدقي', 'GIZ', 30.0384, 31.2124],
  ['GIZ', 'Mohandessin', 'المهندسين', 'GIZ', 30.0571, 31.2003],
  ['GIZ', 'Haram', 'الهرم', 'GIZ', 29.9905, 31.152],
  ['GIZ', '6th of October', 'السادس من أكتوبر', 'GIZ', 29.9381, 30.9133],
  ['GIZ', 'Sheikh Zayed', 'الشيخ زايد', 'GIZ', 30.0444, 30.9833],
];

async function main() {
  const demoPassword = process.env.SEED_DEMO_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword || adminPassword.length < 8) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (8 characters or more) in .env');
  }

  for (const z of ZONES) await prisma.zone.upsert({ where: { code: z.code }, update: { name: z.name }, create: z });
  // Zones made before the two big sizes existed get their prices for them.
  for (const z of ZONES) await prisma.zone.updateMany({ where: { code: z.code, priceXXL: 0 }, data: { priceXXL: z.priceXXL, priceBulky: z.priceBulky } });
  if ((await prisma.priceTier.count()) === 0) await prisma.priceTier.createMany({ data: TIERS });

  const hubIds = new Map<string, string>();
  const facilities = [];
  for (const f of FACILITIES) {
    const hub = await prisma.hub.upsert({ where: { code: f.code }, update: {}, create: { ...f, isSorting: true } });
    hubIds.set(f.code, hub.id);
    facilities.push(hub);
  }
  for (const h of LAST_MILE) {
    const parent = nearest(h, facilities)!;
    const hub = await prisma.hub.upsert({ where: { code: h.code }, update: {}, create: { ...h, isSorting: false, parentId: parent.id } });
    hubIds.set(h.code, hub.id);
  }
  const hubId = (code: string | null) => (code ? hubIds.get(code)! : null);

  for (const [code, nameEn, nameAr, zoneCode, hub, lat, lng] of GOVERNORATES) {
    await prisma.governorate.upsert({
      where: { code },
      update: { zoneCode },
      create: { code, nameEn, nameAr, zoneCode, hubId: hubId(hub), lat, lng },
    });
  }
  for (const [governorateCode, nameEn, nameAr, hub, lat, lng] of AREAS) {
    await prisma.area.upsert({
      where: { governorateCode_nameEn: { governorateCode, nameEn } },
      update: {},
      create: { governorateCode, nameEn, nameAr, hubId: hubId(hub), lat, lng },
    });
  }

  for (const [key, def] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: def.default as never } });
  }

  // Chart of accounts: the built in accounts the system posts to.
  for (const a of ACCOUNT_LIST) {
    await prisma.account.upsert({
      where: { code: a.code },
      update: { name: a.name, nameAr: a.nameAr, type: a.type, party: a.party ?? null, system: true },
      create: { code: a.code, name: a.name, nameAr: a.nameAr, type: a.type, party: a.party ?? null, system: true },
    });
  }

  const addUser = async (data: {
    email: string;
    name: string;
    role: 'ADMIN' | 'HUB_STAFF' | 'COURIER' | 'MERCHANT' | 'AGENT';
    team?: 'INBOUND' | 'SORTING' | 'OUTBOUND';
    password: string;
    phone?: string;
    hubId?: string | null;
    merchantId?: string | null;
    agentId?: string | null;
    courierType?: 'PICKUP' | 'DELIVERY';
  }) => {
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) return;
    const { password, ...rest } = data;
    await prisma.user.create({ data: { ...rest, merchantOwner: rest.role === 'MERCHANT', passwordHash: await hashPassword(password) } });
  };

  await addUser({ email: adminEmail.toLowerCase(), name: 'Admin', role: 'ADMIN', password: adminPassword });

  if (demoPassword) {
    // A second admin, so money moves can be approved by a different person.
    await addUser({ email: 'finance@shiply.local', name: 'Finance', role: 'ADMIN', password: demoPassword });
    // Two demo agents: one supplies pickup staff (work from sorting facilities), one supplies
    // delivery staff (work from last mile hubs). Couriers join with the agent's code.
    const pickupAgent = await prisma.agent.upsert({
      where: { code: 'AGCAIRO' },
      update: {},
      create: { code: 'AGCAIRO', name: 'Cairo Movers', phone: '+201005550001', email: 'ops@cairomovers.example', supplies: 'PICKUP', bankName: 'CIB', bankAccountName: 'Cairo Movers LLC' },
    });
    const deliveryAgent = await prisma.agent.upsert({
      where: { code: 'AGDELTA' },
      update: {},
      create: { code: 'AGDELTA', name: 'Delta Riders', phone: '+201005550002', email: 'ops@deltariders.example', supplies: 'DELIVERY', bankName: 'NBE', bankAccountName: 'Delta Riders' },
    });
    if (!(await prisma.vehicle.findUnique({ where: { plate: 'ق ط ر 1234' } }))) {
      await prisma.vehicle.create({ data: { agentId: pickupAgent.id, plate: 'ق ط ر 1234', kind: 'VAN', contract: 'FIXED', monthlyRent: 1_500_000, capacityParcels: 400 } });
    }
    await addUser({ email: 'agent@cairomovers.example', name: 'Cairo Movers', role: 'AGENT', password: demoPassword, agentId: pickupAgent.id, phone: pickupAgent.phone });
    await addUser({ email: 'agent@deltariders.example', name: 'Delta Riders', role: 'AGENT', password: demoPassword, agentId: deliveryAgent.id, phone: deliveryAgent.phone });
    let phoneNo = 100;
    const nextPhone = () => `+2010000${String(phoneNo++).padStart(5, '0')}`;
    const slug = (code: string) => code.toLowerCase().replace(/[^a-z]/g, '');
    for (const f of FACILITIES) {
      const id = hubId(f.code);
      await addUser({ email: `staff.${slug(f.code)}@shiply.local`, name: `${f.name} supervisor`, role: 'HUB_STAFF', password: demoPassword, hubId: id });
      for (const team of ['INBOUND', 'SORTING', 'OUTBOUND'] as const) {
        await addUser({ email: `${team.toLowerCase()}.${slug(f.code)}@shiply.local`, name: `${f.name} ${team.toLowerCase()}`, role: 'HUB_STAFF', team, password: demoPassword, hubId: id });
      }
      await addUser({ email: `courier.${slug(f.code)}@shiply.local`, name: `${f.name} pickup courier`, role: 'COURIER', password: demoPassword, hubId: id, phone: nextPhone(), agentId: pickupAgent.id, courierType: 'PICKUP' });
    }
    for (const h of LAST_MILE) {
      await addUser({ email: `staff.${slug(h.code)}@shiply.local`, name: `${h.name} staff`, role: 'HUB_STAFF', password: demoPassword, hubId: hubId(h.code) });
      await addUser({ email: `courier.${slug(h.code)}@shiply.local`, name: `${h.name} courier`, role: 'COURIER', password: demoPassword, hubId: hubId(h.code), phone: nextPhone(), agentId: deliveryAgent.id, courierType: 'DELIVERY' });
    }
    const area = await prisma.area.findFirst({ where: { nameEn: 'Heliopolis' } });
    const facility = nearest({ lat: area!.lat!, lng: area!.lng! }, facilities)!;
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
        homeHubId: facility.id,
      },
    });
    await addUser({ email: 'merchant@evechantelle.example', name: 'Eve Chantelle', role: 'MERCHANT', password: demoPassword, merchantId: merchant.id });
    const alexArea = await prisma.governorate.findUniqueOrThrow({ where: { code: 'ALX' } });
    const alexFacility = nearest(alexArea, facilities)!;
    const nile = await prisma.merchant.upsert({
      where: { code: 'NILE' },
      update: {},
      create: {
        code: 'NILE',
        name: 'Nile Home',
        phone: '+201101234567',
        email: 'orders@nilehome.example',
        pickupAddress: '40 Fouad St, Alexandria',
        governorateCode: 'ALX',
        homeHubId: alexFacility.id,
      },
    });
    await addUser({ email: 'merchant@nilehome.example', name: 'Nile Home', role: 'MERCHANT', password: demoPassword, merchantId: nile.id });

    // Packaging for the shop. Stock comes in through purchase orders, so it starts at zero.
    if (!(await prisma.supplier.findFirst({ where: { name: 'Cairo Packaging Co' } }))) {
      await prisma.supplier.create({ data: { name: 'Cairo Packaging Co', phone: '+201001112223', taxId: '100-200-300' } });
    }
    const packaging = [
      { sku: 'FLY-S', name: 'Flyer bags, small', nameAr: 'أكياس شحن صغيرة', unit: 'Pack of 100', price: 9000, minStock: 20 },
      { sku: 'FLY-M', name: 'Flyer bags, medium', nameAr: 'أكياس شحن متوسطة', unit: 'Pack of 100', price: 12000, minStock: 20 },
      { sku: 'FLY-L', name: 'Flyer bags, large', nameAr: 'أكياس شحن كبيرة', unit: 'Pack of 50', price: 11000, minStock: 10 },
      { sku: 'BOX-M', name: 'Carton box, medium', nameAr: 'كرتونة متوسطة', unit: 'Pack of 20', price: 16000, minStock: 10 },
      { sku: 'TAPE', name: 'Packing tape', nameAr: 'شريط لاصق', unit: 'Roll', price: 2500, minStock: 30 },
      { sku: 'BUBBLE', name: 'Bubble wrap', nameAr: 'غلاف فقاعات', unit: 'Roll of 10 m', price: 6000, minStock: 10 },
    ];
    for (const p of packaging) await prisma.packagingProduct.upsert({ where: { sku: p.sku }, update: {}, create: p });
  }

  console.log('Seed done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
