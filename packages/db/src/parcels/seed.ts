// Starting data for the Shiply parcel network: price zones and volume tiers, sorting facilities
// and last mile hubs, which hub serves each governorate and area, truck routes, the network's
// settings, and (with a demo password) demo agents, hub staff, couriers and merchants.
// Safe to run again: it only adds what is missing and never overwrites edits.
import type { PrismaClient } from '@prisma/client';
import { SETTINGS, nearest } from '@shiplynow/shared/parcels';
import { JOB_ROLE_TEMPLATES } from '@shiplynow/shared';
import { writeAccess } from '../access';
import { hashPassword } from '../password';

const EGP = 100;

// Placeholder prices (VAT included) until the business sends the real price list.
const ZONES = [
  // Seven route zones (owner, 2026-11-08): the route from pickup to delivery picks one.
  {
    code: 'SAME',
    name: 'Same city',
    transitDays: 1,
    priceS: 40 * EGP,
    priceM: 50 * EGP,
    priceL: 65 * EGP,
    priceXL: 90 * EGP,
    priceXXL: 130 * EGP,
    priceBulky: 180 * EGP,
  },
  {
    code: 'GC',
    name: 'Greater Cairo',
    transitDays: 1,
    priceS: 50 * EGP,
    priceM: 60 * EGP,
    priceL: 75 * EGP,
    priceXL: 100 * EGP,
    priceXXL: 140 * EGP,
    priceBulky: 200 * EGP,
  },
  {
    code: 'ALX',
    name: 'Alexandria',
    transitDays: 1,
    priceS: 60 * EGP,
    priceM: 70 * EGP,
    priceL: 85 * EGP,
    priceXL: 110 * EGP,
    priceXXL: 150 * EGP,
    priceBulky: 220 * EGP,
  },
  {
    code: 'DELTA',
    name: 'Delta',
    transitDays: 2,
    priceS: 65 * EGP,
    priceM: 75 * EGP,
    priceL: 90 * EGP,
    priceXL: 120 * EGP,
    priceXXL: 165 * EGP,
    priceBulky: 240 * EGP,
  },
  {
    code: 'CANAL',
    name: 'Canal and Suez',
    transitDays: 2,
    priceS: 65 * EGP,
    priceM: 75 * EGP,
    priceL: 90 * EGP,
    priceXL: 120 * EGP,
    priceXXL: 165 * EGP,
    priceBulky: 240 * EGP,
  },
  {
    code: 'UPPER',
    name: 'Upper Egypt',
    transitDays: 2,
    priceS: 75 * EGP,
    priceM: 85 * EGP,
    priceL: 100 * EGP,
    priceXL: 135 * EGP,
    priceXXL: 185 * EGP,
    priceBulky: 270 * EGP,
  },
  {
    code: 'REMOTE',
    name: 'Remote: Red Sea, Sinai, Matrouh, New Valley',
    transitDays: 3,
    priceS: 90 * EGP,
    priceM: 100 * EGP,
    priceL: 120 * EGP,
    priceXL: 160 * EGP,
    priceXXL: 220 * EGP,
    priceBulky: 320 * EGP,
  },
];

const TIERS = [
  { name: 'Starter', minParcels: 0, discountBp: 0 },
  { name: 'Growing', minParcels: 300, discountBp: 500 },
  { name: 'Established', minParcels: 1000, discountBp: 1000 },
  { name: 'Key account', minParcels: 3000, discountBp: 1500 },
];

// governorate code (Shiply Now's, the official ones), price zone, last mile hub, lat, lng (capital)
const GOVERNORATES: [string, string, string | null, number, number][] = [
  ['EG-C', 'GC', 'CAI-E', 30.0444, 31.2357],
  ['EG-GZ', 'GC', 'GIZ', 30.0131, 31.2089],
  ['EG-KB', 'GC', 'CAI-E', 30.466, 31.1848],
  ['EG-ALX', 'ALX', 'ALX', 31.2001, 29.9187],
  ['EG-BH', 'DELTA', 'DMN', 31.0341, 30.4682],
  ['EG-GH', 'DELTA', 'DLT', 30.7865, 31.0004],
  ['EG-MNF', 'DELTA', 'DLT', 30.559, 31.0119],
  ['EG-DK', 'DELTA', 'DLT', 31.0409, 31.3785],
  ['EG-SHR', 'DELTA', 'DLT', 30.5877, 31.502],
  ['EG-KFS', 'DELTA', 'DLT', 31.1107, 30.9388],
  ['EG-DT', 'DELTA', 'DLT', 31.4165, 31.8133],
  ['EG-PTS', 'CANAL', 'DLT', 31.2653, 32.3019],
  ['EG-IS', 'CANAL', 'DLT', 30.5965, 32.2715],
  ['EG-SUZ', 'CANAL', 'DLT', 29.9668, 32.5498],
  ['EG-FYM', 'UPPER', 'AST', 29.3084, 30.8428],
  ['EG-BNS', 'UPPER', 'AST', 29.0661, 31.0994],
  ['EG-MN', 'UPPER', 'AST', 28.0871, 30.7618],
  ['EG-AST', 'UPPER', 'AST', 27.1809, 31.1837],
  ['EG-SHG', 'UPPER', 'AST', 26.5591, 31.6957],
  ['EG-KN', 'UPPER', 'AST', 26.1551, 32.716],
  ['EG-LX', 'UPPER', 'AST', 25.6872, 32.6396],
  ['EG-ASN', 'UPPER', 'AST', 24.0889, 32.8998],
  ['EG-BA', 'REMOTE', null, 27.2579, 33.8116],
  ['EG-WAD', 'REMOTE', null, 25.439, 30.5586],
  ['EG-MT', 'REMOTE', null, 31.3543, 27.2373],
  ['EG-SIN', 'REMOTE', null, 31.1316, 33.7984],
  ['EG-JS', 'REMOTE', null, 28.2417, 33.6222],
];

const FACILITIES = [
  {
    code: 'OBR',
    name: 'Obour Sorting Center',
    address: 'Obour City, Industrial Zone',
    lat: 30.228,
    lng: 31.479,
  },
  {
    code: 'ALXSF',
    name: 'Alexandria Sorting Center',
    address: 'Amreya, Alexandria',
    lat: 31.057,
    lng: 29.8,
  },
];

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
  ['EG-C', 'Nasr City', 'مدينة نصر', 'CAI-E', 30.0566, 31.3301],
  ['EG-C', 'Heliopolis', 'مصر الجديدة', 'CAI-E', 30.0911, 31.3225],
  ['EG-C', 'New Cairo', 'القاهرة الجديدة', 'CAI-E', 30.0074, 31.4913],
  ['EG-C', 'Shorouk', 'الشروق', 'CAI-E', 30.129, 31.607],
  ['EG-C', 'Madinaty', 'مدينتي', 'CAI-E', 30.107, 31.6385],
  ['EG-C', 'Maadi', 'المعادي', 'CAI-S', 29.9602, 31.2569],
  ['EG-C', 'Mokattam', 'المقطم', 'CAI-S', 30.0222, 31.3006],
  ['EG-C', 'Downtown', 'وسط البلد', 'CAI-S', 30.0459, 31.2421],
  ['EG-C', 'Zamalek', 'الزمالك', 'CAI-S', 30.0609, 31.2197],
  ['EG-C', 'Helwan', 'حلوان', 'CAI-S', 29.85, 31.3342],
  ['EG-GZ', 'Dokki', 'الدقي', 'GIZ', 30.0384, 31.2124],
  ['EG-GZ', 'Mohandessin', 'المهندسين', 'GIZ', 30.0571, 31.2003],
  ['EG-GZ', 'Haram', 'الهرم', 'GIZ', 29.9905, 31.152],
  ['EG-GZ', '6th of October', 'السادس من أكتوبر', 'GIZ', 29.9381, 30.9133],
  ['EG-GZ', 'Sheikh Zayed', 'الشيخ زايد', 'GIZ', 30.0444, 30.9833],
];

/** We launch in Cairo and Giza; everywhere else is set up but not served until a hub is given. */
const LAUNCH = new Set(['EG-C', 'EG-GZ']);

export interface NetworkSeedOptions {
  /** Demo agents, hub staff, couriers and merchants are made only with a demo password. */
  demoPassword?: string;
  /** Serve the whole country and run trucks between every facility (the test suites use this). */
  everywhere?: boolean;
  log?: (message: string) => void;
}

export async function seedNetwork(prisma: PrismaClient, options: NetworkSeedOptions = {}) {
  const log = options.log ?? (() => undefined);
  for (const z of ZONES)
    await prisma.pricingZone.upsert({ where: { code: z.code }, update: {}, create: z });
  if ((await prisma.priceTier.count()) === 0) await prisma.priceTier.createMany({ data: TIERS });

  const hubIds = new Map<string, string>();
  const facilities = [];
  for (const f of FACILITIES) {
    const hub = await prisma.hub.upsert({
      where: { code: f.code },
      update: {},
      create: { ...f, isSorting: true },
    });
    hubIds.set(f.code, hub.id);
    facilities.push(hub);
  }
  for (const h of LAST_MILE) {
    const parent = nearest(h, facilities)!;
    const hub = await prisma.hub.upsert({
      where: { code: h.code },
      update: {},
      create: { ...h, isSorting: false, parentId: parent.id },
    });
    hubIds.set(h.code, hub.id);
  }
  const hubId = (code: string | null) => (code ? hubIds.get(code)! : null);
  const served = (gov: string, hub: string | null) =>
    options.everywhere || LAUNCH.has(gov) ? hubId(hub) : null;

  // Only fills what is empty, so coverage changed on the network page is kept.
  for (const [code, zoneCode, hub, lat, lng] of GOVERNORATES) {
    await prisma.governorate.updateMany({
      where: { code, zoneCode: null },
      data: { zoneCode, hubId: served(code, hub), lat, lng },
    });
  }
  for (const [governorateCode, nameEn, nameAr, hub, lat, lng] of AREAS) {
    await prisma.networkArea.upsert({
      where: { governorateCode_nameEn: { governorateCode, nameEn } },
      update: {},
      create: { governorateCode, nameEn, nameAr, hubId: served(governorateCode, hub), lat, lng },
    });
  }
  if (options.everywhere && (await prisma.lineHaulLink.count()) === 0) {
    const ids = FACILITIES.map((f) => hubIds.get(f.code)!);
    for (const a of ids)
      for (const b of ids)
        if (a !== b) await prisma.lineHaulLink.create({ data: { fromId: a, toId: b } });
  }
  for (const [key, def] of Object.entries(SETTINGS)) {
    const id = { key: `parcels.${key}`, scope: 'global' };
    await prisma.setting.upsert({
      where: { key_scope: id },
      update: {},
      create: { ...id, value: def.default as never },
    });
  }
  log(
    `Parcel network: ${FACILITIES.length} sorting facilities, ${LAST_MILE.length} hubs, ${ZONES.length} price zones`,
  );

  const password = options.demoPassword;
  if (!password) return;
  const hash = await hashPassword(password);
  const addUser = async (data: {
    email: string;
    name: string;
    role: 'admin' | 'hub_staff' | 'courier' | 'merchant' | 'agent';
    team?: 'INBOUND' | 'SORTING' | 'OUTBOUND';
    phone?: string;
    hubId?: string | null;
    merchantId?: string | null;
    agentId?: string | null;
    courierType?: 'PICKUP' | 'DELIVERY';
  }) => {
    if (await prisma.user.findUnique({ where: { email: data.email } })) return;
    await prisma.user.create({
      data: {
        ...data,
        phone: data.phone ?? null,
        merchantRole: data.role === 'merchant' ? 'owner' : null,
        passwordHash: hash,
      },
    });
  };

  await addUser({ email: 'finance@shiply.local', name: 'Finance', role: 'admin' });
  // The network's demo office admin opens every app, Shiply included (access profiles, docs/ACCESS.md).
  const finance = await prisma.user.findUnique({
    where: { email: 'finance@shiply.local' },
    include: { access: true },
  });
  if (finance && !finance.access)
    await prisma.$transaction((tx) =>
      writeAccess(tx, finance.id, { ...JOB_ROLE_TEMPLATES.owner, jobRole: 'owner' }, []),
    );
  const pickupAgent = await prisma.agent.upsert({
    where: { code: 'AGCAIRO' },
    update: {},
    create: {
      code: 'AGCAIRO',
      name: 'Cairo Movers',
      phone: '+201005550001',
      email: 'ops@cairomovers.example',
      supplies: 'PICKUP',
      bankName: 'CIB',
      bankAccountName: 'Cairo Movers LLC',
    },
  });
  const deliveryAgent = await prisma.agent.upsert({
    where: { code: 'AGDELTA' },
    update: {},
    create: {
      code: 'AGDELTA',
      name: 'Delta Riders',
      phone: '+201005550002',
      email: 'ops@deltariders.example',
      supplies: 'DELIVERY',
      bankName: 'NBE',
      bankAccountName: 'Delta Riders',
    },
  });
  if (!(await prisma.vehicle.findUnique({ where: { plate: 'ق ط ر 1234' } }))) {
    await prisma.vehicle.create({
      data: {
        agentId: pickupAgent.id,
        plate: 'ق ط ر 1234',
        kind: 'VAN',
        contract: 'FIXED',
        monthlyRent: 1_500_000,
        capacityParcels: 400,
      },
    });
  }
  await addUser({
    email: 'agent@cairomovers.example',
    name: 'Cairo Movers',
    role: 'agent',
    agentId: pickupAgent.id,
    phone: pickupAgent.phone,
  });
  await addUser({
    email: 'agent@deltariders.example',
    name: 'Delta Riders',
    role: 'agent',
    agentId: deliveryAgent.id,
    phone: deliveryAgent.phone,
  });
  let phoneNo = 100;
  const nextPhone = () => `+2010900${String(phoneNo++).padStart(5, '0')}`;
  const slug = (code: string) => code.toLowerCase().replace(/[^a-z]/g, '');
  for (const f of FACILITIES) {
    const id = hubId(f.code);
    await addUser({
      email: `staff.${slug(f.code)}@shiply.local`,
      name: `${f.name} supervisor`,
      role: 'hub_staff',
      hubId: id,
    });
    for (const team of ['INBOUND', 'SORTING', 'OUTBOUND'] as const) {
      await addUser({
        email: `${team.toLowerCase()}.${slug(f.code)}@shiply.local`,
        name: `${f.name} ${team.toLowerCase()}`,
        role: 'hub_staff',
        team,
        hubId: id,
      });
    }
    await addUser({
      email: `courier.${slug(f.code)}@shiply.local`,
      name: `${f.name} pickup courier`,
      role: 'courier',
      hubId: id,
      phone: nextPhone(),
      agentId: pickupAgent.id,
      courierType: 'PICKUP',
    });
  }
  for (const h of LAST_MILE) {
    await addUser({
      email: `staff.${slug(h.code)}@shiply.local`,
      name: `${h.name} staff`,
      role: 'hub_staff',
      hubId: hubId(h.code),
    });
    await addUser({
      email: `courier.${slug(h.code)}@shiply.local`,
      name: `${h.name} courier`,
      role: 'courier',
      hubId: hubId(h.code),
      phone: nextPhone(),
      agentId: deliveryAgent.id,
      courierType: 'DELIVERY',
    });
  }
  const area = await prisma.networkArea.findFirst({ where: { nameEn: 'Heliopolis' } });
  const facility = nearest({ lat: area!.lat!, lng: area!.lng! }, facilities)!;
  // Shiply Now's seed already has Eve Chantelle: the network adds its pickup details to it.
  const eveFields = {
    code: 'EVE',
    pickupAddress: '12 Baghdad St, Heliopolis',
    governorateCode: 'EG-C',
    areaId: area?.id ?? null,
    homeHubId: facility.id,
  };
  const existingEve =
    (await prisma.merchant.findUnique({ where: { code: 'EVE' } })) ??
    (await prisma.merchant.findFirst({ where: { name: 'Eve Chantelle' } }));
  const eve = existingEve
    ? existingEve.code
      ? existingEve
      : await prisma.merchant.update({
          where: { id: existingEve.id },
          // The packaging shop texts the delivery code to the merchant's phone.
          data: { ...eveFields, contactPhone: existingEve.contactPhone ?? '+201001234567' },
        })
    : await prisma.merchant.create({
        data: {
          ...eveFields,
          name: 'Eve Chantelle',
          contactPhone: '+201001234567',
          contactEmail: 'ops@evechantelle.example',
        },
      });
  await addUser({
    email: 'merchant@evechantelle.example',
    name: 'Eve Chantelle',
    role: 'merchant',
    merchantId: eve.id,
  });
  const alx = await prisma.governorate.findUniqueOrThrow({ where: { code: 'EG-ALX' } });
  const nile = await prisma.merchant.upsert({
    where: { code: 'NILE' },
    update: {},
    create: {
      code: 'NILE',
      name: 'Nile Home',
      contactPhone: '+201101234567',
      contactEmail: 'orders@nilehome.example',
      pickupAddress: '40 Fouad St, Alexandria',
      governorateCode: 'EG-ALX',
      homeHubId: nearest(alx, facilities)!.id,
    },
  });
  await addUser({
    email: 'merchant@nilehome.example',
    name: 'Nile Home',
    role: 'merchant',
    merchantId: nile.id,
  });
  // Shiply's packaging shop: merchants who ship next day buy bags and boxes from the sorting
  // facility. Stock comes in through purchase orders, so it starts at zero.
  const owner = await prisma.user.findFirst({
    where: { role: 'admin' },
    orderBy: { createdAt: 'asc' },
  });
  if (owner && !(await prisma.supplier.findFirst({ where: { name: 'Cairo Packaging Co' } })))
    await prisma.supplier.create({
      data: {
        name: 'Cairo Packaging Co',
        phone: '+201001112223',
        taxId: '100-200-300',
        createdById: owner.id,
      },
    });
  const packaging = [
    {
      sku: 'FLY-S',
      name: 'Flyer bags, small',
      nameAr: 'أكياس شحن صغيرة',
      unit: 'Pack of 100',
      price: 9000,
      minStock: 20,
    },
    {
      sku: 'FLY-M',
      name: 'Flyer bags, medium',
      nameAr: 'أكياس شحن متوسطة',
      unit: 'Pack of 100',
      price: 12000,
      minStock: 20,
    },
    {
      sku: 'FLY-L',
      name: 'Flyer bags, large',
      nameAr: 'أكياس شحن كبيرة',
      unit: 'Pack of 50',
      price: 11000,
      minStock: 10,
    },
    {
      sku: 'BOX-M',
      name: 'Carton box, medium',
      nameAr: 'كرتونة متوسطة',
      unit: 'Pack of 20',
      price: 16000,
      minStock: 10,
    },
    {
      sku: 'TAPE',
      name: 'Packing tape',
      nameAr: 'شريط لاصق',
      unit: 'Roll',
      price: 2500,
      minStock: 30,
    },
    {
      sku: 'BUBBLE',
      name: 'Bubble wrap',
      nameAr: 'غلاف فقاعات',
      unit: 'Roll of 10 m',
      price: 6000,
      minStock: 10,
    },
  ];
  for (const p of packaging)
    await prisma.packagingProduct.upsert({ where: { sku: p.sku }, update: {}, create: p });
  log('Parcel network demo: agents, hub staff, couriers, two merchants, packaging');
}
