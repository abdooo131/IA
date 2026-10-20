'use strict';
/*
 * Business operations on the database object.
 * Everything that changes stock posts a row to db.ledger, and every user action
 * is written to db.audit. Stock on hand is always the sum of the ledger.
 */
const Planner = require('../engine.js');

const DAY = 86400000;

// ---------- small helpers ----------

function nowIso(db) { return db._clock || new Date().toISOString(); }
function addDays(iso, n) { return Planner.fmtDate(Planner.parseDate(iso) + n * DAY); }
function round(n, dp) { const f = Math.pow(10, dp == null ? 4 : dp); return Math.round(n * f) / f; }
function num(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : fallback;
}
function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }

class UserError extends Error {}
function fail(msg) { throw new UserError(msg); }

function nextId(db, prefix) {
  db.meta.seq = db.meta.seq || {};
  const n = (db.meta.seq[prefix] || 0) + 1;
  db.meta.seq[prefix] = n;
  return prefix + '-' + String(n).padStart(prefix === 'L' ? 7 : 5, '0');
}

function audit(db, user, action, entity, ref, detail) {
  db.audit.push({ id: nextId(db, 'A'), at: nowIso(db), user: user || 'Unknown', action, entity, ref: ref || '', detail: detail || '' });
}

function post(db, e) {
  if (!e.qty) return null;
  const row = {
    id: nextId(db, 'L'), at: nowIso(db), date: e.date, type: e.type, location: e.location, item: e.item,
    qty: round(e.qty), ref: e.ref || '', user: e.user || 'System', note: e.note || ''
  };
  db.ledger.push(row);
  return row;
}

function emptyDb() {
  return {
    meta: { version: 1, createdAt: new Date().toISOString(), seq: {} },
    settings: Object.assign({}, Planner.DEFAULT_SETTINGS),
    locations: [], suppliers: [], items: [], products: [], bom: [],
    sales: [], imports: [], ledger: [], waste: [], stockouts: [],
    planRuns: [], pos: [], transfers: [], production: [], audit: []
  };
}

// ---------- lookups ----------

function maps(db) {
  return {
    items: new Map(db.items.map(i => [i.code, i])),
    products: new Map(db.products.map(p => [p.code, p])),
    suppliers: new Map(db.suppliers.map(s => [s.code, s])),
    locations: new Map(db.locations.map(l => [l.code, l]))
  };
}

// Multi level recipe → raw materials per one unit of each product.
function flatBom(db) {
  const byParent = new Map();
  db.bom.forEach(b => {
    if (!byParent.has(b.product)) byParent.set(b.product, []);
    byParent.get(b.product).push(b);
  });
  const itemSet = new Set(db.items.map(i => i.code));
  const cache = new Map();
  function flat(code, stack) {
    if (cache.has(code)) return cache.get(code);
    const out = new Map();
    (byParent.get(code) || []).forEach(l => {
      if (byParent.has(l.component) && stack.indexOf(l.component) < 0) {
        flat(l.component, stack.concat(l.component)).forEach((q, it) => out.set(it, (out.get(it) || 0) + q * l.qty));
      } else if (itemSet.has(l.component)) {
        out.set(l.component, (out.get(l.component) || 0) + l.qty);
      }
    });
    cache.set(code, out);
    return out;
  }
  const res = new Map();
  db.products.forEach(p => res.set(p.code, flat(p.code, [p.code])));
  return res;
}

function productCost(db, flat) {
  const m = maps(db);
  const out = new Map();
  flat.forEach((lines, p) => {
    let c = 0;
    lines.forEach((q, it) => { const i = m.items.get(it); if (i) c += q * num(i.unitCost, 0); });
    out.set(p, c);
  });
  return out;
}

function balances(db, upToDate) {
  const b = new Map();
  db.ledger.forEach(r => {
    if (upToDate && r.date > upToDate) return;
    const k = r.location + '|' + r.item;
    b.set(k, (b.get(k) || 0) + r.qty);
  });
  return b;
}

function lastSalesDate(db) {
  let max = '';
  db.sales.forEach(s => { if (s.date > max) max = s.date; });
  return max;
}

function today(db) {
  const last = lastSalesDate(db);
  return last ? addDays(last, 1) : Planner.fmtDate(Date.now());
}

// ---------- engine input from the database ----------

function engineData(db) {
  const m = maps(db);
  const bal = balances(db);
  const stock = [];
  bal.forEach((q, k) => { const [location, item] = k.split('|'); stock.push({ location, item, qty: q }); });
  const inTransit = [];
  db.transfers.forEach(t => {
    if (t.status !== 'APPROVED' && t.status !== 'DISPATCHED') return;
    t.lines.forEach(l => { if (l.kind === 'item') inTransit.push({ location: t.to, item: l.code, qty: l.qty }); });
  });
  const openPOs = [];
  db.pos.forEach(po => {
    if (['DRAFT', 'APPROVED', 'SENT', 'PARTIAL'].indexOf(po.status) < 0) return;
    po.lines.forEach(l => { const open = l.qty - (l.received || 0); if (open > 0) openPOs.push({ item: l.item, qty: open }); });
  });
  const names = new Map(db.products.map(p => [p.code, p.name]));
  return {
    branches: db.locations.filter(l => l.type === 'BRANCH' && l.active !== false).map(l => ({ code: l.code, name: l.name, deliveryDays: l.deliveryDays })),
    items: db.items.filter(i => i.active !== false).map(i => {
      const s = m.suppliers.get(i.supplier) || {};
      return {
        code: i.code, name: i.name, unit: i.unit, supplier: s.name || i.supplier || 'Unassigned',
        leadTimeDays: num(i.leadTimeDays, num(s.leadTimeDays, 1)), orderEveryDays: num(i.orderEveryDays, num(s.orderEveryDays, null)),
        moq: i.moq, packSize: i.packSize, transferMultiple: i.transferMultiple, unitCost: i.unitCost, shelfLifeDays: i.shelfLifeDays
      };
    }),
    products: db.products.filter(p => p.active !== false).map(p => ({
      code: p.code, name: p.name, madeAt: p.madeAt === 'BRANCH' ? 'BRANCH' : 'CK', price: p.price, minQty: p.minQty, targetService: p.targetService
    })),
    bom: db.bom.map(b => ({ product: b.product, item: b.component, qty: b.qty, productName: names.get(b.product) })),
    sales: db.sales,
    stock, inTransit, openPOs
  };
}

// ---------- planning ----------

function runPlan(db, planDate, user) {
  const date = planDate || today(db);
  const r = Planner.plan(engineData(db), Object.assign({}, db.settings, { planDate: date }));
  const keep = (o, keys) => { const x = {}; keys.forEach(k => { x[k] = typeof o[k] === 'number' ? round(o[k], 3) : o[k]; }); return x; };
  const run = {
    id: nextId(db, 'PLN'), planDate: r.planDate, createdAt: nowIso(db), createdBy: user, status: 'DRAFT',
    historyFrom: r.historyFrom, historyTo: r.historyTo, settings: r.settings, warnings: r.warnings,
    branches: r.branches,
    fresh: r.fresh.map(x => keep(x, ['branch', 'product', 'name', 'forecast', 'sd', 'serviceLevel', 'send', 'expWaste', 'expWasteCost', 'expLostSales'])),
    production: r.production.map(x => keep(x, ['product', 'name', 'total', 'byBranch', 'serviceLevel', 'unitCost', 'price', 'expWaste', 'expWasteCost'])),
    ckTransfer: r.ckTransfer.map(x => keep(x, ['item', 'name', 'unit', 'need', 'onHand', 'inTransit', 'request', 'send', 'short'])),
    branchRaw: r.branchRaw.filter(x => x.request > 0 || x.onHand < x.target).map(x => keep(x, ['branch', 'item', 'name', 'unit', 'coverDays', 'delivers', 'forecast', 'safety', 'target', 'onHand', 'inTransit', 'request', 'send', 'short', 'shelfCapped'])),
    purchasing: r.purchasing.map(x => keep(x, ['item', 'name', 'unit', 'supplier', 'dailyAvg', 'leadTimeDays', 'orderEveryDays', 'safety', 'reorderPoint', 'orderUpTo', 'onHand', 'onOrder', 'committedToday', 'daysLeft', 'orderQty', 'packSize', 'unitCost', 'value', 'status'])),
    demand: r.demand.map(x => keep(x, ['product', 'name', 'madeAt', 'components', 'rawLines', 'forecast', 'planned', 'plannedByBranch'])),
    explosion: r.explosion,
    requirements: r.requirements.map(x => keep(x, ['item', 'name', 'unit', 'ck', 'branch', 'total', 'products', 'mainOnHand', 'value'])),
    overrides: [], docs: null
  };
  run.purchasing.forEach(p => { if (!isFinite(p.daysLeft)) p.daysLeft = null; });
  db.planRuns.push(run);
  audit(db, user, 'Ran plan', 'Plan', run.id, 'For ' + run.planDate);
  return run;
}

function overridePlan(db, id, body, user) {
  const run = db.planRuns.find(r => r.id === id) || fail('Plan not found.');
  if (run.status !== 'DRAFT') fail('Only a draft plan can be changed.');
  const reason = str(body.reason);
  if (!reason) fail('Give a reason for the change.');
  const to = num(body.qty, NaN);
  if (!(to >= 0)) fail('Enter a quantity of 0 or more.');
  let line, field, label;
  if (body.kind === 'fresh') { line = run.fresh.find(x => x.branch === body.branch && x.product === body.code); field = 'send'; }
  else if (body.kind === 'branchRaw') { line = run.branchRaw.find(x => x.branch === body.branch && x.item === body.code); field = 'send'; }
  else if (body.kind === 'ckTransfer') { line = run.ckTransfer.find(x => x.item === body.code); field = 'send'; }
  else if (body.kind === 'po') { line = run.purchasing.find(x => x.item === body.code); field = 'orderQty'; }
  if (!line) fail('Line not found in this plan.');
  const from = line[field];
  line[field] = to;
  label = line.name + (body.branch ? ' at ' + body.branch : '');
  if (body.kind === 'fresh') {
    const pr = run.production.find(p => p.product === body.code);
    if (pr) { pr.byBranch[body.branch] = to; pr.total = Object.keys(pr.byBranch).reduce((a, k) => a + pr.byBranch[k], 0); }
  }
  if (body.kind === 'po') line.value = to * line.unitCost;
  run.overrides.push({ kind: body.kind, branch: body.branch || '', code: body.code, name: line.name, from, to, reason, user, at: nowIso(db) });
  audit(db, user, 'Changed plan line', 'Plan', run.id, label + ': ' + from + ' → ' + to + ' (' + reason + ')');
  return run;
}

function approvePlan(db, id, user) {
  const run = db.planRuns.find(r => r.id === id) || fail('Plan not found.');
  if (run.status !== 'DRAFT') fail('This plan is already ' + run.status.toLowerCase() + '.');
  // Older draft plans for the same day are replaced.
  db.planRuns.forEach(r => { if (r !== run && r.planDate === run.planDate && r.status === 'DRAFT') r.status = 'REPLACED'; });
  const m = maps(db);
  const docs = { transfers: [], production: null, pos: [] };

  // Kitchen raw materials.
  const ckLines = run.ckTransfer.filter(l => l.send > 0).map(l => ({ kind: 'item', code: l.code || l.item, name: l.name, unit: l.unit, qty: l.send, planned: l.send }));
  if (ckLines.length) docs.transfers.push(newTransfer(db, 'MAIN', 'CK', run.planDate, ckLines, run.id, user).id);

  // Production order at the kitchen.
  const prodLines = run.production.filter(p => p.total > 0).map(p => ({ product: p.product, name: p.name, qty: p.total }));
  if (prodLines.length) {
    const po = { id: nextId(db, 'PRD'), date: run.planDate, status: 'PLANNED', lines: prodLines, plan: run.id, createdAt: nowIso(db), createdBy: user, history: [] };
    po.history.push({ at: nowIso(db), user, action: 'Created from plan ' + run.id });
    db.production.push(po);
    docs.production = po.id;
  }

  // One delivery per branch: raw materials from the main WH plus fresh products from the kitchen.
  run.branches.forEach(b => {
    const lines = [];
    run.branchRaw.filter(l => l.branch === b.code && l.send > 0).forEach(l => lines.push({ kind: 'item', code: l.item, name: l.name, unit: l.unit, qty: l.send, planned: l.send }));
    run.fresh.filter(l => l.branch === b.code && l.send > 0).forEach(l => lines.push({ kind: 'product', code: l.product, name: l.name, unit: 'pcs', qty: l.send, planned: l.send }));
    if (lines.length) docs.transfers.push(newTransfer(db, 'MAIN', b.code, run.planDate, lines, run.id, user).id);
  });

  // Purchase orders, one per supplier.
  const bySupplier = new Map();
  run.purchasing.filter(p => p.orderQty > 0).forEach(p => {
    const item = m.items.get(p.item);
    const sup = item ? item.supplier : p.supplier;
    if (!bySupplier.has(sup)) bySupplier.set(sup, []);
    bySupplier.get(sup).push(p);
  });
  bySupplier.forEach((lines, sup) => {
    const lead = Math.max.apply(null, lines.map(l => l.leadTimeDays || 1));
    const po = newPO(db, sup, addDays(run.planDate, lead), lines.map(l => ({ item: l.item, name: l.name, unit: l.unit, qty: l.orderQty, unitCost: l.unitCost })), user, 'Created from plan ' + run.id);
    po.plan = run.id;
    docs.pos.push(po.id);
  });

  run.status = 'APPROVED';
  run.approvedAt = nowIso(db);
  run.approvedBy = user;
  run.docs = docs;
  audit(db, user, 'Approved plan', 'Plan', run.id, docs.transfers.length + ' transfers, ' + docs.pos.length + ' purchase orders' + (docs.production ? ', production ' + docs.production : ''));
  return run;
}

// ---------- transfers ----------

function newTransfer(db, from, to, date, lines, plan, user) {
  const t = { id: nextId(db, 'TR'), from, to, date, status: 'APPROVED', lines, plan: plan || '', createdAt: nowIso(db), createdBy: user, history: [] };
  t.history.push({ at: nowIso(db), user, action: plan ? 'Created from plan ' + plan : 'Created' });
  db.transfers.push(t);
  return t;
}

function transferAction(db, id, body, user) {
  const t = db.transfers.find(x => x.id === id) || fail('Transfer not found.');
  const action = body.action;
  const qtyFor = (l) => {
    const e = (body.lines || []).find(x => x.code === l.code && (x.kind || 'item') === l.kind);
    return e ? Math.max(0, num(e.qty, l.qty)) : l.qty;
  };
  if (action === 'dispatch') {
    if (t.status !== 'APPROVED') fail('Only an approved transfer can be dispatched.');
    t.lines.forEach(l => {
      l.qty = qtyFor(l);
      if (l.kind === 'item') post(db, { date: body.date || t.date, type: 'TRANSFER_OUT', location: t.from, item: l.code, qty: -l.qty, ref: t.id, user });
    });
    t.status = 'DISPATCHED';
    t.dispatchedAt = nowIso(db);
  } else if (action === 'receive') {
    if (t.status !== 'DISPATCHED') fail('Only a dispatched transfer can be received.');
    const diffs = [];
    t.lines.forEach(l => {
      l.received = qtyFor(l);
      if (l.received !== l.qty) diffs.push(l.name + ' ' + l.qty + ' sent, ' + l.received + ' received');
      if (l.kind === 'item') {
        post(db, { date: body.date || t.date, type: 'TRANSFER_IN', location: t.to, item: l.code, qty: l.received, ref: t.id, user });
      }
    });
    t.status = 'RECEIVED';
    t.receivedAt = nowIso(db);
    if (diffs.length) t.history.push({ at: nowIso(db), user, action: 'Differences: ' + diffs.join('; ') });
  } else if (action === 'cancel') {
    if (t.status !== 'APPROVED') fail('Only a transfer that has not left can be cancelled.');
    t.status = 'CANCELLED';
  } else fail('Unknown action.');
  t.history.push({ at: nowIso(db), user, action: action === 'dispatch' ? 'Dispatched' : action === 'receive' ? 'Received' : 'Cancelled', note: str(body.note) });
  audit(db, user, (action === 'dispatch' ? 'Dispatched' : action === 'receive' ? 'Received' : 'Cancelled') + ' transfer', 'Transfer', t.id, t.from + ' → ' + t.to);
  return t;
}

// ---------- production ----------

function productionAction(db, id, body, user) {
  const p = db.production.find(x => x.id === id) || fail('Production order not found.');
  if (body.action === 'complete') {
    if (p.status !== 'PLANNED') fail('Only a planned order can be completed.');
    const flat = flatBom(db);
    const use = new Map();
    p.lines.forEach(l => {
      const e = (body.lines || []).find(x => x.product === l.product);
      l.made = e ? Math.max(0, num(e.qty, l.qty)) : l.qty;
      (flat.get(l.product) || new Map()).forEach((q, it) => use.set(it, (use.get(it) || 0) + q * l.made));
    });
    use.forEach((q, it) => post(db, { date: body.date || p.date, type: 'PRODUCTION', location: 'CK', item: it, qty: -q, ref: p.id, user, note: 'Used in production' }));
    p.status = 'COMPLETED';
    p.completedAt = nowIso(db);
    p.history.push({ at: nowIso(db), user, action: 'Completed', note: str(body.note) });
    audit(db, user, 'Completed production', 'Production', p.id, p.lines.reduce((a, l) => a + l.made, 0) + ' units');
  } else if (body.action === 'cancel') {
    if (p.status !== 'PLANNED') fail('Only a planned order can be cancelled.');
    p.status = 'CANCELLED';
    p.history.push({ at: nowIso(db), user, action: 'Cancelled', note: str(body.note) });
    audit(db, user, 'Cancelled production', 'Production', p.id, '');
  } else fail('Unknown action.');
  return p;
}

// ---------- purchase orders ----------

function newPO(db, supplier, expectedDate, lines, user, note) {
  const po = { id: nextId(db, 'PO'), supplier, status: 'DRAFT', createdAt: nowIso(db), createdBy: user, expectedDate, oracleRef: '', lines: lines.map(l => Object.assign({ received: 0 }, l)), history: [] };
  po.history.push({ at: nowIso(db), user, action: note || 'Created' });
  db.pos.push(po);
  audit(db, user, 'Created purchase order', 'Purchase order', po.id, supplier);
  return po;
}

function createPO(db, body, user) {
  const m = maps(db);
  const sup = m.suppliers.get(str(body.supplier)) || fail('Choose a supplier.');
  const lines = (body.lines || []).map(l => {
    const it = m.items.get(str(l.item)) || fail('Unknown raw material ' + l.item + '.');
    const qty = num(l.qty, 0);
    if (!(qty > 0)) fail('Quantity for ' + it.name + ' must be more than 0.');
    return { item: it.code, name: it.name, unit: it.unit, qty, unitCost: num(l.unitCost, it.unitCost) };
  });
  if (!lines.length) fail('Add at least one line.');
  return newPO(db, sup.code, str(body.expectedDate) || addDays(today(db), num(sup.leadTimeDays, 1)), lines, user, 'Created manually');
}

function poAction(db, id, body, user) {
  const po = db.pos.find(x => x.id === id) || fail('Purchase order not found.');
  const a = body.action;
  let label;
  if (a === 'approve') {
    if (po.status !== 'DRAFT') fail('Only a draft can be approved.');
    po.status = 'APPROVED'; label = 'Approved';
  } else if (a === 'send') {
    if (po.status !== 'APPROVED') fail('Approve the order before sending it.');
    po.oracleRef = str(body.oracleRef);
    po.status = 'SENT'; label = 'Sent to supplier' + (po.oracleRef ? ' (Oracle PO ' + po.oracleRef + ')' : '');
  } else if (a === 'receive') {
    if (po.status !== 'SENT' && po.status !== 'PARTIAL') fail('Only a sent order can be received.');
    const got = [];
    po.lines.forEach(l => {
      const e = (body.lines || []).find(x => x.item === l.item);
      const q = e ? Math.max(0, num(e.qty, 0)) : 0;
      if (q > 0) {
        l.received = round((l.received || 0) + q);
        post(db, { date: body.date || today(db), type: 'RECEIPT', location: 'MAIN', item: l.item, qty: q, ref: po.id, user, note: str(body.note) });
        got.push(l.name + ' ' + q + ' ' + (l.unit || ''));
      }
    });
    if (!got.length) fail('Enter the quantity received for at least one line.');
    po.status = po.lines.every(l => l.received >= l.qty - 1e-9) ? 'RECEIVED' : 'PARTIAL';
    label = 'Received ' + got.join(', ');
  } else if (a === 'close') {
    if (po.status !== 'PARTIAL') fail('Only a partly received order can be closed short.');
    po.status = 'CLOSED'; label = 'Closed short';
  } else if (a === 'cancel') {
    if (['DRAFT', 'APPROVED', 'SENT'].indexOf(po.status) < 0) fail('This order can no longer be cancelled.');
    po.status = 'CANCELLED'; label = 'Cancelled';
  } else if (a === 'edit') {
    if (po.status !== 'DRAFT') fail('Only a draft can be edited.');
    (body.lines || []).forEach(e => { const l = po.lines.find(x => x.item === e.item); if (l) l.qty = Math.max(0, num(e.qty, l.qty)); });
    po.lines = po.lines.filter(l => l.qty > 0);
    if (body.expectedDate) po.expectedDate = str(body.expectedDate);
    label = 'Edited lines';
  } else fail('Unknown action.');
  po.history.push({ at: nowIso(db), user, action: label, note: str(body.note) });
  audit(db, user, label, 'Purchase order', po.id, '');
  return po;
}

// ---------- stock counts and waste ----------

function stockCount(db, body, user) {
  const loc = str(body.location);
  if (!db.locations.find(l => l.code === loc)) fail('Choose a location.');
  const date = str(body.date) || today(db);
  const bal = balances(db);
  const ref = nextId(db, 'CNT');
  let n = 0;
  (body.lines || []).forEach(l => {
    const counted = num(l.counted, null);
    if (counted === null) return;
    const sys = bal.get(loc + '|' + l.item) || 0;
    const diff = round(counted - sys);
    n++;
    if (diff) post(db, { date, type: 'COUNT', location: loc, item: l.item, qty: diff, ref, user, note: 'Counted ' + counted + ', system ' + round(sys, 3) });
  });
  if (!n) fail('Enter at least one counted quantity.');
  audit(db, user, 'Posted stock count', 'Stock count', ref, loc + ', ' + n + ' items');
  return { ref, lines: n };
}

function recordWaste(db, body, user) {
  const m = maps(db);
  const loc = str(body.location);
  if (!m.locations.has(loc)) fail('Choose a location.');
  const date = str(body.date) || addDays(today(db), -1);
  const cost = productCost(db, flatBom(db));
  const ref = nextId(db, 'WST');
  let n = 0;
  (body.lines || []).forEach(l => {
    const qty = num(l.qty, 0);
    if (!(qty > 0)) return;
    const code = str(l.code);
    const isItem = m.items.has(code);
    const isProduct = m.products.has(code);
    if (!isItem && !isProduct) fail('Unknown item or product ' + code + '.');
    const unitCost = isItem ? num(m.items.get(code).unitCost, 0) : (cost.get(code) || 0);
    db.waste.push({ id: ref + '-' + (++n), date, location: loc, kind: isItem ? 'item' : 'product', code, name: (isItem ? m.items.get(code) : m.products.get(code)).name, qty, reason: str(l.reason) || 'Expired', cost: round(qty * unitCost, 2), user, at: nowIso(db) });
    if (isItem) post(db, { date, type: 'WASTE', location: loc, item: code, qty: -qty, ref, user, note: str(l.reason) });
  });
  if (!n) fail('Enter at least one quantity.');
  audit(db, user, 'Recorded waste', 'Waste', ref, loc + ', ' + n + ' lines');
  return { ref, lines: n };
}

// ---------- sales consumption (backflush) ----------

function postSalesConsumption(db, date, branch, user) {
  const ref = 'SALES:' + date + ':' + branch;
  db.ledger = db.ledger.filter(r => r.ref !== ref);
  const flat = flatBom(db);
  const branchMade = new Set(db.products.filter(p => p.madeAt === 'BRANCH').map(p => p.code));
  const use = new Map();
  db.sales.forEach(s => {
    if (s.date !== date || s.branch !== branch || !branchMade.has(s.product)) return;
    (flat.get(s.product) || new Map()).forEach((q, it) => use.set(it, (use.get(it) || 0) + q * s.qty));
  });
  use.forEach((q, it) => post(db, { date, type: 'SALES_USE', location: branch, item: it, qty: -q, ref, user, note: 'Used by drinks sold' }));
}

// ---------- imports ----------

const IMPORTS = {
  sales: { title: 'Sales', required: ['date', 'branch', 'product', 'qty'],
    fields: { date: ['date', 'businessdate', 'transactiondate', 'saledate', 'day'], branch: ['branch', 'store', 'location', 'branchcode', 'storecode', 'outlet'], product: ['product', 'sku', 'productcode', 'menuitem', 'item', 'itemcode', 'plu'], qty: ['qty', 'quantity', 'sold', 'unitssold', 'count', 'units'] } },
  products: { title: 'Products', required: ['code', 'name'],
    fields: { code: ['code', 'sku', 'product', 'productcode'], oracleCode: ['oraclecode', 'oracleitem', 'itemnumber', 'oracle'], name: ['name', 'productname', 'description'], category: ['category', 'group'], madeAt: ['madeat', 'producedat', 'kitchen', 'source', 'type'], price: ['price', 'sellingprice', 'menuprice'] } },
  items: { title: 'Raw materials', required: ['code', 'name'],
    fields: { code: ['code', 'item', 'itemcode', 'sku'], oracleCode: ['oraclecode', 'itemnumber', 'oracleitem', 'oracle'], name: ['name', 'itemname', 'description'], unit: ['unit', 'uom', 'primaryuom'], category: ['category', 'group'], supplier: ['supplier', 'suppliercode', 'vendor'], leadTimeDays: ['leadtimedays', 'leadtime', 'lt'], moq: ['moq', 'minorder', 'minimumorder'], packSize: ['packsize', 'pack', 'casesize'], transferMultiple: ['transfermultiple', 'issuemultiple'], unitCost: ['unitcost', 'cost', 'price'], shelfLifeDays: ['shelflifedays', 'shelflife'] } },
  bom: { title: 'Recipes', required: ['product', 'component', 'qty'],
    fields: { product: ['product', 'sku', 'parent', 'assembly', 'productcode'], component: ['component', 'item', 'ingredient', 'itemcode', 'rawmaterial'], qty: ['qty', 'quantity', 'qtyper', 'quantityper', 'usage'] } },
  counts: { title: 'Stock count', required: ['location', 'item', 'counted'],
    fields: { location: ['location', 'subinventory', 'warehouse', 'branch', 'store'], item: ['item', 'itemcode', 'sku', 'itemnumber'], counted: ['counted', 'qty', 'quantity', 'onhand', 'count'] } }
};

function normKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function mapRows(def, rows) {
  if (!rows || !rows.length) fail('The file has no rows.');
  const headers = Object.keys(rows[0]);
  const map = {};
  Object.keys(def.fields).forEach(f => {
    const h = headers.find(x => def.fields[f].indexOf(normKey(x)) >= 0);
    if (h) map[f] = h;
  });
  const missing = def.required.filter(f => !map[f]);
  if (missing.length) fail('Missing column' + (missing.length > 1 ? 's' : '') + ': ' + missing.join(', ') + '. Found: ' + headers.join(', ') + '.');
  return rows.map(r => { const o = {}; Object.keys(map).forEach(f => { o[f] = r[map[f]]; }); return o; });
}

function importFile(db, type, body, user) {
  const def = IMPORTS[type] || fail('Unknown import type.');
  const rows = mapRows(def, body.rows);
  const m = maps(db);
  const errors = [];
  let accepted = 0;
  const err = (i, msg) => { if (errors.length < 200) errors.push('Row ' + (i + 2) + ': ' + msg); };
  const id = nextId(db, 'IMP');

  if (type === 'sales') {
    // Accept branch by code or name, product by SKU or Oracle code.
    const branchBy = new Map();
    db.locations.filter(l => l.type === 'BRANCH').forEach(l => { branchBy.set(normKey(l.code), l.code); branchBy.set(normKey(l.name), l.code); });
    const prodBy = new Map();
    db.products.forEach(p => { prodBy.set(normKey(p.code), p.code); if (p.oracleCode) prodBy.set(normKey(p.oracleCode), p.code); });
    const clean = [];
    rows.forEach((r, i) => {
      const t = Planner.parseDate(r.date);
      const b = branchBy.get(normKey(r.branch));
      const p = prodBy.get(normKey(r.product));
      const q = num(r.qty, NaN);
      if (!isFinite(t)) return err(i, 'date "' + str(r.date) + '" not recognised');
      if (!b) return err(i, 'branch "' + str(r.branch) + '" not found');
      if (!p) return err(i, 'product "' + str(r.product) + '" not found. Create it under Products first');
      if (!isFinite(q) || q < 0) return err(i, 'quantity "' + str(r.qty) + '" is not a number');
      clean.push({ date: Planner.fmtDate(t), branch: b, product: p, qty: q, importId: id });
    });
    // A file replaces earlier sales for the same branch and day.
    const days = new Set(clean.map(s => s.date + '|' + s.branch));
    const replaced = db.sales.filter(s => days.has(s.date + '|' + s.branch)).length;
    db.sales = db.sales.filter(s => !days.has(s.date + '|' + s.branch));
    const agg = new Map();
    clean.forEach(s => { const k = s.date + '|' + s.branch + '|' + s.product; if (agg.has(k)) agg.get(k).qty += s.qty; else agg.set(k, s); });
    agg.forEach(s => db.sales.push(s));
    accepted = clean.length;
    days.forEach(k => { const [d, b] = k.split('|'); postSalesConsumption(db, d, b, user); });
    if (replaced) errors.unshift('Replaced ' + replaced + ' earlier sales rows for the same branch and day.');
  } else if (type === 'products') {
    rows.forEach((r, i) => {
      try { upsertProduct(db, r, user, true); accepted++; } catch (e) { err(i, e.message); }
    });
  } else if (type === 'items') {
    const supBy = new Map();
    db.suppliers.forEach(s => { supBy.set(normKey(s.code), s.code); supBy.set(normKey(s.name), s.code); });
    rows.forEach((r, i) => {
      try {
        if (r.supplier && !supBy.has(normKey(r.supplier))) {
          const s = { code: nextId(db, 'SUP'), name: str(r.supplier), leadTimeDays: num(r.leadTimeDays, 1), orderEveryDays: 7, active: true };
          db.suppliers.push(s); supBy.set(normKey(s.name), s.code);
        }
        if (r.supplier) r.supplier = supBy.get(normKey(r.supplier));
        upsertItem(db, r, user, true); accepted++;
      } catch (e) { err(i, e.message); }
    });
  } else if (type === 'bom') {
    const byProduct = new Map();
    rows.forEach((r, i) => {
      const p = str(r.product), c = str(r.component), q = num(r.qty, NaN);
      if (!m.products.has(p)) return err(i, 'product "' + p + '" not found');
      if (!m.items.has(c) && !m.products.has(c)) return err(i, 'component "' + c + '" is not a raw material or product');
      if (!(q > 0)) return err(i, 'quantity must be more than 0');
      if (!byProduct.has(p)) byProduct.set(p, []);
      byProduct.get(p).push({ product: p, component: c, qty: q });
      accepted++;
    });
    byProduct.forEach((lines, p) => { db.bom = db.bom.filter(b => b.product !== p).concat(lines); });
  } else if (type === 'counts') {
    const byLoc = new Map();
    rows.forEach((r, i) => {
      const loc = db.locations.find(l => normKey(l.code) === normKey(r.location) || normKey(l.name) === normKey(r.location));
      if (!loc) return err(i, 'location "' + str(r.location) + '" not found');
      if (!m.items.has(str(r.item))) return err(i, 'raw material "' + str(r.item) + '" not found');
      if (!byLoc.has(loc.code)) byLoc.set(loc.code, []);
      byLoc.get(loc.code).push({ item: str(r.item), counted: r.counted });
      accepted++;
    });
    byLoc.forEach((lines, loc) => stockCount(db, { location: loc, date: body.date, lines }, user));
  }

  const rec = { id, type, title: def.title, fileName: str(body.fileName) || 'file', rows: rows.length, accepted, rejected: rows.length - accepted, errors, user, at: nowIso(db) };
  db.imports.push(rec);
  audit(db, user, 'Imported ' + def.title.toLowerCase(), 'Import', id, rec.fileName + ': ' + accepted + ' of ' + rows.length + ' rows');
  return rec;
}

// ---------- master data ----------

const MADE_AT = ['BRANCH', 'CK', 'SEMI'];

function upsertProduct(db, body, user, quiet) {
  const code = str(body.code);
  if (!code) fail('SKU code is required.');
  if (!str(body.name) && !db.products.find(p => p.code === code)) fail('Name is required.');
  let p = db.products.find(x => x.code === code);
  const created = !p;
  if (!p) { p = { code, active: true, createdAt: nowIso(db) }; db.products.push(p); }
  let madeAt = str(body.madeAt).toUpperCase();
  if (madeAt.indexOf('KITCHEN') >= 0 || madeAt === 'CENTRAL') madeAt = 'CK';
  if (madeAt.indexOf('SEMI') >= 0) madeAt = 'SEMI';
  if (madeAt && MADE_AT.indexOf(madeAt) < 0) madeAt = 'BRANCH';
  ['name', 'oracleCode', 'category'].forEach(k => { if (body[k] !== undefined) p[k] = str(body[k]); });
  if (madeAt) p.madeAt = madeAt; else if (!p.madeAt) p.madeAt = 'BRANCH';
  ['price', 'minQty', 'targetService'].forEach(k => { if (body[k] !== undefined && body[k] !== '') p[k] = num(body[k], null); });
  if (body.active !== undefined) p.active = !!body.active;
  if (Array.isArray(body.bom)) {
    const m = maps(db);
    const lines = body.bom.filter(l => str(l.component)).map(l => {
      const c = str(l.component);
      if (c === code) fail('A product cannot use itself.');
      if (!m.items.has(c) && !m.products.has(c)) fail('Component ' + c + ' does not exist.');
      const q = num(l.qty, NaN);
      if (!(q > 0)) fail('Quantity for ' + c + ' must be more than 0.');
      return { product: code, component: c, qty: q };
    });
    db.bom = db.bom.filter(b => b.product !== code).concat(lines);
  }
  if (!quiet) audit(db, user, created ? 'Created product' : 'Updated product', 'Product', code, p.name);
  return p;
}

function upsertItem(db, body, user, quiet) {
  const code = str(body.code);
  if (!code) fail('Item code is required.');
  let it = db.items.find(x => x.code === code);
  const created = !it;
  if (!it) { if (!str(body.name)) fail('Name is required.'); it = { code, active: true, createdAt: nowIso(db) }; db.items.push(it); }
  ['name', 'oracleCode', 'unit', 'category', 'supplier'].forEach(k => { if (body[k] !== undefined) it[k] = str(body[k]); });
  ['leadTimeDays', 'moq', 'packSize', 'transferMultiple', 'unitCost', 'shelfLifeDays', 'orderEveryDays'].forEach(k => { if (body[k] !== undefined && body[k] !== '') it[k] = num(body[k], null); });
  if (body.active !== undefined) it.active = !!body.active;
  if (!quiet) audit(db, user, created ? 'Created raw material' : 'Updated raw material', 'Raw material', code, it.name);
  return it;
}

function upsertSupplier(db, body, user) {
  let s = str(body.code) ? db.suppliers.find(x => x.code === str(body.code)) : null;
  const created = !s;
  if (!s) { if (!str(body.name)) fail('Name is required.'); s = { code: str(body.code) || nextId(db, 'SUP'), active: true }; db.suppliers.push(s); }
  ['name', 'contact', 'phone', 'email'].forEach(k => { if (body[k] !== undefined) s[k] = str(body[k]); });
  ['leadTimeDays', 'orderEveryDays'].forEach(k => { if (body[k] !== undefined && body[k] !== '') s[k] = num(body[k], null); });
  if (body.active !== undefined) s.active = !!body.active;
  audit(db, user, created ? 'Created supplier' : 'Updated supplier', 'Supplier', s.code, s.name);
  return s;
}

function upsertLocation(db, body, user) {
  const code = str(body.code);
  if (!code) fail('Code is required.');
  let l = db.locations.find(x => x.code === code);
  const created = !l;
  if (!l) { if (!str(body.name)) fail('Name is required.'); l = { code, type: 'BRANCH', active: true }; db.locations.push(l); }
  ['name', 'deliveryDays', 'address'].forEach(k => { if (body[k] !== undefined) l[k] = str(body[k]); });
  if (body.type && ['MAIN', 'CK', 'BRANCH'].indexOf(body.type) >= 0 && created) l.type = body.type;
  if (body.active !== undefined) l.active = !!body.active;
  audit(db, user, created ? 'Created location' : 'Updated location', 'Location', code, l.name);
  return l;
}

function updateSettings(db, body, user) {
  Object.keys(Planner.DEFAULT_SETTINGS).forEach(k => {
    if (k === 'planDate') return;
    if (body[k] !== undefined && body[k] !== '') { const v = num(body[k], null); if (v !== null) db.settings[k] = v; }
  });
  audit(db, user, 'Updated planning settings', 'Settings', '', '');
  return db.settings;
}

// ---------- read models ----------

function stockView(db) {
  const m = maps(db);
  const bal = balances(db);
  const lastCount = new Map();
  db.ledger.forEach(r => { if (r.type === 'COUNT' || r.type === 'OPENING') { const k = r.location; if (!lastCount.has(k) || lastCount.get(k) < r.date) lastCount.set(k, r.date); } });
  const rows = db.items.map(i => {
    const by = {};
    let total = 0;
    db.locations.forEach(l => { const q = bal.get(l.code + '|' + i.code) || 0; by[l.code] = round(q, 3); total += q; });
    return { code: i.code, name: i.name, unit: i.unit, unitCost: i.unitCost, byLocation: by, total: round(total, 3), value: round(total * num(i.unitCost, 0), 2) };
  });
  const valueByLocation = {};
  db.locations.forEach(l => { valueByLocation[l.code] = round(rows.reduce((a, r) => a + Math.max(0, r.byLocation[l.code]) * num(r.unitCost, 0), 0), 2); });
  const negatives = [];
  rows.forEach(r => db.locations.forEach(l => { if (r.byLocation[l.code] < -1e-6) negatives.push({ location: l.code, item: r.code, name: r.name, qty: r.byLocation[l.code] }); }));
  return { rows, valueByLocation, lastCount: Object.fromEntries(lastCount), negatives };
}

function dashboard(db) {
  const t = today(db);
  const weekAgo = addDays(t, -7);
  const lastRun = db.planRuns.filter(r => r.status !== 'REPLACED').slice(-1)[0] || null;
  const todayRun = db.planRuns.filter(r => r.planDate === t && r.status !== 'REPLACED').slice(-1)[0] || null;
  const openPOs = db.pos.filter(p => ['DRAFT', 'APPROVED', 'SENT', 'PARTIAL'].indexOf(p.status) >= 0);
  const poValue = p => p.lines.reduce((a, l) => a + (l.qty - (l.received || 0)) * num(l.unitCost, 0), 0);
  const late = openPOs.filter(p => (p.status === 'SENT' || p.status === 'PARTIAL') && p.expectedDate < t);
  const wasteWeek = db.waste.filter(w => w.date >= weekAgo && w.date < t);
  const wasteByDay = {};
  for (let i = 7; i >= 1; i--) wasteByDay[addDays(t, -i)] = 0;
  wasteWeek.forEach(w => { wasteByDay[w.date] = (wasteByDay[w.date] || 0) + w.cost; });
  const salesByDay = {};
  for (let i = 14; i >= 1; i--) salesByDay[addDays(t, -i)] = 0;
  const prices = new Map(db.products.map(p => [p.code, num(p.price, 0)]));
  db.sales.forEach(s => { if (s.date in salesByDay) salesByDay[s.date] += s.qty * (prices.get(s.product) || 0); });
  const stockoutsWeek = db.stockouts.filter(s => s.date >= weekAgo && s.date < t);
  const sv = stockView(db);
  const urgent = lastRun ? lastRun.purchasing.filter(p => p.status === 'urgent') : [];
  return {
    today: t,
    todayRun: todayRun ? { id: todayRun.id, status: todayRun.status } : null,
    lastRun: lastRun ? { id: lastRun.id, planDate: lastRun.planDate, status: lastRun.status } : null,
    pos: { awaitingApproval: openPOs.filter(p => p.status === 'DRAFT').length, open: openPOs.length, openValue: round(openPOs.reduce((a, p) => a + poValue(p), 0), 0), late: late.map(p => ({ id: p.id, supplier: p.supplier, expectedDate: p.expectedDate })) },
    transfers: { toDispatch: db.transfers.filter(x => x.status === 'APPROVED').length, inTransit: db.transfers.filter(x => x.status === 'DISPATCHED').length },
    production: { planned: db.production.filter(x => x.status === 'PLANNED').length },
    waste: { weekCost: round(wasteWeek.reduce((a, w) => a + w.cost, 0), 0), byDay: wasteByDay, topItems: topN(wasteWeek, w => w.name, w => w.cost, 5) },
    stockouts: { weekUnits: round(stockoutsWeek.reduce((a, s) => a + s.lostUnits, 0), 0), top: topN(stockoutsWeek, s => s.name, s => s.lostUnits, 5) },
    salesByDay,
    stockValue: sv.valueByLocation,
    negatives: sv.negatives.length,
    lastCount: sv.lastCount,
    urgentItems: urgent.map(u => ({ item: u.item, name: u.name, daysLeft: u.daysLeft, supplier: u.supplier })),
    recent: db.audit.slice(-8).reverse()
  };
}

function topN(rows, key, val, n) {
  const m = new Map();
  rows.forEach(r => m.set(key(r), (m.get(key(r)) || 0) + val(r)));
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, v]) => ({ name, value: round(v, 1) }));
}

module.exports = {
  UserError, emptyDb, nextId, audit, post, addDays, round, num, str, maps, flatBom, productCost, balances, today, lastSalesDate,
  engineData, runPlan, overridePlan, approvePlan, transferAction, productionAction, createPO, poAction,
  stockCount, recordWaste, postSalesConsumption, importFile, IMPORTS, upsertProduct, upsertItem, upsertSupplier, upsertLocation,
  updateSettings, stockView, dashboard
};
