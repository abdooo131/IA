/* ASG Planning Desk forecasting engine.
   Turns raw tables (items, sources, weekly sales, stock, optional stockouts and cancellations)
   into everything the page shows. The same code runs for the built in demo data and for files
   a planner uploads, so both are treated identically. */
const ENGINE = (() => {
  const HORIZON = 16, FOLDS = 4, FOLD_LEN = 8, REVIEW_DAYS = 7, SHOW_WEEKS = 53;
  const SVC = {AX: .97, AY: .96, AZ: .95, BX: .95, BY: .94, BZ: .92, CX: .92, CY: .90, CZ: .88};
  const MS_DAY = 864e5;

  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const std = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1)); };
  const sum = a => a.reduce((x, y) => x + y, 0);
  const ceilTo = (x, step) => step > 0 ? Math.ceil(x / step) * step : Math.ceil(x);
  const iso = d => d.toISOString().slice(0, 10);
  const addDays = (isoStr, n) => iso(new Date(Date.parse(isoStr + 'T00:00:00Z') + n * MS_DAY));
  // inverse normal CDF (Acklam), for safety stock z values
  function zOf(p){
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924],
      b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857],
      c = [-.00778489400243029, -.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878],
      d = [.00778469570904146, .32246712907004, 2.445134137143, 3.75440866190742];
    const q = p < .02425 ? Math.sqrt(-2 * Math.log(p)) : p > .97575 ? Math.sqrt(-2 * Math.log(1 - p)) : null;
    if (q == null){ const r = (p - .5) ** 2, s = p - .5;
      return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * s / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
    const v = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    return p > .5 ? -v : v;
  }

  /* Calendar every Egyptian dealer feels: Ramadan slows orders, dealers stock up before the January price list. */
  const RAMADAN = [['2023-03-23', '2023-04-21'], ['2024-03-11', '2024-04-09'], ['2025-03-01', '2025-03-30'], ['2026-02-18', '2026-03-19'],
                   ['2027-02-08', '2027-03-09'], ['2028-01-28', '2028-02-26']];
  function calendar(isoStr){
    let m = 1; const [, mo, da] = isoStr.split('-').map(Number);
    const end = addDays(isoStr, 6);
    if (RAMADAN.some(([a, b]) => !(end < a || isoStr > b))) m *= .72;
    if ((mo === 12 && da >= 18) || (mo === 1 && da <= 3)) m *= 1.15;
    return m;
  }
  const woy = isoStr => { const d = new Date(Date.parse(isoStr + 'T00:00:00Z')), y0 = Date.UTC(d.getUTCFullYear(), 0, 1); return Math.min(51, Math.floor((d - y0) / MS_DAY / 7)); };

  /* models: each takes history h and returns n weekly forecasts */
  const velocity = (h, n, w) => Array(n).fill(mean(h.slice(-w)));
  function ses(h, n, alpha = .2){ let l = mean(h.slice(0, 8)); for (const x of h) l = alpha * x + (1 - alpha) * l; return Array(n).fill(l); }
  function croston(h, n, alpha = .15, sba = false){
    let z = null, p = null, gap = 1;
    for (const x of h){ if (x > 0){ z = z == null ? x : alpha * x + (1 - alpha) * z; p = p == null ? gap : alpha * gap + (1 - alpha) * p; gap = 1; } else gap++; }
    return Array(n).fill(z == null ? 0 : z / p * (sba ? 1 - alpha / 2 : 1));
  }
  const seasonal = (h, n, ih, ifu) => { const l = ses(h.map((x, i) => x / Math.max(ih[i], .3)), 1, .15)[0]; return ifu.slice(0, n).map(i => l * i); };
  const share = (h, n, lineFc, lineH) => { const s = sum(h.slice(-26)) / Math.max(1e-9, sum(lineH.slice(-26))); return lineFc.slice(0, n).map(x => s * x); };

  function classify(h){
    const nz = h.filter(x => x > 0); if (!nz.length) return 'lumpy';
    const adi = h.length / nz.length, cv2 = nz.length > 1 ? (std(nz) / mean(nz)) ** 2 : 0;
    return adi < 1.32 ? (cv2 < .49 ? 'smooth' : 'erratic') : (cv2 < .49 ? 'intermittent' : 'lumpy');
  }

  /* demand after stockout adjustment: scale partial weeks, impute dark weeks from recent demand,
     but stop imputing once a SKU has been out for more than 150 days (it is no longer really for sale) */
  function adjust(sold, short){
    const a = []; let run = 0;
    sold.forEach((u, i) => { const sd = short[i] || 0; run = sd >= 7 ? run + 7 : 0;
      if (sd >= 7 || (sd && u === 0)) a.push(run > 150 ? u : a.length ? mean(a.slice(-8)) : u);
      else if (sd) a.push(u * 7 / (7 - sd));
      else a.push(u); });
    return {a, outDays: run};
  }

  function build(R){
    const issues = [...(R.issues || [])];
    const N = R.nweeks, weeks = Array.from({length: N}, (_, i) => addDays(R.start, 7 * i));
    const fweeks = Array.from({length: HORIZON}, (_, k) => addDays(R.start, 7 * (N + k)));
    const srcNames = Object.keys(R.sources);
    const items = R.items.filter(it => R.sales[it.sku] || (R.stock[it.sku] && R.stock[it.sku].oh > 0));
    R.items.filter(it => !items.includes(it)).forEach(it =>
      issues.push({type: 'No sales and no stock', sku: it.sku, id: null, detail: 'In the item list but has no sales history and nothing on hand, so it is left out.', kind: 'data', sev: 'low'}));
    const S = items.map((it, k) => {
      const sold = (R.sales[it.sku] || Array(N).fill(0)).map(x => Math.max(0, x || 0));
      const short = R.short[it.sku] || Array(N).fill(0);
      const {a, outDays} = adjust(sold, short);
      return {...it, id: String(k + 1), sold, short, adj: a, outDays};
    });

    /* seasonal index per product line: calendar effects times week of year shape when 2 years of history exist */
    const lines = [...new Set(S.map(s => s.line))];
    const lineHist = Object.fromEntries(lines.map(l => [l, weeks.map((_, i) => sum(S.filter(s => s.line === l).map(s => s.adj[i])))]));
    const shape = {};
    for (const l of lines){
      const w = Array(52).fill(1);
      if (N >= 104){
        const y = lineHist[l].map((v, i) => v / calendar(weeks[i])), acc = Array.from({length: 52}, () => []);
        for (let i = 26; i < N - 26; i++){ const base = mean(y.slice(i - 26, i + 26)); if (base > 0) acc[woy(weeks[i])].push(y[i] / base); }
        const raw = acc.map(v => v.length ? mean(v) : 1);
        for (let k = 0; k < 52; k++){ const sm = mean([-2, -1, 0, 1, 2].map(o => raw[(k + o + 52) % 52])); w[k] = 1 + .6 * (sm - 1); }
      }
      shape[l] = w;
    }
    const idx = (line, dates) => dates.map(d => calendar(d) * shape[line][woy(d)]);

    const models = (h, line, cut, n) => {
      const hh = h.slice(0, cut), ih = idx(line, weeks.slice(0, cut)), fd = cut < N ? weeks.slice(cut, cut + n) : fweeks.slice(0, n), ifu = idx(line, fd);
      const lh = lineHist[line].slice(0, cut);
      return {velocity_30: velocity(hh, n, 4), velocity_90: velocity(hh, n, 13), ses: ses(hh, n), croston: croston(hh, n), sba: croston(hh, n, .15, true),
              seasonal_ses: seasonal(hh, n, ih, ifu), product_share: share(hh, n, seasonal(lh, n, ih, ifu), lh)};
    };
    const folds = Math.max(1, Math.min(FOLDS, Math.floor((N - 16) / FOLD_LEN)));
    const cuts = Array.from({length: folds}, (_, k) => N - FOLD_LEN * (folds - k));
    const tot = {sel: [0, 0], base: [0, 0]}, hold = {sel: [0, 0], base: [0, 0]}, byLine = {};

    for (const s of S){
      const per = cuts.map(c => ({fc: models(s.adj, s.line, c, FOLD_LEN), act: s.adj.slice(c, c + FOLD_LEN)}));
      const names = Object.keys(per[0].fc), errs = {};
      const addErr = m => errs[m] = per.map(({fc, act}) => [sum(act.map((a, i) => Math.abs(a - fc[m][i]))), sum(act)]);
      names.forEach(addErr);
      const score = (m, ks) => { const e = sum(ks.map(k => errs[m][k][0])), a = sum(ks.map(k => errs[m][k][1])); return a ? e / a : (e < .5 ? 0 : 9); };
      const all = [...Array(folds).keys()], older = folds > 1 ? all.slice(0, -1) : all;
      const ens = [...names].sort((x, y) => score(x, all) - score(y, all)).slice(0, 3);
      per.forEach(({fc}) => fc.ensemble = fc[ens[0]].map((_, i) => mean(ens.map(m => fc[m][i]))));
      addErr('ensemble');
      const allm = [...names, 'ensemble'];
      const best = allm.reduce((b, m) => score(m, all) < score(b, all) ? m : b), bestOld = allm.reduce((b, m) => score(m, older) < score(b, older) ? m : b);
      s.model = best; s.wape = Math.min(5, score(best, all)); s.cls = classify(s.adj.slice(-52));
      s.long = s.outDays > 150;
      const recentSales = sum(s.sold.slice(-13));
      if (!s.long && sum(s.adj.slice(-26)) > 0){
        const e = sum(errs[best].map(x => x[0])), a = sum(errs[best].map(x => x[1])), eb = sum(errs.velocity_30.map(x => x[0]));
        tot.sel[0] += e; tot.sel[1] += a; tot.base[0] += eb; tot.base[1] += a;
        const last = folds - 1; hold.sel[0] += errs[bestOld][last][0]; hold.sel[1] += errs[bestOld][last][1];
        hold.base[0] += errs.velocity_30[last][0]; hold.base[1] += errs.velocity_30[last][1];
        const b = byLine[s.line] ||= [0, 0, 0]; b[0] += e; b[1] += a; b[2] += eb;
      }
      const res = per.flatMap(({fc, act}) => act.map((a, i) => a - fc[best][i]));
      s.sigma = Math.max(std(res), .05 * mean(s.adj.slice(-13)));
      const full = models(s.adj, s.line, N, HORIZON);
      full.ensemble = full[ens[0]].map((_, i) => mean(ens.map(m => full[m][i])));
      const off = s.long || (recentSales === 0 && sum(s.adj.slice(-13)) === 0);
      s.fm = off ? Array(HORIZON).fill(0) : full[best].map(x => Math.max(0, x));
      s.fl = s.fm.map(x => Math.max(0, x - 1.28 * s.sigma));
      s.fh = s.fm.map(x => x ? x + 1.28 * s.sigma : 0);
    }

    /* ABC on 12 month value at cost, XYZ on weekly variability */
    const val = s => sum(s.adj.slice(-52)) * (s.cost || 0), total = sum(S.map(val));
    let run = 0;
    [...S].sort((a, b) => val(b) - val(a)).forEach(s => { run += val(s);
      s.abc = run <= .8 * total ? 'A' : run <= .95 * total ? 'B' : 'C';
      const h = s.adj.slice(-52), cv = mean(h) ? std(h) / mean(h) : 9; s.xyz = cv < .25 ? 'X' : cv < .5 ? 'Y' : 'Z'; });

    const rows = S.map(s => {
      const src = R.sources[s.src] || {kind: 'factory', lt: 21, pack: 1, moq: 0};
      const st = R.stock[s.sku] || {oh: 0, cm: 0, inc: 0};
      const oh = st.oh, cm = st.cm || 0, inc = st.inc || 0;
      const wk = mean(s.fm.slice(0, 8)), daily = wk / 7, L = src.lt + REVIEW_DAYS;
      const level = SVC[s.abc + s.xyz], ss = zOf(level) * s.sigma * Math.sqrt(L / 7);
      const rop = Math.round(daily * L + ss), tgt = Math.round(daily * (L + 21) + ss), pos = Math.max(oh, 0) - cm + inc;
      const dead = sum(s.sold.slice(-13)) === 0 && oh > 0;
      const verb = src.kind === 'factory' ? 'Make' : 'Buy';
      let q = 0, status, reason;
      if (dead){ status = 'dead'; reason = `Not planned. No sales in 13 weeks with ${fmt(oh)} pcs on hand. Discontinue or clear with a dealer offer.`; }
      else if (s.long){ status = 'longout'; reason = `Not planned. Out of stock for ${s.outDays} days while still listed. Demand is no longer imputed. Restart production or remove it from the price list.`; }
      else if (!daily){ status = 'ok'; reason = 'Not planned. No demand forecast for this SKU, it has stopped selling.'; }
      else {
        const head = `Stock position ${fmt(pos)} pcs (on hand ${fmt(Math.max(oh, 0))}, committed ${fmt(cm)}, incoming ${fmt(inc)}) against reorder point ${fmt(rop)}. ` +
          `Reorder point is ${L} days of demand (${fmt(daily * L)}) plus safety stock ${fmt(ss)} for ${Math.round(level * 100)}% service (${s.abc}${s.xyz}).`;
        if (pos < rop){ const need = tgt - pos; q = Math.max(src.moq || 0, ceilTo(need, src.pack || 1)); status = 'make';
          reason = `${head} ${verb} up to ${fmt(tgt)} needs ${fmt(need)}, rounded to ${fmt(q)} (cartons of ${src.pack || 1}, minimum batch ${fmt(src.moq || 0)}). Covers ${fmt((pos + q) / daily)} days.`; }
        else { status = 'ok'; reason = `${head} Nothing to ${verb.toLowerCase()} this week.`; }
      }
      const free = Math.max(oh, 0) - cm, dl = daily ? free / daily : null;
      if ((status === 'ok' || status === 'make') && daily && free > daily * 120) status = 'over';
      if (oh < 0) issues.push({type: 'Negative stock', sku: s.sku, id: s.id, detail: `Stock file shows ${fmt(oh)} on hand. Shipments were booked before the receipt.`, kind: 'process', sev: 'high'});
      if (!s.cost) issues.push({type: 'Unit cost missing', sku: s.sku, id: s.id, detail: 'No unit cost in the item list, so order value is left out.', kind: 'data', sev: 'medium'});
      if (!R.stock[s.sku]) issues.push({type: 'Not in stock file', sku: s.sku, id: s.id, detail: 'No stock row, so on hand is taken as zero.', kind: 'data', sev: 'medium'});
      if (!R.sources[s.src]) issues.push({type: 'Unknown source', sku: s.sku, id: s.id, detail: `Source "${s.src}" is not in the sources file. Using 21 days lead time and no batch rules.`, kind: 'data', sev: 'medium'});
      s.status = status; s.daily = daily; s.oh = oh;
      return {id: s.id, sku: s.sku, code: s.code || '', p: s.p, c: s.c || '–', z: s.z || '–', line: s.line, src: s.src, oh, cm, inc, wk: Math.round(wk), rop, tgt, pos, q,
              cost: s.cost || null, val: s.cost ? Math.round(q * s.cost) : null, sv: Math.round(Math.max(oh, 0) * (s.cost || 0)), dl: dl == null ? null : Math.round(dl),
              abc: s.abc, xyz: s.xyz, cls: s.cls, model: s.model, wape: s.wape, conf: s.wape < .2 ? 'high' : s.wape < .4 ? 'medium' : 'low', status, reason,
              lt: src.lt, pack: src.pack || 1, moq: src.moq || 0, svc: Math.round(level * 100), price: s.price || null};
    });

    const sources = {};
    for (const name of new Set([...srcNames, ...S.map(s => s.src)])){
      const src = R.sources[name] || {kind: 'factory', lt: 21, pack: 1, moq: 0}, mine = S.filter(s => s.src === name);
      let cap = src.cap || null;
      if (src.kind === 'factory' && !cap && mine.length){
        cap = ceilTo(mean(weeks.slice(-52).map((_, j) => sum(mine.map(s => s.adj[N - 52 + j] || 0)))) * 1.15, 1000);
        issues.push({type: 'Capacity not given', sku: name, id: null, detail: `No weekly capacity in the sources file. Using ${fmt(cap)} a week, 15% above last year's demand.`, kind: 'data', sev: 'low'});
      }
      if (R.sources[name] && !src.confirmed)
        issues.push({type: 'Lead time not confirmed', sku: name, id: null, detail: `Using ${src.lt} days, cartons of ${src.pack || 1}, minimum batch ${fmt(src.moq || 0)}.`, kind: 'data', sev: 'medium'});
      sources[name] = {kind: src.kind, lt: src.lt, pack: src.pack || 1, moq: src.moq || 0, cap};
    }

    /* pricing suggestions */
    const md = [], mu = [];
    for (const s of S){
      if (s.status === 'dead' || s.long || !s.daily) continue;
      const cover = Math.max(s.oh, 0) / s.daily;
      if (cover > 120){ const pct = cover < 180 ? 5 : cover < 260 ? 10 : 15;
        md.push({id: s.id, pct, v: s.oh * (s.cost || 0), why: `${fmt(Math.max(s.oh, 0))} pcs on hand, selling ${fmt(s.daily)} a day, ${fmt(cover)} days of cover. A ${pct}% dealer discount should clear the excess in about 60 days.`}); }
      const outWeeks = s.short.slice(-13).filter(x => x > 0).length;
      if (outWeeks >= 2 && 'AB'.includes(s.abc)){ const pct = outWeeks < 4 ? 3 : 5;
        mu.push({id: s.id, pct, v: s.daily * (s.cost || 0), why: `Short in ${outWeeks} of the last 13 weeks while demand holds at ${fmt(s.daily)} a day (${s.abc} item). A ${pct}% price list increase protects margin while supply catches up.`}); }
    }
    const top = arr => arr.sort((a, b) => b.v - a.v).slice(0, 30).map(({v, ...r}) => r);

    /* cancellations */
    const asof = R.asof, c90 = addDays(asof, -90), c365 = addDays(asof, -365), cl = R.cancels || [];
    const win = (from, label) => { const r = cl.filter(c => c.date > from); return {w: label, o: r.length, u: sum(r.map(c => c.qty)), v: Math.round(sum(r.map(c => c.value || 0)))}; };
    const why = {}; cl.filter(c => c.date > c90).forEach(c => { const o = why[c.reason || 'Not given'] ||= {r: c.reason || 'Not given', o: 0, v: 0}; o.o++; o.v += c.value || 0; });

    const w = x => x[1] ? x[0] / x[1] : 0, first = Math.max(0, N - SHOW_WEEKS);
    return {
      asof, annual: Math.round(sum(S.map(s => sum(s.sold.slice(-52))))), label: R.label,
      weeks: weeks.slice(first), fweeks,
      acc: {sel: w(tot.sel), base: w(tot.base), hsel: w(hold.sel), hbase: w(hold.base),
            lines: Object.entries(byLine).filter(([, v]) => v[1]).sort().map(([line, v]) => ({line, sel: v[0] / v[1], base: v[2] / v[1]}))},
      sources, skus: rows,
      H: Object.fromEntries(S.map(s => [s.id, [s.sold.slice(first).map(Math.round), s.adj.slice(first).map(Math.round), s.short.slice(first)]])),
      F: Object.fromEntries(S.map(s => [s.id, [s.fm.map(Math.round), s.fl.map(Math.round), s.fh.map(Math.round)]])),
      issues, md: top(md), mu: top(mu), margin: R.margin || 1.45,
      cancel: {win: cl.length ? [win(c90, 'Last 90 days'), win(c365, 'Last 12 months')] : [], why: Object.values(why).map(r => ({...r, v: Math.round(r.v)}))},
    };
  }
  function fmt(x){ return Math.round(x).toLocaleString('en'); }

  /* ---------- reading uploaded tables ---------- */
  const ALIAS = {
    sku: ['sku', 'item', 'item code', 'item_code', 'code', 'product code', 'variant sku', 'barcode sku'],
    p: ['product', 'name', 'description', 'item name', 'product name', 'title'],
    line: ['line', 'product line', 'category', 'family', 'group', 'collection'],
    c: ['finish', 'color', 'colour', 'variant'], z: ['size', 'dimension'],
    src: ['source', 'factory', 'supplier', 'made at', 'plant', 'vendor'],
    cost: ['unit cost', 'unit_cost', 'cost', 'standard cost', 'cost egp', 'unit_cost_egp'],
    price: ['price', 'dealer price', 'list price', 'unit price'],
    code: ['model', 'model code', 'model_code'],
    date: ['date', 'week', 'week start', 'week_start', 'order date', 'order_date', 'invoice date', 'ship date', 'created at', 'day'],
    qty: ['qty', 'quantity', 'units', 'sold', 'qty sold', 'quantity sold', 'pcs', 'pieces', 'net qty'],
    status: ['status', 'order status', 'state'], reason: ['reason', 'cancel reason', 'cancellation reason'],
    value: ['value', 'amount', 'net amount', 'total', 'value egp', 'line total'],
    oh: ['on hand', 'on_hand', 'onhand', 'stock', 'qty on hand', 'available', 'inventory'],
    cm: ['committed', 'reserved', 'allocated', 'open orders'], inc: ['incoming', 'on order', 'on_order', 'in transit', 'open po', 'wip'],
    kind: ['type', 'kind'], lt: ['lead time days', 'lead_time_days', 'lead time', 'lt', 'lead_time'],
    pack: ['carton', 'pack', 'pack size', 'carton size', 'case qty'], moq: ['min batch', 'min_batch', 'moq', 'minimum batch', 'minimum order'],
    cap: ['weekly capacity', 'weekly_capacity', 'capacity', 'capacity per week'], confirmed: ['confirmed', 'lead time confirmed'],
    days: ['days out', 'days_out', 'short days', 'stockout days', 'days'],
  };
  function mapCols(headers, wanted){
    const norm = h => String(h).trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
    const H = headers.map(norm), out = {};
    for (const k of wanted){ const i = H.findIndex(h => ALIAS[k].map(norm).includes(h)); if (i >= 0) out[k] = headers[i]; }
    return out;
  }
  const num = v => { if (v == null || v === '') return null; if (typeof v === 'number') return v; const x = parseFloat(String(v).replace(/[, ]/g, '').replace(/[^\d.\-eE]/g, '')); return isNaN(x) ? null : x; };
  function toISODate(v){
    if (v instanceof Date && !isNaN(v)) return iso(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
    if (typeof v === 'number' && v > 20000 && v < 80000) return iso(new Date(Date.UTC(1899, 11, 30) + v * MS_DAY)); // Excel serial
    const s = String(v ?? '').trim(); let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return iso(new Date(Date.UTC(+m[1], m[2] - 1, +m[3])));
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))){ const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return iso(new Date(Date.UTC(y, m[2] - 1, +m[1]))); } // day first
    const t = Date.parse(s); return isNaN(t) ? null : iso(new Date(t));
  }
  const monday = isoStr => { const d = new Date(Date.parse(isoStr + 'T00:00:00Z')); return addDays(isoStr, -((d.getUTCDay() + 6) % 7)); };

  /* tables: {items, sales, stock, sources?, stockouts?} each an array of row objects. Returns {raw, problems} */
  function fromTables(t){
    const problems = [], need = (name, rows, cols, req) => {
      if (!rows || !rows.length){ problems.push(`${name}: file is empty.`); return null; }
      const m = mapCols(Object.keys(rows[0]), cols), miss = req.filter(k => !m[k]);
      if (miss.length){ problems.push(`${name}: missing column ${miss.map(k => '"' + ALIAS[k][0] + '"').join(', ')}. Found: ${Object.keys(rows[0]).join(', ')}.`); return null; }
      return m;
    };
    const mi = need('Items', t.items, ['sku', 'p', 'line', 'c', 'z', 'src', 'cost', 'price', 'code'], ['sku', 'p', 'line', 'src']);
    const ms = need('Sales', t.sales, ['sku', 'date', 'qty', 'status', 'reason', 'value'], ['sku', 'date', 'qty']);
    const mk = need('Stock', t.stock, ['sku', 'oh', 'cm', 'inc'], ['sku', 'oh']);
    const mo = t.sources?.length ? need('Sources', t.sources, ['src', 'kind', 'lt', 'pack', 'moq', 'cap', 'confirmed'], ['src', 'lt']) : null;
    const mx = t.stockouts?.length ? need('Stockouts', t.stockouts, ['sku', 'date', 'days'], ['sku', 'date', 'days']) : null;
    if (!mi || !ms || !mk) return {problems};
    const issues = [], items = [], seen = new Set();
    for (const r of t.items){ const sku = String(r[mi.sku] ?? '').trim(); if (!sku) continue;
      if (seen.has(sku)){ issues.push({type: 'Duplicate SKU', sku, id: null, detail: 'Appears more than once in the item list. The first row is used.', kind: 'data', sev: 'high'}); continue; }
      seen.add(sku);
      items.push({sku, p: String(r[mi.p] ?? sku), line: String(r[mi.line] ?? 'Other').trim() || 'Other', c: mi.c ? String(r[mi.c] ?? '') : '', z: mi.z ? String(r[mi.z] ?? '') : '',
                  src: String(r[mi.src] ?? 'Unknown').trim() || 'Unknown', cost: mi.cost ? num(r[mi.cost]) : null, price: mi.price ? num(r[mi.price]) : null, code: mi.code ? String(r[mi.code] ?? '') : ''}); }
    const dated = [], cancels = [], unknown = new Map();
    let badDate = 0;
    for (const r of t.sales){ const sku = String(r[ms.sku] ?? '').trim(), d = toISODate(r[ms.date]), q = num(r[ms.qty]);
      if (!sku || q == null) continue; if (!d){ badDate++; continue; }
      if (!seen.has(sku)){ unknown.set(sku, (unknown.get(sku) || 0) + q); continue; }
      const stt = ms.status ? String(r[ms.status] ?? '').toLowerCase() : '';
      if (/cancel|void|reject|declin/.test(stt)){ cancels.push({date: d, sku, qty: q, value: ms.value ? num(r[ms.value]) || 0 : 0, reason: ms.reason ? String(r[ms.reason] ?? '') : ''}); continue; }
      dated.push([d, sku, q]); }
    if (badDate) problems.push(`Sales: ${badDate} rows have a date that could not be read. Use YYYY-MM-DD or DD/MM/YYYY.`);
    for (const [sku, q] of unknown) issues.push({type: 'Sales for unknown SKU', sku, id: null, detail: `${fmt(q)} units sold but the SKU is not in the item list.`, kind: 'data', sev: 'medium'});
    if (!dated.length){ problems.push('Sales: no usable rows.'); return {problems}; }
    const dates = dated.map(x => x[0]).sort(), start = monday(dates[0]), last = monday(dates[dates.length - 1]);
    const N = Math.round((Date.parse(last) - Date.parse(start)) / MS_DAY / 7) + 1;
    if (N < 20) problems.push(`Sales: ${N} weeks of history is too short to forecast. Upload at least 26 weeks, ideally 104 for seasonality.`);
    else if (N < 26) problems.push(`Sales: only ${N} weeks of history. Forecasts will be rough; 104 weeks gives seasonality.`);
    const wkIndex = d => Math.round((Date.parse(monday(d)) - Date.parse(start)) / MS_DAY / 7);
    const sales = {};
    for (const [d, sku, q] of dated){ (sales[sku] ||= Array(N).fill(0))[wkIndex(d)] += q; }
    const short = {};
    if (mx) for (const r of t.stockouts){ const sku = String(r[mx.sku] ?? '').trim(), d = toISODate(r[mx.date]), v = num(r[mx.days]);
      if (!seen.has(sku) || !d || v == null) continue; const i = wkIndex(d); if (i >= 0 && i < N) (short[sku] ||= Array(N).fill(0))[i] = Math.min(7, (short[sku][i] || 0) + v); }
    const stock = {};
    for (const r of t.stock){ const sku = String(r[mk.sku] ?? '').trim(); if (!sku) continue;
      stock[sku] = {oh: num(r[mk.oh]) || 0, cm: mk.cm ? num(r[mk.cm]) || 0 : 0, inc: mk.inc ? num(r[mk.inc]) || 0 : 0}; }
    const sources = {};
    if (mo) for (const r of t.sources){ const name = String(r[mo.src] ?? '').trim(); if (!name) continue;
      const kind = /import|buy|supplier|vendor|purchase/i.test(String(r[mo.kind] ?? '')) ? 'import' : 'factory';
      sources[name] = {kind, lt: num(r[mo.lt]) || 21, pack: mo.pack ? num(r[mo.pack]) || 1 : 1, moq: mo.moq ? num(r[mo.moq]) || 0 : 0,
                       cap: mo.cap ? num(r[mo.cap]) : null, confirmed: mo.confirmed ? /^(y|yes|true|1)$/i.test(String(r[mo.confirmed] ?? '').trim()) : false}; }
    else issues.push({type: 'No sources file', sku: 'all', id: null, detail: 'Lead times, cartons and batch sizes default to 21 days, 1 and 0.', kind: 'data', sev: 'medium'});
    if (problems.some(p => !p.startsWith('Sales: only'))) return {problems};
    return {problems, raw: {asof: addDays(last, 6), start, nweeks: N, items, sources, sales, short, stock, cancels, issues}};
  }

  return {build, fromTables, ALIAS};
})();
