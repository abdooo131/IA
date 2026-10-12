/* ASG Planning Desk forecasting engine.
   Turns raw tables into everything the page shows. The same code runs for the built in demo
   data and for files a planner uploads.

   Inputs (all but items, sales and stock are optional):
     items       sku, product, line, source, finish, size, unit_cost, price, model, launch_date, end_date, replaces
     sales       date, sku, qty, status (shipped, cancelled, lost), channel (dealer, project, export), reason, value
     stock       sku, on_hand, committed, incoming
     sources     source, type, lead_time_days, carton, min_batch, weekly_capacity, confirmed
     stockouts   date, sku, days_out
     events      type (price, promo), start, end, pct, line, sku          price changes and dealer promotions
     orders      due_date, sku, qty, channel                            confirmed future orders
     macro       month, cement, usd_egp, cpi                             market data
     dealers     date, dealer, sku, stock, sell_out                      stock held by dealers
     bom         sku, material, qty_per_unit
     materials   material, unit, on_hand, on_order, lead_time_days

   Forecast steps per SKU, each one visible in the SKU drawer:
     1 weekly dealer demand: shipped plus recorded lost orders, cancelled orders removed
     2 stockout weeks filled in, then demand that moved to sibling sizes taken back off them
     3 price change and promotion effects measured from history and removed
     4 calendar removed: Ramadan, Eid, public holidays, year end stocking, and the line's yearly shape
     5 seven models backtested on 4 windows of 8 weeks; lowest error wins
     6 winner's level put back through the calendar and any announced events
     7 construction activity (cement, 6 month lag) moves the level by each line's measured elasticity
     8 dealer stock above or below normal pulls the next 8 weeks down or up
     9 lifecycle: launches borrow history, phase outs stop at their end date
    10 export forecast and confirmed project and export orders added on top
*/
const ENGINE = (() => {
  const HORIZON = 26, FOLDS = 4, FOLD_LEN = 8, REVIEW_DAYS = 7, SHOW_WEEKS = 53, SCHED_WEEKS = 6, MACRO_LAG = 6;
  const SVC = {AX: .97, AY: .96, AZ: .95, BX: .95, BY: .94, BZ: .92, CX: .92, CY: .90, CZ: .88};
  const MS_DAY = 864e5;

  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const std = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1)); };
  const sum = a => a.reduce((x, y) => x + y, 0);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const ceilTo = (x, step) => step > 0 ? Math.ceil(x / step) * step : Math.ceil(x);
  const iso = d => d.toISOString().slice(0, 10);
  const ms = s => Date.parse(s + 'T00:00:00Z');
  const addDays = (s, n) => iso(new Date(ms(s) + n * MS_DAY));
  const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / MS_DAY);
  const fmt = x => Math.round(x).toLocaleString('en');
  const pctTxt = x => (x >= 0 ? '+' : '') + Math.round(x * 100) + '%';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dtxt = s => { const [y, m, d] = s.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };
  function zOf(p){ // inverse normal CDF (Acklam)
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

  /* ---------- Egyptian trading calendar ---------- */
  const RAMADAN = [['2023-03-23', '2023-04-20'], ['2024-03-11', '2024-04-08'], ['2025-03-01', '2025-03-29'], ['2026-02-18', '2026-03-18'], ['2027-02-08', '2027-03-08'], ['2028-01-28', '2028-02-25']];
  const EID = [['2023-04-21', '2023-04-24', 'Eid al Fitr'], ['2023-06-27', '2023-07-01', 'Eid al Adha'], ['2024-04-09', '2024-04-12', 'Eid al Fitr'], ['2024-06-15', '2024-06-19', 'Eid al Adha'],
    ['2025-03-30', '2025-04-02', 'Eid al Fitr'], ['2025-06-05', '2025-06-09', 'Eid al Adha'], ['2026-03-19', '2026-03-22', 'Eid al Fitr'], ['2026-05-26', '2026-05-30', 'Eid al Adha'],
    ['2027-03-09', '2027-03-12', 'Eid al Fitr'], ['2027-05-15', '2027-05-19', 'Eid al Adha'], ['2028-02-26', '2028-02-29', 'Eid al Fitr'], ['2028-05-04', '2028-05-08', 'Eid al Adha']];
  const DAYOFF = [['01-07', 'Coptic Christmas'], ['01-25', 'Revolution Day'], ['04-25', 'Sinai Liberation Day'], ['05-01', 'Labour Day'], ['06-30', 'June 30 Revolution'],
    ['07-23', 'Revolution Day'], ['10-06', 'Armed Forces Day']];
  const NESSIM = ['2023-04-17', '2024-05-06', '2025-04-21', '2026-04-13', '2027-05-03', '2028-04-17'];
  const overlap = (ws, a, b) => Math.max(0, (Math.min(ms(addDays(ws, 6)), ms(b)) - Math.max(ms(ws), ms(a))) / MS_DAY + 1); // days of [a, b] inside the week
  function calendar(ws){
    let m = 1; const why = [];
    const we = addDays(ws, 6);
    const ram = RAMADAN.find(([a, b]) => !(we < a || ws > b)); if (ram){ const k = .72 + .28 * (1 - overlap(ws, ram[0], ram[1]) / 7); m *= k; why.push(['Ramadan', k]); }
    for (const [a, b, name] of EID){
      const o = overlap(ws, a, b); if (o > 0){ const k = 1 - .35 * o / 4; m *= k; why.push([name, k]); }
      const lead = daysBetween(ws, a); if (lead >= 7 && lead <= 13){ m *= 1.12; why.push([`Before ${name}`, 1.12]); }
    }
    const y = +ws.slice(0, 4);
    for (const [md, name] of DAYOFF) for (const yy of [y, y + 1]){ const d = `${yy}-${md}`; if (d >= ws && d <= we){ m *= .92; why.push([name, .92]); } }
    for (const d of NESSIM) if (d >= ws && d <= we){ m *= .92; why.push(['Sham el Nessim', .92]); }
    const [, mo, da] = ws.split('-').map(Number);
    if ((mo === 12 && da >= 18) || (mo === 1 && da <= 3)){ m *= 1.15; why.push(['Year end stocking', 1.15]); }
    return {m, why};
  }
  const calCache = {}; const cal = ws => (calCache[ws] ||= calendar(ws)).m;
  const woy = s => Math.min(51, Math.floor(daysBetween(`${s.slice(0, 4)}-01-01`, s) / 7));
  const monthOf = s => s.slice(0, 7);
  const addMonths = (m, k) => { let [y, mo] = m.split('-').map(Number); mo += k; while (mo > 12){ mo -= 12; y++; } while (mo < 1){ mo += 12; y--; } return `${y}-${String(mo).padStart(2, '0')}`; };

  /* split weekly values into calendar months by days; returns [{m, v}] */
  function toMonths(weeks, vals, from = null, to = null){
    const out = new Map();
    weeks.forEach((ws, i) => { for (let d = 0; d < 7; d++){ const day = addDays(ws, d); if ((from && day < from) || (to && day > to)) continue;
      const m = monthOf(day); out.set(m, (out.get(m) || 0) + (vals[i] || 0) / 7); } });
    return [...out].map(([m, v]) => ({m, v}));
  }

  /* ---------- models on deseasonalized, event cleaned demand ---------- */
  const velocity = (h, n, w) => Array(n).fill(mean(h.slice(-w)));
  function ses(h, n, alpha = .2){ let l = mean(h.slice(0, 8)); for (const x of h) l = alpha * x + (1 - alpha) * l; return Array(n).fill(l); }
  function holt(h, n, a = .2, b = .05, phi = .9){
    let l = mean(h.slice(0, 4)), t = h.length > 8 ? (mean(h.slice(4, 8)) - l) / 4 : 0;
    for (const x of h){ const pl = l; l = a * x + (1 - a) * (l + phi * t); t = b * (l - pl) + (1 - b) * phi * t; }
    const out = []; let s = 0, p = 1; for (let k = 1; k <= n; k++){ p *= phi; s += p; out.push(Math.max(0, l + s * t)); } return out;
  }
  function croston(h, n, alpha = .15, sba = false){
    let z = null, p = null, gap = 1;
    for (const x of h){ if (x > 0){ z = z == null ? x : alpha * x + (1 - alpha) * z; p = p == null ? gap : alpha * gap + (1 - alpha) * p; gap = 1; } else gap++; }
    return Array(n).fill(z == null ? 0 : z / p * (sba ? 1 - alpha / 2 : 1));
  }
  const share = (h, n, lineFc, lineH) => { const s = sum(h.slice(-26)) / Math.max(1e-9, sum(lineH.slice(-26))); return lineFc.slice(0, n).map(x => s * x); };
  const MODELS = ['velocity_30', 'velocity_90', 'ses', 'holt', 'croston', 'sba', 'product_share'];
  const MODEL_TXT = {velocity_30: 'average of the last 4 weeks', velocity_90: 'average of the last 13 weeks', ses: 'smoothed average, recent weeks count more',
    holt: 'smoothed level with a damped trend', croston: 'order size divided by gap between orders', sba: 'Croston with bias correction',
    product_share: "product line forecast times this SKU's share", ensemble: 'average of the three best models'};

  function classify(h){
    const nz = h.filter(x => x > 0); if (!nz.length) return 'lumpy';
    const adi = h.length / nz.length, cv2 = nz.length > 1 ? (std(nz) / mean(nz)) ** 2 : 0;
    return adi < 1.32 ? (cv2 < .49 ? 'smooth' : 'erratic') : (cv2 < .49 ? 'intermittent' : 'lumpy');
  }

  /* ---------- build ---------- */
  function build(R){
    const issues = [...(R.issues || [])];
    const N = R.nweeks, weeks = Array.from({length: N}, (_, i) => addDays(R.start, 7 * i));
    const fweeks = Array.from({length: HORIZON}, (_, k) => addDays(R.start, 7 * (N + k)));
    const allWeeks = [...weeks, ...fweeks], T = allWeeks.length, asof = R.asof;
    const wkOf = d => Math.floor(daysBetween(R.start, d) / 7);

    const itemsIn = R.items.filter(it => R.sales[it.sku] || R.stock[it.sku]?.oh > 0 || (it.launch && it.launch > addDays(asof, -182)));
    R.items.filter(it => !itemsIn.includes(it)).forEach(it =>
      issues.push({type: 'No sales and no stock', sku: it.sku, id: null, detail: 'In the item list with no sales history and nothing on hand, so it is left out.', kind: 'data', sev: 'low'}));
    const zero = () => Array(N).fill(0);
    const S = itemsIn.map((it, k) => {
      const ch = R.sales[it.sku] || {dealer: zero(), project: zero(), export: zero(), lost: zero()};
      return {...it, id: String(k + 1), dealer: ch.dealer.map(x => Math.max(0, x)), project: ch.project, export: ch.export, lost: ch.lost,
              short: R.short[it.sku] || zero(), notes: []};
    });
    const bySku = Object.fromEntries(S.map(s => [s.sku, s]));

    /* 1-2 lost orders and stockouts: fill in demand, but not after 150 days out */
    for (const s of S){
      const a = []; let run = 0; s.imputed = zero();
      s.dealer.forEach((u, i) => { const sd = s.short[i] || 0, lost = s.lost[i] || 0; run = sd >= 7 ? run + 7 : 0;
        let v;
        if (lost > 0) v = u + lost;                                         // recorded refused orders beat estimates
        else if (sd >= 7 || (sd && u === 0)) v = run > 150 ? u : a.length ? mean(a.slice(-8)) : u;
        else if (sd) v = u * 7 / (7 - sd);
        else v = u;
        a.push(v); s.imputed[i] = Math.max(0, v - u - lost); });
      s.adj = a; s.outDays = run; s.long = run > 150;
      const lostTot = sum(s.lost.slice(-13)); if (lostTot) s.notes.push(['Lost orders', `${fmt(lostTot)} units refused in the last 13 weeks are counted as demand.`]);
    }
    /* substitution: when one size is out, part of its demand shows up on sibling sizes of the same model and finish */
    const groups = {}, sizesOf = {};
    S.forEach(s => (sizesOf[s.code || s.p] ||= new Set()).add(s.z));
    // sizes of one model and finish stand in for each other; a model sold in one size swaps between finishes instead
    S.forEach(s => (groups[(s.code || s.p) + '|' + (sizesOf[s.code || s.p].size > 1 ? s.c : 'any finish')] ||= []).push(s));
    const subst = [];
    for (const [g, mem] of Object.entries(groups)){
      if (mem.length < 2) continue;
      let up = 0, lostSum = 0, n = 0;
      for (let i = 9; i < N; i++){
        const outs = mem.filter(s => s.imputed[i] > 0); if (!outs.length) continue;
        const others = mem.filter(s => !s.imputed[i] && !s.short[i]); if (!others.length) continue;
        const L = sum(outs.map(s => s.imputed[i]));
        const U = sum(others.map(s => s.dealer[i] - median(s.dealer.slice(i - 9, i - 1))));
        up += U; lostSum += L; n++;
      }
      const rate = n >= 3 && lostSum > 0 ? clamp(up / lostSum * n / (n + 3), 0, .8) : 0;
      if (rate < .05) continue;
      subst.push({group: g.split('|')[0] + ' ' + g.split('|')[1], rate, weeks: n, ids: mem.map(s => s.id), line: mem[0].line, src: mem[0].src, c: mem[0].c});
      for (let i = 0; i < N; i++){
        const outs = mem.filter(s => s.imputed[i] > 0); if (!outs.length) continue;
        const others = mem.filter(s => !s.imputed[i] && !s.short[i]); const vol = sum(others.map(s => sum(s.dealer.slice(-26)))) || 1;
        const move = rate * sum(outs.map(s => s.imputed[i]));
        others.forEach(s => { const take = move * sum(s.dealer.slice(-26)) / vol; s.adj[i] = Math.max(0, s.adj[i] - take); s.substTaken = (s.substTaken || 0) + take; });
      }
      mem.forEach(s => s.notes.push(['Substitution', `When a ${g.endsWith('any finish') ? 'finish' : 'size'} of ${g.split('|')[0]} ${g.endsWith('any finish') ? '' : g.split('|')[1] + ' '}is out, about ${Math.round(rate * 100)}% of its demand moves to the others. ` +
        (s.substTaken ? `${fmt(s.substTaken)} borrowed units were taken off this SKU's history.` : 'That share is not counted twice.')]));
    }

    /* 3 events: price changes and promotions, plus devaluations found in the FX series */
    const events = (R.events || []).map((e, k) => ({...e, k, auto: false}));
    const macro = R.macro || [];
    for (let i = 1; i < macro.length; i++){ const a = macro[i - 1].usd_egp, b = macro[i].usd_egp;
      if (a && b && b / a - 1 > .05) events.push({type: 'price', start: `${macro[i].month}-15`, end: `${macro[i].month}-15`, pct: Math.round((b / a - 1) * 50), line: '', sku: '', k: events.length, auto: true,
        name: `Devaluation ${macro[i].month} (${pctTxt(b / a - 1)} USD/EGP), dealers expect a price rise`}); }
    const covers = (e, s) => (!e.line || e.line === s.line) && (!e.sku || e.sku === s.sku);
    const lines = [...new Set(S.map(s => s.line))];
    const shapeOf = (mem, effOf) => { const w = Array(52).fill(1);
      if (N < 104) return w;
      const y = Array.from({length: N}, (_, i) => sum(mem.map(s => s.adj[i] / effOf(s, i))) / cal(weeks[i])), acc = Array.from({length: 52}, () => []);
      for (let i = 26; i < N - 26; i++){ const base = mean(y.slice(i - 26, i + 26)); if (base > 0) acc[woy(weeks[i])].push(y[i] / base); }
      const raw = acc.map(v => v.length ? mean(v) : 1);
      for (let k = 0; k < 52; k++){ const sm = mean([-2, -1, 0, 1, 2].map(o => raw[(k + o + 52) % 52])); w[k] = 1 + .6 * (sm - 1); }
      return w; };
    const shape0 = Object.fromEntries(lines.map(l => [l, shapeOf(S.filter(s => s.line === l), () => 1)]));
    const seriesOf = list => Array.from({length: N}, (_, i) => sum(list.map(s => s.adj[i] / (cal(weeks[i]) * shape0[s.line][woy(weeks[i])]))));
    const PRICE_OFF = [-4, -3, -2, -1, 0, 1, 2, 3], PROMO_KEYS = ['during', 'post1', 'post2'];
    const offsets = e => { const w0 = wkOf(e.start), w1 = wkOf(e.end || e.start), o = [];
      if (e.type === 'price') PRICE_OFF.forEach(d => o.push([w0 + d, 'p' + d]));
      else { for (let w = w0; w <= w1; w++) o.push([w, 'during']); o.push([w1 + 1, 'post1'], [w1 + 2, 'post2']); }
      return o; };
    const inAnyEvent = new Set(); events.forEach(e => offsets(e).forEach(([w]) => inAnyEvent.add(w)));
    const measured = {price: {}, promo: {}}, counts = {price: 0, promo: 0};
    for (const e of events){
      const w0 = wkOf(e.start); if (w0 < 6 || wkOf(e.end || e.start) + 3 >= N || !e.pct) continue;
      const scope = S.filter(s => covers(e, s)); if (!scope.length) continue;
      const y = seriesOf(scope), basew = [];
      for (let w = w0 - 14; w <= w0 + 16; w++) if (w >= 0 && w < N && !inAnyEvent.has(w)) basew.push(y[w]);
      const base = median(basew); if (!base) continue;
      const per = {}; offsets(e).forEach(([w, key]) => { if (w >= 0 && w < N) (per[key] ||= []).push(y[w] / base - 1); });
      e.measured = {};
      for (const [key, v] of Object.entries(per)){ const eff = mean(v) / (e.pct / 10); (measured[e.type][key] ||= []).push(eff); e.measured[key] = mean(v); }
      counts[e.type]++;
    }
    const DEFAULT = {price: {'p-4': .03, 'p-3': .06, 'p-2': .1, 'p-1': .14, p0: -.12, p1: -.1, p2: -.06, p3: -.03}, promo: {during: .25, post1: -.1, post2: -.05}};
    const profile = {price: {}, promo: {}};
    for (const t of ['price', 'promo']) for (const key of Object.keys(DEFAULT[t])){
      const v = measured[t][key] || [], n = v.length;
      profile[t][key] = n ? (mean(v) * n + DEFAULT[t][key]) / (n + 1) : DEFAULT[t][key]; // measured, shrunk toward a sensible default
    }
    for (const s of S){
      s.eff = Array(T).fill(1); s.effWhy = Array.from({length: T}, () => []);
      for (const e of events){ if (!covers(e, s)) continue;
        offsets(e).forEach(([w, key]) => { if (w < 0 || w >= T) return; const k = clamp(1 + profile[e.type][key] * (e.pct || 0) / 10, .3, 3);
          s.eff[w] *= k; s.effWhy[w].push([e.name || (e.type === 'price' ? `Price change ${pctTxt((e.pct || 0) / 100)} on ${dtxt(e.start)}` : `Promotion ${e.pct}% ${dtxt(e.start)} to ${dtxt(e.end)}`), k]); }); }
    }

    /* 4 seasonality: calendar times the line's yearly shape (needs 2 years) */
    const shape = Object.fromEntries(lines.map(l => [l, shapeOf(S.filter(s => s.line === l), (s, i) => s.eff[i])]));
    const seas = (line, i) => cal(allWeeks[i]) * shape[line][woy(allWeeks[i])];

    /* deseasonalized, event cleaned series the models learn from */
    for (const s of S) s.base = s.adj.map((v, i) => v / (s.eff[i] * seas(s.line, i)));
    const lineBase = Object.fromEntries(lines.map(l => [l, Array.from({length: N}, (_, i) => sum(S.filter(s => s.line === l).map(s => s.base[i])))]));

    /* 7 market: construction activity leads lock demand by about 6 months */
    const mIdx = Object.fromEntries(macro.map((r, i) => [r.month, i]));
    const cem = m => { const i = mIdx[m]; if (i == null) return null; const v = [i - 1, i, i + 1].map(j => macro[j]?.cement).filter(x => x > 0); return v.length ? mean(v) : null; };
    const elasticity = {};
    const lastMacro = macro.length ? macro[macro.length - 1].month : null;
    const cemLag = w => { let m = addMonths(monthOf(allWeeks[w]), -MACRO_LAG); if (lastMacro && m > lastMacro) m = lastMacro; return cem(m); };
    for (const l of lines){
      const mon = toMonths(weeks, lineBase[l]).filter(r => r.m > monthOf(weeks[0]) && r.m < monthOf(weeks[N - 1]));
      const mv = Object.fromEntries(mon.map(r => [r.m, r.v])), xs = [], ys = [];
      for (const {m} of mon){ const p = addMonths(m, -12); if (!mv[p]) continue;
        const c1 = cem(addMonths(m, -MACRO_LAG)), c0 = cem(addMonths(p, -MACRO_LAG)); if (!c1 || !c0) continue;
        xs.push(Math.log(c1 / c0)); ys.push(Math.log(mv[m] / mv[p])); }
      let beta = 0;
      if (xs.length >= 6){ const mx = mean(xs), my = mean(ys), vx = sum(xs.map(x => (x - mx) ** 2));
        if (vx > 1e-6) beta = clamp(sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / vx * xs.length / (xs.length + 6), 0, 1.5); }
      elasticity[l] = {beta, n: xs.length};
    }
    const macroFactor = (line, cut, w) => { const b = elasticity[line]?.beta || 0; if (!b) return 1; const c0 = cemLag(cut - 1), c1 = cemLag(w); return c0 && c1 ? (c1 / c0) ** b : 1; };

    /* 5 backtest */
    const fitModels = (s, cut, n) => {
      const h = s.base.slice(0, cut), lh = lineBase[s.line].slice(0, cut);
      return {velocity_30: velocity(h, n, 4), velocity_90: velocity(h, n, 13), ses: ses(h, n), holt: holt(h, n), croston: croston(h, n), sba: croston(h, n, .15, true),
              product_share: share(h, n, ses(lh, n, .15), lh)};
    };
    const reseason = (s, cut, lvl) => lvl.map((v, k) => v * seas(s.line, cut + k) * s.eff[cut + k] * macroFactor(s.line, cut, cut + k));
    const folds = Math.max(1, Math.min(FOLDS, Math.floor((N - 16) / FOLD_LEN)));
    const cuts = Array.from({length: folds}, (_, k) => N - FOLD_LEN * (folds - k));
    const tot = {sel: [0, 0], base: [0, 0], msel: [0, 0], mbase: [0, 0]}, hold = {sel: [0, 0], base: [0, 0]}, byLine = {};
    for (const s of S){
      const per = cuts.map(c => { const lv = fitModels(s, c, FOLD_LEN), fc = {};
        for (const m of MODELS) fc[m] = reseason(s, c, lv[m]);
        return {fc, act: s.adj.slice(c, c + FOLD_LEN), old: velocity(s.adj.slice(0, c), FOLD_LEN, 4)}; });
      const errs = {}, add = m => errs[m] = per.map(({fc, act}) => [sum(act.map((a, i) => Math.abs(a - fc[m][i]))), sum(act)]);
      MODELS.forEach(add);
      const score = (m, ks) => { const e = sum(ks.map(k => errs[m][k][0])), a = sum(ks.map(k => errs[m][k][1])); return a ? e / a : (e < .5 ? 0 : 9); };
      const all = [...Array(folds).keys()], older = folds > 1 ? all.slice(0, -1) : all;
      const ens = [...MODELS].sort((x, y) => score(x, all) - score(y, all)).slice(0, 3);
      per.forEach(({fc}) => fc.ensemble = fc[ens[0]].map((_, i) => mean(ens.map(m => fc[m][i]))));
      add('ensemble');
      const allm = [...MODELS, 'ensemble'];
      const best = allm.reduce((b, m) => score(m, all) < score(b, all) ? m : b), bestOld = allm.reduce((b, m) => score(m, older) < score(b, older) ? m : b);
      s.model = best; s.ens = ens; s.wape = Math.min(5, score(best, all)); s.cls = classify(s.adj.slice(-52));
      if (!s.long && sum(s.adj.slice(-26)) > 0 && !(s.launch && s.launch > weeks[N - 26])){
        const oldE = per.map(({act, old}) => sum(act.map((a, i) => Math.abs(a - old[i]))));
        const e = sum(errs[best].map(x => x[0])), a = sum(errs[best].map(x => x[1])), eb = sum(oldE);
        tot.sel[0] += e; tot.sel[1] += a; tot.base[0] += eb; tot.base[1] += a;
        per.forEach(({fc, act, old}) => { for (const [lo, hi] of [[0, 4], [4, 8]]){ const A = sum(act.slice(lo, hi));
          tot.msel[0] += Math.abs(A - sum(fc[best].slice(lo, hi))); tot.mbase[0] += Math.abs(A - sum(old.slice(lo, hi))); tot.msel[1] += A; tot.mbase[1] += A; } });
        const last = folds - 1; hold.sel[0] += errs[bestOld][last][0]; hold.sel[1] += errs[bestOld][last][1]; hold.base[0] += oldE[last]; hold.base[1] += errs[bestOld][last][1];
        const b = byLine[s.line] ||= [0, 0, 0]; b[0] += e; b[1] += a; b[2] += eb;
      }
      const res = per.flatMap(({fc, act}) => act.map((a, i) => a - fc[best][i]));
      s.sigma = Math.max(std(res), .05 * mean(s.adj.slice(-13)));

      /* 6-7 future */
      const lv = fitModels(s, N, HORIZON); lv.ensemble = lv[ens[0]].map((_, i) => mean(ens.map(m => lv[m][i])));
      s.levelNow = lv[best][0];
      s.fDealer = reseason(s, N, lv[best]).map(x => Math.max(0, x));
      const mf = macroFactor(s.line, N, N + 12);
      if (Math.abs(mf - 1) > .01) s.notes.push(['Construction activity', `Cement sales 6 months ago point to ${pctTxt(mf - 1)} demand by ${dtxt(fweeks[12])} for ${s.line} (elasticity ${(elasticity[s.line].beta).toFixed(2)}).`]);
    }

    /* 8 dealer stock */
    const dealerIdx = {};
    for (const [sku, rows] of Object.entries(R.dealers || {})){
      const dates = [...new Set(rows.map(r => r.date))].sort(); if (dates.length < 2) continue;
      const cov = dates.map(d => { const rr = rows.filter(r => r.date === d), so = sum(rr.map(r => r.sell_out)); return so > 0 ? sum(rr.map(r => r.stock)) / so : null; });
      const now = cov[cov.length - 1], norm = mean(cov.slice(0, -1).filter(x => x != null));
      if (now != null && norm) dealerIdx[sku] = {now, norm, idx: now / norm, dealers: new Set(rows.map(r => r.dealer)).size};
    }
    for (const s of S){ const d = dealerIdx[s.sku]; if (!d || Math.abs(d.idx - 1) < .1) continue;
      const k0 = clamp(1 - .5 * (d.idx - 1), .6, 1.4);
      for (let k = 0; k < 8; k++) s.fDealer[k] *= 1 + (k0 - 1) * (1 - k / 8);
      s.dealerCover = d;
      s.notes.push(['Dealer stock', `Dealers hold ${d.now.toFixed(1)} weeks of stock against a normal ${d.norm.toFixed(1)}. The next 8 weeks are ${k0 < 1 ? 'reduced' : 'raised'} by up to ${Math.round(Math.abs(k0 - 1) * 100)}% while they ${k0 < 1 ? 'sell it down' : 'refill'}.`]);
    }

    /* 9 lifecycle */
    for (const s of S){
      if (s.launch && s.launch > addDays(asof, -182)){
        const src = s.replaces && bySku[s.replaces];
        const launchW = wkOf(s.launch) - N; // weeks from now, negative if already launched
        let level;
        if (src){ level = mean(src.base.slice(-13)); s.notes.push(['New SKU', `Launched ${dtxt(s.launch)} replacing ${src.sku}. Uses that SKU's demand level until it has its own history.`]); }
        else { const sib = S.filter(o => o !== s && o.line === s.line && !(o.launch && o.launch > addDays(asof, -182)));
          level = .6 * median(sib.map(o => mean(o.base.slice(-13)))); s.notes.push(['New SKU', `Launch ${dtxt(s.launch)}. No predecessor, so it starts at 60% of a typical ${s.line} SKU.`]); }
        const own = mean(s.base.slice(-8)), weeksLive = Math.max(0, -launchW);
        const blend = Math.min(1, weeksLive / 13), lvl = blend * own + (1 - blend) * level;
        s.fDealer = s.fDealer.map((_, k) => { const age = k - launchW; if (age < 0) return 0;
          const ramp = age < 4 ? [.5, .75, .9, 1][age] : 1; return lvl * ramp * seas(s.line, N + k) * s.eff[N + k] * macroFactor(s.line, N, N + k); });
        s.isNew = true;
      }
      if (s.end){
        if (s.end <= asof){ s.fDealer = s.fDealer.map(() => 0); s.ended = true; s.notes.push(['Discontinued', `Ended ${dtxt(s.end)}. No forecast.`]); }
        else { const kEnd = wkOf(s.end) - N; s.fDealer = s.fDealer.map((v, k) => k > kEnd ? 0 : v); s.phaseout = true;
          s.notes.push(['Phase out', `Ends ${dtxt(s.end)}. Forecast stops then and the plan only covers demand until that date.`]); }
      }
      if (s.long){ s.fDealer = s.fDealer.map(() => 0); }
      else if (!s.isNew && sum(s.dealer.slice(-13)) === 0 && sum(s.adj.slice(-13)) === 0) s.fDealer = s.fDealer.map(() => 0);
    }

    /* 10 export run rate, confirmed orders */
    const ordersBySku = {};
    for (const o of R.orders || []){ const w = wkOf(o.date) - N; if (w < 0 || w >= HORIZON || !bySku[o.sku]) continue; (ordersBySku[o.sku] ||= []).push({...o, w}); }
    for (const s of S){
      const ex = s.export || zero(), exLvl = sum(ex.slice(-26)) ? ses(ex, 1, .15)[0] : 0;
      s.fExport = Array(HORIZON).fill(exLvl); s.fProject = Array(HORIZON).fill(0);
      for (const o of ordersBySku[s.sku] || []){
        if (o.channel === 'export') s.fExport[o.w] = Math.max(s.fExport[o.w], o.qty);
        else s.fProject[o.w] += o.qty;
      }
      if (s.ended || s.long){ s.fExport = s.fExport.map(() => 0); }
      const ordTxt = (ordersBySku[s.sku] || []).map(o => `${fmt(o.qty)} ${o.channel} due ${dtxt(o.date)}`);
      if (ordTxt.length) s.notes.push(['Confirmed orders', ordTxt.join('; ') + '.']);
      if (exLvl > 0) s.notes.push(['Export', `Export runs at about ${fmt(exLvl)} a week and is added to dealer demand.`]);
      const projHist = sum(s.project.slice(-52));
      if (projHist) s.notes.push(['Project orders', `${fmt(projHist)} units of one off project orders in the last year are kept out of the base forecast; only confirmed project orders are added.`]);
      s.fm = s.fDealer.map((v, k) => v + s.fExport[k] + s.fProject[k]);
      const sdEx = std(ex.slice(-26));
      const sdW = Math.sqrt(s.sigma ** 2 + sdEx ** 2);
      s.fl = s.fm.map((x, k) => Math.max(s.fProject[k], x - 1.28 * sdW * (x > 0)));
      s.fh = s.fm.map(x => x ? x + 1.28 * sdW : 0);
      s.sdW = sdW;
      const evWhy = s.effWhy.slice(N).flatMap((w, k) => w.map(([n, m]) => [n, m, k])).filter(([, , k]) => k < HORIZON);
      const evNames = [...new Set(evWhy.map(x => x[0]))];
      for (const name of evNames){ const ks = evWhy.filter(x => x[0] === name);
        const delta = sum(ks.map(([, m, k]) => s.fDealer[k] - s.fDealer[k] / m));
        s.notes.push(['Price and promotions', `${name}: ${delta >= 0 ? 'adds' : 'removes'} about ${fmt(Math.abs(delta))} units across ${ks.length} weeks.`]); }
      const hol = [...new Set(fweeks.flatMap((ws, k) => calendar(ws).why.filter(([n]) => !/Year end|Ramadan/.test(n)).map(([n]) => n)))].slice(0, 4);
      if (hol.length) s.notes.push(['Calendar', `Holidays in the forecast: ${hol.join(', ')}. Ramadan and year end stocking are always applied.`]);
    }

    /* ABC on 12 month value at cost, XYZ on weekly variability */
    const val = s => sum(s.adj.slice(-52)) * (s.cost || 0), total = sum(S.map(val));
    let run = 0;
    [...S].sort((a, b) => val(b) - val(a)).forEach(s => { run += val(s);
      s.abc = run <= .8 * total ? 'A' : run <= .95 * total ? 'B' : 'C';
      const h = s.base.slice(-52), cv = mean(h) ? std(h) / mean(h) : 9; s.xyz = cv < .25 ? 'X' : cv < .5 ? 'Y' : 'Z'; });

    /* plan */
    const demandOver = (s, days) => { let t = 0; for (let k = 0; k < HORIZON && days > 0; k++){ const d = Math.min(7, days); t += s.fm[k] * d / 7; days -= d; } return t; };
    const rows = S.map(s => {
      const src = R.sources[s.src] || {kind: 'factory', lt: 21, pack: 1, moq: 0};
      const st = R.stock[s.sku] || {oh: 0, cm: 0, inc: 0};
      const oh = st.oh, cm = st.cm || 0, inc = st.inc || 0;
      const wk = mean(s.fm.slice(0, 8)), daily = wk / 7, L = src.lt + REVIEW_DAYS;
      const level = SVC[s.abc + s.xyz], ss = zOf(level) * s.sdW * Math.sqrt(L / 7);
      const dL = demandOver(s, L), dT = demandOver(s, L + 21);
      const rop = Math.round(dL + ss), tgt = Math.round(dT + ss), pos = Math.max(oh, 0) - cm + inc;
      const dead = (sum(s.dealer.slice(-13)) === 0 && oh > 0 && !s.isNew) || (s.ended && oh > 0);
      const verb = src.kind === 'factory' ? 'Make' : 'Buy';
      let q = 0, status, reason;
      if (dead){ status = 'dead'; reason = `Not planned. ${s.ended ? `Discontinued ${dtxt(s.end)}` : 'No sales in 13 weeks'} with ${fmt(oh)} pcs on hand. Clear with a dealer offer.`; }
      else if (s.long){ status = 'longout'; reason = `Not planned. Out of stock for ${s.outDays} days while still listed. Demand is no longer imputed. Restart production or remove it from the price list.`; }
      else if (!daily && !dL){ status = s.ended ? 'dead' : 'ok'; reason = s.isNew ? `Launches ${dtxt(s.launch)}, beyond the planning window.` : 'Not planned. No demand forecast for this SKU.'; }
      else {
        const head = `Stock position ${fmt(pos)} pcs (on hand ${fmt(Math.max(oh, 0))}, committed ${fmt(cm)}, incoming ${fmt(inc)}) against reorder point ${fmt(rop)}. ` +
          `Reorder point is forecast demand over ${L} days (${fmt(dL)}) plus safety stock ${fmt(ss)} for ${Math.round(level * 100)}% service (${s.abc}${s.xyz}).`;
        if (pos < rop){ const need = tgt - pos; q = Math.max(src.moq || 0, ceilTo(need, src.pack || 1)); status = 'make';
          reason = `${head} ${verb} up to ${fmt(tgt)} (demand over ${L + 21} days plus safety stock) needs ${fmt(need)}, rounded to ${fmt(q)} (cartons of ${src.pack || 1}, minimum batch ${fmt(src.moq || 0)}).`; }
        else { status = 'ok'; reason = `${head} Nothing to ${verb.toLowerCase()} this week.`; }
      }
      const free = Math.max(oh, 0) - cm, dl = daily ? free / daily : null;
      if ((status === 'ok' || status === 'make') && daily && free > daily * 120) status = 'over';
      if (oh < 0) issues.push({type: 'Negative stock', sku: s.sku, id: s.id, detail: `Stock file shows ${fmt(oh)} on hand. Shipments were booked before the receipt.`, kind: 'process', sev: 'high'});
      if (!s.cost) issues.push({type: 'Unit cost missing', sku: s.sku, id: s.id, detail: 'No unit cost in the item list, so order value is left out.', kind: 'data', sev: 'medium'});
      if (!R.stock[s.sku]) issues.push({type: 'Not in stock file', sku: s.sku, id: s.id, detail: 'No stock row, so on hand is taken as zero.', kind: 'data', sev: 'medium'});
      if (!R.sources[s.src]) issues.push({type: 'Unknown source', sku: s.sku, id: s.id, detail: `Source "${s.src}" is not in the sources file. Using 21 days lead time and no batch rules.`, kind: 'data', sev: 'medium'});
      s.status = status; s.daily = daily; s.oh = oh;
      const life = s.isNew ? 'new' : s.phaseout ? 'phaseout' : s.ended ? 'ended' : '';
      return {id: s.id, sku: s.sku, code: s.code || '', p: s.p, c: s.c || '–', z: s.z || '–', line: s.line, src: s.src, oh, cm, inc, wk: Math.round(wk), rop, tgt, pos, q,
              cost: s.cost || null, val: s.cost ? Math.round(q * s.cost) : null, sv: Math.round(Math.max(oh, 0) * (s.cost || 0)), dl: dl == null ? null : Math.round(dl),
              abc: s.abc, xyz: s.xyz, cls: s.cls, model: s.model, modelTxt: MODEL_TXT[s.model], ens: s.ens, wape: s.wape,
              conf: s.wape < .2 ? 'high' : s.wape < .4 ? 'medium' : 'low', status, reason, life, launch: s.launch || '', end: s.end || '', replaces: s.replaces || '',
              lt: src.lt, pack: src.pack || 1, moq: src.moq || 0, svc: Math.round(level * 100), price: s.price || null, notes: s.notes,
              dcov: s.dealerCover ? +s.dealerCover.idx.toFixed(2) : null};
    });

    /* sources and capacity schedule */
    const sources = {};
    for (const name of new Set([...Object.keys(R.sources), ...S.map(s => s.src)])){
      const src = R.sources[name] || {kind: 'factory', lt: 21, pack: 1, moq: 0}, mine = S.filter(s => s.src === name);
      let cap = src.cap || null;
      if (src.kind === 'factory' && !cap && mine.length){
        cap = ceilTo(mean(weeks.slice(-52).map((_, j) => sum(mine.map(s => s.adj[N - 52 + j] || 0)))) * 1.15, 1000);
        issues.push({type: 'Capacity not given', sku: name, id: null, detail: `No weekly capacity in the sources file. Using ${fmt(cap)} a week, 15% above last year's demand.`, kind: 'data', sev: 'low'});
      }
      if (R.sources[name] && !src.confirmed)
        issues.push({type: 'Lead time not confirmed', sku: name, id: null, detail: `Using ${src.lt} days, cartons of ${src.pack || 1}, minimum batch ${fmt(src.moq || 0)}.`, kind: 'data', sev: 'medium'});
      sources[name] = {kind: src.kind, lt: src.lt, pack: src.pack || 1, moq: src.moq || 0, cap,
                       fc: fweeks.map((_, k) => Math.round(sum(mine.map(s => s.fm[k]))))};
    }

    /* raw materials */
    const bom = R.bom || [], mats = R.materials || {};
    const matNeed = {};
    for (const b of bom){ const s = bySku[b.sku]; if (!s) continue; const r = rows[+s.id - 1];
      const m = matNeed[b.material] ||= {material: b.material, unit: mats[b.material]?.unit || '', plan: 0, next13: 0, skus: 0};
      m.plan += r.q * b.per; m.next13 += sum(s.fm.slice(0, 13)) * b.per; m.skus++; }
    const materials = Object.values(matNeed).map(m => { const st = mats[m.material] || {}; const have = (st.on_hand || 0) + (st.on_order || 0);
      return {...m, on_hand: st.on_hand || 0, on_order: st.on_order || 0, lt: st.lt || null, weekly: m.next13 / 13,
              cover: m.next13 ? have / (m.next13 / 13) : null, short: Math.max(0, m.plan - (st.on_hand || 0))}; });
    for (const m of materials) if (m.short > 0) issues.push({type: 'Material short for plan', sku: m.material, id: null,
      detail: `This week's plan needs ${fmt(m.plan)} ${m.unit}, ${fmt(m.on_hand)} on hand. ${fmt(m.on_order)} on order${m.lt ? `, lead time ${m.lt} days` : ''}.`, kind: 'process', sev: 'high'});

    /* pricing suggestions */
    const md = [], mu = [];
    for (const s of S){
      if (s.status === 'dead' || s.long || !s.daily) continue;
      const cover = Math.max(s.oh, 0) / s.daily;
      if (cover > 120){ const pct = cover < 180 ? 5 : cover < 260 ? 10 : 15;
        md.push({id: s.id, pct, v: s.oh * (s.cost || 0), why: `${fmt(Math.max(s.oh, 0))} pcs on hand, selling ${fmt(s.daily)} a day, ${fmt(cover)} days of cover. A ${pct}% dealer discount should clear the excess in about 60 days.`}); }
      const outWeeks = s.short.slice(-13).filter((x, i) => x > 0 || s.lost[N - 13 + i] > 0).length;
      if ((outWeeks >= 2 && 'AB'.includes(s.abc)) || outWeeks >= 4){ const pct = outWeeks < 4 ? 3 : 5;
        mu.push({id: s.id, pct, v: s.daily * (s.cost || 0), why: `Short in ${outWeeks} of the last 13 weeks while demand holds at ${fmt(s.daily)} a day (${s.abc} item). A ${pct}% price list increase protects margin while supply catches up.`}); }
    }
    const top = arr => arr.sort((a, b) => b.v - a.v).slice(0, 40).map(({v, ...r}) => r);

    /* cancellations */
    const c90 = addDays(asof, -90), c365 = addDays(asof, -365), cl = R.cancels || [];
    const lineOf = sku => bySku[sku]?.line || '';
    const win = (from, label, rowsC) => { const r = rowsC.filter(c => c.date > from); return {w: label, o: r.length, u: sum(r.map(c => c.qty)), v: Math.round(sum(r.map(c => c.value || 0)))}; };

    const w = x => x[1] ? x[0] / x[1] : 0, first = Math.max(0, N - SHOW_WEEKS);
    return {
      asof, annual: Math.round(sum(S.map(s => sum(s.dealer.slice(-52)) + sum(s.project.slice(-52)) + sum(s.export.slice(-52))))),
      weeks: weeks.slice(first), fweeks, horizon: HORIZON, sched: SCHED_WEEKS,
      acc: {sel: w(tot.sel), base: w(tot.base), hsel: w(hold.sel), hbase: w(hold.base), msel: w(tot.msel), mbase: w(tot.mbase),
            lines: Object.entries(byLine).filter(([, v]) => v[1]).sort().map(([line, v]) => ({line, sel: v[0] / v[1], base: v[2] / v[1]}))},
      sources, skus: rows,
      /* history: shipped all channels, demand all channels, stockout days, events multiplier; forecast: total, low, high, dealer, export, project */
      H: Object.fromEntries(S.map(s => [s.id, [s.dealer.slice(first).map((v, i) => Math.round(v + s.project[first + i] + s.export[first + i])),
                                                s.adj.slice(first).map((v, i) => Math.round(v + s.project[first + i] + s.export[first + i])), s.short.slice(first)]])),
      F: Object.fromEntries(S.map(s => [s.id, [s.fm, s.fl, s.fh, s.fDealer, s.fExport, s.fProject].map(a => a.map(Math.round))])),
      SD: Object.fromEntries(S.map(s => [s.id, s.sdW])),
      events: events.map(e => ({type: e.type, start: e.start, end: e.end || e.start, pct: e.pct, line: e.line || '', sku: e.sku || '', auto: e.auto,
        name: e.name || (e.type === 'price' ? `Price change ${pctTxt((e.pct || 0) / 100)}` : `Promotion ${e.pct}% off`), future: (e.end || e.start) > asof,
        measured: e.measured || null})),
      profile, eventCounts: counts,
      macro: macro.map(r => ({m: r.month, cement: r.cement, fx: r.usd_egp, cpi: r.cpi})), elasticity, macroLag: MACRO_LAG,
      subst, holidays: fweeks.map((ws, k) => ({ws, k, why: calendar(ws).why, m: calendar(ws).m})).filter(h => h.why.length),
      materials, issues, md: top(md), mu: top(mu), margin: R.margin || 1.45,
      bom: bom.reduce((o, b) => ((o[b.sku] ||= []).push([b.material, b.per]), o), {}), matStock: mats,
      cancel: {rows: cl.map(c => ({...c, line: lineOf(c.sku)})), c90, c365},
    };
  }

  /* ---------- reading uploaded tables ---------- */
  const ALIAS = {
    sku: ['sku', 'item', 'item code', 'code', 'product code', 'variant sku'],
    p: ['product', 'name', 'description', 'item name', 'product name', 'title'],
    line: ['line', 'product line', 'category', 'family', 'group', 'collection'],
    c: ['finish', 'color', 'colour', 'variant'], z: ['size', 'dimension'],
    src: ['source', 'factory', 'supplier', 'made at', 'plant', 'vendor'],
    cost: ['unit cost', 'cost', 'standard cost', 'cost egp', 'unit cost egp'],
    price: ['price', 'dealer price', 'list price', 'unit price'],
    code: ['model', 'model code'], launch: ['launch date', 'launch', 'start date', 'introduced'], end: ['end date', 'end', 'discontinued', 'discontinue date'],
    replaces: ['replaces', 'replaces sku', 'predecessor', 'old sku'],
    date: ['date', 'week', 'week start', 'order date', 'invoice date', 'ship date', 'created at', 'day', 'due date', 'month'],
    qty: ['qty', 'quantity', 'units', 'sold', 'qty sold', 'quantity sold', 'pcs', 'pieces', 'net qty'],
    status: ['status', 'order status', 'state'], reason: ['reason', 'cancel reason', 'cancellation reason'],
    channel: ['channel', 'customer type', 'segment', 'order type', 'market'],
    value: ['value', 'amount', 'net amount', 'total', 'value egp', 'line total'],
    oh: ['on hand', 'onhand', 'stock', 'qty on hand', 'available', 'inventory'],
    cm: ['committed', 'reserved', 'allocated', 'open orders'], inc: ['incoming', 'on order', 'in transit', 'open po', 'wip'],
    kind: ['type', 'kind'], lt: ['lead time days', 'lead time', 'lt'],
    pack: ['carton', 'pack', 'pack size', 'carton size', 'case qty'], moq: ['min batch', 'moq', 'minimum batch', 'minimum order'],
    cap: ['weekly capacity', 'capacity', 'capacity per week'], confirmed: ['confirmed', 'lead time confirmed'],
    days: ['days out', 'short days', 'stockout days', 'days'],
    etype: ['type', 'event type', 'kind'], start: ['start', 'start date', 'from', 'effective date', 'date'], eend: ['end', 'end date', 'to', 'until'],
    pct: ['pct', 'percent', 'change pct', 'discount pct', 'change', 'discount', '%'], ename: ['name', 'event', 'description'],
    month: ['month', 'period', 'date'], cement: ['cement', 'cement tons', 'cement sales', 'construction', 'construction index'],
    fx: ['usd egp', 'usd/egp', 'fx', 'exchange rate', 'usd'], cpi: ['cpi', 'inflation index', 'consumer prices'],
    dealer: ['dealer', 'customer', 'account', 'distributor'], dstock: ['stock', 'dealer stock', 'on hand', 'inventory'], sellout: ['sell out', 'weekly sell out', 'sales', 'sold'],
    material: ['material', 'component', 'raw material'], per: ['qty per unit', 'per unit', 'usage', 'quantity per'], unit: ['unit', 'uom'],
    mon: ['on hand', 'stock', 'inventory'], monord: ['on order', 'incoming', 'open po'], mlt: ['lead time days', 'lead time'],
  };
  const norm = h => String(h).trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
  function mapCols(headers, wanted){
    const H = headers.map(norm), out = {}, used = new Set();
    for (const k of wanted){ const i = H.findIndex((h, j) => !used.has(j) && ALIAS[k].map(norm).includes(h)); if (i >= 0){ out[k] = headers[i]; used.add(i); } }
    return out;
  }
  const num = v => { if (v == null || v === '') return null; if (typeof v === 'number') return v; const x = parseFloat(String(v).replace(/[, ]/g, '').replace(/[^\d.\-eE]/g, '')); return isNaN(x) ? null : x; };
  function toISODate(v){
    if (v instanceof Date && !isNaN(v)) return iso(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
    if (typeof v === 'number' && v > 20000 && v < 80000) return iso(new Date(Date.UTC(1899, 11, 30) + v * MS_DAY));
    const s = String(v ?? '').trim(); let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return iso(new Date(Date.UTC(+m[1], m[2] - 1, +m[3])));
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})$/))) return iso(new Date(Date.UTC(+m[1], m[2] - 1, 1)));
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))){ const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return iso(new Date(Date.UTC(y, m[2] - 1, +m[1]))); }
    const t = Date.parse(s); return isNaN(t) ? null : iso(new Date(t));
  }
  const monday = s => { const d = new Date(ms(s)); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
  const str = v => String(v ?? '').trim();

  function fromTables(t){
    const problems = [], warn = [];
    const need = (name, rows, cols, req) => {
      if (!rows || !rows.length){ problems.push(`${name}: file is empty.`); return null; }
      const m = mapCols(Object.keys(rows[0]), cols), miss = req.filter(k => !m[k]);
      if (miss.length){ problems.push(`${name}: missing column ${miss.map(k => '"' + ALIAS[k][0] + '"').join(', ')}. Found: ${Object.keys(rows[0]).join(', ')}.`); return null; }
      return m;
    };
    const opt = (name, rows, cols, req) => rows?.length ? need(name, rows, cols, req) : null;
    const mi = need('Items', t.items, ['sku', 'p', 'line', 'c', 'z', 'src', 'cost', 'price', 'code', 'launch', 'end', 'replaces'], ['sku', 'p', 'line', 'src']);
    const ms_ = need('Sales', t.sales, ['sku', 'date', 'qty', 'status', 'reason', 'value', 'channel'], ['sku', 'date', 'qty']);
    const mk = need('Stock', t.stock, ['sku', 'oh', 'cm', 'inc'], ['sku', 'oh']);
    const mo = opt('Sources', t.sources, ['src', 'kind', 'lt', 'pack', 'moq', 'cap', 'confirmed'], ['src', 'lt']);
    const mx = opt('Stockouts', t.stockouts, ['sku', 'date', 'days'], ['sku', 'date', 'days']);
    const me = opt('Price changes and promotions', t.events, ['etype', 'start', 'eend', 'pct', 'line', 'sku', 'ename'], ['etype', 'start', 'pct']);
    const mr = opt('Confirmed orders', t.orders, ['date', 'sku', 'qty', 'channel'], ['date', 'sku', 'qty']);
    const mm = opt('Market data', t.macro, ['month', 'cement', 'fx', 'cpi'], ['month']);
    const md = opt('Dealer stock', t.dealers, ['date', 'dealer', 'sku', 'dstock', 'sellout'], ['date', 'sku', 'dstock', 'sellout']);
    const mb = opt('Bill of materials', t.bom, ['sku', 'material', 'per'], ['sku', 'material', 'per']);
    const mt = opt('Materials', t.materials, ['material', 'unit', 'mon', 'monord', 'mlt'], ['material', 'mon']);
    if (!mi || !ms_ || !mk || problems.length) return {problems};

    const issues = [], items = [], seen = new Set();
    for (const r of t.items){ const sku = str(r[mi.sku]); if (!sku) continue;
      if (seen.has(sku)){ issues.push({type: 'Duplicate SKU', sku, id: null, detail: 'Appears more than once in the item list. The first row is used.', kind: 'data', sev: 'high'}); continue; }
      seen.add(sku);
      items.push({sku, p: str(r[mi.p]) || sku, line: str(r[mi.line]) || 'Other', c: mi.c ? str(r[mi.c]) : '', z: mi.z ? str(r[mi.z]) : '', src: str(r[mi.src]) || 'Unknown',
                  cost: mi.cost ? num(r[mi.cost]) : null, price: mi.price ? num(r[mi.price]) : null, code: mi.code ? str(r[mi.code]) : '',
                  launch: mi.launch ? toISODate(r[mi.launch]) : null, end: mi.end ? toISODate(r[mi.end]) : null, replaces: mi.replaces ? str(r[mi.replaces]) : ''}); }
    const dated = [], cancels = [], unknown = new Map(); let badDate = 0;
    for (const r of t.sales){ const sku = str(r[ms_.sku]), d = toISODate(r[ms_.date]), q = num(r[ms_.qty]);
      if (!sku || q == null) continue; if (!d){ badDate++; continue; }
      if (!seen.has(sku)){ unknown.set(sku, (unknown.get(sku) || 0) + q); continue; }
      const stt = ms_.status ? str(r[ms_.status]).toLowerCase() : '';
      if (/cancel|void|reject|declin/.test(stt)){ cancels.push({date: d, sku, qty: q, value: ms_.value ? num(r[ms_.value]) || 0 : 0, reason: ms_.reason ? str(r[ms_.reason]) : ''}); continue; }
      const chRaw = ms_.channel ? str(r[ms_.channel]).toLowerCase() : '';
      const ch = /lost|backorder|refus|short/.test(stt) ? 'lost' : /proj|contract|tender/.test(chRaw) ? 'project' : /export|abroad|intl|international/.test(chRaw) ? 'export' : 'dealer';
      dated.push([d, sku, q, ch]); }
    if (badDate) problems.push(`Sales: ${badDate} rows have a date that could not be read. Use YYYY-MM-DD or DD/MM/YYYY.`);
    for (const [sku, q] of unknown) issues.push({type: 'Sales for unknown SKU', sku, id: null, detail: `${fmt(q)} units sold but the SKU is not in the item list.`, kind: 'data', sev: 'medium'});
    if (!dated.length){ problems.push('Sales: no usable rows.'); return {problems}; }
    const dates = dated.map(x => x[0]).sort(), start = monday(dates[0]), last = monday(dates[dates.length - 1]);
    const N = Math.round(daysBetween(start, last) / 7) + 1;
    if (N < 20){ problems.push(`Sales: ${N} weeks of history is too short to forecast. Upload at least 26 weeks, ideally 104 for seasonality.`); return {problems}; }
    if (N < 26) warn.push(`Sales: only ${N} weeks of history. Forecasts will be rough; 104 weeks gives seasonality.`);
    const wkIndex = d => Math.floor(daysBetween(start, d) / 7);
    const sales = {};
    for (const [d, sku, q, ch] of dated){ const o = sales[sku] ||= {dealer: Array(N).fill(0), project: Array(N).fill(0), export: Array(N).fill(0), lost: Array(N).fill(0)}; o[ch][wkIndex(d)] += q; }
    const short = {};
    if (mx) for (const r of t.stockouts){ const sku = str(r[mx.sku]), d = toISODate(r[mx.date]), v = num(r[mx.days]);
      if (!seen.has(sku) || !d || v == null) continue; const i = wkIndex(d); if (i >= 0 && i < N) (short[sku] ||= Array(N).fill(0))[i] = Math.min(7, (short[sku][i] || 0) + v); }
    const stock = {};
    for (const r of t.stock){ const sku = str(r[mk.sku]); if (!sku) continue;
      stock[sku] = {oh: num(r[mk.oh]) || 0, cm: mk.cm ? num(r[mk.cm]) || 0 : 0, inc: mk.inc ? num(r[mk.inc]) || 0 : 0}; }
    const sources = {};
    if (mo) for (const r of t.sources){ const name = str(r[mo.src]); if (!name) continue;
      sources[name] = {kind: /import|buy|supplier|vendor|purchase/i.test(str(r[mo.kind])) ? 'import' : 'factory', lt: num(r[mo.lt]) || 21,
                       pack: mo.pack ? num(r[mo.pack]) || 1 : 1, moq: mo.moq ? num(r[mo.moq]) || 0 : 0, cap: mo.cap ? num(r[mo.cap]) : null,
                       confirmed: mo.confirmed ? /^(y|yes|true|1)$/i.test(str(r[mo.confirmed])) : false}; }
    else issues.push({type: 'No sources file', sku: 'all', id: null, detail: 'Lead times, cartons and batch sizes default to 21 days, 1 and 0.', kind: 'data', sev: 'medium'});
    const events = me ? t.events.map(r => { const ty = /promo|offer|discount|campaign/i.test(str(r[me.etype])) ? 'promo' : 'price', s0 = toISODate(r[me.start]);
      return s0 && {type: ty, start: s0, end: me.eend ? toISODate(r[me.eend]) || s0 : s0, pct: num(r[me.pct]) || 0, line: me.line ? str(r[me.line]) : '', sku: me.sku ? str(r[me.sku]) : '', name: me.ename ? str(r[me.ename]) : ''}; }).filter(Boolean) : [];
    const orders = mr ? t.orders.map(r => { const d = toISODate(r[mr.date]), q = num(r[mr.qty]), sku = str(r[mr.sku]);
      return d && q && seen.has(sku) && {date: d, sku, qty: q, channel: /export/i.test(str(r[mr.channel])) ? 'export' : 'project'}; }).filter(Boolean) : [];
    const macro = mm ? t.macro.map(r => { const d = toISODate(r[mm.month]); return d && {month: d.slice(0, 7), cement: mm.cement ? num(r[mm.cement]) : null, usd_egp: mm.fx ? num(r[mm.fx]) : null, cpi: mm.cpi ? num(r[mm.cpi]) : null}; })
      .filter(Boolean).sort((a, b) => a.month < b.month ? -1 : 1) : [];
    const dealers = {};
    if (md) for (const r of t.dealers){ const sku = str(r[md.sku]), d = toISODate(r[md.date]); if (!seen.has(sku) || !d) continue;
      (dealers[sku] ||= []).push({date: d, dealer: md.dealer ? str(r[md.dealer]) : 'all', stock: num(r[md.dstock]) || 0, sell_out: num(r[md.sellout]) || 0}); }
    const bom = mb ? t.bom.map(r => ({sku: str(r[mb.sku]), material: str(r[mb.material]), per: num(r[mb.per]) || 0})).filter(b => b.sku && b.material && b.per) : [];
    const materials = {};
    if (mt) for (const r of t.materials){ const m = str(r[mt.material]); if (!m) continue;
      materials[m] = {unit: mt.unit ? str(r[mt.unit]) : '', on_hand: num(r[mt.mon]) || 0, on_order: mt.monord ? num(r[mt.monord]) || 0 : 0, lt: mt.mlt ? num(r[mt.mlt]) : null}; }
    return {problems: warn, raw: {asof: addDays(last, 6), start, nweeks: N, items, sources, sales, short, stock, cancels, issues, events, orders, macro, dealers, bom, materials}};
  }

  return {build, fromTables, toMonths, addDays, monthOf, ALIAS, MODEL_TXT};
})();
