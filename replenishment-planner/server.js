'use strict';
/*
 * Supply chain system server. No dependencies: run `node server.js` and open http://localhost:3000
 * Data is saved in data/db.json. Delete that file (or use Settings → Reset) to start again from example data.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const ops = require('./lib/ops.js');
const { seed } = require('./lib/seed.js');

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC = path.join(__dirname, 'public');

// ---------- storage ----------

function yesterdayIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - 86400000).toISOString().slice(0, 10);
}

let db;
function load() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    console.log('Loaded ' + DB_FILE);
  } else {
    console.log('No data yet. Building example data with two weeks of history...');
    db = seed(yesterdayIso());
    save();
  }
}
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- http helpers ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => { size += c.length; if (size > 60 * 1024 * 1024) { reject(new ops.UserError('File too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new ops.UserError('Request body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (pathname === '/engine.js') file = path.join(__dirname, 'engine.js');
  fs.readFile(file, (err, data) => {
    if (err) {
      // Single page app: unknown paths get the app shell.
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': TYPES['.html'] });
        res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------- routes ----------

const routes = [];
function route(method, pattern, handler, mutates) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, mutates: !!mutates });
}

const between = (d, q) => (!q.from || d >= q.from) && (!q.to || d <= q.to);
const page = (rows, q, def) => {
  const offset = Math.max(0, +q.offset || 0);
  const limit = Math.min(1000, Math.max(1, +q.limit || def || 100));
  return { total: rows.length, offset, limit, rows: rows.slice(offset, offset + limit) };
};

route('GET', '/api/bootstrap', () => ({
  today: ops.today(db), settings: db.settings, seeded: db.meta.seeded || null,
  locations: db.locations, suppliers: db.suppliers, items: db.items, products: db.products, bom: db.bom,
  imports: ops.IMPORTS
}));

route('GET', '/api/dashboard', () => ops.dashboard(db));

// Master data
route('GET', '/api/products/:code', p => {
  const prod = db.products.find(x => x.code === p.code) || ops.UserError && null;
  if (!prod) throw new ops.UserError('Product not found.');
  const flat = ops.flatBom(db).get(prod.code) || new Map();
  const m = ops.maps(db);
  const raw = Array.from(flat.entries()).map(([it, q]) => { const i = m.items.get(it); return { item: it, name: i.name, unit: i.unit, qty: ops.round(q, 5), cost: ops.round(q * ops.num(i.unitCost, 0), 3) }; });
  const usedIn = db.bom.filter(b => b.component === prod.code).map(b => ({ product: b.product, name: (m.products.get(b.product) || {}).name, qty: b.qty }));
  const t = ops.today(db), from = ops.addDays(t, -28);
  const byBranch = {}, byDay = {};
  db.sales.forEach(s => { if (s.product === prod.code && s.date >= from) { byBranch[s.branch] = (byBranch[s.branch] || 0) + s.qty; byDay[s.date] = (byDay[s.date] || 0) + s.qty; } });
  return { product: prod, bom: db.bom.filter(b => b.product === prod.code), raw, cost: ops.round(raw.reduce((a, r) => a + r.cost, 0), 2), usedIn, sales28: { byBranch, byDay } };
});
route('POST', '/api/products', (p, b, u) => ops.upsertProduct(db, b, u), true);

route('GET', '/api/items/:code', p => {
  const it = db.items.find(x => x.code === p.code);
  if (!it) throw new ops.UserError('Raw material not found.');
  const bal = ops.balances(db);
  const stock = {};
  db.locations.forEach(l => { stock[l.code] = ops.round(bal.get(l.code + '|' + it.code) || 0, 3); });
  const usedIn = db.bom.filter(b => b.component === it.code).map(b => ({ product: b.product, name: (db.products.find(x => x.code === b.product) || {}).name, qty: b.qty }));
  const pos = db.pos.filter(po => po.lines.some(l => l.item === it.code)).slice(-15).reverse().map(po => { const l = po.lines.find(x => x.item === it.code); return { id: po.id, status: po.status, createdAt: po.createdAt, expectedDate: po.expectedDate, qty: l.qty, received: l.received }; });
  const ledger = db.ledger.filter(r => r.item === it.code).slice(-40).reverse();
  return { item: it, stock, usedIn, pos, ledger };
});
route('POST', '/api/items', (p, b, u) => ops.upsertItem(db, b, u), true);
route('POST', '/api/suppliers', (p, b, u) => ops.upsertSupplier(db, b, u), true);
route('POST', '/api/locations', (p, b, u) => ops.upsertLocation(db, b, u), true);
route('POST', '/api/settings', (p, b, u) => ops.updateSettings(db, b, u), true);

// Sales and imports
route('GET', '/api/sales/summary', (p, b, u, q) => {
  const t = ops.today(db);
  const from = q.from || ops.addDays(t, -14), to = q.to || ops.addDays(t, -1);
  const price = new Map(db.products.map(x => [x.code, ops.num(x.price, 0)]));
  const byDay = {}, byProduct = {}, byBranch = {};
  db.sales.forEach(s => {
    if (s.date < from || s.date > to) return;
    if (q.branch && s.branch !== q.branch) return;
    const v = s.qty * (price.get(s.product) || 0);
    const d = byDay[s.date] = byDay[s.date] || { units: 0, value: 0 };
    d.units += s.qty; d.value += v;
    const pr = byProduct[s.product] = byProduct[s.product] || { units: 0, value: 0 };
    pr.units += s.qty; pr.value += v;
    const br = byBranch[s.branch] = byBranch[s.branch] || { units: 0, value: 0 };
    br.units += s.qty; br.value += v;
  });
  return { from, to, byDay, byProduct, byBranch, totalRows: db.sales.length, firstDate: db.sales.reduce((a, s) => (!a || s.date < a ? s.date : a), ''), lastDate: ops.lastSalesDate(db) };
});
route('GET', '/api/imports', (p, b, u, q) => page(db.imports.slice().reverse(), q, 50));
route('POST', '/api/import/:type', (p, b, u) => ops.importFile(db, p.type, b, u), true);

// Stock
route('GET', '/api/stock', () => ops.stockView(db));
route('POST', '/api/stock/count', (p, b, u) => ops.stockCount(db, b, u), true);
route('GET', '/api/waste', (p, b, u, q) => page(db.waste.filter(w => between(w.date, q) && (!q.location || w.location === q.location)).slice().reverse(), q, 200));
route('POST', '/api/waste', (p, b, u) => ops.recordWaste(db, b, u), true);
route('GET', '/api/stockouts', (p, b, u, q) => page(db.stockouts.filter(w => between(w.date, q) && (!q.location || w.branch === q.location)).slice().reverse(), q, 200));
route('GET', '/api/ledger', (p, b, u, q) => {
  const s = (q.q || '').toLowerCase();
  const names = new Map(db.items.map(i => [i.code, i.name]));
  const rows = db.ledger.filter(r =>
    (!q.location || r.location === q.location) && (!q.item || r.item === q.item) && (!q.type || r.type === q.type) && between(r.date, q) &&
    (!s || (r.ref + ' ' + r.note + ' ' + r.user + ' ' + (names.get(r.item) || '')).toLowerCase().indexOf(s) >= 0)
  ).slice().reverse();
  return page(rows, q, 100);
});

// Planning
route('GET', '/api/plans', (p, b, u, q) => page(db.planRuns.slice().reverse().map(r => ({
  id: r.id, planDate: r.planDate, status: r.status, createdAt: r.createdAt, createdBy: r.createdBy, approvedBy: r.approvedBy || '', approvedAt: r.approvedAt || '',
  overrides: r.overrides.length, warnings: r.warnings.length, docs: r.docs,
  freshUnits: r.fresh.reduce((a, x) => a + x.send, 0), poLines: r.purchasing.filter(x => x.orderQty > 0).length, poValue: Math.round(r.purchasing.reduce((a, x) => a + (x.orderQty > 0 ? x.value : 0), 0))
})), q, 50));
route('POST', '/api/plans', (p, b, u) => ops.runPlan(db, b.planDate, u), true);
route('GET', '/api/plans/:id', p => { const r = db.planRuns.find(x => x.id === p.id); if (!r) throw new ops.UserError('Plan not found.'); return r; });
route('POST', '/api/plans/:id/override', (p, b, u) => ops.overridePlan(db, p.id, b, u), true);
route('POST', '/api/plans/:id/approve', (p, b, u) => ops.approvePlan(db, p.id, u), true);

// Purchase orders
const supName = code => (db.suppliers.find(s => s.code === code) || {}).name || code;
const poSummary = po => ({ id: po.id, supplier: po.supplier, supplierName: supName(po.supplier), status: po.status, createdAt: po.createdAt, createdBy: po.createdBy, expectedDate: po.expectedDate, oracleRef: po.oracleRef, plan: po.plan || '', lines: po.lines.length, value: Math.round(po.lines.reduce((a, l) => a + l.qty * ops.num(l.unitCost, 0), 0)), receivedPct: Math.round(100 * po.lines.reduce((a, l) => a + Math.min(l.received || 0, l.qty), 0) / Math.max(1e-9, po.lines.reduce((a, l) => a + l.qty, 0))) });
route('GET', '/api/pos', (p, b, u, q) => page(db.pos.filter(po => (!q.status || q.status.split(',').indexOf(po.status) >= 0) && (!q.supplier || po.supplier === q.supplier)).slice().reverse().map(poSummary), q, 200));
route('GET', '/api/pos/:id', p => { const po = db.pos.find(x => x.id === p.id); if (!po) throw new ops.UserError('Purchase order not found.'); return Object.assign({ supplierName: supName(po.supplier) }, po); });
route('POST', '/api/pos', (p, b, u) => ops.createPO(db, b, u), true);
route('POST', '/api/pos/:id/action', (p, b, u) => ops.poAction(db, p.id, b, u), true);

// Transfers and production
const locName = code => (db.locations.find(l => l.code === code) || {}).name || code;
route('GET', '/api/transfers', (p, b, u, q) => page(db.transfers.filter(t => (!q.status || q.status.split(',').indexOf(t.status) >= 0) && (!q.to || t.to === q.to) && between(t.date, q)).slice().reverse().map(t => ({
  id: t.id, from: t.from, to: t.to, toName: locName(t.to), date: t.date, status: t.status, plan: t.plan, items: t.lines.filter(l => l.kind === 'item').length, fresh: t.lines.filter(l => l.kind === 'product').reduce((a, l) => a + l.qty, 0), createdBy: t.createdBy
})), q, 200));
route('GET', '/api/transfers/:id', p => { const t = db.transfers.find(x => x.id === p.id); if (!t) throw new ops.UserError('Transfer not found.'); return Object.assign({ fromName: locName(t.from), toName: locName(t.to) }, t); });
route('POST', '/api/transfers/:id/action', (p, b, u) => ops.transferAction(db, p.id, b, u), true);
route('GET', '/api/production', (p, b, u, q) => page(db.production.slice().reverse().map(x => ({ id: x.id, date: x.date, status: x.status, plan: x.plan, units: x.lines.reduce((a, l) => a + l.qty, 0), made: x.lines.reduce((a, l) => a + (l.made || 0), 0), products: x.lines.length })), q, 100));
route('GET', '/api/production/:id', p => { const x = db.production.find(y => y.id === p.id); if (!x) throw new ops.UserError('Production order not found.'); return x; });
route('POST', '/api/production/:id/action', (p, b, u) => ops.productionAction(db, p.id, b, u), true);

// Activity log and admin
route('GET', '/api/audit', (p, b, u, q) => {
  const s = (q.q || '').toLowerCase();
  return page(db.audit.filter(a => (!q.entity || a.entity === q.entity) && (!s || (a.user + ' ' + a.action + ' ' + a.ref + ' ' + a.detail).toLowerCase().indexOf(s) >= 0)).slice().reverse(), q, 100);
});
route('POST', '/api/reset', (p, b, u) => { db = seed(yesterdayIso()); ops.audit(db, u, 'Reset to example data', 'Settings', '', ''); return { ok: true }; }, true);

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
  const r = routes.find(x => x.method === req.method && x.re.test(pathname));
  if (!r) return send(res, 404, { error: 'Not found' });
  const m = pathname.match(r.re);
  const params = {};
  r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  const query = Object.fromEntries(url.searchParams.entries());
  let user = 'Unknown';
  try { user = decodeURIComponent(req.headers['x-user'] || '') || 'Unknown'; } catch (e) { /* keep default */ }
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    // Work on a copy so a failed action leaves the data untouched.
    const snapshot = r.mutates ? JSON.stringify(db) : null;
    let out;
    try { out = r.handler(params, body, user.slice(0, 60), query); }
    catch (e) { if (snapshot) db = JSON.parse(snapshot); throw e; }
    if (r.mutates) save();
    send(res, 200, out === undefined ? { ok: true } : out);
  } catch (e) {
    if (e instanceof ops.UserError) send(res, 400, { error: e.message });
    else { console.error(e); send(res, 500, { error: 'Something went wrong on the server: ' + e.message }); }
  }
});

load();
server.listen(PORT, () => {
  console.log('Supply chain system running at http://localhost:' + PORT);
});
