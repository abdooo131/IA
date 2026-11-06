import type { PrismaClient } from '@prisma/client';
import { addDays, cairoDay, cairoDayStart, GLOBAL_SCOPE, type SettingKey } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { createMerchant, createSku, createUser } from '../admin-ops';
import { ensureEmployees } from '../hr';
import { reportDamage, settleDamage } from '../damage';
import { DomainError } from '../domain-error';
import {
  accountKey,
  approvePayout,
  balanceOf,
  createPayout,
  createSupplier,
  decideFinanceRequest,
  markPayoutPaid,
  merchantOwed,
  payoutNeedsApproval,
  payRiderBonus,
  prepareInvoices,
  recordBankDeposit,
  recordBill,
  recordCashHandover,
  reviewCashHandover,
  riderBonusOwed,
  riderCash,
  setSalary,
  submitBillPayment,
  submitCapitalIn,
  submitExpense,
  submitPayroll,
} from '../finance';
import { accrueStorage } from '../finance/postings';
import { closeManifest, createManifest, receiveOnManifest } from '../inbound';
import {
  acceptOrder,
  cancelOrder,
  completeDelivery,
  createOrder,
  decideFailedOrder,
  failDelivery,
  flagLateOrders,
  handToRider,
  markItemMissing,
  packOrder,
  pickOrderItem,
  recordDeliveryCall,
  returnToStore,
} from '../orders';
import { savePhoto } from '../photos';
import { createReturn, handOverReturn, pickForReturn } from '../returns';
import { getMerchantSetting, getSetting, setSetting } from '../settings';
import { move } from '../stock';
import { rateOrder } from '../tracking';
import {
  closeTransfer,
  createTransfer,
  pickForTransfer,
  receiveTransfer,
  sendTransfer,
} from '../transfers';
import { ean13, MERCHANT as SEED_MERCHANT } from '../seed/data';
import {
  clockedClient,
  installClock,
  realNow,
  restoreClock,
  setContextClock,
  simNow,
} from './clock';
import {
  CANCEL_REASONS,
  COLLECTORS,
  DEMO_APPROVER,
  DEMO_MERCHANTS,
  DEMO_TEAM,
  DOOR_PHOTO_JPEG,
  FIRST_NAMES,
  LAST_NAMES,
  PACK_PHOTO_JPEG,
  STREETS,
} from './data';
import { cutoff, type Random, randomSource, Simulation } from './scheduler';

// Fills a database with one realistic month of activity by calling the real domain
// functions under a simulated clock (see clock.ts). It refuses to run unless DEMO_LOAD is
// "true" and runs once: the last step writes a demo.loaded audit row, and a later run
// stops at once when it finds that row (or the demo merchants of a run that stopped).

export interface DemoOptions {
  /** Password for the demo users it creates (merchant users, extra staff and riders) */
  demoPassword: string;
  /** Days simulated, ending today (Cairo). Default 30. */
  days?: number;
  /** Average orders per day across all stores. Default 20. */
  ordersPerDay?: number;
  /** Random seed, so a run is repeatable. */
  seed?: number;
  /** Simulate the stores side by side (default true; much faster over a remote database). */
  parallel?: boolean;
  log?: (message: string) => void;
}

export type DemoResult =
  | { status: 'already_loaded' | 'partial_run_found' }
  | { status: 'loaded'; seconds: number; counts: Record<string, number> };

const MARKER = 'demo.loaded';
const MIN = 60_000;

/** Fee values used for the demo when the global value is still 0 (piastres or basis points). */
const DEMO_FEES: [SettingKey, number][] = [
  ['fee.order_fixed_piastres', 1500],
  ['fee.order_percent_bp', 150],
  ['fee.cod_percent_bp', 100],
  ['fee.failed_delivery_piastres', 1500],
  ['fee.receiving_per_unit_piastres', 50],
  ['fee.storage_per_unit_month_piastres', 100],
  ['fee.return_per_unit_piastres', 200],
  ['rider.bonus_per_delivery_piastres', 1000],
];

interface SimRider {
  id: string;
  userId: string;
  badge: string;
  busyUntil: number;
}
interface Point {
  lat: number;
  lng: number;
  zoneId: string;
  zoneName: string;
}
interface Customer {
  name: string;
  phone: string;
  address: string;
  point: Point;
}
interface SimStore {
  id: string;
  code: string;
  staffId: string;
  riders: SimRider[];
  points: Point[];
  customers: Customer[];
  hours: Map<number, { opens: number; closes: number; closed: boolean }>;
  receivingBinId: string;
  shelfIds: string[];
  weight: number;
}
interface SimSku {
  id: string;
  sku: string;
  pricePiastres: number;
}
interface SimMerchant {
  id: string;
  name: string;
  actorId: string;
  expressPricePiastres: number;
  skus: SimSku[];
  weight: number;
}

type Outcome = 'deliver' | 'cancel' | 'missing' | 'fail_retry' | 'fail_ship_normally' | 'refused';

/** Loads the demo month. See DemoOptions; returns early when it already ran. */
export async function loadDemo(base: PrismaClient, options: DemoOptions): Promise<DemoResult> {
  if (process.env.DEMO_LOAD !== 'true') throw new Error('Set DEMO_LOAD=true to load demo data');
  const log = options.log ?? (() => undefined);
  if (await base.auditLog.findFirst({ where: { action: MARKER } })) {
    log('Demo data is already loaded; nothing to do');
    return { status: 'already_loaded' };
  }
  if (await base.merchant.findFirst({ where: { name: DEMO_MERCHANTS[0]!.name } })) {
    log(
      `Merchant ${DEMO_MERCHANTS[0]!.name} exists but the demo was never finished; ` +
        'a previous run stopped midway. Load the demo into a fresh database instead.',
    );
    return { status: 'partial_run_found' };
  }

  const started = realNow();
  const days = options.days ?? 30;
  const today = cairoDay(new Date());
  const firstDay = addDays(today, -(days - 1));
  const at = (day: string, hour: number, minute = 0) =>
    cairoDayStart(day).getTime() + (hour * 60 + minute) * MIN;

  installClock(at(firstDay, 7, 30));
  try {
    const db = clockedClient(base);
    const sim = new Simulation(options.parallel ?? true);
    const rnd = randomSource(options.seed ?? 20261102);
    const world = await setUp(db, rnd, options, log);
    const counts = await simulate(db, sim, rnd, world, { firstDay, days, today, at }, options, log);
    await fillEmployeeFiles(db);
    setContextClock(Math.min(realNow() - 1000, Date.now()));
    await db.$transaction((tx) =>
      recordAudit(tx, {
        actorUserId: world.admin,
        action: MARKER,
        entityType: 'demo',
        entityId: 'demo',
        after: { firstDay, lastDay: today, ...counts },
      }),
    );
    const seconds = Math.round((realNow() - started) / 1000);
    log(`Demo month loaded in ${seconds} s`);
    return { status: 'loaded', seconds, counts };
  } finally {
    restoreClock();
  }
}

/** Every demo person gets an employee file with a job title and department (docs/HR.md). */
async function fillEmployeeFiles(db: PrismaClient) {
  await ensureEmployees(db);
  const plain = await db.employee.findMany({
    where: { department: null },
    include: { user: { select: { role: true } } },
  });
  const byRole = {
    admin: ['management', 'Manager'],
    finance: ['finance', 'Accountant'],
    store_staff: ['store', 'Store associate'],
    rider: ['delivery', 'Rider'],
    merchant: ['other', 'Other'],
  } as const;
  for (const e of plain) {
    const [department, jobTitle] = byRole[e.user.role];
    await db.employee.update({ where: { id: e.id }, data: { department, jobTitle } });
  }
}

// ─── set up ────────────────────────────────────────────────────────────────────

type World = Awaited<ReturnType<typeof setUp>>;

async function setUp(
  db: PrismaClient,
  rnd: Random,
  options: DemoOptions,
  log: (m: string) => void,
) {
  const adminUser = await db.user.findFirst({
    where: { role: 'admin', isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!adminUser) throw new Error('Run the seed first: no admin user');
  const admin = adminUser.id;

  const storeRows = await db.darkStore.findMany({
    where: { isActive: true },
    include: { bins: { where: { isActive: true } }, hours: true },
    orderBy: { code: 'asc' },
  });
  const hubRow = storeRows.find((s) => s.kind === 'hub') ?? null;
  const darkStores = storeRows.filter((s) => s.kind === 'dark_store');
  if (darkStores.length === 0) throw new Error('Run the seed first: no dark stores');
  const byCode = new Map(darkStores.map((s) => [s.code, s]));

  // Team: every store gets staff and two or more riders.
  for (const t of DEMO_TEAM) {
    const store = byCode.get(t.storeCode);
    if (!store || (await db.user.findUnique({ where: { email: t.email } }))) continue;
    await createUser(db, {
      email: t.email,
      name: t.name,
      phone: t.phone,
      role: t.role,
      password: options.demoPassword,
      darkStoreId: store.id,
      badgeCode: t.badgeCode ?? null,
      actorUserId: admin,
    });
  }

  const pointsByZone = await db.$queryRaw<
    { zoneId: string; zoneName: string; storeId: string; lat: number; lng: number }[]
  >`SELECT z.id AS "zoneId", z.name_en AS "zoneName", z.dark_store_id AS "storeId",
           ST_Y(p.geom) AS lat, ST_X(p.geom) AS lng
    FROM zones z, LATERAL ST_Dump(ST_GeneratePoints(z.area, 80, 7)) p
    WHERE z.area IS NOT NULL AND z.is_active`;

  const weights: Record<string, number> = { NCR: 45, MAA: 35, ZAM: 20 };
  const stores: SimStore[] = [];
  for (const s of darkStores) {
    const users = await db.user.findMany({
      where: { darkStoreId: s.id, isActive: true, role: { in: ['store_staff', 'rider'] } },
      include: { rider: true },
      orderBy: { createdAt: 'asc' },
    });
    const staff = users.find((u) => u.role === 'store_staff');
    // A rider still carrying an older order (a used database) cannot start a new trip
    // with it, so only riders with nothing on them take part.
    const busy = new Set(
      (
        await db.delivery.findMany({
          where: { status: { in: ['assigned', 'picked_up'] } },
          select: { riderId: true },
        })
      ).map((d) => d.riderId),
    );
    const riders = users.filter(
      (u) => u.rider && u.rider.darkStoreId === s.id && !busy.has(u.rider.id),
    );
    const points = pointsByZone
      .filter((p) => p.storeId === s.id)
      .map((p) => ({ lat: p.lat, lng: p.lng, zoneId: p.zoneId, zoneName: p.zoneName }));
    const receiving = s.bins.find((b) => b.type === 'receiving');
    const shelves = s.bins
      .filter((b) => b.type === 'pickable')
      .sort((a, b) => a.code.localeCompare(b.code));
    if (
      !staff ||
      riders.length === 0 ||
      points.length === 0 ||
      !receiving ||
      shelves.length === 0
    ) {
      log(`Store ${s.code} is left out: it needs staff, a rider, a zone and bins`);
      continue;
    }
    const store: SimStore = {
      id: s.id,
      code: s.code,
      staffId: staff.id,
      riders: riders.map((u) => ({
        id: u.rider!.id,
        userId: u.id,
        badge: u.rider!.badgeCode,
        busyUntil: 0,
      })),
      points,
      customers: [],
      hours: new Map(
        s.hours.map((h) => [
          h.weekday,
          { opens: h.opensMinute, closes: h.closesMinute, closed: h.isClosed },
        ]),
      ),
      receivingBinId: receiving.id,
      shelfIds: shelves.map((b) => b.id),
      weight: weights[s.code] ?? 25,
    };
    for (let i = 0; i < 140; i++) store.customers.push(newCustomer(rnd, store));
    stores.push(store);
  }
  if (stores.length === 0) throw new Error('No store can take orders');

  // Finance: the person who prepares and a different person who approves.
  const financeUsers = await db.user.findMany({
    where: { role: 'finance', isActive: true },
    include: { access: { select: { accounting: true } } },
    orderBy: { createdAt: 'asc' },
  });
  let preparer = financeUsers[0]?.id;
  if (!preparer) {
    preparer = (
      await createUser(db, {
        email: 'demo.finance@shiplynow.local',
        name: 'Nadia Mostafa',
        phone: '+201500000902',
        role: 'finance',
        password: options.demoPassword,
        jobRole: 'finance_officer',
        actorUserId: admin,
      })
    ).id;
  }
  let approver = financeUsers.find(
    (u) => u.id !== preparer && u.access?.accounting === 'manage',
  )?.id;
  if (!approver) {
    approver = (
      await createUser(db, {
        ...DEMO_APPROVER,
        role: 'finance',
        password: options.demoPassword,
        jobRole: 'finance_manager',
        actorUserId: admin,
      })
    ).id;
  }

  // Merchants: the seed's merchant plus two new ones, each with a 60 minute price.
  const merchants: SimMerchant[] = [];
  const existing = await db.merchant.findFirst({
    where: { name: SEED_MERCHANT.name, isActive: true },
    include: { skus: { where: { isActive: true } }, users: { where: { isActive: true } } },
  });
  if (existing && existing.skus.length > 0) {
    if (existing.expressPricePiastres == null) await setExpressPrice(db, existing.id, 4500, admin);
    merchants.push({
      id: existing.id,
      name: existing.name,
      actorId: existing.users.find((u) => u.role === 'merchant')?.id ?? admin,
      expressPricePiastres: existing.expressPricePiastres ?? 4500,
      skus: existing.skus.map((k) => ({ id: k.id, sku: k.sku, pricePiastres: k.pricePiastres })),
      weight: 40,
    });
  }
  for (const [i, m] of DEMO_MERCHANTS.entries()) {
    const merchant = await createMerchant(db, {
      name: m.name,
      contactEmail: m.contactEmail,
      contactPhone: m.contactPhone,
      actorUserId: admin,
    });
    const user = await createUser(db, {
      email: m.user.email,
      name: m.user.name,
      phone: m.user.phone,
      role: 'merchant',
      password: options.demoPassword,
      merchantId: merchant.id,
      actorUserId: admin,
    });
    const skus: SimSku[] = [];
    for (const [j, p] of m.products.entries()) {
      const sku = await createSku(db, {
        merchantId: merchant.id,
        sku: p.sku,
        barcode: ean13(`${m.barcodePrefix}${String(j + 1).padStart(5, '0')}`),
        titleEn: p.titleEn,
        titleAr: p.titleAr,
        pricePiastres: p.pricePiastres,
        weightGrams: p.weightGrams,
        actorUserId: admin,
      });
      skus.push({ id: sku.id, sku: sku.sku, pricePiastres: sku.pricePiastres });
    }
    await setExpressPrice(db, merchant.id, m.expressPricePiastres, user.id);
    merchants.push({
      id: merchant.id,
      name: merchant.name,
      actorId: user.id,
      expressPricePiastres: m.expressPricePiastres,
      skus,
      weight: i === 0 ? 35 : 25,
    });
  }
  log(`Merchants: ${merchants.map((m) => `${m.name} (${m.skus.length} products)`).join(', ')}`);

  // Fees for the demo, only where nobody has set them yet.
  for (const [key, value] of DEMO_FEES) {
    if ((await getSetting(db, key)) === 0)
      await setSetting(db, { key, value, scope: GLOBAL_SCOPE, actorUserId: admin });
  }

  // Salaries for the store teams (riders are on salary plus a bonus per delivery).
  const team = await db.user.findMany({
    where: {
      isActive: true,
      employment: 'employee',
      role: { in: ['store_staff', 'rider'] },
      darkStoreId: { in: stores.map((s) => s.id) },
    },
    include: { salary: true },
  });
  for (const u of team) {
    if (u.salary) continue;
    await setSalary(db, {
      userId: u.id,
      monthlyPiastres: u.role === 'rider' ? 700_000 : 900_000,
      actorUserId: admin,
    });
  }

  const accounts = await db.ledgerAccount.findMany({
    where: {
      key: {
        in: ['bank', 'expense:rent', 'expense:utilities', 'expense:fuel', 'expense:packaging'],
      },
    },
  });
  const account = (key: string) => {
    const a = accounts.find((x) => x.key === key);
    if (!a) throw new Error(`Run the seed first: ledger account ${key} is missing`);
    return a.id;
  };

  log(
    `Stores: ${stores.map((s) => `${s.code} (${s.riders.length} riders)`).join(', ')}` +
      (hubRow ? `; shipments go through hub ${hubRow.code}` : ''),
  );
  return {
    admin,
    preparer,
    approver,
    stores,
    merchants,
    hub: hubRow
      ? {
          id: hubRow.id,
          code: hubRow.code,
          receivingBinId: hubRow.bins.find((b) => b.type === 'receiving')?.id ?? null,
          shelfIds: hubRow.bins
            .filter((b) => b.type === 'pickable')
            .sort((a, b) => a.code.localeCompare(b.code))
            .map((b) => b.id),
        }
      : null,
    bank: account('bank'),
    rent: account('expense:rent'),
    utilities: account('expense:utilities'),
    fuel: account('expense:fuel'),
    packaging: account('expense:packaging'),
  };
}

function setExpressPrice(db: PrismaClient, merchantId: string, price: number, actor: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    await tx.merchant.update({ where: { id: merchantId }, data: { expressPricePiastres: price } });
    await recordAudit(tx, {
      actorUserId: actor,
      action: 'merchant.express_price',
      entityType: 'merchant',
      entityId: merchantId,
      before: { expressPricePiastres: before.expressPricePiastres },
      after: { expressPricePiastres: price },
    });
  });
}

function newCustomer(rnd: Random, store: SimStore): Customer {
  const point = rnd.pick(store.points);
  const prefix = rnd.weighted([
    ['10', 40],
    ['11', 25],
    ['12', 25],
    ['15', 10],
  ] as const);
  const phone = `+20${prefix}${String(rnd.int(0, 99_999_999)).padStart(8, '0')}`;
  const building = rnd.int(1, 120);
  const flat = rnd.int(1, 24);
  return {
    name: `${rnd.pick(FIRST_NAMES)} ${rnd.pick(LAST_NAMES)}`,
    phone,
    point,
    address: `Building ${building}, ${rnd.pick(STREETS)}, flat ${flat}, ${point.zoneName}, Cairo`,
  };
}

// ─── simulation ────────────────────────────────────────────────────────────────

interface Timeline {
  firstDay: string;
  days: number;
  today: string;
  at: (day: string, hour: number, minute?: number) => number;
}

async function simulate(
  db: PrismaClient,
  sim: Simulation,
  rnd: Random,
  w: World,
  t: Timeline,
  options: DemoOptions,
  log: (m: string) => void,
) {
  const c = {
    orders: 0,
    delivered: 0,
    cancelled: 0,
    failedAttempts: 0,
    failedForGood: 0,
    retriedDelivered: 0,
    missingAtPick: 0,
    ratings: 0,
    lateChecks: 0,
    handovers: 0,
    deposits: 0,
    payouts: 0,
    expenses: 0,
    manifests: 0,
    transfers: 0,
    storageDays: 0,
    errors: 0,
    skippedEvents: 0,
    feeSettingFixed: 0,
  };
  const startedAt = realNow();
  const avail = new Map<string, number>();
  const key = (storeId: string, skuId: string) => `${storeId}:${skuId}`;
  const now = () => simNow();
  const minutesLater = (m: number) => now().getTime() + Math.round(m * MIN);
  const lateWindows: { from: number; to: number }[] = [];
  const pendingHandovers: string[] = [];
  const storeOf = new Map(w.stores.map((s) => [s.id, s]));

  async function loadAvailability() {
    avail.clear();
    const buffer = new Map<string, number>();
    for (const s of w.stores) buffer.set(s.id, await getSetting(db, 'stock.buffer_units', s.id));
    const levels = await db.stockLevel.findMany({
      where: { darkStoreId: { in: w.stores.map((s) => s.id) } },
    });
    for (const l of levels)
      avail.set(
        key(l.darkStoreId, l.skuId),
        Math.max(0, l.onHand - l.reserved - (buffer.get(l.darkStoreId) ?? 0)),
      );
  }

  const photo = (kind: 'pack' | 'delivery', jpeg: string, actor: string) =>
    savePhoto(db, {
      kind,
      contentType: 'image/jpeg',
      data: Buffer.from(jpeg, 'base64'),
      actorUserId: actor,
    });

  /** Logs a refusal from the rules and carries on; anything else stops the run. */
  async function guarded(what: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      c.errors++;
      if (c.errors <= 25) log(`  refused (${what}): ${error.code}`);
    }
  }

  // ── stock in: shipments (through the hub when one exists), receiving, put away ──

  async function putAway(
    storeId: string,
    fromBinId: string,
    shelfIds: string[],
    skuId: string,
    qty: number,
    tag: string,
  ) {
    const index = Math.abs(hash(skuId)) % shelfIds.length;
    await move(db, {
      skuId,
      fromBinId,
      toBinId: shelfIds[index]!,
      quantity: qty,
      reason: 'put_away',
      actorUserId: storeOf.get(storeId)?.staffId ?? w.admin,
      idempotencyKey: `putaway:demo:${tag}:${storeId}:${skuId}`,
    });
  }

  /** One round of shipments: plan[storeId][skuId] = units each store should get. */
  async function ship(round: string, plan: Map<string, Map<string, number>>) {
    for (const m of w.merchants) {
      const skuIds = new Set(m.skus.map((k) => k.id));
      const destinations = w.hub ? [w.hub.id] : w.stores.map((s) => s.id);
      for (const dest of destinations) {
        const lines = new Map<string, number>();
        for (const [storeId, perSku] of plan) {
          if (!w.hub && storeId !== dest) continue;
          for (const [skuId, qty] of perSku)
            if (skuIds.has(skuId) && qty > 0) lines.set(skuId, (lines.get(skuId) ?? 0) + qty);
        }
        if (lines.size === 0) continue;
        const destCode = w.hub?.id === dest ? w.hub.code : storeOf.get(dest)!.code;
        setContextClock(now().getTime() + rnd.int(3, 12) * MIN);
        const manifest = await createManifest(db, {
          merchantId: m.id,
          darkStoreId: dest,
          reference: `ASN-${round}-${destCode}`,
          note: round === 'R1' ? 'Opening stock for the 60 minute service' : 'Restock',
          expectedAt: new Date(now().getTime() + 2 * 3600_000),
          lines: [...lines].map(([skuId, expectedQty]) => ({ skuId, expectedQty })),
          actorUserId: m.actorId,
        });
        c.manifests++;
        manifestsToReceive.push({ id: manifest.id, dest, lines, merchant: m });
      }
    }
  }
  const manifestsToReceive: {
    id: string;
    dest: string;
    lines: Map<string, number>;
    merchant: SimMerchant;
  }[] = [];

  async function receiveAll(round: string, plan: Map<string, Map<string, number>>) {
    const hub = w.hub;
    for (const mf of manifestsToReceive.splice(0)) {
      const isHub = hub?.id === mf.dest;
      const staffId = isHub ? w.admin : storeOf.get(mf.dest)!.staffId;
      let first = true;
      for (const [skuId, expected] of mf.lines) {
        // Now and then a line arrives one short or one extra; everything that arrives is received.
        const roll = first ? 1 : rnd.next();
        const qty = roll < 0.03 ? Math.max(1, expected - 1) : roll < 0.06 ? expected + 1 : expected;
        first = false;
        setContextClock(now().getTime() + rnd.int(8, 20) * 1000);
        await receiveOnManifest(db, {
          manifestId: mf.id,
          darkStoreId: mf.dest,
          skuId,
          quantity: qty,
          actorUserId: staffId,
          idempotencyKey: `demo:${mf.id}:${skuId}`,
        });
        mf.lines.set(skuId, qty);
      }
      await closeManifest(db, { manifestId: mf.id, darkStoreId: mf.dest, actorUserId: staffId });
      setContextClock(now().getTime() + 5 * MIN);
      const bins = isHub ? hub! : storeOf.get(mf.dest)!;
      for (const [skuId, qty] of mf.lines) {
        setContextClock(now().getTime() + 15_000);
        await putAway(
          mf.dest,
          bins.receivingBinId!,
          bins.shelfIds,
          skuId,
          qty,
          `${round}:${mf.id}`,
        );
      }
    }
    if (!hub) return;
    // From the hub, one transfer per store carries what each store should get, never more
    // than the hub holds free (a line may have arrived short).
    const hubLevels = await db.stockLevel.findMany({ where: { darkStoreId: hub.id } });
    const hubFree = new Map(hubLevels.map((l) => [l.skuId, l.onHand - l.reserved]));
    for (const [storeId, perSku] of plan) {
      const store = storeOf.get(storeId)!;
      const lines: { skuId: string; quantity: number }[] = [];
      for (const [skuId, want] of perSku) {
        const quantity = Math.min(want, hubFree.get(skuId) ?? 0);
        if (quantity <= 0) continue;
        hubFree.set(skuId, (hubFree.get(skuId) ?? 0) - quantity);
        lines.push({ skuId, quantity });
      }
      if (lines.length === 0) continue;
      setContextClock(now().getTime() + 5 * MIN);
      const transfer = await createTransfer(db, {
        fromId: hub.id,
        toId: storeId,
        lines,
        note: `Demo ${round} to ${store.code}`,
        actorUserId: w.admin,
      });
      for (const l of lines) {
        setContextClock(now().getTime() + 20_000);
        await pickForTransfer(db, {
          transferId: transfer.id,
          darkStoreId: hub.id,
          skuId: l.skuId,
          quantity: l.quantity,
          actorUserId: w.admin,
          idempotencyKey: `demo:${transfer.id}:${l.skuId}`,
        });
      }
      await sendTransfer(db, {
        transferId: transfer.id,
        darkStoreId: hub.id,
        actorUserId: w.admin,
      });
      setContextClock(now().getTime() + rnd.int(35, 60) * MIN);
      for (const l of lines) {
        setContextClock(now().getTime() + 15_000);
        await receiveTransfer(db, {
          transferId: transfer.id,
          darkStoreId: storeId,
          skuId: l.skuId,
          quantity: l.quantity,
          actorUserId: store.staffId,
          idempotencyKey: `demo:${transfer.id}:in:${l.skuId}`,
        });
      }
      await closeTransfer(db, {
        transferId: transfer.id,
        darkStoreId: storeId,
        actorUserId: store.staffId,
      });
      for (const l of lines) {
        setContextClock(now().getTime() + 15_000);
        await putAway(
          storeId,
          store.receivingBinId,
          store.shelfIds,
          l.skuId,
          l.quantity,
          `${round}:${transfer.id}`,
        );
      }
      c.transfers++;
    }
  }

  function stockPlan(round: 'R1' | 'R2') {
    const plan = new Map<string, Map<string, number>>();
    for (const s of w.stores) {
      const perSku = new Map<string, number>();
      // Bigger stores hold more; the restock tops each product up to its target.
      const target = Math.round(14 + (s.weight / 45) * 18);
      for (const m of w.merchants)
        for (const k of m.skus) {
          const have = avail.get(key(s.id, k.id)) ?? 0;
          const want = target + rnd.int(-3, 4);
          const qty = round === 'R1' ? Math.max(0, want - have) : have < target ? want - have : 0;
          if (qty >= 3) perSku.set(k.id, qty);
        }
      plan.set(s.id, perSku);
    }
    return plan;
  }

  async function stockRound(day: string, round: 'R1' | 'R2') {
    sim.atGlobal(t.at(day, 8, 0), async () => {
      await loadAvailability();
      const plan = stockPlan(round);
      await ship(round, plan);
      setContextClock(t.at(day, 9, 0));
      await receiveAll(round, plan);
      await loadAvailability();
      log(`  ${day}: shipments ${round} received and put away`);
    });
  }

  // ── orders ──

  function outcomeFor(dayIndex: number, items: number): Outcome {
    const lastDays = dayIndex >= t.days - 2;
    return rnd.weighted<Outcome>([
      ['deliver', 848],
      ['cancel', 45],
      ['missing', items > 1 ? 30 : 0],
      ['fail_retry', lastDays ? 0 : 18],
      ['fail_ship_normally', lastDays ? 0 : 22],
      ['refused', 22],
    ]);
  }

  function chooseItems(store: SimStore, merchant: SimMerchant) {
    const count = rnd.weighted([
      [1, 50],
      [2, 35],
      [3, 15],
    ] as const);
    const items: { skuId: string; quantity: number }[] = [];
    const candidates = merchant.skus.filter((k) => (avail.get(key(store.id, k.id)) ?? 0) > 0);
    for (let i = 0; i < count && candidates.length > 0; i++) {
      const k = candidates.splice(rnd.int(0, candidates.length - 1), 1)[0]!;
      const have = avail.get(key(store.id, k.id)) ?? 0;
      const qty = Math.min(
        have,
        rnd.weighted([
          [1, 80],
          [2, 17],
          [3, 3],
        ] as const),
      );
      avail.set(key(store.id, k.id), have - qty);
      items.push({ skuId: k.id, quantity: qty });
    }
    return items;
  }

  function freeRider(store: SimStore) {
    const ms = now().getTime();
    const free = store.riders.filter((r) => r.busyUntil <= ms);
    if (free.length > 0) return { rider: rnd.pick(free), waitUntil: 0 };
    return { rider: null, waitUntil: Math.min(...store.riders.map((r) => r.busyUntil)) };
  }

  function placeOrder(store: SimStore, dayIndex: number) {
    return async () => {
      const merchant = rnd.weighted(w.merchants.map((m) => [m, m.weight] as const));
      const items = chooseItems(store, merchant);
      if (items.length === 0) return;
      // About one order in four is a returning customer.
      const customer =
        rnd.chance(0.75) || store.customers.length === 0
          ? newCustomer(rnd, store)
          : rnd.pick(store.customers);
      if (!store.customers.includes(customer) && store.customers.length < 600)
        store.customers.push(customer);
      const outcome = outcomeFor(dayIndex, items.length);
      const order = await createOrder(db, {
        merchantId: merchant.id,
        darkStoreId: store.id,
        zoneId: customer.point.zoneId,
        source: 'manual',
        customerName: customer.name,
        customerPhone: customer.phone,
        addressText: customer.address,
        latitude: customer.point.lat,
        longitude: customer.point.lng,
        paymentMethod: rnd.chance(0.7) ? 'cod' : 'prepaid',
        deliveryFeePiastres: merchant.expressPricePiastres,
        items,
        placedAt: now(),
        actorUserId: merchant.actorId,
      });
      c.orders++;
      if (order.status !== 'new') return;
      const o = { id: order.id, store, merchant, outcome, items };
      sim.atStore(store.id, minutesLater(rnd.between(0.5, 2.5)), async () => {
        await acceptOrder(db, { orderId: o.id, darkStoreId: store.id, actorUserId: store.staffId });
        if (o.outcome === 'cancel') {
          sim.atStore(store.id, minutesLater(rnd.between(1, 6)), async () => {
            const byMerchant = rnd.chance(0.5);
            await cancelOrder(db, {
              orderId: o.id,
              reason: rnd.pick(CANCEL_REASONS),
              actorUserId: byMerchant ? merchant.actorId : store.staffId,
            });
            for (const i of o.items) {
              const k = key(store.id, i.skuId);
              avail.set(k, (avail.get(k) ?? 0) + i.quantity);
            }
            c.cancelled++;
          });
          return;
        }
        sim.atStore(store.id, minutesLater(rnd.between(2, 6)), () => pick(o));
      });
    };
  }

  type Live = {
    id: string;
    store: SimStore;
    merchant: SimMerchant;
    outcome: Outcome;
    items: { skuId: string; quantity: number }[];
  };

  async function pick(o: Live) {
    for (const [i, item] of o.items.entries()) {
      setContextClock(now().getTime() + Math.round(rnd.between(0.5, 2) * MIN));
      const last = i === o.items.length - 1;
      if (o.outcome === 'missing' && last) {
        await markItemMissing(db, {
          orderId: o.id,
          darkStoreId: o.store.id,
          skuId: item.skuId,
          quantity: item.quantity,
          actorUserId: o.store.staffId,
          idempotencyKey: `demo:${o.id}:${item.skuId}`,
        });
        c.missingAtPick++;
        continue;
      }
      await pickOrderItem(db, {
        orderId: o.id,
        darkStoreId: o.store.id,
        skuId: item.skuId,
        quantity: item.quantity,
        actorUserId: o.store.staffId,
        idempotencyKey: `demo:${o.id}:${item.skuId}`,
      });
    }
    sim.atStore(o.store.id, minutesLater(rnd.between(1.5, 4)), async () => {
      const p = await photo('pack', PACK_PHOTO_JPEG, o.store.staffId);
      await packOrder(db, {
        orderId: o.id,
        darkStoreId: o.store.id,
        photoId: p.id,
        actorUserId: o.store.staffId,
      });
      sim.atStore(o.store.id, minutesLater(rnd.between(0.5, 3)), () => handOver(o, 1));
    });
  }

  async function handOver(o: Live, attempt: number) {
    const { rider, waitUntil } = freeRider(o.store);
    if (!rider) {
      sim.atStore(o.store.id, waitUntil + 30_000, () => handOver(o, attempt));
      return;
    }
    const at = now();
    await handToRider(db, {
      orderId: o.id,
      darkStoreId: o.store.id,
      badgeCode: rider.badge,
      actorUserId: o.store.staffId,
      now: at,
    });
    const late = rnd.chance(0.1);
    const ride = late ? rnd.between(42, 62) : rnd.between(9, 30);
    const start = at.getTime();
    rider.busyUntil = start + (ride + rnd.between(8, 16)) * MIN;
    if (ride > 36) lateWindows.push({ from: start + 36 * MIN, to: start + ride * MIN });
    sim.atStore(o.store.id, start + Math.round(ride * MIN), () => arrive(o, rider, attempt));
  }

  async function arrive(o: Live, rider: SimRider, attempt: number) {
    const delivery = await db.delivery.findFirstOrThrow({
      where: { orderId: o.id, status: 'picked_up' },
      select: {
        id: true,
        codExpectedPiastres: true,
        order: { select: { deliveryOtp: true, trackingToken: true, paymentMethod: true } },
      },
    });
    const fails =
      attempt === 1 &&
      (o.outcome === 'fail_retry' || o.outcome === 'fail_ship_normally' || o.outcome === 'refused');
    if (!fails) {
      const byCode = rnd.chance(0.85);
      const proof = byCode ? null : await photo('delivery', DOOR_PHOTO_JPEG, rider.userId);
      await completeDelivery(db, {
        deliveryId: delivery.id,
        riderUserId: rider.userId,
        otp: byCode ? delivery.order.deliveryOtp : undefined,
        photoId: proof?.id,
        codCollectedPiastres:
          delivery.order.paymentMethod === 'cod' && delivery.codExpectedPiastres > 0
            ? delivery.codExpectedPiastres
            : undefined,
        now: now(),
      });
      c.delivered++;
      if (attempt > 1) c.retriedDelivered++;
      if (rnd.chance(0.35) && delivery.order.trackingToken) {
        const token = delivery.order.trackingToken;
        sim.atStore(o.store.id, minutesLater(rnd.between(10, 150)), async () => {
          const stars = rnd.weighted([
            [5, 60],
            [4, 28],
            [3, 9],
            [2, 2],
            [1, 1],
          ] as const);
          await rateOrder(db, {
            token,
            stars,
            comment: stars <= 2 ? 'The rider could not find the building at first' : null,
          });
          c.ratings++;
        });
      }
      return;
    }
    const reason =
      o.outcome === 'refused'
        ? 'refused'
        : rnd.weighted([
            ['no_answer', 50],
            ['wrong_address', 25],
            ['reschedule_requested', 25],
          ] as const);
    let photoId: string | undefined;
    if (reason === 'no_answer') {
      const calls = await getSetting(db, 'delivery.min_calls_no_answer', o.store.id);
      for (let i = 0; i < calls; i++) {
        setContextClock(now().getTime() + rnd.int(60, 150) * 1000);
        await recordDeliveryCall(db, { deliveryId: delivery.id, riderUserId: rider.userId });
      }
      photoId = (await photo('delivery', DOOR_PHOTO_JPEG, rider.userId)).id;
    }
    const result = await failDelivery(db, {
      deliveryId: delivery.id,
      riderUserId: rider.userId,
      reason,
      photoId,
      now: now(),
    });
    c.failedAttempts++;
    // The rider brings the goods back on the way to the store.
    sim.atStore(o.store.id, minutesLater(rnd.between(15, 40)), async () => {
      await returnToStore(db, {
        orderId: o.id,
        darkStoreId: o.store.id,
        actorUserId: o.store.staffId,
        now: now(),
      });
      if (result.status === 'failed') {
        c.failedForGood++;
        return;
      }
      // The merchant decides: try again (the same evening when there is time, else the next
      // day around noon), or ship it normally.
      const evening = minutesLater(rnd.between(90, 180));
      const sameDay =
        o.outcome === 'fail_retry' &&
        evening < cairoDayStart(cairoDay(now())).getTime() + (21 * 60 + 30) * MIN;
      const next = sameDay
        ? evening
        : cairoDayStart(addDays(cairoDay(now()), 1)).getTime() + rnd.int(11 * 60, 13 * 60) * MIN;
      sim.atStore(o.store.id, next, async () => {
        if (o.outcome === 'fail_retry') {
          await decideFailedOrder(db, {
            orderId: o.id,
            decision: { action: 'retry' },
            actorUserId: o.merchant.actorId,
            merchantId: o.merchant.id,
            now: now(),
          });
          sim.atStore(o.store.id, minutesLater(rnd.between(3, 15)), () => handOver(o, attempt + 1));
        } else {
          await decideFailedOrder(db, {
            orderId: o.id,
            decision: { action: 'ship_normally', reason: 'Customer asked for delivery next week' },
            actorUserId: o.merchant.actorId,
            merchantId: o.merchant.id,
            now: now(),
          });
          c.failedForGood++;
        }
      });
    });
  }

  // ── company wide events ──

  const supplier: { id?: string; billId?: string; billTotal?: number } = {};

  async function twoPeople(
    result: { status: 'posted' } | { status: 'pending'; request: { id: string } },
  ) {
    if (result.status === 'pending')
      await decideFinanceRequest(db, {
        requestId: result.request.id,
        approve: true,
        note: 'Checked against the receipt',
        actorUserId: w.approver,
      });
  }

  async function storeBox(storeId: string) {
    return balanceOf(db, { type: 'store_cash', darkStoreId: storeId });
  }

  async function monthlyCosts(day: string) {
    for (const s of w.stores) {
      await twoPeople(
        await submitExpense(db, {
          expenseAccountId: w.rent,
          paidFromAccountId: w.bank,
          amountPiastres: Math.round((18_000 + (s.weight / 45) * 10_000) / 500) * 50_000,
          reference: `RENT-${s.code}-${day.slice(0, 7)}`,
          memo: `Rent ${s.code} ${day.slice(0, 7)}`,
          darkStoreId: s.id,
          actorUserId: w.preparer,
          idempotencyKey: `demo:rent:${s.code}:${day.slice(0, 7)}`,
        }),
      );
      await twoPeople(
        await submitExpense(db, {
          expenseAccountId: w.utilities,
          paidFromAccountId: w.bank,
          amountPiastres: 120_000,
          reference: `WE-${s.code}-${day.slice(0, 7)}`,
          memo: `Internet and phone line ${s.code}`,
          darkStoreId: s.id,
          actorUserId: w.preparer,
          idempotencyKey: `demo:internet:${s.code}:${day.slice(0, 7)}`,
        }),
      );
      c.expenses += 2;
    }
  }

  const ordersPerDay = options.ordersPerDay ?? 20;
  const realCutoff = cutoff();
  for (let d = 0; d < t.days; d++) {
    const day = addDays(t.firstDay, d);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const isToday = day === t.today;

    if (d === 0) {
      sim.atGlobal(t.at(day, 7, 40), async () => {
        await twoPeople(
          await submitCapitalIn(db, {
            moneyAccountId: w.bank,
            amountPiastres: 60_000_000,
            reference: 'CAP-2026-001',
            memo: 'Owner capital for the pilot',
            actorUserId: w.preparer,
            idempotencyKey: 'demo:capital',
          }),
        );
        await monthlyCosts(day);
        const existing = await db.supplier.findFirst({ where: { name: 'Nile Packaging Co.' } });
        supplier.id =
          existing?.id ??
          (
            await createSupplier(db, {
              name: 'Nile Packaging Co.',
              taxId: '512334781',
              phone: '+201001234567',
              whtBp: 100,
              defaultExpenseAccountId: w.packaging,
              actorUserId: w.preparer,
            })
          ).id;
        log(`  ${day}: capital in, rent and internet paid, supplier ready`);
      });
      await stockRound(day, 'R1');
    }
    const restockDay = d === Math.min(14, t.days - 1) && d > 0;
    if (restockDay) await stockRound(day, 'R2');
    if (d === Math.min(4, t.days - 1) && d > 0) {
      sim.atGlobal(t.at(day, 10, 15), async () => {
        if (!supplier.id) return;
        const bill = await recordBill(db, {
          supplierId: supplier.id,
          reference: 'NPC-INV-2291',
          billDate: day,
          dueDate: addDays(day, 30),
          netPiastres: 1_200_000,
          vatPiastres: 168_000,
          memo: 'Boxes, bags and tape for the three stores',
          actorUserId: w.preparer,
          idempotencyKey: 'demo:bill:NPC-INV-2291',
        });
        supplier.billId = bill.id;
        supplier.billTotal = bill.totalPiastres;
      });
    }
    if (d === Math.min(19, t.days - 1) && d > 0) {
      sim.atGlobal(t.at(day, 10, 20), async () => {
        if (!supplier.billId || !supplier.billTotal) return;
        await twoPeople(
          await submitBillPayment(db, {
            billId: supplier.billId,
            amountPiastres: supplier.billTotal,
            moneyAccountId: w.bank,
            reference: 'CIB-TRF-88120',
            actorUserId: w.preparer,
            idempotencyKey: 'demo:bill-payment:NPC-INV-2291',
          }),
        );
      });
    }

    // Morning: finance settles yesterday's cash differences and banks the store boxes.
    sim.atGlobal(t.at(day, 10, 0), async () => {
      for (const id of pendingHandovers.splice(0)) {
        await reviewCashHandover(db, {
          handoverId: id,
          decision: 'write_off',
          note: 'Small shortage, counted twice; written off',
          actorUserId: w.preparer,
        });
      }
      if (d > 0 && d % 3 === 0) {
        for (const s of w.stores) {
          const box = await storeBox(s.id);
          if (box <= 0) continue;
          await recordBankDeposit(db, {
            darkStoreId: s.id,
            amountPiastres: box,
            reference: `DEP-${s.code}-${day}`,
            actorUserId: w.preparer,
            idempotencyKey: `demo:deposit:${s.code}:${day}`,
          });
          c.deposits++;
        }
      }
    });

    // Thursdays: fuel for the riders' motorbikes, paid from the store box when it holds enough.
    if (weekday === 4) {
      sim.atGlobal(t.at(day, 13, 0), async () => {
        for (const s of w.stores) {
          const amount = 150_000 * Math.max(1, s.riders.length - 1);
          const boxAccount = await db.ledgerAccount.findUnique({
            where: { key: accountKey({ type: 'store_cash', darkStoreId: s.id }) },
          });
          const fromBox = boxAccount && (await storeBox(s.id)) >= amount;
          await twoPeople(
            await submitExpense(db, {
              expenseAccountId: w.fuel,
              paidFromAccountId: fromBox ? boxAccount.id : w.bank,
              amountPiastres: amount,
              reference: `FUEL-${s.code}-${day}`,
              memo: `Fuel for riders ${s.code}`,
              darkStoreId: s.id,
              actorUserId: w.preparer,
              idempotencyKey: `demo:fuel:${s.code}:${day}`,
            }),
          );
          c.expenses++;
        }
      });
    }

    // Sundays: weekly payouts of what we owe each merchant up to the end of Saturday.
    if (weekday === 0 && d > 0) {
      sim.atGlobal(t.at(day, 12, 0), async () => {
        const cutoffAt = cairoDayStart(day);
        for (const m of w.merchants) {
          if (await db.payout.findFirst({ where: { merchantId: m.id, status: 'draft' } })) continue;
          if (Math.min(await merchantOwed(db, m.id, cutoffAt), await merchantOwed(db, m.id)) <= 0)
            continue;
          const payout = await createPayout(db, {
            merchantId: m.id,
            cutoffAt,
            note: `Weekly payout up to ${addDays(day, -1)}`,
            actorUserId: w.preparer,
          });
          if (await payoutNeedsApproval(db, payout.amountPiastres))
            await approvePayout(db, { payoutId: payout.id, actorUserId: w.approver });
          setContextClock(now().getTime() + 40 * MIN);
          await markPayoutPaid(db, {
            payoutId: payout.id,
            reference: `CIB-PAY-${day.replace(/-/g, '')}-${payout.number}`,
            actorUserId: w.preparer,
          });
          c.payouts++;
        }
      });
    }

    // First day of a month: last month's salaries and rider bonuses, tax invoices, new rent.
    if (day.endsWith('-01') && d > 0) {
      const month = addDays(day, -1).slice(0, 7);
      sim.atGlobal(t.at(day, 10, 30), async () => {
        const salaries = await db.staffSalary.findMany({
          where: { user: { isActive: true, employment: 'employee' }, monthlyPiastres: { gt: 0 } },
        });
        if (salaries.length > 0) {
          await twoPeople(
            await submitPayroll(db, {
              month,
              moneyAccountId: w.bank,
              lines: salaries.map((s) => ({ userId: s.userId })),
              actorUserId: w.preparer,
            }),
          );
          log(`  ${day}: salaries for ${month} paid (${salaries.length} people)`);
        }
        for (const s of w.stores)
          for (const r of s.riders) {
            const owed = await riderBonusOwed(db, r.id);
            if (owed <= 0) continue;
            await payRiderBonus(db, {
              riderId: r.id,
              amountPiastres: owed,
              from: 'bank',
              reference: `BONUS-${month}-${r.badge}`,
              actorUserId: w.preparer,
              idempotencyKey: `demo:bonus:${month}:${r.id}`,
            });
          }
        setContextClock(t.at(day, 14, 0));
        const invoices = await prepareInvoices(db, { month, actorUserId: w.preparer, now: now() });
        log(`  ${day}: tax invoices for ${month}: ${JSON.stringify(invoices)}`);
        setContextClock(t.at(day, 15, 0));
        await monthlyCosts(day);
      });
    }

    // One return to a merchant and two damage reports, to fill those screens.
    if (d === Math.max(1, t.days - 6)) {
      sim.atGlobal(t.at(day, 12, 30), async () => {
        await loadAvailability();
        await guarded('return', () => demoReturn());
        await guarded('damage', () => demoDamage());
      });
    }

    // Orders through the day, while the store is open.
    const dayOrders = Math.max(
      1,
      Math.round(ordersPerDay * (weekday === 5 ? 1.15 : 1) + rnd.between(-4, 4)),
    );
    const totalWeight = w.stores.reduce((s, x) => s + x.weight, 0);
    for (const s of w.stores) {
      const hours = s.hours.get(weekday);
      if (hours?.closed) continue;
      // Shipments are received and put away before the day's first order.
      const firstOrder =
        d === 0
          ? w.hub
            ? 16 * 60
            : 13 * 60
          : restockDay
            ? w.hub
              ? 14 * 60
              : 11 * 60
            : 10 * 60 + 15;
      const opens = Math.max((hours?.opens ?? 600) + 20, firstOrder);
      const closes = Math.min((hours?.closes ?? 1440) - 100, 22 * 60);
      if (closes <= opens) continue;
      const n = Math.round((dayOrders * s.weight) / totalWeight + rnd.between(-1, 1));
      const times: number[] = [];
      for (let i = 0; i < n; i++) {
        // Busier around lunch and in the evening.
        const minute = rnd.chance(0.55)
          ? rnd.between(Math.max(opens, 18 * 60), closes)
          : rnd.between(opens, Math.min(closes, 18 * 60));
        times.push(t.at(day, 0, Math.round(minute)) + rnd.int(0, 59) * 1000);
      }
      for (const ms of times.sort((a, b) => a - b)) {
        // Today only orders that can be finished before now.
        if (isToday && ms > realCutoff - 150 * MIN) continue;
        sim.atStore(s.id, ms, placeOrder(s, d));
      }
    }

    // SLA checks every 15 minutes while an order is out past its ride time.
    for (let minute = 10 * 60 + 15; minute < 24 * 60; minute += 15) {
      const ms = t.at(day, 0, minute);
      sim.atGlobal(ms, async () => {
        if (!lateWindows.some((wnd) => wnd.from <= ms && wnd.to >= ms)) return;
        await flagLateOrders(db, now());
        c.lateChecks++;
      });
    }

    // Evening: riders hand their cash to the store; the day's storage is charged.
    const evening = isToday ? null : t.at(day, 23, 40);
    if (evening !== null) {
      sim.atGlobal(evening, async () => {
        for (const s of w.stores)
          for (const r of s.riders) {
            const expected = await riderCash(db, r.id);
            if (expected <= 0) continue;
            const short = rnd.chance(0.03) ? rnd.int(1, 4) * 500 : 0;
            const handover = await recordCashHandover(db, {
              riderId: r.id,
              darkStoreId: s.id,
              countedPiastres: Math.max(0, expected - short),
              note: short ? 'Rider says a customer paid short' : undefined,
              receivedById: s.staffId,
              idempotencyKey: `demo:handover:${r.id}:${day}`,
            });
            if (handover.status === 'pending') pendingHandovers.push(handover.id);
            c.handovers++;
            setContextClock(now().getTime() + rnd.int(2, 6) * MIN);
          }
        const storage = await accrueStorage(db, day);
        if (storage.charged > 0) c.storageDays++;
        const done = c.orders;
        log(
          `  ${day}: ${done} orders so far, ${c.delivered} delivered, ${c.payouts} payouts, ${Math.round((realNow() - startedAt) / 1000)} s`,
        );
      });
    }
  }

  // The return and damage reports of the demo.
  async function demoReturn() {
    const merchant = w.merchants[w.merchants.length - 1]!;
    const store = w.stores[Math.min(1, w.stores.length - 1)]!;
    const stocked = merchant.skus
      .map((k) => ({ k, have: avail.get(key(store.id, k.id)) ?? 0 }))
      .filter((x) => x.have >= 6)
      .slice(0, 2);
    if (stocked.length === 0) return;
    const ret = await createReturn(db, {
      merchantId: merchant.id,
      darkStoreId: store.id,
      note: 'Slow sellers, taking them back to the warehouse',
      lines: stocked.map((x) => ({ skuId: x.k.id, source: 'sellable' as const, quantity: 2 })),
      actorUserId: merchant.actorId,
    });
    for (const x of stocked) avail.set(key(store.id, x.k.id), x.have - 2);
    setContextClock(now().getTime() + 50 * MIN);
    for (const x of stocked) {
      setContextClock(now().getTime() + 40_000);
      await pickForReturn(db, {
        returnId: ret.id,
        darkStoreId: store.id,
        skuId: x.k.id,
        quantity: 2,
        actorUserId: store.staffId,
        idempotencyKey: `demo:${ret.id}:${x.k.id}`,
      });
    }
    setContextClock(now().getTime() + 90 * MIN);
    await handOverReturn(db, {
      returnId: ret.id,
      darkStoreId: store.id,
      collectedBy: rnd.pick(COLLECTORS),
      actorUserId: store.staffId,
      now: now(),
    });
    log(`  return ${ret.reference} handed to ${merchant.name}`);
  }

  async function demoDamage() {
    const merchant = w.merchants[Math.min(1, w.merchants.length - 1)]!;
    const reports: { store: SimStore; cause: 'store_handling' | 'expired'; settle: boolean }[] = [
      { store: w.stores[0]!, cause: 'store_handling', settle: true },
      { store: w.stores[w.stores.length - 1]!, cause: 'expired', settle: false },
    ];
    for (const r of reports) {
      const units = await db.binStock.findFirst({
        where: {
          quantity: { gte: 4 },
          sku: { merchantId: merchant.id },
          bin: { darkStoreId: r.store.id, type: 'pickable' },
        },
        orderBy: { quantity: 'desc' },
      });
      if (!units || (avail.get(key(r.store.id, units.skuId)) ?? 0) < 2) continue;
      avail.set(key(r.store.id, units.skuId), (avail.get(key(r.store.id, units.skuId)) ?? 0) - 1);
      setContextClock(now().getTime() + 20 * MIN);
      const { report } = await reportDamage(db, {
        darkStoreId: r.store.id,
        skuId: units.skuId,
        fromBinId: units.binId,
        quantity: 1,
        cause: r.cause,
        note: r.cause === 'expired' ? 'Best before date passed' : 'Dropped from the top shelf',
        actorUserId: r.store.staffId,
        idempotencyKey: `demo:damage:${r.store.id}:${units.skuId}`,
      });
      if (r.settle) {
        setContextClock(now().getTime() + 120 * MIN);
        await settleDamage(db, {
          reportId: report.id,
          cause: r.cause,
          chargeRider: false,
          note: 'Confirmed from the store camera',
          actorUserId: w.admin,
          now: now(),
        });
      }
    }
  }

  log(`Simulating ${t.days} days from ${t.firstDay} to ${t.today}`);
  await sim.run();
  c.skippedEvents = sim.skipped;
  // A sanity read for the report.
  c.feeSettingFixed = await getMerchantSetting(db, 'fee.order_fixed_piastres', w.merchants[0]!.id);
  return c;
}

function hash(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return h;
}
