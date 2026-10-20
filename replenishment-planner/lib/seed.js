'use strict';
/*
 * Builds an example database with two weeks of simulated operations:
 * daily plans, approvals, purchase orders, receipts, transfers, kitchen production,
 * sales, waste, sold out days and a weekly count. Every figure is made up.
 */
const Demo = require('../demo.js');
const ops = require('./ops.js');

function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const CATEGORY = {
  'Roastery Co.': 'Coffee', 'Delta Dairy': 'Dairy', 'Plant Drinks': 'Dairy', 'Dairy Imports': 'Dairy', 'Bakery Supplies': 'Bakery',
  'Food Wholesale': 'Dry goods', 'Syrup House': 'Syrups and sauces', 'City Bakery': 'Bread', 'Deli Meats': 'Meat', 'Fresh Produce': 'Produce',
  'Pack Pro': 'Packaging', 'Ice Factory': 'Ice'
};

const USERS = { planner: 'Planner', buyer: 'Purchasing', wh: 'Warehouse', kitchen: 'Kitchen', branch: 'Branch manager' };

function seed(yesterday, days) {
  const r = rng(1980);
  const span = days || 14;
  const demo = Demo.buildDemo(yesterday, 10, { healthy: true });
  const db = ops.emptyDb();
  const start = ops.addDays(yesterday, -(span - 1));
  db._clock = ops.addDays(start, -1) + 'T20:00:00.000Z';

  // Master data.
  db.locations.push({ code: 'MAIN', name: 'Main warehouse', type: 'MAIN', deliveryDays: '', active: true });
  db.locations.push({ code: 'CK', name: 'Central kitchen', type: 'CK', deliveryDays: 'daily', active: true });
  demo.branches.forEach(b => db.locations.push({ code: b.code, name: b.name, type: 'BRANCH', deliveryDays: b.deliveryDays, active: true }));

  const supCode = new Map();
  demo.items.forEach(i => {
    if (supCode.has(i.supplier)) return;
    const lts = demo.items.filter(x => x.supplier === i.supplier).map(x => x.leadTimeDays);
    const s = { code: ops.nextId(db, 'SUP'), name: i.supplier, leadTimeDays: Math.min.apply(null, lts), orderEveryDays: Math.min.apply(null, lts) <= 1 ? 2 : 7, contact: '', phone: '', email: '', active: true };
    db.suppliers.push(s);
    supCode.set(i.supplier, s.code);
  });
  demo.items.forEach((i, n) => db.items.push({
    code: i.code, oracleCode: String(410100 + n * 7), name: i.name, unit: i.unit, category: CATEGORY[i.supplier] || 'Other', supplier: supCode.get(i.supplier),
    leadTimeDays: i.leadTimeDays, moq: i.moq, packSize: i.packSize, transferMultiple: i.transferMultiple, unitCost: i.unitCost, shelfLifeDays: i.shelfLifeDays, active: true
  }));
  demo.products.forEach((p, n) => db.products.push({
    code: p.code, oracleCode: String(520100 + n * 3), name: p.name, category: p.madeAt === 'CK' ? (/sandwich|ciabatta|brioche/i.test(p.name) ? 'Sandwiches' : 'Desserts') : 'Drinks',
    madeAt: p.madeAt, price: p.price, active: true
  }));
  db.products.push({ code: 'SF01', oracleCode: '530100', name: 'Tiramisu cream mix (per kg)', category: 'Semi finished', madeAt: 'SEMI', price: null, active: true });
  demo.bom.forEach(b => db.bom.push({ product: b.product, component: b.item, qty: b.qty }));
  db.sales = demo.sales;
  db.imports.push({ id: ops.nextId(db, 'IMP'), type: 'sales', title: 'Sales', fileName: 'pos_sales_history.csv', rows: db.sales.length, accepted: db.sales.length, rejected: 0, errors: [], user: USERS.planner, at: db._clock });

  // Opening balances, the day before the simulation starts.
  demo.stock.forEach(s => ops.post(db, { date: ops.addDays(start, -1), type: 'OPENING', location: s.location, item: s.item, qty: s.qty, ref: 'OPENING', user: USERS.wh, note: 'Opening count' }));
  ops.audit(db, USERS.wh, 'Posted opening balances', 'Stock count', 'OPENING', db.locations.length + ' locations');

  const cost = ops.productCost(db, ops.flatBom(db));
  const salesIdx = new Map();
  db.sales.forEach(s => salesIdx.set(s.date + '|' + s.branch + '|' + s.product, s));
  const names = new Map(db.products.map(p => [p.code, p.name]));
  let oracleNo = 45210;

  for (let k = 0; k < span; k++) {
    const d = ops.addDays(start, k);
    const last = k === span - 1;
    const at = h => { db._clock = d + 'T' + String(h).padStart(2, '0') + ':' + String(Math.floor(r() * 60)).padStart(2, '0') + ':00.000Z'; };

    // Supplier deliveries due today.
    at(5);
    db.pos.filter(p => (p.status === 'SENT' || p.status === 'PARTIAL') && p.expectedDate <= d).forEach(po => {
      const partial = r() < 0.12;
      const lines = po.lines.map(l => ({ item: l.item, qty: ops.round((l.qty - l.received) * (partial ? 0.6 : 1), 2) }));
      ops.poAction(db, po.id, { action: 'receive', date: d, lines, note: partial ? 'Supplier short delivered' : '' }, USERS.wh);
    });

    // Plan, with an occasional manual change, then approve.
    at(6);
    const run = ops.runPlan(db, d, USERS.planner);
    if (r() < 0.5) {
      const cand = run.fresh.filter(f => f.send > 4);
      const f = cand[Math.floor(r() * cand.length)];
      if (f) ops.overridePlan(db, run.id, { kind: 'fresh', branch: f.branch, code: f.product, qty: f.send + 6, reason: 'Branch asked for more, event nearby' }, USERS.planner);
    }
    ops.approvePlan(db, run.id, USERS.planner);

    // Purchasing approves and sends, except on the last day.
    at(9);
    (run.docs.pos || []).forEach(id => {
      if (last) return;
      ops.poAction(db, id, { action: 'approve' }, USERS.buyer);
      ops.poAction(db, id, { action: 'send', oracleRef: String(oracleNo++) }, USERS.buyer);
    });

    // Kitchen production and deliveries.
    at(4);
    if (run.docs.production) ops.productionAction(db, run.docs.production, { action: 'complete', date: d }, USERS.kitchen);
    at(7);
    const sentFresh = new Map();
    run.docs.transfers.forEach(id => {
      ops.transferAction(db, id, { action: 'dispatch', date: d }, USERS.wh);
      const t = db.transfers.find(x => x.id === id);
      t.lines.filter(l => l.kind === 'product').forEach(l => sentFresh.set(t.to + '|' + l.code, l.qty));
    });
    at(8);
    run.docs.transfers.forEach(id => ops.transferAction(db, id, { action: 'receive', date: d }, USERS.branch));

    // Sales: fresh products cannot sell more than was delivered.
    at(22);
    db.locations.filter(l => l.type === 'BRANCH').forEach(b => {
      db.products.filter(p => p.madeAt === 'CK').forEach(p => {
        const sent = sentFresh.get(b.code + '|' + p.code) || 0;
        const s = salesIdx.get(d + '|' + b.code + '|' + p.code);
        const demand = s ? s.qty : 0;
        if (demand > sent) {
          db.stockouts.push({ date: d, branch: b.code, product: p.code, name: p.name, lostUnits: demand - sent, soldOutAt: String(13 + Math.floor(r() * 7)) + ':' + (r() < 0.5 ? '00' : '30') });
          if (s) s.qty = sent;
        } else if (sent > demand) {
          const q = sent - demand;
          db.waste.push({ id: 'WST-SIM-' + d + '-' + b.code + '-' + p.code, date: d, location: b.code, kind: 'product', code: p.code, name: names.get(p.code), qty: q, reason: 'Unsold at close', cost: ops.round(q * (cost.get(p.code) || 0), 2), user: USERS.branch, at: db._clock });
        }
      });
      ops.postSalesConsumption(db, d, b.code, 'POS import');
    });
    // Occasional expired dairy at a branch.
    if (r() < 0.45) {
      const b = db.locations.filter(l => l.type === 'BRANCH')[Math.floor(r() * 11)];
      ops.recordWaste(db, { location: b.code, date: d, lines: [{ code: r() < 0.6 ? 'RM002' : 'RM004', qty: 1 + Math.floor(r() * 3), reason: 'Expired' }] }, USERS.branch);
    }
    // Weekly count of fast movers at the main WH.
    if (k === 6) {
      at(21);
      const bal = ops.balances(db);
      const lines = ['RM001', 'RM002', 'RM005', 'RM013', 'RM014', 'RM015', 'RM021', 'RM022', 'RM023', 'RM024'].map(it => {
        const sys = Math.max(0, bal.get('MAIN|' + it) || 0);
        return { item: it, counted: ops.round(sys * (0.96 + r() * 0.05), 1) };
      });
      ops.stockCount(db, { location: 'MAIN', date: d, lines }, USERS.wh);
    }
  }
  db.sales = db.sales.filter(s => s.qty > 0);
  ops.audit(db, USERS.planner, 'Imported sales', 'Import', 'IMP-00001', 'POS sales up to ' + yesterday);
  delete db._clock;
  db.meta.seeded = { yesterday, days: span, note: 'Example data. Every figure is made up.' };
  return db;
}

module.exports = { seed };
