import { addDays, cairoDay, cairoDayStart, type WhatIfBase } from '@shiplynow/shared';
import type { Db } from '../client';
import { DomainError } from '../domain-error';
import { contractPricesAt, versionInForce } from './contracts';
import { addMonths } from './assets';

// What each merchant earns us in a Cairo month, against what serving them costs:
//
//   fees            fee income booked to the merchant (before VAT), by kind
//   rider bonus     bonuses of the merchant's delivered orders (tagged to the merchant)
//   rider salaries  each store's rider salaries, shared by the merchant's part of the store's
//                   delivered orders
//   store costs     each store's other costs (fuel, staff, supplies; rent apart), shared the
//                   same way
//   storage space   each store's rent, shared by units stored (unit days from the daily
//                   storage charge; the units held now when nothing was charged)
//   damage          damage paid for the merchant's goods
//   packaging       packaging costs tagged to the merchant
//   other direct    any other cost tagged to the merchant (payment costs...)
//
// Margin = fees - costs; per order = margin / delivered orders.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface MerchantMonth {
  merchant: { id: string; name: string };
  deliveredOrders: number;
  productsPiastres: number;
  codCashPiastres: number;
  feesByKind: Record<string, number>;
  feesPiastres: number;
  costs: {
    riderBonusPiastres: number;
    riderSalaryPiastres: number;
    storeCostsPiastres: number;
    storageSpacePiastres: number;
    damagePiastres: number;
    packagingPiastres: number;
    otherDirectPiastres: number;
  };
  costsPiastres: number;
  marginPiastres: number;
  marginPerOrderPiastres: number | null;
  /** Margin as a share of fees, in basis points (null without fees) */
  marginBp: number | null;
  stores: {
    darkStoreId: string;
    orders: number;
    storeOrders: number;
    unitDays: number;
    storeUnitDays: number;
  }[];
}

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const shareOf = (pool: number, part: number, whole: number) =>
  whole > 0 ? Math.round((pool * part) / whole) : 0;

/** Every merchant with activity in the month (or one merchant), most profitable first. */
export async function merchantProfitability(
  db: Db,
  input: { month: string; merchantId?: string },
): Promise<{ month: string; rows: MerchantMonth[] }> {
  if (!MONTH.test(input.month)) throw new DomainError('invalid_month', 400);
  const from = cairoDayStart(`${input.month}-01`);
  const to = cairoDayStart(`${addMonths(input.month, 1)}-01`);

  const [fees, direct, delivered, riderPay, storePool, rent, unitRows] = await Promise.all([
    db.$queryRaw<{ merchant_id: string; kind: string; amount: bigint }[]>`
      SELECT l.merchant_id, e.kind, -SUM(l.amount_piastres) AS amount
      FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id
        JOIN ledger_entries e ON e.id = l.entry_id
      WHERE a.type = 'revenue' AND l.merchant_id IS NOT NULL
        AND l.occurred_at >= ${from} AND l.occurred_at < ${to}
      GROUP BY l.merchant_id, e.kind`,
    db.$queryRaw<{ merchant_id: string; type: string; key: string; amount: bigint }[]>`
      SELECT l.merchant_id, a.type::text AS type, a.key, SUM(l.amount_piastres) AS amount
      FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id
        JOIN ledger_entries e ON e.id = l.entry_id
      WHERE a.category = 'expense' AND l.merchant_id IS NOT NULL AND e.kind <> 'year_close'
        AND l.occurred_at >= ${from} AND l.occurred_at < ${to}
      GROUP BY l.merchant_id, a.type, a.key`,
    db.$queryRaw<
      { merchant_id: string; dark_store_id: string; n: bigint; products: bigint; cash: bigint }[]
    >`
      SELECT o.merchant_id, o.dark_store_id, COUNT(*) AS n,
        COALESCE(SUM((SELECT SUM(i.picked_qty * i.unit_price_piastres) FROM order_items i
                      WHERE i.order_id = o.id)), 0) AS products,
        COALESCE(SUM((SELECT SUM(d.cod_collected_piastres) FROM deliveries d
                      WHERE d.order_id = o.id AND d.status = 'delivered')), 0) AS cash
      FROM orders o
      WHERE o.status = 'delivered' AND o.delivered_at >= ${from} AND o.delivered_at < ${to}
      GROUP BY o.merchant_id, o.dark_store_id`,
    // Salaries and other pay of riders, per store.
    db.$queryRaw<{ dark_store_id: string; amount: bigint }[]>`
      SELECT l.dark_store_id, SUM(l.amount_piastres) AS amount
      FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id
        JOIN ledger_entries e ON e.id = l.entry_id
        JOIN users u ON u.id = l.user_id
      WHERE a.category = 'expense' AND u.role = 'rider' AND l.merchant_id IS NULL
        AND l.dark_store_id IS NOT NULL AND e.kind <> 'year_close'
        AND l.occurred_at >= ${from} AND l.occurred_at < ${to}
      GROUP BY l.dark_store_id`,
    // Every other cost of a store that is for no one merchant, rent apart.
    db.$queryRaw<{ dark_store_id: string; amount: bigint }[]>`
      SELECT l.dark_store_id, SUM(l.amount_piastres) AS amount
      FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id
        JOIN ledger_entries e ON e.id = l.entry_id
        LEFT JOIN users u ON u.id = l.user_id
      WHERE a.category = 'expense' AND l.merchant_id IS NULL AND l.dark_store_id IS NOT NULL
        AND (u.id IS NULL OR u.role <> 'rider') AND a.key <> 'expense:rent'
        AND e.kind <> 'year_close'
        AND l.occurred_at >= ${from} AND l.occurred_at < ${to}
      GROUP BY l.dark_store_id`,
    db.$queryRaw<{ dark_store_id: string; amount: bigint }[]>`
      SELECT l.dark_store_id, SUM(l.amount_piastres) AS amount
      FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id
        JOIN ledger_entries e ON e.id = l.entry_id
      WHERE a.key = 'expense:rent' AND l.merchant_id IS NULL AND l.dark_store_id IS NOT NULL
        AND e.kind <> 'year_close'
        AND l.occurred_at >= ${from} AND l.occurred_at < ${to}
      GROUP BY l.dark_store_id`,
    // Unit days per store and merchant, from the daily storage charge.
    db.$queryRaw<{ dark_store_id: string; merchant_id: string; units: bigint }[]>`
      SELECT e.data->>'darkStoreId' AS dark_store_id,
        (SELECT l.merchant_id FROM ledger_lines l WHERE l.entry_id = e.id AND l.merchant_id IS NOT NULL LIMIT 1) AS merchant_id,
        SUM((e.data->>'units')::int) AS units
      FROM ledger_entries e
      WHERE e.kind = 'storage_fee' AND e.occurred_at >= ${from} AND e.occurred_at < ${to}
      GROUP BY 1, 2`,
  ]);

  // Units per store and merchant: unit days when storage was charged, else the units now.
  const unitDays = new Map<string, Map<string, number>>();
  const addUnits = (store: string, merchant: string, n: number) => {
    const m = unitDays.get(store) ?? new Map<string, number>();
    m.set(merchant, (m.get(merchant) ?? 0) + n);
    unitDays.set(store, m);
  };
  for (const r of unitRows)
    if (r.dark_store_id && r.merchant_id) addUnits(r.dark_store_id, r.merchant_id, num(r.units));
  const rentStores = rent.map((r) => r.dark_store_id).filter((s) => !unitDays.has(s));
  if (rentStores.length) {
    const held = await db.binStock.findMany({
      where: { quantity: { gt: 0 }, bin: { darkStoreId: { in: rentStores } } },
      select: {
        quantity: true,
        bin: { select: { darkStoreId: true } },
        sku: { select: { merchantId: true } },
      },
    });
    for (const h of held) addUnits(h.bin.darkStoreId, h.sku.merchantId, h.quantity);
  }

  const storeOrders = new Map<string, number>();
  for (const d of delivered)
    storeOrders.set(d.dark_store_id, (storeOrders.get(d.dark_store_id) ?? 0) + num(d.n));
  const pool = (rows: { dark_store_id: string; amount: bigint }[]) =>
    new Map(rows.map((r) => [r.dark_store_id, num(r.amount)]));
  const riderPool = pool(riderPay);
  const storeCostPool = pool(storePool);
  const rentPool = pool(rent);

  const ids = new Set<string>([
    ...fees.map((f) => f.merchant_id),
    ...direct.map((d) => d.merchant_id),
    ...delivered.map((d) => d.merchant_id),
    ...[...unitDays.values()].flatMap((m) => [...m.keys()]),
  ]);
  if (input.merchantId) {
    for (const id of [...ids]) if (id !== input.merchantId) ids.delete(id);
    ids.add(input.merchantId);
  }
  const merchants = await db.merchant.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true },
  });
  if (input.merchantId && !merchants.length) throw new DomainError('merchant_not_found', 404);

  const rows: MerchantMonth[] = merchants.map((m) => {
    const feesByKind: Record<string, number> = {};
    for (const f of fees.filter((x) => x.merchant_id === m.id))
      feesByKind[f.kind] = (feesByKind[f.kind] ?? 0) + num(f.amount);
    const feesTotal = Object.values(feesByKind).reduce((s, v) => s + v, 0);
    const mine = direct.filter((d) => d.merchant_id === m.id);
    const sum = (pick: (d: (typeof mine)[number]) => boolean) =>
      mine.filter(pick).reduce((s, d) => s + num(d.amount), 0);
    const riderBonus = sum((d) => d.type === 'rider_bonus_expense');
    const damage = sum((d) => d.type === 'damage_expense');
    const packaging = sum((d) => d.key === 'expense:packaging');
    const otherDirect = sum(
      (d) =>
        d.type !== 'rider_bonus_expense' &&
        d.type !== 'damage_expense' &&
        d.key !== 'expense:packaging',
    );
    const myDelivered = delivered.filter((d) => d.merchant_id === m.id);
    const storeIds = new Set([
      ...myDelivered.map((d) => d.dark_store_id),
      ...[...unitDays.entries()].filter(([, u]) => u.has(m.id)).map(([s]) => s),
    ]);
    let riderSalary = 0;
    let storeCosts = 0;
    let storage = 0;
    const stores: MerchantMonth['stores'] = [];
    for (const s of storeIds) {
      const orders = num(myDelivered.find((d) => d.dark_store_id === s)?.n);
      const all = storeOrders.get(s) ?? 0;
      const units = unitDays.get(s)?.get(m.id) ?? 0;
      const allUnits = [...(unitDays.get(s)?.values() ?? [])].reduce((a, b) => a + b, 0);
      riderSalary += shareOf(riderPool.get(s) ?? 0, orders, all);
      storeCosts += shareOf(storeCostPool.get(s) ?? 0, orders, all);
      storage += shareOf(rentPool.get(s) ?? 0, units, allUnits);
      stores.push({
        darkStoreId: s,
        orders,
        storeOrders: all,
        unitDays: units,
        storeUnitDays: allUnits,
      });
    }
    const n = myDelivered.reduce((s, d) => s + num(d.n), 0);
    const costs = {
      riderBonusPiastres: riderBonus,
      riderSalaryPiastres: riderSalary,
      storeCostsPiastres: storeCosts,
      storageSpacePiastres: storage,
      damagePiastres: damage,
      packagingPiastres: packaging,
      otherDirectPiastres: otherDirect,
    };
    const costsTotal = Object.values(costs).reduce((s, v) => s + v, 0);
    const margin = feesTotal - costsTotal;
    return {
      merchant: m,
      deliveredOrders: n,
      productsPiastres: myDelivered.reduce((s, d) => s + num(d.products), 0),
      codCashPiastres: myDelivered.reduce((s, d) => s + num(d.cash), 0),
      feesByKind,
      feesPiastres: feesTotal,
      costs,
      costsPiastres: costsTotal,
      marginPiastres: margin,
      marginPerOrderPiastres: n > 0 ? Math.round(margin / n) : null,
      marginBp: feesTotal > 0 ? Math.round((margin * 10_000) / feesTotal) : null,
      stores,
    };
  });
  rows.sort((a, b) => b.marginPiastres - a.marginPiastres);
  return { month: input.month, rows };
}

/**
 * One merchant's month with what the what if calculator starts from: the month's volume and
 * the fee values in force (the merchant's settings, the contract's minimum).
 */
export async function merchantProfitDetail(db: Db, input: { month: string; merchantId: string }) {
  const { rows } = await merchantProfitability(db, input);
  const row = rows[0]!;
  // The contract in force on the month's last day (or today, for the month running).
  const lastDay = addDays(`${addMonths(input.month, 1)}-01`, -1);
  const today = cairoDay(new Date());
  const day = lastDay < today ? lastDay : today;
  const version = await versionInForce(db, input.merchantId, day);
  const { prices } = await contractPricesAt(db, {
    merchantId: input.merchantId,
    at: cairoDayStart(day),
  });
  const base: WhatIfBase = {
    deliveredOrders: row.deliveredOrders,
    productsPiastres: row.productsPiastres,
    codCashPiastres: row.codCashPiastres,
    feesByKind: row.feesByKind,
    costsPiastres: row.costsPiastres,
  };
  const stores = await db.darkStore.findMany({
    where: { id: { in: row.stores.map((s) => s.darkStoreId) } },
    select: { id: true, code: true, nameEn: true, nameAr: true },
  });
  return {
    month: input.month,
    ...row,
    stores: row.stores.map((s) => ({ ...s, store: stores.find((x) => x.id === s.darkStoreId) })),
    base,
    current: {
      // The version's prices before any band (the what if leaves tiers out).
      orderFixedPiastres: version?.orderFixedPiastres ?? prices.orderFixedPiastres,
      orderPercentBp: version?.orderPercentBp ?? prices.orderPercentBp,
      codPercentBp: version?.codPercentBp ?? prices.codPercentBp,
      minimumPiastres: version?.minimumMonthlyFeePiastres ?? null,
    },
    tiers:
      version?.tiers.map((t) => ({
        fromOrder: t.fromOrder,
        fixedFeePiastres: t.fixedFeePiastres,
        percentBp: t.percentBp,
        codPercentBp: t.codPercentBp,
        failedDeliveryPiastres: t.failedDeliveryPiastres,
        receivingPerUnitPiastres: t.receivingPerUnitPiastres,
        storagePerUnitMonthPiastres: t.storagePerUnitMonthPiastres,
        returnPerUnitPiastres: t.returnPerUnitPiastres,
      })) ?? [],
    contract: version ? { id: version.id, version: version.version } : null,
    previousMonth: addMonths(input.month, -1),
    lastDay,
  };
}
