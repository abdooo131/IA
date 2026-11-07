import { analyse, DEFAULT_SETTINGS, STATUS } from './engine.js';
import { sampleData } from './sample.js';
import { parseCsv, readOrders, applyCourier, readAds, readCosts, TEMPLATES } from './csv.js';
import { store, money, pct, times, esc, initTheme, toast } from './ui.js';

// ---------- State ----------

const params = new URLSearchParams(location.search);
const saved = store.get('data');
let state = {
  source: 'demo',
  orders: [],
  ads: [],
  settings: { ...DEFAULT_SETTINGS, ...(store.get('settings') || {}) },
  tab: store.get('tab', 'overview'),
  orderQuery: '',
  orderStatus: 'all',
  orderPage: 0,
};
let result = null;

function useDemo() {
  const d = sampleData();
  state.source = 'demo';
  state.orders = d.orders;
  state.ads = d.ads;
  // The demo has its own costs; keep the user's own fee settings out of it.
  state.demoSettings = { ...DEFAULT_SETTINGS, productCosts: d.productCosts };
}

if (saved && !params.has('demo')) {
  state.source = 'mine';
  state.orders = saved.orders || [];
  state.ads = saved.ads || [];
} else {
  useDemo();
}

const activeSettings = () => (state.source === 'demo' ? state.demoSettings : state.settings);

function recompute() {
  result = analyse(state.orders, state.ads, activeSettings());
  render();
}

// ---------- Chrome ----------

initTheme(document.getElementById('theme'));
const view = document.getElementById('view');

function renderChrome() {
  const chip = document.getElementById('source-chip');
  chip.classList.toggle('mine', state.source === 'mine');
  document.getElementById('source-label').textContent = state.source === 'demo' ? 'Demo store' : 'Your store';
  const s = result.summary;
  document.getElementById('period-title').textContent = s.from
    ? `${fmtDate(s.from)} to ${fmtDate(s.to)}`
    : 'No orders yet';
  document.getElementById('period-note').textContent = s.days
    ? `${s.days} days · ${s.ordersBooked.toLocaleString('en-US')} orders`
    : '';
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)));
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  state.tab = t.dataset.tab;
  store.set('tab', state.tab);
  render();
}));

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ---------- Views ----------

function render() {
  renderChrome();
  const s = result.summary;
  if (!s.ordersBooked) {
    view.innerHTML = `<div class="empty"><h2>No orders to show</h2><p>Load your orders file, or look around with the demo store.</p>
      <div class="cta-row" style="justify-content:center"><button class="btn btn-primary" data-act="import">Load files</button><button class="btn" data-act="demo">Use demo store</button></div></div>`;
    return;
  }
  const views = { overview, ads: adsView, products: productsView, delivery: deliveryView, days: daysView, orders: ordersView };
  view.innerHTML = (views[state.tab] || overview)();
  wireCharts();
  if (state.tab === 'orders') wireOrders();
}

view.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'import') openDrawer('import');
  if (act === 'demo') { useDemo(); recompute(); }
  if (act === 'costs') openDrawer('settings');
  const tab = e.target.closest('[data-goto]')?.dataset.goto;
  if (tab) { state.tab = tab; store.set('tab', tab); render(); window.scrollTo({ top: 0 }); }
});

function overview() {
  const s = result.summary;
  const c = s.currency;
  const kept = Math.max(0, s.netProfit);
  const keepPct = s.bookedSales ? kept / s.bookedSales : 0;
  const lostPct = s.bookedSales ? (s.returnedValue + s.pendingValue) / s.bookedSales : 0;
  const costPct = Math.max(0, 1 - keepPct - lostPct);
  const costs = s.productCost + s.shipping + s.returnFees + s.paymentFees + s.packaging + s.adSpend + s.fixed;

  return `
  <div class="grid grid-hero">
    <section class="panel hero-num">
      <div class="label">Net profit</div>
      <div class="big ${s.netProfit < 0 ? 'neg' : ''}">${money(s.netProfit, c)}</div>
      <div class="ctx">You keep <b>${pct(s.keepRate)}</b> of the ${money(s.bookedSales, c)} you booked.</div>
      <div class="keep-bar" role="img" aria-label="Of booked sales: ${pct(keepPct)} kept, ${pct(costPct)} spent on costs, ${pct(lostPct)} returned or still on the road">
        <span style="width:${keepPct * 100}%;background:var(--accent)"></span>
        <span style="width:${costPct * 100}%;background:var(--ink-3)"></span>
        <span style="width:${lostPct * 100}%;background:var(--neg)"></span>
      </div>
      <div class="legend" style="margin-top:4px">
        <span><i style="background:var(--accent)"></i>Kept ${pct(keepPct, 0)}</span>
        <span><i style="background:var(--ink-3)"></i>Costs ${pct(costPct, 0)}</span>
        <span><i style="background:var(--neg)"></i>Returned or on the road ${pct(lostPct, 0)}</span>
      </div>
      <div class="hero-facts">
        <div>Average delivered order<b>${money(s.ordersDelivered ? s.revenue / s.ordersDelivered : 0, c)}</b></div>
        <div>Profit per delivered order<b class="${s.netProfit < 0 ? 'neg' : ''}">${money(s.ordersDelivered ? s.netProfit / s.ordersDelivered : 0, c)}</b></div>
        <div>Lost to returns<b>${money(-(s.returnFees + returnTrips()), c)}</b></div>
      </div>
    </section>
    <section class="panel">
      <h2>Where the money went</h2>
      <p class="panel-sub">From everything customers ordered to what you keep. Costs total ${money(costs, c)}.</p>
      ${walkBars()}
    </section>
  </div>

  <div class="grid grid-tiles" style="margin-top:14px">
    ${tile('Delivered and paid', money(s.revenue, c), `${s.ordersDelivered.toLocaleString('en-US')} orders`)}
    ${tile('Return rate', pct(s.returnRate), `${s.ordersReturned.toLocaleString('en-US')} parcels came back`)}
    ${tile('Cost per delivered order', money(s.costPerDelivered, c), 'Shipping, returns, fees, packaging')}
    ${tile('Real return on ads', times(s.trueRoas), `Ad platform says ${times(s.reportedRoas)}`)}
    ${tile('Break even return on ads', times(s.breakEvenRoas), `At your ${pct(s.contributionMargin, 0)} margin after delivery`)}
    ${tile('Still on the road', money(s.pendingValue, c), `${s.ordersPending} orders, counted once delivered`)}
  </div>

  <div class="grid grid-2" style="margin-top:14px">
    <section class="panel">
      <h2>Profit by day</h2>
      <p class="panel-sub">After ads and a daily share of fixed costs. The last few days look low because their parcels are still on the road. Hover a bar for the detail.</p>
      ${dailyChart(result.daily, c)}
    </section>
    <section class="panel">
      <h2>What to look at first</h2>
      <p class="panel-sub">Biggest leaks first, each with its numbers.</p>
      ${checksList(result.checks)}
    </section>
  </div>`;
}

// Outbound shipping and packaging spent on parcels that came back.
function returnTrips() {
  return result.orders.filter((o) => o.status === STATUS.RETURNED).reduce((t, o) => t + o.shipping + o.packaging, 0);
}

function tile(label, value, note) {
  return `<section class="panel tile"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="note">${esc(note)}</div></section>`;
}

function walkBars() {
  const w = result.waterfall;
  const top = Math.max(...w.map((x) => Math.abs(x.value)), 1);
  let running = 0;
  const c = result.summary.currency;
  return `<div class="walk">${w.map((x) => {
    let left; let width; let cls;
    if (x.total) {
      width = Math.abs(x.value) / top * 100;
      left = 0;
      cls = x.key === 'net' ? 'net' : 'total';
      if (x.key === 'booked') running = x.value;
    } else {
      width = Math.abs(x.value) / top * 100;
      running += x.value;
      left = Math.max(0, running) / top * 100;
      cls = 'minus';
    }
    if (x.key === 'net' && x.value < 0) cls = 'minus';
    return `<div class="walk-line ${x.total ? 'is-total' : ''}" title="${esc(x.label)}: ${money(x.value, c)}">
      <span>${esc(x.label)}</span>
      <span class="track"><span class="bar ${cls}" style="left:${left}%;width:${Math.max(width, 0.4)}%"></span></span>
      <span class="amt ${x.value < 0 && x.total ? 'neg' : ''}">${money(x.value, c)}</span></div>`;
  }).join('')}</div>`;
}

function checksList(checks) {
  const label = { good: 'Good', warning: 'Watch', serious: 'Fix', critical: 'Urgent' };
  return `<div class="checks">${checks.map((k) => `
    <div class="check"><span class="badge ${k.level}">${label[k.level]}</span>
      <div><h3>${esc(k.title)}</h3><p>${esc(k.body)}</p></div></div>`).join('')}</div>`;
}

// Daily bars: blue for days that made money, red for days that lost it.
function dailyChart(daily, currency) {
  const W = 640; const H = 240; const padL = 52; const padR = 8; const padT = 10; const padB = 26;
  const vals = daily.map((d) => d.net);
  let max = Math.max(0, ...vals); let min = Math.min(0, ...vals);
  const step = niceStep((max - min) / 4 || 1);
  max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
  if (max === min) max = min + step;
  const y = (v) => padT + (max - v) / (max - min) * (H - padT - padB);
  const bw = (W - padL - padR) / daily.length;
  const gap = Math.min(2, bw * 0.2);
  const ticks = [];
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(v);
  const every = Math.ceil(daily.length / 6);

  const bars = daily.map((d, i) => {
    const x = padL + i * bw + gap / 2;
    const w = Math.max(1, bw - gap);
    const top = y(Math.max(0, d.net)); const bot = y(Math.min(0, d.net));
    const h = Math.max(1, bot - top);
    const fill = d.net < 0 ? 'var(--neg)' : 'var(--pos)';
    const r = Math.min(4, w / 2, h);
    // Round only the end away from zero.
    const path = d.net >= 0
      ? `M${x},${bot} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${bot} Z`
      : `M${x},${top} V${bot - r} Q${x},${bot} ${x + r},${bot} H${x + w - r} Q${x + w},${bot} ${x + w},${bot - r} V${top} Z`;
    const tip = `<b>${fmtDate(d.date)}</b><br>Net ${money(d.net, currency)}<br>${d.orders} orders · ${d.returned} returned<br>Ads ${money(d.adSpend, currency)}`;
    return `<g><rect class="hit" x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" data-tip="${esc(tip)}" data-x="${x + w / 2}" data-y="${top}"></rect>
      <path class="mark" d="${path}" fill="${fill}"></path></g>`;
  }).join('');

  const grid = ticks.map((v) => `<line class="${v === 0 ? 'zero-line' : 'grid-line'}" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"></line>
    <text class="axis-text" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${shortMoney(v)}</text>`).join('');
  const xl = daily.map((d, i) => (i % every === 0 ? `<text class="axis-text" x="${padL + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${fmtDate(d.date)}</text>` : '')).join('');
  const lossDays = daily.filter((d) => d.net < 0).length;
  return `<div class="chart" data-chart>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net profit per day. ${daily.length - lossDays} days made money, ${lossDays} lost money.">${grid}${bars}${xl}</svg>
    <div class="tooltip" role="presentation"></div>
    <div class="legend"><span><i style="background:var(--pos)"></i>Made money</span><span><i style="background:var(--neg)"></i>Lost money</span>
      <a href="#" data-goto="days" class="small" style="margin-inline-start:auto">See the table</a></div>
  </div>`;
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const shortMoney = (v) => (Math.abs(v) >= 1000 ? `${v < 0 ? '−' : ''}${Math.round(Math.abs(v) / 1000)}k` : String(Math.round(v)));

function wireCharts() {
  view.querySelectorAll('[data-chart]').forEach((chart) => {
    const tip = chart.querySelector('.tooltip');
    const svg = chart.querySelector('svg');
    let hot = null;
    svg.addEventListener('pointermove', (e) => {
      const hit = e.target.closest('.hit');
      if (!hit) return;
      if (hot) hot.classList.remove('is-hot');
      hot = hit.nextElementSibling; hot.classList.add('is-hot');
      const box = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const sx = box.width / vb.width;
      let x = parseFloat(hit.dataset.x) * sx;
      x = Math.min(Math.max(x, 70), box.width - 70);
      tip.style.left = `${x}px`;
      tip.style.top = `${parseFloat(hit.dataset.y) * sx}px`;
      tip.innerHTML = hit.dataset.tip;
      tip.classList.add('show');
    });
    svg.addEventListener('pointerleave', () => { tip.classList.remove('show'); if (hot) hot.classList.remove('is-hot'); });
  });
}

function adsView() {
  const s = result.summary; const c = s.currency;
  const rows = result.campaigns;
  if (!rows.length) return `<div class="empty"><h2>No ad data yet</h2><p>Load your ad report to compare what the platform reports with what was delivered.</p><button class="btn btn-primary" data-act="import">Load files</button></div>`;
  const maxRoas = Math.max(...rows.map((r) => Math.max(r.reportedRoas, r.trueRoas)), s.breakEvenRoas, 1);
  return `
  <div class="grid grid-tiles">
    ${tile('Ad spend', money(s.adSpend, c), `${rows.length} campaigns`)}
    ${tile('Real return on ads', times(s.trueRoas), `Ad platform says ${times(s.reportedRoas)}`)}
    ${tile('Break even', times(s.breakEvenRoas), 'Below this, a campaign loses money')}
  </div>
  <section class="panel" style="margin-top:14px">
    <h2>Campaigns</h2>
    <p class="panel-sub">The platform counts a sale at checkout. Rebh counts it once delivered and paid. The thin line marks break even.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Campaign</th><th class="r">Spend</th><th class="r">Platform says</th><th>Real return on ads</th><th class="r">Orders</th><th class="r">Returned</th><th class="r">Profit after ads</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${esc(r.campaign)}</td>
        <td class="r">${money(r.spend, c)}</td>
        <td class="r">${times(r.reportedRoas)}</td>
        <td><span style="display:inline-flex;align-items:center;gap:8px;min-width:200px">
          <span style="position:relative;display:inline-block;width:120px;height:10px;background:var(--surface-2);border-radius:3px">
            <span style="position:absolute;inset-block:0;inset-inline-start:0;width:${r.trueRoas / maxRoas * 100}%;background:${r.trueRoas < s.breakEvenRoas ? 'var(--neg)' : 'var(--pos)'};border-radius:3px"></span>
            <span title="Break even" style="position:absolute;top:-3px;bottom:-3px;inset-inline-start:${s.breakEvenRoas / maxRoas * 100}%;width:2px;background:var(--ink)"></span>
          </span><b class="num">${times(r.trueRoas)}</b></span></td>
        <td class="r">${r.orders}</td>
        <td class="r">${r.orders ? pct(r.returned / r.orders, 0) : '–'}</td>
        <td class="r ${r.profitAfterAds < 0 ? 'neg' : ''}"><b>${money(r.profitAfterAds, c)}</b></td></tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted">Orders are tied to a campaign through the campaign column in your orders file (for example a UTM campaign). Orders without one count in the totals but not per campaign.</p>
  </section>`;
}

function productsView() {
  const c = result.summary.currency;
  const rows = result.products;
  const maxNet = Math.max(...rows.map((r) => Math.abs(r.net)), 1);
  const missing = state.source === 'mine' ? rows.filter((r) => state.settings.productCosts?.[r.product] === undefined).length : 0;
  return `
  ${missing ? `<div class="check" style="margin-bottom:14px"><span class="badge warning">Watch</span><div><h3>${missing} products have no cost set</h3><p>They use ${state.settings.defaultCostPct}% of the price as an estimate. <a href="#" data-act="costs">Add real costs</a> for exact margins.</p></div></div>` : ''}
  <section class="panel">
    <h2>Products</h2>
    <p class="panel-sub">Profit after product cost, delivery, returns and fees, before ads and fixed costs.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Product</th><th class="r">Orders</th><th class="r">Units delivered</th><th class="r">Return rate</th><th class="r">Delivered sales</th><th>Profit before ads</th><th class="r">Margin</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${esc(r.product)}</td><td class="r">${r.orders}</td><td class="r">${r.units}</td>
        <td class="r ${r.returnRate > Math.max(0.15, result.summary.returnRate * 1.5) ? 'neg' : ''}">${pct(r.returnRate)}</td>
        <td class="r">${money(r.revenue, c)}</td>
        <td><span class="mini-bar" style="width:${Math.abs(r.net) / maxNet * 90}px;${r.net < 0 ? 'background:var(--neg)' : ''}"></span><span class="num ${r.net < 0 ? 'neg' : ''}">${money(r.net, c)}</span></td>
        <td class="r">${pct(r.margin, 0)}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function deliveryView() {
  const s = result.summary; const c = s.currency;
  const parts = [
    { label: 'Delivered', n: s.ordersDelivered, color: 'var(--s1)' },
    { label: 'Returned or refused', n: s.ordersReturned, color: 'var(--s2)' },
    { label: 'On the road', n: s.ordersPending, color: 'var(--s3)' },
  ];
  const total = parts.reduce((t, p) => t + p.n, 0) || 1;
  const zones = result.zones;
  return `
  <div class="grid grid-tiles">
    ${tile('Return rate', pct(s.returnRate), 'Of parcels that reached an end')}
    ${tile('Shipping and return trips', money(s.shipping + s.returnFees, c), `${money(s.returnFees, c)} of it on return trips`)}
    ${tile('COD and card fees', money(s.paymentFees, c), 'On delivered orders')}
  </div>
  <section class="panel" style="margin-top:14px">
    <h2>What happened to every parcel</h2>
    <p class="panel-sub">${total.toLocaleString('en-US')} parcels sent, not counting ${s.ordersCancelled} cancelled orders.</p>
    <div class="seg" role="img" aria-label="${parts.map((p) => `${p.label} ${pct(p.n / total, 0)}`).join(', ')}">${parts.map((p) => `<span style="width:${p.n / total * 100}%;background:${p.color}"></span>`).join('')}</div>
    <div class="legend">${parts.map((p) => `<span><i style="background:${p.color}"></i>${p.label} <b class="num">${p.n.toLocaleString('en-US')}</b> (${pct(p.n / total, 0)})</span>`).join('')}</div>
  </section>
  <section class="panel" style="margin-top:14px">
    <h2>By area</h2>
    <p class="panel-sub">Where parcels come back, and what delivery costs there.</p>
    ${zones.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Area</th><th class="r">Parcels</th><th class="r">Returned</th><th class="r">Return rate</th><th class="r">Delivery cost</th><th class="r">Per parcel</th></tr></thead>
      <tbody>${zones.map((z) => `<tr><td>${esc(z.zone)}</td><td class="r">${z.parcels}</td><td class="r">${z.returned}</td>
        <td class="r ${z.returnRate > Math.max(0.15, s.returnRate * 1.4) ? 'neg' : ''}">${pct(z.returnRate)}</td>
        <td class="r">${money(z.deliveryCost, c)}</td><td class="r">${money(z.costPerParcel, c)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted small">Add a city or zone column to your orders or courier file to see this.</p>'}
  </section>`;
}

function daysView() {
  const c = result.summary.currency;
  return `<section class="panel">
    <h2>Day by day</h2>
    <p class="panel-sub">Net includes ads and a daily share of fixed costs (${money(result.summary.fixed / Math.max(1, result.summary.days), c)} a day).</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Day</th><th class="r">Orders</th><th class="r">Booked</th><th class="r">Delivered sales</th><th class="r">Ad spend</th><th class="r">Delivery</th><th class="r">Returned</th><th class="r">Net</th></tr></thead>
      <tbody>${[...result.daily].reverse().map((d) => `<tr><td>${fmtDate(d.date)} <span class="muted small">${new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span></td>
        <td class="r">${d.orders}</td><td class="r">${money(d.booked, c)}</td><td class="r">${money(d.revenue, c)}</td>
        <td class="r">${money(d.adSpend, c)}</td><td class="r">${money(d.delivery, c)}</td><td class="r">${d.returned}</td>
        <td class="r ${d.net < 0 ? 'neg' : ''}"><b>${money(d.net, c, { sign: true })}</b></td></tr>`).join('')}</tbody>
    </table></div></section>`;
}

const PAGE = 50;
const statusLabel = { delivered: 'Delivered', returned: 'Returned', in_transit: 'On the road', cancelled: 'Cancelled' };

function filteredOrders() {
  const q = state.orderQuery.trim().toLowerCase();
  return result.orders.filter((o) => (state.orderStatus === 'all' || o.status === state.orderStatus)
    && (!q || `${o.id} ${o.product} ${o.campaign} ${o.zone}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function ordersView() {
  return `<div class="toolbar">
    <input class="input" id="oq" type="search" placeholder="Search order, product, campaign, area" value="${esc(state.orderQuery)}" style="flex:1;min-width:200px" aria-label="Search orders">
    <select class="input" id="os" aria-label="Filter by status">
      ${['all', STATUS.DELIVERED, STATUS.RETURNED, STATUS.IN_TRANSIT, STATUS.CANCELLED].map((v) => `<option value="${v}" ${state.orderStatus === v ? 'selected' : ''}>${v === 'all' ? 'All statuses' : statusLabel[v]}</option>`).join('')}
    </select></div>
  <div id="orders-table"></div>`;
}

function renderOrdersTable() {
  const c = result.summary.currency;
  const rows = filteredOrders();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  state.orderPage = Math.min(state.orderPage, pages - 1);
  const slice = rows.slice(state.orderPage * PAGE, state.orderPage * PAGE + PAGE);
  document.getElementById('orders-table').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Order</th><th>Day</th><th>Product</th><th>Status</th><th>Area</th><th class="r">Total</th><th class="r">Product cost</th><th class="r">Delivery</th><th class="r">Fees</th><th class="r">Profit</th></tr></thead>
      <tbody>${slice.map((o) => `<tr><td>${esc(o.id)}</td><td>${fmtDate(o.date)}</td><td>${esc(o.product)}${o.qty > 1 ? ` <span class="muted">×${o.qty}</span>` : ''}</td>
        <td><span class="pill ${o.status}">${statusLabel[o.status]}</span></td><td>${esc(o.zone)}</td>
        <td class="r">${money(o.total, c)}</td><td class="r">${o.productCost ? money(o.productCost, c) : '–'}</td>
        <td class="r">${o.shipping + o.returnFee ? money(o.shipping + o.returnFee, c) : '–'}</td>
        <td class="r">${o.paymentFee + o.packaging ? money(o.paymentFee + o.packaging, c) : '–'}</td>
        <td class="r ${o.net < 0 ? 'neg' : ''}">${o.pending ? '<span class="muted">pending</span>' : o.status === 'cancelled' ? '–' : `<b>${money(o.net, c)}</b>`}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No orders match.</td></tr>'}</tbody>
    </table></div>
    <div class="pager"><span>${rows.length.toLocaleString('en-US')} orders · page ${state.orderPage + 1} of ${pages}</span>
      <span><button class="btn" id="prev" ${state.orderPage === 0 ? 'disabled' : ''}>Previous</button> <button class="btn" id="next" ${state.orderPage >= pages - 1 ? 'disabled' : ''}>Next</button></span></div>
    <p class="small muted">Profit per order is before ads and fixed costs, which are not tied to single orders.</p>`;
  document.getElementById('prev').onclick = () => { state.orderPage--; renderOrdersTable(); };
  document.getElementById('next').onclick = () => { state.orderPage++; renderOrdersTable(); };
}

function wireOrders() {
  renderOrdersTable();
  document.getElementById('oq').addEventListener('input', (e) => { state.orderQuery = e.target.value; state.orderPage = 0; renderOrdersTable(); });
  document.getElementById('os').addEventListener('change', (e) => { state.orderStatus = e.target.value; state.orderPage = 0; renderOrdersTable(); });
}

// ---------- Drawers ----------

const back = document.getElementById('back');
let lastFocus = null;
function openDrawer(id) {
  if (id === 'settings') fillSettings();
  lastFocus = document.activeElement;
  document.getElementById(id).classList.add('open');
  back.classList.add('show');
  document.getElementById(id).querySelector('[data-close]').focus();
}
function closeDrawers() {
  document.querySelectorAll('.drawer.open').forEach((d) => d.classList.remove('open'));
  back.classList.remove('show');
  lastFocus?.focus?.();
}
back.addEventListener('click', closeDrawers);
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeDrawers));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawers(); });
document.getElementById('open-import').addEventListener('click', () => openDrawer('import'));
document.getElementById('open-settings').addEventListener('click', () => openDrawer('settings'));

// Import
const pending = { orders: null, courier: null, ads: null, costs: null };

async function readFile(kind, file, statusEl) {
  try {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) throw new Error('The file has no rows.');
    let note;
    if (kind === 'orders') {
      pending.orders = readOrders(rows);
      if (!pending.orders.length) throw new Error('No order numbers found. Is there an "order" or "Name" column?');
      const undated = pending.orders.filter((o) => !o.date).length;
      note = `${pending.orders.length.toLocaleString('en-US')} orders read${undated ? `, ${undated} without a date` : ''}.`;
    } else if (kind === 'courier') {
      pending.courier = rows; note = `${rows.length.toLocaleString('en-US')} parcels read. They will be matched to orders by order number.`;
    } else if (kind === 'ads') {
      pending.ads = readAds(rows);
      note = `${pending.ads.length.toLocaleString('en-US')} rows, ${money(pending.ads.reduce((t, a) => t + a.spend, 0), state.settings.currency)} spend.`;
    } else {
      pending.costs = readCosts(rows); note = `${Object.keys(pending.costs).length} product costs.`;
    }
    statusEl.classList.remove('err');
    statusEl.textContent = `✓ ${file.name}: ${note}`;
  } catch (err) {
    pending[kind] = null;
    statusEl.classList.add('err');
    statusEl.textContent = `${file.name}: ${err.message}`;
  }
  document.getElementById('apply-import').disabled = !pending.orders;
}

document.querySelectorAll('.drop').forEach((drop) => {
  const kind = drop.dataset.kind;
  const status = drop.querySelector('.status');
  drop.querySelector('input').addEventListener('change', (e) => e.target.files[0] && readFile(kind, e.target.files[0], status));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) readFile(kind, f, status);
  });
});

document.getElementById('apply-import').addEventListener('click', () => {
  const orders = pending.orders.map((o) => ({ ...o }));
  let note = '';
  if (pending.courier) {
    const n = applyCourier(orders, pending.courier);
    note = ` Courier file matched ${n} of ${orders.length} orders.`;
  }
  if (pending.costs) state.settings.productCosts = { ...state.settings.productCosts, ...pending.costs };
  state.source = 'mine';
  state.orders = orders.filter((o) => o.date);
  state.ads = pending.ads || [];
  const ok = store.set('data', { orders: state.orders, ads: state.ads });
  store.set('settings', state.settings);
  closeDrawers();
  recompute();
  toast(`Loaded ${state.orders.length.toLocaleString('en-US')} orders.${note}${ok ? '' : ' (Too large to remember after you close this tab.)'}`);
});

document.getElementById('use-demo').addEventListener('click', () => { useDemo(); closeDrawers(); recompute(); });

document.querySelectorAll('[data-template]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  const kind = a.dataset.template;
  const blob = new Blob([TEMPLATES[kind]], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: `rebh-${kind}-template.csv` });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}));

// Settings
const form = document.getElementById('settings-form');
function fillSettings() {
  const st = activeSettings();
  for (const el of form.elements) if (el.name && el.name in st) el.value = st[el.name];
  const products = [...new Set(state.orders.map((o) => o.product))].sort();
  document.getElementById('cost-list').innerHTML = products.length
    ? products.map((p, i) => `<div class="cost-row"><label for="pc-${i}">${esc(p)}</label><input class="input" id="pc-${i}" data-product="${esc(p)}" type="number" min="0" step="0.01" placeholder="${st.defaultCostPct}% of price" value="${st.productCosts?.[p] ?? ''}"></div>`).join('')
    : '<p class="small muted">Load orders to list your products here.</p>';
  if (state.source === 'demo') document.getElementById('cost-list').insertAdjacentHTML('afterbegin', '<p class="small muted">You are looking at the demo store. Changes apply to the demo until you load your own files.</p>');
}

document.getElementById('save-settings').addEventListener('click', () => {
  const st = { ...activeSettings(), productCosts: { ...activeSettings().productCosts } };
  for (const el of form.elements) {
    if (!el.name) continue;
    st[el.name] = el.type === 'number' ? (parseFloat(el.value) || 0) : (el.value.trim() || 'EGP');
  }
  form.querySelectorAll('[data-product]').forEach((el) => {
    if (el.value === '') delete st.productCosts[el.dataset.product];
    else st.productCosts[el.dataset.product] = parseFloat(el.value) || 0;
  });
  if (state.source === 'demo') state.demoSettings = st;
  else { state.settings = st; store.set('settings', st); }
  closeDrawers();
  recompute();
  toast('Recalculated with your costs.');
});

document.getElementById('clear-data').addEventListener('click', () => {
  store.remove('data'); store.remove('settings');
  state.settings = { ...DEFAULT_SETTINGS };
  useDemo();
  closeDrawers();
  recompute();
  toast('Your files and costs were removed from this browser.');
});

// ---------- Start ----------

recompute();
if (params.has('import')) openDrawer('import');
