/*
 * Replenishment planning engine.
 *
 * Network: Suppliers -> Main WH -> Central Kitchen (CK) -> Branches.
 * Raw materials go from the Main WH to the CK and to the branches.
 * Fresh products (sandwiches, desserts) are made at the CK and pushed to branches daily.
 *
 * Works in the browser (window.Planner) and in Node (require('./engine.js')).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Planner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var DAY_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  // ---------- math ----------

  // Inverse standard normal CDF (Acklam's approximation).
  function normInv(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    var pl = 0.02425, q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - pl) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function normPdf(z) { return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI); }

  function normCdf(z) {
    // Abramowitz and Stegun 7.1.26
    var t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  function roundUpTo(x, m) {
    if (!(m > 0)) m = 1;
    if (x <= 0) return 0;
    var n = Math.ceil(x / m - 1e-9);
    return +(n * m).toFixed(4);
  }

  function roundDownTo(x, m) {
    if (!(m > 0)) m = 1;
    if (x <= 0) return 0;
    return +(Math.floor(x / m + 1e-9) * m).toFixed(4);
  }

  function num(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : fallback;
  }

  // ---------- dates ----------

  function parseDate(s) {
    if (s instanceof Date) return Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
    if (typeof s === 'number' && s > 20000 && s < 80000) return Date.UTC(1899, 11, 30) + s * DAY; // Excel serial
    var str = String(s || '').trim();
    var m = str.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = str.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/); // DD/MM/YYYY
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
    m = str.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2,4})/); // 12-OCT-2026 (Oracle)
    if (m) {
      var months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      var mi = months.indexOf(m[2].toLowerCase());
      var y = +m[3];
      if (y < 100) y += 2000;
      if (mi >= 0) return Date.UTC(y, mi, +m[1]);
    }
    return NaN;
  }

  function fmtDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function weekday(ms) { return new Date(ms).getUTCDay(); }

  // "daily", "every day", "Sun,Tue,Thu", "sun tue thu"
  function parseDeliveryDays(s) {
    var str = String(s || 'daily').toLowerCase();
    if (!str.trim() || /daily|every\s*day|all/.test(str)) return [0, 1, 2, 3, 4, 5, 6];
    var out = [];
    str.split(/[^a-z]+/).forEach(function (t) {
      var k = t.slice(0, 3);
      if (k in DAY_NAMES && out.indexOf(DAY_NAMES[k]) < 0) out.push(DAY_NAMES[k]);
    });
    return out.length ? out.sort() : [0, 1, 2, 3, 4, 5, 6];
  }

  // Days covered by a delivery on `ms`: from that day until the day before the next delivery.
  function daysUntilNextDelivery(days, ms) {
    var wd = weekday(ms);
    for (var i = 1; i <= 7; i++) if (days.indexOf((wd + i) % 7) >= 0) return i;
    return 7;
  }

  // ---------- defaults ----------

  var DEFAULT_SETTINGS = {
    planDate: null,             // delivery day being planned (YYYY-MM-DD); default: day after last sales date
    historyWeeks: 8,            // weeks of sales history used for forecasting
    branchServiceLevel: 0.95,   // chance a branch does not run out of a raw material before next delivery
    mainServiceLevel: 0.97,     // chance the main WH does not run out before a supplier order arrives
    orderEveryDays: 7,          // default days between purchase orders to the same supplier
    freshMinService: 0.5,       // limits for the fresh product target (margin based)
    freshMaxService: 0.9,
    freshDefaultService: 0.7,   // used when a product has no selling price
    ckBufferPct: 0              // extra production at CK on top of branch plans (percent)
  };

  // ---------- main ----------

  function plan(data, userSettings) {
    var s = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) { s[k] = DEFAULT_SETTINGS[k]; });
    Object.keys(userSettings || {}).forEach(function (k) {
      if (userSettings[k] !== undefined && userSettings[k] !== null && userSettings[k] !== '') s[k] = userSettings[k];
    });

    var warnings = [];
    var warn = function (level, msg) { warnings.push({ level: level, msg: msg }); };

    // ----- master data -----
    var items = new Map();
    (data.items || []).forEach(function (r) {
      var code = String(r.code || '').trim();
      if (!code) return;
      items.set(code, {
        code: code,
        name: r.name || code,
        unit: r.unit || '',
        supplier: r.supplier || 'Unassigned',
        leadTimeDays: Math.max(0, num(r.leadTimeDays, 1)),
        leadTimeSdDays: Math.max(0, num(r.leadTimeSdDays, 0)),
        moq: Math.max(0, num(r.moq, 0)),
        packSize: Math.max(0, num(r.packSize, 1)) || 1,
        transferMultiple: Math.max(0, num(r.transferMultiple, 1)) || 1,
        unitCost: Math.max(0, num(r.unitCost, 0)),
        shelfLifeDays: Math.max(0, num(r.shelfLifeDays, 0)),
        orderEveryDays: Math.max(1, num(r.orderEveryDays, s.orderEveryDays))
      });
    });

    var products = new Map();
    (data.products || []).forEach(function (r) {
      var code = String(r.code || '').trim();
      if (!code) return;
      var madeAt = String(r.madeAt || 'BRANCH').trim().toUpperCase();
      products.set(code, {
        code: code,
        name: r.name || code,
        madeAt: madeAt === 'CK' || madeAt.indexOf('KITCHEN') >= 0 || madeAt === 'CENTRAL' ? 'CK' : 'BRANCH',
        price: num(r.price, 0),
        targetService: num(r.targetService, null),
        minQty: Math.max(0, num(r.minQty, 0))
      });
    });

    var bom = new Map();
    (data.bom || []).forEach(function (r) {
      var p = String(r.product || '').trim();
      var it = String(r.item || '').trim();
      var q = num(r.qty, 0);
      if (!p || !it || !(q > 0)) return;
      if (!products.has(p)) return;
      if (!items.has(it)) { warn('warn', 'Recipe for ' + p + ' uses unknown item ' + it + '. Line skipped.'); return; }
      if (!bom.has(p)) bom.set(p, []);
      bom.get(p).push({ item: it, qty: q });
    });
    products.forEach(function (p) {
      if (!bom.has(p.code)) warn('warn', 'Product ' + p.name + ' has no recipe, so it uses no raw materials.');
      p.cost = (bom.get(p.code) || []).reduce(function (a, l) { return a + l.qty * items.get(l.item).unitCost; }, 0);
    });

    var branches = [];
    (data.branches || []).forEach(function (r) {
      var code = String(r.code || '').trim();
      if (!code) return;
      branches.push({ code: code, name: r.name || code, deliveryDays: parseDeliveryDays(r.deliveryDays), deliveryText: r.deliveryDays || 'daily' });
    });
    var branchSet = new Set(branches.map(function (b) { return b.code; }));

    // ----- sales history -----
    var sales = new Map();      // branch|product|date -> qty
    var active = new Map();     // branch -> Set(date)
    var lastDate = -Infinity;
    var skipped = 0;
    (data.sales || []).forEach(function (r) {
      var d = parseDate(r.date);
      var b = String(r.branch || '').trim();
      var p = String(r.product || '').trim();
      var q = num(r.qty, 0);
      if (!isFinite(d) || !branchSet.has(b) || !products.has(p)) { skipped++; return; }
      var k = b + '|' + p + '|' + d;
      sales.set(k, (sales.get(k) || 0) + q);
      if (!active.has(b)) active.set(b, new Set());
      active.get(b).add(d);
      if (d > lastDate) lastDate = d;
    });
    if (skipped) warn('info', skipped + ' sales rows skipped (unknown branch, product or date).');
    if (!isFinite(lastDate)) {
      warn('error', 'No usable sales history. Import sales to get a plan.');
      lastDate = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) - DAY;
    }

    var planDate = s.planDate ? parseDate(s.planDate) : NaN;
    if (!isFinite(planDate)) planDate = lastDate + DAY;
    var histEnd = Math.min(lastDate, planDate - DAY);
    var histStart = histEnd - (Math.max(1, num(s.historyWeeks, 8)) * 7 - 1) * DAY;
    var histDates = [];
    for (var t = histEnd; t >= histStart; t -= DAY) histDates.push(t); // most recent first

    function isActive(b, d) { var set = active.get(b); return !!set && set.has(d); }

    // Weighted weekday forecast of one product at one branch.
    var fcCache = new Map();
    function forecast(b, p, d) {
      var wd = weekday(d);
      var key = b + '|' + p + '|' + wd;
      if (fcCache.has(key)) return fcCache.get(key);
      var obs = [];
      histDates.forEach(function (h) { if (weekday(h) === wd && isActive(b, h)) obs.push(sales.get(b + '|' + p + '|' + h) || 0); });
      if (obs.length < 3) {
        obs = [];
        histDates.forEach(function (h) { if (isActive(b, h)) obs.push(sales.get(b + '|' + p + '|' + h) || 0); });
      }
      var res = meanSd(obs, true);
      fcCache.set(key, res);
      return res;
    }

    // ----- 1. fresh products: CK to branches -----
    var fresh = []; // per branch per product
    var ckProducts = [];
    products.forEach(function (p) { if (p.madeAt === 'CK') ckProducts.push(p); });

    ckProducts.forEach(function (p) {
      var sl;
      if (p.targetService !== null && p.targetService > 0 && p.targetService < 1) sl = p.targetService;
      else if (p.price > 0) sl = (p.price - p.cost) / p.price;
      else sl = s.freshDefaultService;
      sl = Math.min(s.freshMaxService, Math.max(s.freshMinService, sl));
      p.serviceLevel = sl;
      var z = normInv(sl);
      branches.forEach(function (b) {
        var f = forecast(b.code, p.code, planDate);
        var q = Math.max(p.minQty, Math.round(f.mean + z * f.sd));
        if (f.mean === 0 && f.n === 0) q = 0;
        var zq = f.sd > 0 ? (q - f.mean) / f.sd : 0;
        var expLeft = f.sd > 0 ? f.sd * (normPdf(zq) + zq * normCdf(zq)) : Math.max(0, q - f.mean);
        var expShort = f.sd > 0 ? f.sd * (normPdf(zq) - zq * (1 - normCdf(zq))) : Math.max(0, f.mean - q);
        fresh.push({
          branch: b.code, product: p.code, name: p.name,
          forecast: f.mean, sd: f.sd, serviceLevel: sl, send: q,
          expWaste: expLeft, expWasteCost: expLeft * p.cost, expLostSales: expShort
        });
      });
    });

    // CK production and its raw material needs.
    var production = ckProducts.map(function (p) {
      var rows = fresh.filter(function (r) { return r.product === p.code; });
      var total = rows.reduce(function (a, r) { return a + r.send; }, 0);
      var withBuffer = Math.ceil(total * (1 + num(s.ckBufferPct, 0) / 100));
      var byBranch = {};
      rows.forEach(function (r) { byBranch[r.branch] = r.send; });
      return {
        product: p.code, name: p.name, total: withBuffer, byBranch: byBranch,
        serviceLevel: p.serviceLevel, unitCost: p.cost, price: p.price,
        expWaste: rows.reduce(function (a, r) { return a + r.expWaste; }, 0),
        expWasteCost: rows.reduce(function (a, r) { return a + r.expWasteCost; }, 0)
      };
    });

    var stock = indexQty(data.stock, 'location');
    var transit = indexQty(data.inTransit, 'location');

    var ckNeed = new Map();
    production.forEach(function (pr) {
      (bom.get(pr.product) || []).forEach(function (l) { ckNeed.set(l.item, (ckNeed.get(l.item) || 0) + l.qty * pr.total); });
    });
    var ckTransfer = [];
    ckNeed.forEach(function (need, it) {
      var item = items.get(it);
      var onHand = stock.get('CK|' + it) || 0;
      var inTr = transit.get('CK|' + it) || 0;
      var send = roundUpTo(need - onHand - inTr, item.transferMultiple);
      ckTransfer.push({ item: it, name: item.name, unit: item.unit, need: need, onHand: onHand, inTransit: inTr, request: send, send: send, short: 0 });
    });

    // ----- 2. raw materials to branches (par levels) -----
    var branchProducts = [];
    products.forEach(function (p) { if (p.madeAt === 'BRANCH') branchProducts.push(p); });

    var zBranch = normInv(s.branchServiceLevel);
    var branchRaw = [];
    var branchesDelivered = [];
    branches.forEach(function (b) {
      var delivers = b.deliveryDays.indexOf(weekday(planDate)) >= 0;
      var cover = daysUntilNextDelivery(b.deliveryDays, planDate);
      if (delivers) branchesDelivered.push(b.code);

      // Consumption history per item at this branch (from sales x recipe).
      var dates = histDates.filter(function (h) { return isActive(b.code, h); });
      var cons = new Map(); // item -> array aligned with dates
      dates.forEach(function (h, i) {
        branchProducts.forEach(function (p) {
          var q = sales.get(b.code + '|' + p.code + '|' + h);
          if (!q) return;
          (bom.get(p.code) || []).forEach(function (l) {
            if (!cons.has(l.item)) cons.set(l.item, new Array(dates.length).fill(0));
            cons.get(l.item)[i] += q * l.qty;
          });
        });
      });

      // Forecast usage over the coverage window.
      var windowUse = new Map();
      for (var k = 0; k < cover; k++) {
        var day = planDate + k * DAY;
        branchProducts.forEach(function (p) {
          var f = forecast(b.code, p.code, day);
          if (!f.mean) return;
          (bom.get(p.code) || []).forEach(function (l) { windowUse.set(l.item, (windowUse.get(l.item) || 0) + f.mean * l.qty); });
        });
      }

      var itemCodes = new Set();
      windowUse.forEach(function (_, it) { itemCodes.add(it); });
      cons.forEach(function (_, it) { itemCodes.add(it); });

      itemCodes.forEach(function (it) {
        var item = items.get(it);
        var series = cons.get(it) || [];
        var residSd = weekdayResidualSd(series, dates);
        var use = windowUse.get(it) || 0;
        var dailyAvg = use / cover;
        var safety = zBranch * residSd * Math.sqrt(cover);
        var target = use + safety;
        var capped = false;
        if (item.shelfLifeDays > 0 && dailyAvg > 0 && target > dailyAvg * item.shelfLifeDays) {
          target = dailyAvg * item.shelfLifeDays;
          capped = true;
        }
        var onHand = stock.get(b.code + '|' + it) || 0;
        var inTr = transit.get(b.code + '|' + it) || 0;
        var request = delivers ? roundUpTo(target - onHand - inTr, item.transferMultiple) : 0;
        branchRaw.push({
          branch: b.code, item: it, name: item.name, unit: item.unit,
          coverDays: cover, delivers: delivers, forecast: use, dailyAvg: dailyAvg, safety: safety, target: target,
          onHand: onHand, inTransit: inTr, request: request, send: request, short: 0, shelfCapped: capped
        });
      });
    });

    // ----- 3. allocate main WH stock when it cannot cover all requests -----
    var requestedByItem = new Map();
    ckTransfer.forEach(function (r) { requestedByItem.set(r.item, (requestedByItem.get(r.item) || 0) + r.request); });
    branchRaw.forEach(function (r) { requestedByItem.set(r.item, (requestedByItem.get(r.item) || 0) + r.request); });

    requestedByItem.forEach(function (req, it) {
      var avail = stock.get('MAIN|' + it) || 0;
      if (req <= avail + 1e-9) return;
      var item = items.get(it);
      // CK first: fresh production is already sold to branches.
      var ck = ckTransfer.find(function (r) { return r.item === it; });
      if (ck) {
        ck.send = Math.min(ck.request, roundDownTo(avail, item.transferMultiple));
        ck.short = ck.request - ck.send;
        avail -= ck.send;
      }
      var lines = branchRaw.filter(function (r) { return r.item === it && r.request > 0; });
      var bReq = lines.reduce(function (a, r) { return a + r.request; }, 0);
      var ratio = bReq > 0 ? Math.max(0, Math.min(1, avail / bReq)) : 0;
      lines.forEach(function (r) { r.send = roundDownTo(r.request * ratio, item.transferMultiple); });
      // Hand out what rounding left over, one multiple at a time, to the branch closest to running out.
      var left = avail - lines.reduce(function (a, r) { return a + r.send; }, 0);
      var cover = function (r) { return r.dailyAvg > 0 ? (r.onHand + r.inTransit + r.send) / r.dailyAvg : Infinity; };
      while (left + 1e-9 >= item.transferMultiple) {
        var open = lines.filter(function (r) { return r.send + item.transferMultiple <= r.request + 1e-9; });
        if (!open.length) break;
        open.sort(function (a, b) { return cover(a) - cover(b); });
        open[0].send = +(open[0].send + item.transferMultiple).toFixed(4);
        left -= item.transferMultiple;
      }
      lines.forEach(function (r) { r.short = +(r.request - r.send).toFixed(4); });
      warn('error', 'Main WH is short of ' + item.name + ': requested ' + fmtQty(req) + ' ' + item.unit + ', only ' + fmtQty(stock.get('MAIN|' + it) || 0) + ' on hand. Shared out by need.');
    });

    branchRaw.forEach(function (r) {
      if (r.shelfCapped) warn('info', 'Target for ' + r.name + ' at ' + r.branch + ' limited by its ' + items.get(r.item).shelfLifeDays + ' day shelf life.');
    });

    // ----- 4. purchasing at the main WH -----
    // Network daily consumption history per item (all products, all branches).
    var netCons = new Map();
    histDates.forEach(function (h, i) {
      branches.forEach(function (b) {
        if (!isActive(b.code, h)) return;
        products.forEach(function (p) {
          var q = sales.get(b.code + '|' + p.code + '|' + h);
          if (!q) return;
          (bom.get(p.code) || []).forEach(function (l) {
            if (!netCons.has(l.item)) netCons.set(l.item, new Array(histDates.length).fill(0));
            netCons.get(l.item)[i] += q * l.qty;
          });
        });
      });
    });
    var openPO = indexQty(data.openPOs, null);

    var zMain = normInv(s.mainServiceLevel);
    var purchasing = [];
    items.forEach(function (item, it) {
      var series = netCons.get(it) || [];
      var ms = meanSd(series, false);
      var mean = ms.mean, sd = ms.sd;
      var L = item.leadTimeDays, R = item.orderEveryDays;
      var safety = zMain * Math.sqrt((L + 1) * sd * sd + mean * mean * item.leadTimeSdDays * item.leadTimeSdDays);
      var reorderPoint = mean * L + safety;
      var orderUpTo = reorderPoint + mean * R;
      var shelfCapped = false;
      if (item.shelfLifeDays > 0 && mean > 0 && orderUpTo > mean * item.shelfLifeDays) {
        orderUpTo = Math.max(mean * item.shelfLifeDays, reorderPoint);
        shelfCapped = true;
      }
      var onHand = stock.get('MAIN|' + it) || 0;
      var onOrder = openPO.get(it) || 0;
      var committed = (requestedByItem.get(it) || 0);
      var position = onHand + onOrder;
      var qty = 0;
      if (mean > 0 && position <= reorderPoint) {
        qty = roundUpTo(Math.max(orderUpTo - position, item.moq), item.packSize);
      }
      var daysLeft = mean > 0 ? onHand / mean : Infinity;
      var status = qty > 0 ? (onHand < committed || daysLeft < L ? 'urgent' : 'order') : (mean === 0 ? 'no use' : 'ok');
      purchasing.push({
        item: it, name: item.name, unit: item.unit, supplier: item.supplier,
        dailyAvg: mean, dailySd: sd, leadTimeDays: L, orderEveryDays: R,
        safety: safety, reorderPoint: reorderPoint, orderUpTo: orderUpTo,
        onHand: onHand, onOrder: onOrder, committedToday: committed, position: position,
        daysLeft: daysLeft, orderQty: qty, packs: qty / item.packSize, packSize: item.packSize,
        value: qty * item.unitCost, unitCost: item.unitCost, status: status, shelfCapped: shelfCapped
      });
    });
    purchasing.sort(function (a, b) { return a.supplier.localeCompare(b.supplier) || a.name.localeCompare(b.name); });

    var notDelivered = branches.filter(function (b) { return branchesDelivered.indexOf(b.code) < 0; });
    if (notDelivered.length) warn('info', notDelivered.map(function (b) { return b.name; }).join(', ') + ': no raw material delivery on this day (fresh products still go out).');

    return {
      planDate: fmtDate(planDate),
      historyFrom: fmtDate(histStart),
      historyTo: fmtDate(histEnd),
      settings: s,
      branches: branches.map(function (b) { return { code: b.code, name: b.name, deliveryText: b.deliveryText, delivers: branchesDelivered.indexOf(b.code) >= 0, coverDays: daysUntilNextDelivery(b.deliveryDays, planDate) }; }),
      fresh: fresh,
      production: production,
      ckTransfer: ckTransfer.sort(byName),
      branchRaw: branchRaw.sort(byName),
      purchasing: purchasing,
      warnings: warnings
    };
  }

  // ---------- helpers ----------

  function byName(a, b) { return a.name.localeCompare(b.name); }

  function fmtQty(n) { return (Math.round(n * 100) / 100).toString(); }

  // Weighted (recent first) mean and sample sd.
  function meanSd(obs, weighted) {
    var n = obs.length;
    if (!n) return { mean: 0, sd: 0, n: 0 };
    var wsum = 0, sum = 0;
    for (var i = 0; i < n; i++) {
      var w = weighted ? (n - i) : 1;
      wsum += w; sum += w * obs[i];
    }
    var mean = sum / wsum;
    if (n < 2) return { mean: mean, sd: Math.sqrt(mean), n: n };
    var ss = 0;
    for (var j = 0; j < n; j++) ss += (obs[j] - mean) * (obs[j] - mean);
    return { mean: mean, sd: Math.sqrt(ss / (n - 1)), n: n };
  }

  // Day to day noise after removing the weekday pattern.
  function weekdayResidualSd(series, dates) {
    if (series.length < 2) return 0;
    var byWd = {};
    dates.forEach(function (d, i) { var w = weekday(d); (byWd[w] = byWd[w] || []).push(series[i]); });
    var avg = {};
    Object.keys(byWd).forEach(function (w) { var a = byWd[w]; avg[w] = a.reduce(function (x, y) { return x + y; }, 0) / a.length; });
    var ss = 0;
    dates.forEach(function (d, i) { var r = series[i] - avg[weekday(d)]; ss += r * r; });
    var dof = Math.max(1, series.length - Object.keys(byWd).length);
    return Math.sqrt(ss / dof);
  }

  function indexQty(rows, locField) {
    var m = new Map();
    (rows || []).forEach(function (r) {
      var it = String(r.item || '').trim();
      if (!it) return;
      var key = locField ? String(r[locField] || '').trim().toUpperCase() + '|' + it : it;
      if (locField) {
        var loc = String(r[locField] || '').trim();
        var up = loc.toUpperCase();
        if (up === 'MAIN' || up === 'MAIN WH' || up === 'WH') key = 'MAIN|' + it;
        else if (up === 'CK' || up.indexOf('KITCHEN') >= 0) key = 'CK|' + it;
        else key = loc + '|' + it;
      }
      m.set(key, (m.get(key) || 0) + num(r.qty, 0));
    });
    return m;
  }

  return {
    plan: plan,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    parseDate: parseDate,
    fmtDate: fmtDate,
    normInv: normInv,
    parseDeliveryDays: parseDeliveryDays
  };
});
