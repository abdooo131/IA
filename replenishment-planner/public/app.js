(function () {
  'use strict';

  // ======================= basics =======================
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const main = $('#main');
  let BOOT = null;
  let USER = '';
  try { USER = localStorage.getItem('scc.user') || ''; } catch (e) { /* storage blocked */ }

  async function api(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-User': encodeURIComponent(USER || 'Unknown') },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({ error: 'The server sent an answer that could not be read.' }));
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  }
  const get = p => api('GET', p);
  const send = (p, b) => api('POST', p, b || {});

  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const nf4 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
  function q(n, unit) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    if (unit === 'pcs' || Math.abs(n) >= 100) return nf0.format(n);
    return Math.abs(n) >= 10 ? nf1.format(n) : nf2.format(n);
  }
  const money = n => 'EGP ' + nf0.format(Math.round(n || 0));
  function kmoney(n) {
    const a = Math.abs(n || 0);
    if (a >= 1e6) return 'EGP ' + nf2.format(n / 1e6) + 'M';
    if (a >= 1e4) return 'EGP ' + nf0.format(n / 1000) + 'k';
    return money(n);
  }
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function day(iso, long) {
    if (!iso) return '';
    const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { weekday: long ? 'long' : 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  function stamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) + ' ' + d.toISOString().slice(11, 16);
  }
  function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  const locName = c => ((BOOT.locations.find(l => l.code === c) || {}).name || c);
  const itemOf = c => BOOT.items.find(i => i.code === c);
  const prodOf = c => BOOT.products.find(p => p.code === c);
  const supName = c => ((BOOT.suppliers.find(s => s.code === c) || {}).name || c || '');
  const branches = () => BOOT.locations.filter(l => l.type === 'BRANCH' && l.active !== false);

  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (bad ? ' bad' : '');
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 2600);
  }

  // ======================= building blocks =======================
  const STATUS = {
    po: { DRAFT: ['warn', 'Awaiting approval'], APPROVED: ['info', 'Approved'], SENT: ['vio', 'Sent to supplier'], PARTIAL: ['warn', 'Part received'], RECEIVED: ['ok', 'Received'], CLOSED: ['', 'Closed short'], CANCELLED: ['', 'Cancelled'] },
    tr: { APPROVED: ['info', 'To dispatch'], DISPATCHED: ['vio', 'In transit'], RECEIVED: ['ok', 'Received'], CANCELLED: ['', 'Cancelled'] },
    plan: { DRAFT: ['warn', 'Draft'], APPROVED: ['ok', 'Approved'], REPLACED: ['', 'Replaced'] },
    prd: { PLANNED: ['info', 'Planned'], COMPLETED: ['ok', 'Made'], CANCELLED: ['', 'Cancelled'] },
    buy: { urgent: ['crit', 'Urgent'], order: ['warn', 'Order'], ok: ['ok', 'OK'], 'no use': ['', 'Not used'] }
  };
  function pill(kind, s) { const v = (STATUS[kind] || {})[s] || ['', s]; return '<span class="pill ' + v[0] + '">' + esc(v[1]) + '</span>'; }
  const LEDGER_TYPES = { OPENING: 'Opening balance', RECEIPT: 'Supplier receipt', TRANSFER_OUT: 'Transfer out', TRANSFER_IN: 'Transfer in', SALES_USE: 'Used by sales', PRODUCTION: 'Used in production', WASTE: 'Waste', COUNT: 'Count adjustment' };
  const MADE_AT = { BRANCH: 'Branch', CK: 'Central kitchen', SEMI: 'Semi finished' };

  function header(title, sub, actions, crumb) {
    return '<div class="ph"><div class="t">' + (crumb ? '<div class="crumb">' + crumb + '</div>' : '') + '<h1>' + title + '</h1>' + (sub ? '<p class="muted">' + sub + '</p>' : '') + '</div>' +
      (actions ? '<div class="acts">' + actions + '</div>' : '') + '</div>' + exampleBanner();
  }
  function exampleBanner() {
    return BOOT && BOOT.seeded ? '<div class="example-banner">Example data: every figure here is made up. Import your own files under Settings and imports, or keep exploring.</div>' : '';
  }
  function card(title, body, opts) {
    opts = opts || {};
    return '<section class="card' + (opts.cls ? ' ' + opts.cls : '') + '">' + (title ? '<div class="hd"><div><h2>' + title + '</h2>' + (opts.sub ? '<div class="sub">' + opts.sub + '</div>' : '') + '</div>' + (opts.actions ? '<div class="acts">' + opts.actions + '</div>' : '') + '</div>' : '') +
      (opts.raw ? body : '<div class="bd">' + body + '</div>') + (opts.foot ? '<div class="ft">' + opts.foot + '</div>' : '') + '</section>';
  }
  function kpi(label, value, sub, cls, link) {
    return '<div class="kpi ' + (cls || '') + '"><span class="label">' + esc(label) + '</span><span class="v">' + value + '</span><span class="s">' + sub + '</span>' + (link ? '<a class="more" href="' + link[0] + '">' + esc(link[1]) + '</a>' : '') + '</div>';
  }
  function table(cols, rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<div class="empty">' + (opts.empty || 'Nothing here yet.') + '</div>';
    return '<div class="tw"><table><thead><tr>' + cols.map(c => '<th class="' + (c.n ? 'n' : '') + '">' + c.h + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(r => '<tr' + (opts.href ? ' class="click" data-href="' + esc(opts.href(r)) + '"' : '') + '>' + cols.map(c => '<td class="' + (c.n ? 'n ' : '') + (c.cls ? c.cls(r) : '') + '">' + c.f(r) + '</td>').join('') + '</tr>').join('') +
      (opts.foot || '') + '</tbody></table></div>';
  }
  function pager(p, go) {
    if (p.total <= p.limit) return '<div class="pager">' + nf0.format(p.total) + ' rows</div>';
    return '<div class="pager">' + nf0.format(p.offset + 1) + ' to ' + nf0.format(Math.min(p.total, p.offset + p.limit)) + ' of ' + nf0.format(p.total) +
      ' <button class="sm" data-act="' + go + '" data-off="' + Math.max(0, p.offset - p.limit) + '"' + (p.offset ? '' : ' disabled') + '>Previous</button>' +
      '<button class="sm" data-act="' + go + '" data-off="' + (p.offset + p.limit) + '"' + (p.offset + p.limit < p.total ? '' : ' disabled') + '>Next</button></div>';
  }
  function barChart(entries, fmt, opts) {
    opts = opts || {};
    if (!entries.length) return '<div class="empty">No data.</div>';
    const max = Math.max(1, ...entries.map(e => e[1]));
    const w = 100 / entries.length;
    const bars = entries.map((e, i) => {
      const h = Math.max(0.5, (e[1] / max) * 92);
      const last = i === entries.length - 1;
      return '<rect x="' + (i * w + w * 0.15).toFixed(3) + '" y="' + (100 - h).toFixed(3) + '" width="' + (w * 0.7).toFixed(3) + '" height="' + h.toFixed(3) + '" style="fill:var(' + (opts.color || '--accent') + ');opacity:' + (last ? 1 : 0.62) + '"><title>' + esc(e[0]) + ': ' + esc(fmt(e[1])) + '</title></rect>';
    }).join('');
    const grid = [25, 50, 75].map(y => '<line x1="0" x2="100" y1="' + y + '" y2="' + y + '" style="stroke:var(--line);stroke-width:0.4" vector-effect="non-scaling-stroke"></line>').join('');
    return '<div class="bars"><div class="faint" style="font-size:11.5px">Highest ' + esc(fmt(max)) + '</div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">' + grid + bars + '</svg><div class="ax"><span>' + esc(entries[0][0]) + '</span><span>' + esc(entries[entries.length - 1][0]) + '</span></div></div>';
  }
  function hbars(rows, fmt, cls) {
    if (!rows.length) return '<div class="empty">Nothing recorded.</div>';
    const max = Math.max(1, ...rows.map(r => r.value));
    return '<div class="grid" style="gap:10px">' + rows.map(r => '<div class="hbar ' + (cls || '') + '"><span>' + esc(r.name) + '</span><span class="num" style="text-align:right">' + esc(fmt(r.value)) + '</span><div class="track"><i style="width:' + (100 * r.value / max).toFixed(1) + '%"></i></div></div>').join('') + '</div>';
  }
  function tabs(id, list, active) {
    return '<div class="tabs" role="tablist">' + list.map(t => '<button role="tab" data-act="tab" data-tabs="' + id + '" data-tab="' + t[0] + '" aria-selected="' + (t[0] === active) + '">' + esc(t[1]) + '</button>').join('') + '</div>';
  }
  function steps(list, current) {
    const i = list.indexOf(current);
    return '<div class="steps">' + list.map((s, k) => '<span class="' + (k < i ? 'done' : k === i ? 'now' : '') + '">' + esc(s) + '</span>').join('') + '</div>';
  }
  function timeline(hist) {
    return '<div class="timeline">' + hist.slice().reverse().map(h => '<div class="ev"><span class="faint num">' + esc(stamp(h.at)) + '</span><span><b>' + esc(h.user) + '</b> ' + esc(h.action) + (h.note ? ' <span class="muted">(' + esc(h.note) + ')</span>' : '') + '</span></div>').join('') + '</div>';
  }
  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function locOptions(sel, filter, blank) {
    return (blank ? opt('', blank, sel) : '') + BOOT.locations.filter(filter || (() => true)).map(l => opt(l.code, l.name, sel)).join('');
  }

  function copyRows(rows) {
    const text = rows.map(r => r.map(c => String(c === undefined || c === null ? '' : c).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
    const done = () => toast('Copied ' + (rows.length - 1) + ' rows. Paste into Excel.');
    const fallback = () => {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { /* nothing */ } ta.remove(); done();
    };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  }

  // Dialog with a form. onSubmit(form) may throw to show an error.
  function dialog(o) {
    const dlg = $('#dlg');
    dlg.innerHTML = '<form><div class="dh"><h2>' + esc(o.title) + '</h2><button type="button" class="sm" data-close>Close</button></div><div class="db">' + o.body + '</div>' +
      '<div class="df"><span class="err"></span><button type="button" data-close>Cancel</button>' + (o.submit === false ? '' : '<button class="primary' + (o.danger ? ' danger' : '') + '" type="submit">' + esc(o.submit || 'Save') + '</button>') + '</div></form>';
    const form = $('form', dlg);
    $$('[data-close]', dlg).forEach(b => { b.onclick = () => dlg.close(); });
    form.onsubmit = async e => {
      e.preventDefault();
      const btn = $('[type=submit]', form);
      if (btn) btn.disabled = true;
      $('.err', form).textContent = '';
      try { await o.onSubmit(form); dlg.close(); } catch (err) { $('.err', form).textContent = err.message; } finally { if (btn) btn.disabled = false; }
    };
    if (o.init) o.init(form);
    dlg.showModal();
    return form;
  }
  const val = (form, name) => { const el = form.elements[name]; return el ? el.value.trim() : ''; };

  // ======================= file reading =======================
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
      else if (c === '"') inQ = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
      else cur += c;
    }
    row.push(cur); if (row.some(x => x.trim() !== '')) rows.push(row);
    const head = (rows.shift() || []).map(h => h.trim());
    return rows.map(r => { const o = {}; head.forEach((h, j) => { o[h] = (r[j] || '').trim(); }); return o; });
  }
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const isX = /\.xlsx?$/i.test(file.name);
      const rd = new FileReader();
      rd.onerror = () => reject(new Error('Could not read the file.'));
      rd.onload = () => {
        try {
          if (isX) {
            if (!window.XLSX) throw new Error('The Excel reader did not load (no internet?). Save the sheet as CSV and try again.');
            const wb = XLSX.read(rd.result, { type: 'array', cellDates: true });
            resolve(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, dateNF: 'yyyy-mm-dd', defval: '' }));
          } else resolve(parseCsv(rd.result));
        } catch (e) { reject(e); }
      };
      if (isX) rd.readAsArrayBuffer(file); else rd.readAsText(file);
    });
  }
  function importDialog(type, after) {
    const def = BOOT.imports[type];
    dialog({
      title: 'Import ' + def.title.toLowerCase(),
      submit: 'Import',
      body: '<p class="muted">CSV or Excel. Required columns: <b>' + def.required.join(', ') + '</b>. Optional: ' + (Object.keys(def.fields).filter(f => def.required.indexOf(f) < 0).join(', ') || 'none') + '. Common Oracle and POS column names are recognised.</p>' +
        (type === 'sales' ? '<p class="muted">Branch can be the branch code or name. Product can be the SKU or the Oracle code. A file replaces earlier sales for the same branch and day, and raw material use at the branch is posted to the stock ledger.</p>' : '') +
        (type === 'counts' ? '<div class="field"><label for="cntDate">Count date</label><input type="date" id="cntDate" name="date" value="' + addDays(BOOT.today, -1) + '"></div>' : '') +
        '<div class="field"><label for="impFile">File</label><input type="file" id="impFile" name="file" accept=".csv,.txt,.xlsx,.xls" required></div>' +
        '<div><button type="button" class="sm" data-tpl>Copy template headers</button></div><div id="impResult"></div>',
      init: form => { $('[data-tpl]', form).onclick = () => copyRows([Object.keys(def.fields)]); },
      onSubmit: async form => {
        const f = form.elements.file.files[0];
        if (!f) throw new Error('Choose a file.');
        const rows = await readFile(f);
        const res = await send('/import/' + type, { fileName: f.name, rows, date: val(form, 'date') });
        await reloadBoot();
        toast('Imported ' + nf0.format(res.accepted) + ' of ' + nf0.format(res.rows) + ' rows' + (res.rejected ? ', ' + res.rejected + ' rejected' : ''));
        if (res.errors.length) setTimeout(() => showImport(res), 50);
        if (after) after(res);
      }
    });
  }
  function showImport(rec) {
    dialog({
      title: rec.title + ' import ' + rec.id, submit: false,
      body: '<p><b>' + esc(rec.fileName) + '</b>: ' + nf0.format(rec.accepted) + ' of ' + nf0.format(rec.rows) + ' rows accepted by ' + esc(rec.user) + ' on ' + esc(stamp(rec.at)) + '.</p>' +
        (rec.errors.length ? '<div class="tw" style="max-height:340px"><table><tbody>' + rec.errors.map(e => '<tr><td class="wrap">' + esc(e) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">No problems.</p>'),
      onSubmit: () => {}
    });
  }

  // ======================= router =======================
  const routes = [
    [/^\/$/, viewDashboard, '/'],
    [/^\/plans$/, viewPlans, '/plans'], [/^\/plans\/([^/]+)$/, viewPlan, '/plans'],
    [/^\/production$/, viewProductionList, '/production'], [/^\/production\/([^/]+)$/, viewProduction, '/production'],
    [/^\/pos$/, viewPOs, '/pos'], [/^\/pos\/([^/]+)$/, viewPO, '/pos'],
    [/^\/transfers$/, viewTransfers, '/transfers'], [/^\/transfers\/([^/]+)$/, viewTransfer, '/transfers'],
    [/^\/stock$/, viewStock, '/stock'], [/^\/ledger$/, viewLedger, '/ledger'], [/^\/waste$/, viewWaste, '/waste'],
    [/^\/sales$/, viewSales, '/sales'],
    [/^\/products$/, viewProducts, '/products'], [/^\/products\/([^/]+)$/, viewProduct, '/products'],
    [/^\/items$/, viewItems, '/items'], [/^\/items\/([^/]+)$/, viewItem, '/items'],
    [/^\/suppliers$/, viewSuppliers, '/suppliers'], [/^\/locations$/, viewLocations, '/locations'],
    [/^\/log$/, viewLog, '/log'], [/^\/settings$/, viewSettings, '/settings']
  ];
  let ACTS = {};
  function bind(acts) { ACTS = acts || {}; }
  main.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a && main.contains(a)) {
      const fn = ACTS[a.getAttribute('data-act')] || (a.getAttribute('data-act') === 'tab' ? switchTab : null);
      if (fn) { e.preventDefault(); Promise.resolve(fn(a, e)).catch(err => toast(err.message, true)); }
      return;
    }
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('button,input,select,a')) location.hash = tr.getAttribute('data-href');
  });
  main.addEventListener('change', e => {
    const a = e.target.closest('[data-change]');
    if (a && ACTS[a.getAttribute('data-change')]) Promise.resolve(ACTS[a.getAttribute('data-change')](a, e)).catch(err => toast(err.message, true));
  });
  function switchTab(btn) {
    const group = btn.getAttribute('data-tabs');
    $$('[data-tabs="' + group + '"]', main).forEach(b => b.setAttribute('aria-selected', String(b === btn)));
    $$('[data-pane="' + group + '"]', main).forEach(p => { p.hidden = p.getAttribute('data-name') !== btn.getAttribute('data-tab'); });
  }

  function parseQs(s) { const o = {}; (s || '').split('&').filter(Boolean).forEach(kv => { const [k, v] = kv.split('='); o[decodeURIComponent(k)] = decodeURIComponent(v || ''); }); return o; }
  function qs(o) { const s = Object.keys(o).filter(k => o[k] !== '' && o[k] !== undefined && o[k] !== null).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&'); return s ? '?' + s : ''; }

  async function render() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [path, query] = hash.split('?');
    for (const [re, fn, navKey] of routes) {
      const m = path.match(re);
      if (!m) continue;
      $$('#nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + navKey));
      $('#side').classList.remove('open');
      bind({});
      try { await fn(...m.slice(1).map(decodeURIComponent), parseQs(query)); }
      catch (e) { main.innerHTML = header('Something went wrong', esc(e.message)) + '<p><a href="#/">Back to the dashboard</a></p>'; }
      return;
    }
    main.innerHTML = header('Page not found', 'This address does not exist.') + '<p><a href="#/">Back to the dashboard</a></p>';
  }
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  async function reloadBoot() { BOOT = await get('/bootstrap'); }
  async function refreshBadges() {
    try {
      const d = await get('/dashboard');
      const b1 = $('#bPo'), b2 = $('#bTr');
      b1.hidden = !d.pos.awaitingApproval; b1.textContent = d.pos.awaitingApproval;
      b2.hidden = !d.transfers.toDispatch; b2.textContent = d.transfers.toDispatch;
    } catch (e) { /* badges are optional */ }
  }
  async function after(msg, hash) {
    toast(msg);
    refreshBadges();
    if (hash && location.hash !== hash) location.hash = hash; else render();
  }

  // ======================= dashboard =======================
  async function viewDashboard() {
    const d = await get('/dashboard');
    const runAct = d.todayRun ? '<a class="btn primary" href="#/plans/' + d.todayRun.id + '">Open today\'s plan</a>' : '<button class="primary" data-act="run">Run plan for ' + esc(day(d.today)) + '</button>';
    const attention = [];
    if (!d.todayRun) attention.push(['warn', 'No plan yet for ' + day(d.today, true) + '.', '<button class="sm" data-act="run">Run it now</button>']);
    else if (d.todayRun.status === 'DRAFT') attention.push(['warn', 'Today\'s plan is waiting for approval.', '<a href="#/plans/' + d.todayRun.id + '">Review</a>']);
    if (d.pos.awaitingApproval) attention.push(['warn', d.pos.awaitingApproval + ' purchase order' + (d.pos.awaitingApproval > 1 ? 's are' : ' is') + ' waiting for approval.', '<a href="#/pos?status=DRAFT">Review</a>']);
    d.pos.late.forEach(p => attention.push(['crit', 'Delivery ' + p.id + ' from ' + supName(p.supplier) + ' was due ' + day(p.expectedDate) + '.', '<a href="#/pos/' + p.id + '">Open</a>']));
    if (d.transfers.toDispatch) attention.push(['info', d.transfers.toDispatch + ' transfers are ready to dispatch.', '<a href="#/transfers?status=APPROVED">Open</a>']);
    if (d.transfers.inTransit) attention.push(['info', d.transfers.inTransit + ' transfers are on the way and not yet received.', '<a href="#/transfers?status=DISPATCHED">Open</a>']);
    if (d.production.planned) attention.push(['info', d.production.planned + ' kitchen production order waiting to be marked as made.', '<a href="#/production">Open</a>']);
    d.urgentItems.slice(0, 5).forEach(u => attention.push(['crit', u.name + ': main WH runs out in ' + (u.daysLeft === null ? '?' : nf1.format(u.daysLeft)) + ' days (' + u.supplier + ').', '<a href="#/items/' + u.item + '">Open</a>']));
    if (d.negatives) attention.push(['warn', d.negatives + ' stock balances are below zero. Count those items.', '<a href="#/stock?neg=1">Show</a>']);
    const stale = BOOT.locations.filter(l => { const last = d.lastCount[l.code]; return !last || (Date.parse(d.today) - Date.parse(last)) / 86400000 > 7; });
    if (stale.length) attention.push(['warn', stale.length + ' of ' + BOOT.locations.length + ' locations have not been counted in the last 7 days' + (stale.length <= 3 ? ': ' + stale.map(l => l.name).join(', ') : '') + '.', '<a href="#/stock">Count</a>']);

    const sales = Object.entries(d.salesByDay).map(([k, v]) => [day(k), v]);
    const waste = Object.entries(d.waste.byDay).map(([k, v]) => [day(k), v]);
    const salesWeek = Object.entries(d.salesByDay).slice(-7).reduce((a, e) => a + e[1], 0);
    main.innerHTML = header(day(d.today, true), 'Daily control for the main warehouse, central kitchen and ' + branches().length + ' branches.', runAct) +
      '<div class="grid g4">' +
      kpi('Waste, last 7 days', kmoney(d.waste.weekCost), nf1.format(salesWeek ? 100 * d.waste.weekCost / salesWeek : 0) + '% of sales value', d.waste.weekCost ? 'bad' : '', ['#/waste', 'See waste']) +
      kpi('Sold out, last 7 days', nf0.format(d.stockouts.weekUnits), 'units customers could not buy', d.stockouts.weekUnits ? 'bad' : '', ['#/waste?tab=out', 'See sold out']) +
      kpi('Open purchase orders', nf0.format(d.pos.open), kmoney(d.pos.openValue) + ' still to receive' + (d.pos.awaitingApproval ? ', ' + d.pos.awaitingApproval + ' to approve' : ''), '', ['#/pos', 'Open orders']) +
      kpi('Deliveries', nf0.format(d.transfers.toDispatch + d.transfers.inTransit), d.transfers.toDispatch + ' to dispatch, ' + d.transfers.inTransit + ' in transit', '', ['#/transfers', 'Open transfers']) +
      '</div>' +
      '<div class="grid g3">' +
      card('Needs attention', attention.length ? '<div class="list">' + attention.map(a => '<div class="row"><span style="display:flex;gap:8px;align-items:baseline"><i class="dot ' + a[0] + '"></i>' + esc(a[1]) + '</span>' + a[2] + '</div>').join('') + '</div>' : '<div class="empty">Nothing needs attention.</div>', { cls: 'span2' }) +
      card('Stock value', '<div class="list">' + BOOT.locations.map(l => '<div class="row"><span>' + esc(l.name) + '</span><span class="num">' + kmoney(d.stockValue[l.code] || 0) + '</span></div>').join('') + '</div>') +
      '</div>' +
      '<div class="grid g3">' +
      card('Sales, last 14 days', barChart(sales, money), { sub: 'Value at menu prices' }) +
      card('Waste by day', barChart(waste, money, { color: '--crit' }), { sub: 'Unsold fresh products and expired raw materials' }) +
      card('Most wasted', hbars(d.waste.topItems, money, 'crit'), { sub: 'Last 7 days, EGP' }) +
      '</div>' +
      card('Recent activity', table([
        { h: 'When', f: a => '<span class="num faint">' + esc(stamp(a.at)) + '</span>' },
        { h: 'Who', f: a => esc(a.user) },
        { h: 'What', f: a => esc(a.action) + (a.ref ? ' <span class="muted">' + esc(a.ref) + '</span>' : '') },
        { h: 'Detail', f: a => esc(a.detail), cls: () => 'wrap' }
      ], d.recent), { raw: true, actions: '<a href="#/log">Full activity log</a>' });
    bind({ run: () => runPlanDialog(d.today) });
  }

  function runPlanDialog(date) {
    dialog({
      title: 'Run the daily plan', submit: 'Run plan',
      body: '<p class="muted">The plan forecasts sales for each branch, breaks products into raw materials through the recipes, and works out deliveries, kitchen production and supplier orders from current stock. Nothing is sent until you approve it.</p>' +
        '<div class="field"><label for="pd">Delivery day</label><input type="date" id="pd" name="planDate" value="' + esc(date || BOOT.today) + '"></div>',
      onSubmit: async form => { const run = await send('/plans', { planDate: val(form, 'planDate') }); after('Plan ' + run.id + ' created', '#/plans/' + run.id); }
    });
  }

  // ======================= planning =======================
  async function viewPlans() {
    const p = await get('/plans?limit=60');
    main.innerHTML = header('Daily planning', 'Each run saves its forecast, recipe breakdown, deliveries, production and purchase suggestions. Approving a run creates the documents.', '<button class="primary" data-act="run">Run plan</button>') +
      card('Plan runs', table([
        { h: 'Plan', f: r => '<a href="#/plans/' + r.id + '">' + r.id + '</a>' },
        { h: 'Delivery day', f: r => esc(day(r.planDate)) },
        { h: 'Status', f: r => pill('plan', r.status) },
        { h: 'Run by', f: r => esc(r.createdBy) + ' <span class="faint num">' + esc(stamp(r.createdAt)) + '</span>' },
        { h: 'Approved by', f: r => esc(r.approvedBy) },
        { h: 'Fresh units', n: 1, f: r => nf0.format(r.freshUnits) },
        { h: 'Order lines', n: 1, f: r => nf0.format(r.poLines) },
        { h: 'Order value', n: 1, f: r => money(r.poValue) },
        { h: 'Changes', n: 1, f: r => r.overrides ? nf0.format(r.overrides) : '' }
      ], p.rows, { href: r => '#/plans/' + r.id, empty: 'No plans yet. Run the first one.' }), { raw: true });
    bind({ run: () => runPlanDialog() });
  }

  async function viewPlan(id, query) {
    const run = await get('/plans/' + encodeURIComponent(id));
    const draft = run.status === 'DRAFT';
    const tab = query.tab || 'summary';
    const branch = query.branch || 'ALL';
    const freshUnits = run.fresh.reduce((a, x) => a + x.send, 0);
    const poLines = run.purchasing.filter(x => x.orderQty > 0);
    const wasteCost = run.production.reduce((a, x) => a + x.expWasteCost, 0);
    const change = (kind, code, br, cur, unit) => draft ? ' <button class="sm link" data-act="ovr" data-kind="' + kind + '" data-code="' + esc(code) + '" data-branch="' + esc(br || '') + '" data-cur="' + cur + '" data-unit="' + esc(unit || '') + '">Change</button>' : '';
    const ovrMark = (kind, code, br) => run.overrides.some(o => o.kind === kind && o.code === code && (o.branch || '') === (br || '')) ? ' <span class="pill vio" title="Changed by hand">Changed</span>' : '';

    // Summary
    const docs = run.docs;
    const summary = '<div class="grid g4">' +
      kpi('Fresh products to branches', nf0.format(freshUnits), 'units from the central kitchen') +
      kpi('Raw material deliveries', nf0.format(run.branchRaw.filter(x => x.send > 0).length + run.ckTransfer.filter(x => x.send > 0).length), 'lines from the main WH') +
      kpi('Supplier orders', nf0.format(poLines.length), money(poLines.reduce((a, x) => a + x.value, 0))) +
      kpi('Expected leftover', money(wasteCost), 'fresh products likely unsold', 'bad') + '</div>' +
      (run.warnings.length ? card('Warnings', '<div class="grid" style="gap:6px">' + run.warnings.map(w => '<div class="alert"><i class="dot ' + (w.level === 'error' ? 'crit' : w.level === 'warn' ? 'warn' : 'info') + '"></i><span>' + esc(w.msg) + '</span></div>').join('') + '</div>') : '') +
      (docs ? card('Documents created on approval', '<div class="list">' +
        (docs.production ? '<div class="row"><span>Kitchen production</span><a href="#/production/' + docs.production + '">' + docs.production + '</a></div>' : '') +
        '<div class="row"><span>Transfers</span><span>' + docs.transfers.map(t => '<a href="#/transfers/' + t + '">' + t + '</a>').join(', ') + '</span></div>' +
        '<div class="row"><span>Purchase orders</span><span>' + (docs.pos.map(t => '<a href="#/pos/' + t + '">' + t + '</a>').join(', ') || 'none') + '</span></div></div>') : '') +
      card('Changes made by hand', table([
        { h: 'Line', f: o => esc(o.name) + (o.branch ? ' <span class="muted">at ' + esc(locName(o.branch)) + '</span>' : '') },
        { h: 'From', n: 1, f: o => q(o.from) }, { h: 'To', n: 1, f: o => '<b>' + q(o.to) + '</b>' },
        { h: 'Reason', f: o => esc(o.reason), cls: () => 'wrap' }, { h: 'By', f: o => esc(o.user) + ' <span class="faint num">' + esc(stamp(o.at)) + '</span>' }
      ], run.overrides, { empty: draft ? 'No changes. Use Change on any line in the other tabs, with a reason.' : 'No changes were made.' }), { raw: true, sub: 'Comparing these with actual sales and waste shows whether the plan or the people were right.' });

    // Forecast and recipes
    const exSel = query.p || (run.explosion.slice().sort((a, b) => b.lines.length - a.lines.length)[0] || {}).product;
    const ex = run.explosion.find(e => e.product === exSel);
    const forecast = '<div class="muted">Product forecast → recipe (BOM) → raw materials needed. Then safety stock, stock on hand and delivery days give the deliveries and orders.</div>' +
      card('Step 1. Product forecast for ' + day(run.planDate, true), table([
        { h: 'Product', f: d => '<a href="#/products/' + d.product + '">' + esc(d.name) + '</a>' }, { h: 'Made at', f: d => esc(MADE_AT[d.madeAt] || d.madeAt) },
        { h: 'Components', n: 1, f: d => d.components }, { h: 'Expected sales', n: 1, f: d => q(d.forecast) }, { h: 'Planned', n: 1, f: d => nf0.format(d.planned), cls: () => 'go' }
      ].concat(run.branches.map(b => ({ h: esc(locName(b.code)), n: 1, f: d => nf0.format(d.plannedByBranch[b.code] || 0) }))), run.demand), { raw: true, sub: 'Same weekday average over the last weeks. Kitchen products include the margin based buffer.' }) +
      card('Step 2. Break a product into raw materials', '<div class="bd"><div class="field" style="max-width:420px"><label for="exSel">Product</label><select id="exSel" data-change="exp">' + run.explosion.map(e => opt(e.product, e.name + ' (' + e.lines.length + ' raw materials)', exSel)).join('') + '</select></div>' +
        (ex ? '<p><b>' + esc(ex.name) + '</b> <span class="muted">made at ' + esc((MADE_AT[ex.madeAt] || '').toLowerCase()) + ', ' + nf0.format(ex.planned) + ' planned</span></p>' : '') + '</div>' +
        (ex ? table([
          { h: 'Raw material', f: l => esc(l.name) }, { h: 'Through', f: l => l.via ? esc(l.via) : '<span class="faint">Direct</span>' },
          { h: 'Per unit', n: 1, f: l => nf4.format(l.qtyPer) }, { h: '× Planned', n: 1, f: () => nf0.format(ex.planned) }, { h: '= Needed', n: 1, f: l => q(l.need, l.unit), cls: () => 'go' },
          { h: 'Unit', f: l => esc(l.unit) }, { h: 'Cost per unit', n: 1, f: l => nf2.format(l.cost) }
        ], ex.lines, { foot: '<tr class="tot"><td colspan="6">Recipe cost per unit</td><td class="n">' + nf2.format(ex.lines.reduce((a, l) => a + l.cost, 0)) + '</td></tr>' }) : ''), { raw: true }) +
      card('Step 3. Total raw materials needed', table([
        { h: 'Raw material', f: r => '<a href="#/items/' + r.item + '">' + esc(r.name) + '</a>' }, { h: 'Unit', f: r => esc(r.unit) },
        { h: 'For kitchen products', n: 1, f: r => q(r.ck, r.unit), cls: r => r.ck ? '' : 'zero' }, { h: 'For branch drinks', n: 1, f: r => q(r.branch, r.unit), cls: r => r.branch ? '' : 'zero' },
        { h: 'Total', n: 1, f: r => q(r.total, r.unit), cls: () => 'go' }, { h: 'Main WH on hand', n: 1, f: r => q(r.mainOnHand, r.unit) }, { h: 'Value', n: 1, f: r => money(r.value) }
      ], run.requirements), { raw: true, sub: 'Usage only, before safety stock and stock on hand.' });

    // Deliveries
    const bchips = '<div class="chips">' + [['ALL', 'All branches']].concat(run.branches.map(b => [b.code, locName(b.code)])).map(b => '<button data-act="br" data-b="' + b[0] + '" aria-pressed="' + (b[0] === branch) + '">' + esc(b[1]) + '</button>').join('') + '</div>';
    let deliveries;
    if (branch === 'ALL') {
      const itemsInRun = Array.from(new Map(run.branchRaw.map(r => [r.item, r])).values()).sort((a, b) => a.name.localeCompare(b.name));
      deliveries = bchips + card('Fresh products from the kitchen', table([{ h: 'Product', f: p => esc(p.name) }].concat(run.branches.map(b => ({ h: esc(locName(b.code)), n: 1, f: p => nf0.format(p.byBranch[b.code] || 0) })), [{ h: 'Total', n: 1, f: p => nf0.format(p.total), cls: () => 'go' }]), run.production), { raw: true, actions: '<button class="sm" data-act="copyFresh">Copy for Excel</button>' }) +
        card('Raw materials from the main WH', table([{ h: 'Raw material', f: r => esc(r.name) }, { h: 'Unit', f: r => esc(r.unit) }].concat(run.branches.map(b => ({
          h: esc(locName(b.code)) + (b.delivers ? '' : '<br><span class="faint" style="text-transform:none">no delivery</span>'), n: 1,
          f: r => { const c = run.branchRaw.find(x => x.branch === b.code && x.item === r.item); return c ? q(c.send, c.unit) : '·'; },
          cls: r => { const c = run.branchRaw.find(x => x.branch === b.code && x.item === r.item); return !c || !c.send ? 'zero' : c.short > 0 ? 'neg' : ''; }
        }))), itemsInRun), { raw: true, sub: 'Red means the main WH did not have enough.', actions: '<button class="sm" data-act="copyRaw">Copy for Excel</button>' });
    } else {
      const b = run.branches.find(x => x.code === branch) || {};
      deliveries = bchips + card(esc(locName(branch)) + ': fresh products', table([
        { h: 'Product', f: r => esc(r.name) + ovrMark('fresh', r.product, branch) }, { h: 'Expected sales', n: 1, f: r => q(r.forecast) }, { h: 'Target', n: 1, f: r => nf0.format(r.serviceLevel * 100) + '%' },
        { h: 'Send', n: 1, f: r => nf0.format(r.send) + change('fresh', r.product, branch, r.send, 'pcs'), cls: () => 'go' },
        { h: 'Likely leftover', n: 1, f: r => q(r.expWaste) }, { h: 'Likely missed sales', n: 1, f: r => q(r.expLostSales) }
      ], run.fresh.filter(r => r.branch === branch)), { raw: true, sub: 'Target is the chance of not selling out, set from each product\'s margin.' }) +
        card(esc(locName(branch)) + ': raw materials', table([
          { h: 'Raw material', f: r => esc(r.name) + ovrMark('branchRaw', r.item, branch) }, { h: 'Unit', f: r => esc(r.unit) },
          { h: 'Use until next delivery', n: 1, f: r => q(r.forecast, r.unit) }, { h: 'Safety stock', n: 1, f: r => q(r.safety, r.unit) }, { h: 'Target', n: 1, f: r => q(r.target, r.unit) },
          { h: 'On hand', n: 1, f: r => q(r.onHand, r.unit), cls: r => r.onHand < 0 ? 'neg' : '' }, { h: 'In transit', n: 1, f: r => q(r.inTransit, r.unit) },
          { h: 'Send', n: 1, f: r => q(r.send, r.unit) + change('branchRaw', r.item, branch, r.send, r.unit), cls: r => r.send ? 'go' : 'zero' },
          { h: '', f: r => r.short > 0 ? '<span class="pill crit">Short ' + q(r.short, r.unit) + '</span>' : '' }
        ], run.branchRaw.filter(r => r.branch === branch), { empty: 'Nothing to send.' }), { raw: true, sub: b.delivers ? 'Covers ' + b.coverDays + ' day' + (b.coverDays > 1 ? 's' : '') + ' until the next delivery (' + esc(b.deliveryText) + ').' : 'No raw material delivery to this branch on this day.' });
    }

    // Kitchen
    const kitchen = '<div class="grid g2">' + card('Production plan', table([
      { h: 'Product', f: r => esc(r.name) }, { h: 'Make', n: 1, f: r => nf0.format(r.total), cls: () => 'go' }, { h: 'Target', n: 1, f: r => nf0.format(r.serviceLevel * 100) + '%' },
      { h: 'Recipe cost', n: 1, f: r => nf2.format(r.unitCost) }, { h: 'Likely leftover', n: 1, f: r => q(r.expWaste) }, { h: 'Leftover cost', n: 1, f: r => money(r.expWasteCost) }
    ], run.production), { raw: true, sub: 'Sum of all branch plans. Change a branch quantity under Deliveries.' }) +
      card('Raw materials to send to the kitchen', table([
        { h: 'Raw material', f: r => esc(r.name) + ovrMark('ckTransfer', r.item) }, { h: 'Unit', f: r => esc(r.unit) }, { h: 'Needed', n: 1, f: r => q(r.need, r.unit) },
        { h: 'At kitchen', n: 1, f: r => q(r.onHand, r.unit) }, { h: 'Send', n: 1, f: r => q(r.send, r.unit) + change('ckTransfer', r.item, '', r.send, r.unit), cls: r => r.send ? 'go' : 'zero' },
        { h: '', f: r => r.short > 0 ? '<span class="pill crit">Short ' + q(r.short, r.unit) + '</span>' : '' }
      ], run.ckTransfer), { raw: true }) + '</div>';

    // Purchasing
    const allBuy = query.all === '1';
    const buyRows = run.purchasing.filter(x => allBuy || x.orderQty > 0);
    const purchasing = '<div class="chips"><button data-act="buyAll" data-v="0" aria-pressed="' + !allBuy + '">Only items to order</button><button data-act="buyAll" data-v="1" aria-pressed="' + allBuy + '">All items</button></div>' +
      card('Supplier orders', table([
        { h: 'Supplier', f: r => esc(r.supplier) }, { h: 'Raw material', f: r => '<a href="#/items/' + r.item + '">' + esc(r.name) + '</a>' + ovrMark('po', r.item) }, { h: 'Use per day', n: 1, f: r => q(r.dailyAvg, r.unit) },
        { h: 'Lead time', n: 1, f: r => r.leadTimeDays + ' d' }, { h: 'On hand', n: 1, f: r => q(r.onHand, r.unit) }, { h: 'On order', n: 1, f: r => q(r.onOrder, r.unit) },
        { h: 'Days left', n: 1, f: r => r.daysLeft === null ? '–' : nf1.format(r.daysLeft) }, { h: 'Reorder at', n: 1, f: r => q(r.reorderPoint, r.unit) }, { h: 'Order up to', n: 1, f: r => q(r.orderUpTo, r.unit) },
        { h: 'Order', n: 1, f: r => q(r.orderQty, r.unit) + change('po', r.item, '', r.orderQty, r.unit), cls: r => r.orderQty ? 'go' : 'zero' }, { h: 'Value', n: 1, f: r => r.value ? money(r.value) : '' },
        { h: 'Status', f: r => pill('buy', r.status) }
      ], buyRows, { empty: 'Nothing to order. Every item is above its reorder point.' }), { raw: true, sub: 'Approving the plan creates one draft purchase order per supplier.' });

    const tabList = [['summary', 'Summary'], ['forecast', 'Forecast and recipes'], ['deliveries', 'Branch deliveries'], ['kitchen', 'Kitchen'], ['buy', 'Supplier orders']];
    const panes = { summary, forecast, deliveries, kitchen, buy: purchasing };
    main.innerHTML = header('Plan ' + esc(run.id) + ' ' + pill('plan', run.status), 'Delivery day ' + esc(day(run.planDate, true)) + '. Run by ' + esc(run.createdBy) + ' on ' + esc(stamp(run.createdAt)) + (run.approvedBy ? '. Approved by ' + esc(run.approvedBy) + ' on ' + esc(stamp(run.approvedAt)) : '') + '. Sales history ' + esc(run.historyFrom) + ' to ' + esc(run.historyTo) + '.',
      draft ? '<button class="primary" data-act="approve">Approve and create documents</button>' : '', '<a href="#/plans">Daily planning</a>') +
      steps(['Run', 'Review and change', 'Approved'], draft ? 'Review and change' : run.status === 'APPROVED' ? 'Approved' : 'Run') +
      tabs('plan', tabList, tab) + tabList.map(t => '<div data-pane="plan" data-name="' + t[0] + '" class="grid"' + (t[0] === tab ? '' : ' hidden') + '>' + panes[t[0]] + '</div>').join('');

    const go = o => { location.hash = '#/plans/' + run.id + qs(Object.assign({ tab: currentTab() }, query, o)); };
    const currentTab = () => (($('[data-tabs="plan"][aria-selected="true"]', main) || {}).getAttribute ? $('[data-tabs="plan"][aria-selected="true"]', main).getAttribute('data-tab') : tab);
    bind({
      approve: () => dialog({
        title: 'Approve plan ' + run.id, submit: 'Approve',
        body: '<p>This creates the kitchen production order, one transfer per branch and for the kitchen, and one draft purchase order per supplier (' + poLines.length + ' lines, ' + money(poLines.reduce((a, x) => a + x.value, 0)) + ').</p><p class="muted">' + run.overrides.length + ' lines were changed by hand.</p>',
        onSubmit: async () => { await send('/plans/' + run.id + '/approve'); after('Plan approved. Documents created.', '#/plans/' + run.id + '?tab=summary'); }
      }),
      ovr: btn => dialog({
        title: 'Change quantity', submit: 'Save change',
        body: '<div class="form"><div class="field"><label for="oq">New quantity (' + esc(btn.dataset.unit) + ')</label><input id="oq" name="qty" type="number" step="any" min="0" value="' + esc(btn.dataset.cur) + '" required></div>' +
          '<div class="field" style="grid-column:1/-1"><label for="or">Reason</label><input id="or" name="reason" required placeholder="For example: event nearby, supplier promo, branch closed early"></div></div><p class="muted">The plan suggested ' + esc(btn.dataset.cur) + '. Your change and reason are saved with the plan.</p>',
        onSubmit: async form => {
          await send('/plans/' + run.id + '/override', { kind: btn.dataset.kind, code: btn.dataset.code, branch: btn.dataset.branch, qty: val(form, 'qty'), reason: val(form, 'reason') });
          toast('Change saved'); go({ tab: currentTab() });
        }
      }),
      br: btn => go({ tab: 'deliveries', branch: btn.dataset.b }),
      buyAll: btn => go({ tab: 'buy', all: btn.dataset.v }),
      exp: sel => go({ tab: 'forecast', p: sel.value }),
      copyFresh: () => copyRows([['Product'].concat(run.branches.map(b => locName(b.code)), ['Total'])].concat(run.production.map(p => [p.name].concat(run.branches.map(b => p.byBranch[b.code] || 0), [p.total])))),
      copyRaw: () => {
        const items = Array.from(new Map(run.branchRaw.map(r => [r.item, r])).values());
        copyRows([['Raw material', 'Unit'].concat(run.branches.map(b => locName(b.code)))].concat(items.map(r => [r.name, r.unit].concat(run.branches.map(b => { const c = run.branchRaw.find(x => x.branch === b.code && x.item === r.item); return c ? c.send : 0; })))));
      }
    });
  }

  // ======================= production =======================
  async function viewProductionList() {
    const p = await get('/production?limit=60');
    main.innerHTML = header('Kitchen production', 'Production orders come from approved plans. Marking an order as made uses up its raw materials at the kitchen through the recipes.') +
      card('', table([
        { h: 'Order', f: r => '<a href="#/production/' + r.id + '">' + r.id + '</a>' }, { h: 'Day', f: r => esc(day(r.date)) }, { h: 'Status', f: r => pill('prd', r.status) },
        { h: 'Products', n: 1, f: r => r.products }, { h: 'Planned units', n: 1, f: r => nf0.format(r.units) }, { h: 'Made', n: 1, f: r => r.made ? nf0.format(r.made) : '' },
        { h: 'From plan', f: r => r.plan ? '<a href="#/plans/' + r.plan + '">' + r.plan + '</a>' : '' }
      ], p.rows, { href: r => '#/production/' + r.id }), { raw: true });
  }
  async function viewProduction(id) {
    const p = await get('/production/' + encodeURIComponent(id));
    const open = p.status === 'PLANNED';
    main.innerHTML = header('Production ' + esc(p.id) + ' ' + pill('prd', p.status), 'For ' + esc(day(p.date, true)) + (p.plan ? ', from plan <a href="#/plans/' + p.plan + '">' + p.plan + '</a>' : '') + '.',
      open ? '<button data-act="cancel">Cancel</button><button class="primary" data-act="done">Mark as made</button>' : '', '<a href="#/production">Kitchen production</a>') +
      '<div class="grid g2">' + card('Products', table([
        { h: 'Product', f: l => '<a href="#/products/' + l.product + '">' + esc(l.name) + '</a>' }, { h: 'Planned', n: 1, f: l => nf0.format(l.qty) },
        { h: 'Made', n: 1, f: l => open ? '<input class="qty" type="number" min="0" step="1" data-prod="' + esc(l.product) + '" value="' + l.qty + '" aria-label="Made">' : nf0.format(l.made || 0) }
      ], p.lines), { raw: true }) + card('History', timeline(p.history)) + '</div>';
    bind({
      done: async () => {
        const lines = $$('[data-prod]', main).map(i => ({ product: i.dataset.prod, qty: i.value }));
        await send('/production/' + p.id + '/action', { action: 'complete', lines });
        after('Production recorded. Raw materials used at the kitchen.');
      },
      cancel: () => dialog({ title: 'Cancel production ' + p.id, submit: 'Cancel order', danger: true, body: '<div class="field"><label for="cn">Reason</label><input id="cn" name="note" required></div>', onSubmit: async f => { await send('/production/' + p.id + '/action', { action: 'cancel', note: val(f, 'note') }); after('Production cancelled'); } })
    });
  }

  // ======================= purchase orders =======================
  async function viewPOs(_q) {
    const query = _q || {};
    const status = query.status || '';
    const p = await get('/pos' + qs({ status, supplier: query.supplier || '', limit: 300 }));
    const chips = [['', 'All'], ['DRAFT', 'Awaiting approval'], ['APPROVED', 'Approved'], ['SENT,PARTIAL', 'Open with supplier'], ['RECEIVED,CLOSED', 'Received'], ['CANCELLED', 'Cancelled']];
    main.innerHTML = header('Purchase orders', 'Full history of every order: who created it, approved it, sent it and received it.', '<button data-act="copy">Copy list for Excel</button><button class="primary" data-act="new">New purchase order</button>') +
      '<div class="filters"><div class="chips">' + chips.map(c => '<button data-act="st" data-s="' + c[0] + '" aria-pressed="' + (c[0] === status) + '">' + c[1] + '</button>').join('') + '</div>' +
      '<div class="field"><label for="sup">Supplier</label><select id="sup" data-change="sup">' + opt('', 'All suppliers', query.supplier) + BOOT.suppliers.map(s => opt(s.code, s.name, query.supplier)).join('') + '</select></div></div>' +
      card('', table([
        { h: 'Order', f: r => '<a href="#/pos/' + r.id + '">' + r.id + '</a>' }, { h: 'Supplier', f: r => esc(r.supplierName) }, { h: 'Status', f: r => pill('po', r.status) },
        { h: 'Created', f: r => '<span class="num">' + esc(stamp(r.createdAt)) + '</span> ' + esc(r.createdBy) }, { h: 'Expected', f: r => esc(day(r.expectedDate)), cls: r => (r.status === 'SENT' || r.status === 'PARTIAL') && r.expectedDate < BOOT.today ? 'neg' : '' },
        { h: 'Oracle PO', f: r => esc(r.oracleRef) }, { h: 'Lines', n: 1, f: r => r.lines }, { h: 'Value', n: 1, f: r => money(r.value) }, { h: 'Received', n: 1, f: r => r.receivedPct + '%' },
        { h: 'Plan', f: r => r.plan ? '<a href="#/plans/' + r.plan + '">' + r.plan + '</a>' : '<span class="faint">Manual</span>' }
      ], p.rows, { href: r => '#/pos/' + r.id, empty: 'No purchase orders match.' }), { raw: true });
    const go = o => { location.hash = '#/pos' + qs(Object.assign({}, query, o)); };
    bind({
      st: b => go({ status: b.dataset.s }), sup: s => go({ supplier: s.value }),
      copy: () => copyRows([['Order', 'Supplier', 'Status', 'Created', 'Expected', 'Oracle PO', 'Lines', 'Value', 'Received %']].concat(p.rows.map(r => [r.id, r.supplierName, r.status, r.createdAt.slice(0, 10), r.expectedDate, r.oracleRef, r.lines, r.value, r.receivedPct]))),
      new: () => newPODialog()
    });
  }
  function newPODialog() {
    const lineRow = () => '<tr><td><select name="item">' + opt('', 'Choose…') + BOOT.items.filter(i => i.active !== false).map(i => opt(i.code, i.name + ' (' + i.unit + ')')).join('') + '</select></td><td><input class="qty" name="qty" type="number" step="any" min="0"></td><td><button type="button" class="sm" data-rm>Remove</button></td></tr>';
    dialog({
      title: 'New purchase order', submit: 'Create draft',
      body: '<div class="form"><div class="field"><label for="ps">Supplier</label><select id="ps" name="supplier" required>' + opt('', 'Choose…') + BOOT.suppliers.filter(s => s.active !== false).map(s => opt(s.code, s.name)).join('') + '</select></div>' +
        '<div class="field"><label for="pe">Expected delivery</label><input id="pe" type="date" name="expectedDate"></div></div>' +
        '<div class="tw"><table><thead><tr><th>Raw material</th><th class="n">Quantity</th><th></th></tr></thead><tbody id="pl">' + lineRow() + lineRow() + '</tbody></table></div><div><button type="button" class="sm" data-add>Add line</button></div>',
      init: f => {
        $('[data-add]', f).onclick = () => $('#pl', f).insertAdjacentHTML('beforeend', lineRow());
        f.addEventListener('click', e => { if (e.target.matches('[data-rm]')) e.target.closest('tr').remove(); });
        f.elements.supplier.onchange = () => {
          const sup = f.elements.supplier.value;
          $$('select[name=item]', f).forEach(s => { Array.from(s.options).forEach(o => { const it = itemOf(o.value); o.hidden = !!(it && sup && it.supplier !== sup); }); });
        };
      },
      onSubmit: async f => {
        const lines = $$('#pl tr', f).map(tr => ({ item: $('[name=item]', tr).value, qty: $('[name=qty]', tr).value })).filter(l => l.item && l.qty);
        const po = await send('/pos', { supplier: val(f, 'supplier'), expectedDate: val(f, 'expectedDate'), lines });
        after('Purchase order ' + po.id + ' created', '#/pos/' + po.id);
      }
    });
  }
  async function viewPO(id) {
    const po = await get('/pos/' + encodeURIComponent(id));
    const s = po.status;
    const value = po.lines.reduce((a, l) => a + l.qty * l.unitCost, 0);
    const acts = [];
    if (s === 'DRAFT') acts.push('<button data-act="edit">Edit quantities</button>', '<button class="primary" data-act="a" data-a="approve">Approve</button>');
    if (s === 'APPROVED') acts.push('<button class="primary" data-act="sendpo">Mark as sent</button>');
    if (s === 'SENT' || s === 'PARTIAL') acts.push('<button class="primary" data-act="receive">Receive delivery</button>');
    if (s === 'PARTIAL') acts.push('<button data-act="a" data-a="close">Close short</button>');
    if (['DRAFT', 'APPROVED', 'SENT'].indexOf(s) >= 0) acts.push('<button class="danger" data-act="cancel">Cancel</button>');
    acts.unshift('<button data-act="copy">Copy for Oracle</button>');
    const flow = ['Draft', 'Approved', 'Sent', 'Received'];
    const now = { DRAFT: 'Draft', APPROVED: 'Approved', SENT: 'Sent', PARTIAL: 'Sent', RECEIVED: 'Received', CLOSED: 'Received', CANCELLED: '' }[s];
    main.innerHTML = header('Purchase order ' + esc(po.id) + ' ' + pill('po', s), esc(po.supplierName) + '. Expected ' + esc(day(po.expectedDate, true)) + (po.oracleRef ? '. Oracle PO ' + esc(po.oracleRef) : '') + (po.plan ? '. From plan <a href="#/plans/' + po.plan + '">' + po.plan + '</a>' : '') + '.', acts.join(''), '<a href="#/pos">Purchase orders</a>') +
      (now ? steps(flow, now) : '') +
      '<div class="grid g3">' + card('Lines', table([
        { h: 'Raw material', f: l => '<a href="#/items/' + l.item + '">' + esc(l.name) + '</a>' }, { h: 'Unit', f: l => esc(l.unit) }, { h: 'Ordered', n: 1, f: l => q(l.qty, l.unit) },
        { h: 'Received', n: 1, f: l => q(l.received || 0, l.unit), cls: l => (l.received || 0) >= l.qty ? 'pos' : (l.received ? 'neg' : 'zero') }, { h: 'Unit cost', n: 1, f: l => nf2.format(l.unitCost) }, { h: 'Value', n: 1, f: l => money(l.qty * l.unitCost) }
      ], po.lines, { foot: '<tr class="tot"><td colspan="5">Total</td><td class="n">' + money(value) + '</td></tr>' }), { raw: true, cls: 'span2' }) +
      card('History', timeline(po.history)) + '</div>';
    const act = async (body, msg) => { await send('/pos/' + po.id + '/action', body); after(msg); };
    bind({
      a: b => act({ action: b.dataset.a }, b.dataset.a === 'approve' ? 'Approved' : 'Closed short'),
      copy: () => copyRows([['Supplier', 'Item code', 'Oracle item', 'Description', 'UOM', 'Quantity', 'Unit price', 'Need by date']].concat(po.lines.map(l => { const it = itemOf(l.item) || {}; return [po.supplierName, l.item, it.oracleCode || '', l.name, l.unit, l.qty, l.unitCost, po.expectedDate]; }))),
      sendpo: () => dialog({ title: 'Mark ' + po.id + ' as sent', submit: 'Mark as sent', body: '<div class="field"><label for="or">Oracle PO number</label><input id="or" name="oracleRef" placeholder="Optional"></div><p class="muted">Use Copy for Oracle to paste the lines into Oracle, then record the Oracle PO number here.</p>', onSubmit: async f => act({ action: 'send', oracleRef: val(f, 'oracleRef') }, 'Marked as sent') }),
      cancel: () => dialog({ title: 'Cancel ' + po.id, submit: 'Cancel order', danger: true, body: '<div class="field"><label for="cn">Reason</label><input id="cn" name="note" required></div>', onSubmit: async f => act({ action: 'cancel', note: val(f, 'note') }, 'Cancelled') }),
      edit: () => dialog({
        title: 'Edit ' + po.id, body: '<div class="field" style="max-width:220px"><label for="ed">Expected delivery</label><input id="ed" type="date" name="expectedDate" value="' + esc(po.expectedDate) + '"></div>' + table([{ h: 'Raw material', f: l => esc(l.name) }, { h: 'Quantity', n: 1, f: l => '<input class="qty" type="number" step="any" min="0" data-item="' + esc(l.item) + '" value="' + l.qty + '"> ' + esc(l.unit) }], po.lines) + '<p class="muted">Set a line to 0 to remove it.</p>',
        onSubmit: async f => act({ action: 'edit', expectedDate: val(f, 'expectedDate'), lines: $$('[data-item]', f).map(i => ({ item: i.dataset.item, qty: i.value })) }, 'Order updated')
      }),
      receive: () => dialog({
        title: 'Receive delivery for ' + po.id, submit: 'Post receipt',
        body: '<div class="form"><div class="field"><label for="rd">Received on</label><input id="rd" type="date" name="date" value="' + esc(BOOT.today) + '"></div><div class="field"><label for="rn">Note</label><input id="rn" name="note" placeholder="Optional, for example invoice number"></div></div>' +
          table([{ h: 'Raw material', f: l => esc(l.name) }, { h: 'Still to come', n: 1, f: l => q(l.qty - (l.received || 0), l.unit) }, { h: 'Received now', n: 1, f: l => '<input class="qty" type="number" step="any" min="0" data-item="' + esc(l.item) + '" value="' + Math.max(0, +(l.qty - (l.received || 0)).toFixed(3)) + '"> ' + esc(l.unit) }], po.lines) +
          '<p class="muted">Receiving adds the quantities to the main warehouse in the stock ledger.</p>',
        onSubmit: async f => act({ action: 'receive', date: val(f, 'date'), note: val(f, 'note'), lines: $$('[data-item]', f).map(i => ({ item: i.dataset.item, qty: i.value })) }, 'Receipt posted')
      })
    });
  }

  // ======================= transfers =======================
  async function viewTransfers(query) {
    const status = query.status === undefined ? 'APPROVED,DISPATCHED' : query.status;
    const p = await get('/transfers' + qs({ status, to: query.to || '', limit: 300 }));
    const chips = [['APPROVED,DISPATCHED', 'Open'], ['APPROVED', 'To dispatch'], ['DISPATCHED', 'In transit'], ['RECEIVED', 'Received'], ['', 'All']];
    main.innerHTML = header('Transfers', 'Deliveries from the main warehouse and the kitchen to branches, and raw materials to the kitchen. Dispatch takes stock out; receiving adds it at the destination.', '<button data-act="dispAll">Dispatch all ready</button>') +
      '<div class="filters"><div class="chips">' + chips.map(c => '<button data-act="st" data-s="' + c[0] + '" aria-pressed="' + (c[0] === status) + '">' + c[1] + '</button>').join('') + '</div>' +
      '<div class="field"><label for="to">Destination</label><select id="to" data-change="to">' + locOptions(query.to || '', l => l.type !== 'MAIN', 'All destinations') + '</select></div></div>' +
      card('', table([
        { h: 'Transfer', f: r => '<a href="#/transfers/' + r.id + '">' + r.id + '</a>' }, { h: 'Day', f: r => esc(day(r.date)) }, { h: 'To', f: r => esc(r.toName) },
        { h: 'Status', f: r => pill('tr', r.status) }, { h: 'Raw material lines', n: 1, f: r => r.items }, { h: 'Fresh units', n: 1, f: r => r.fresh ? nf0.format(r.fresh) : '' },
        { h: 'Plan', f: r => r.plan ? '<a href="#/plans/' + r.plan + '">' + r.plan + '</a>' : '' }
      ], p.rows, { href: r => '#/transfers/' + r.id, empty: 'No transfers match.' }), { raw: true });
    const go = o => { location.hash = '#/transfers' + qs(Object.assign({}, query, o)); };
    bind({
      st: b => go({ status: b.dataset.s }), to: s => go({ to: s.value }),
      dispAll: async () => {
        const ready = p.rows.filter(r => r.status === 'APPROVED');
        if (!ready.length) return toast('Nothing is ready to dispatch.');
        for (const r of ready) await send('/transfers/' + r.id + '/action', { action: 'dispatch' });
        after(ready.length + ' transfers dispatched');
      }
    });
  }
  async function viewTransfer(id) {
    const t = await get('/transfers/' + encodeURIComponent(id));
    const s = t.status;
    const acts = [];
    if (s === 'APPROVED') acts.push('<button class="danger" data-act="cancel">Cancel</button><button class="primary" data-act="disp">Dispatch</button>');
    if (s === 'DISPATCHED') acts.push('<button class="primary" data-act="recv">Receive at ' + esc(t.toName) + '</button>');
    acts.unshift('<button data-act="copy">Copy pick list</button>');
    main.innerHTML = header('Transfer ' + esc(t.id) + ' ' + pill('tr', s), esc(t.fromName) + ' to ' + esc(t.toName) + ', ' + esc(day(t.date, true)) + (t.plan ? '. From plan <a href="#/plans/' + t.plan + '">' + t.plan + '</a>' : '') + '.', acts.join(''), '<a href="#/transfers">Transfers</a>') +
      steps(['To dispatch', 'In transit', 'Received'], { APPROVED: 'To dispatch', DISPATCHED: 'In transit', RECEIVED: 'Received' }[s] || '') +
      '<div class="grid g3">' + card('Lines', table([
        { h: 'Line', f: l => esc(l.name) + (l.kind === 'product' ? ' <span class="pill vio">Fresh</span>' : '') }, { h: 'Unit', f: l => esc(l.unit) },
        { h: 'Planned', n: 1, f: l => q(l.planned, l.unit) }, { h: 'Sent', n: 1, f: l => s === 'APPROVED' ? '' : q(l.qty, l.unit) },
        { h: 'Received', n: 1, f: l => l.received === undefined ? '' : q(l.received, l.unit), cls: l => l.received !== undefined && l.received < l.qty ? 'neg' : '' }
      ], t.lines), { raw: true, cls: 'span2' }) + card('History', timeline(t.history)) + '</div>';
    const qtyDialog = (title, field, submit, action, msg) => dialog({
      title, submit,
      body: table([{ h: 'Line', f: l => esc(l.name) }, { h: field, n: 1, f: l => '<input class="qty" type="number" step="any" min="0" data-code="' + esc(l.code) + '" data-kind="' + l.kind + '" value="' + l.qty + '"> ' + esc(l.unit) }], t.lines) +
        '<div class="field"><label for="tn">Note</label><input id="tn" name="note" placeholder="Optional"></div>',
      onSubmit: async f => { await send('/transfers/' + t.id + '/action', { action, note: val(f, 'note'), lines: $$('[data-code]', f).map(i => ({ code: i.dataset.code, kind: i.dataset.kind, qty: i.value })) }); after(msg); }
    });
    bind({
      disp: () => qtyDialog('Dispatch ' + t.id, 'Quantity sent', 'Dispatch', 'dispatch', 'Dispatched'),
      recv: () => qtyDialog('Receive ' + t.id + ' at ' + t.toName, 'Quantity received', 'Post receipt', 'receive', 'Received'),
      cancel: () => dialog({ title: 'Cancel ' + t.id, submit: 'Cancel transfer', danger: true, body: '<div class="field"><label for="cn">Reason</label><input id="cn" name="note" required></div>', onSubmit: async f => { await send('/transfers/' + t.id + '/action', { action: 'cancel', note: val(f, 'note') }); after('Cancelled'); } }),
      copy: () => copyRows([['Transfer', 'To', 'Line', 'Unit', 'Quantity']].concat(t.lines.map(l => [t.id, t.toName, l.name, l.unit, l.qty])))
    });
  }

  // ======================= stock =======================
  async function viewStock(query) {
    const sv = await get('/stock');
    const s = (query.q || '').toLowerCase();
    const cat = query.cat || '';
    const negOnly = query.neg === '1';
    const showValue = query.v === '1';
    const cats = Array.from(new Set(BOOT.items.map(i => i.category).filter(Boolean))).sort();
    const rows = sv.rows.filter(r => {
      const it = itemOf(r.code) || {};
      return (!s || (r.name + ' ' + r.code + ' ' + (it.oracleCode || '')).toLowerCase().indexOf(s) >= 0) && (!cat || it.category === cat) && (!negOnly || Object.values(r.byLocation).some(v => v < -1e-6));
    });
    const locs = BOOT.locations;
    const cell = (r, l) => showValue ? nf0.format(Math.max(0, r.byLocation[l]) * (r.unitCost || 0)) : q(r.byLocation[l], r.unit);
    main.innerHTML = header('Stock on hand', 'Live balance per location, calculated from every movement in the stock ledger: receipts, transfers, use by sales and production, waste and counts.', '<button data-act="waste">Record waste</button><button class="primary" data-act="count">Count stock</button>') +
      (sv.negatives.length ? '<div class="alert"><i class="dot crit"></i><span>' + sv.negatives.length + ' balances are below zero. More was used than the system knew about: a delivery was not received, a recipe is wrong, or the last count was off. Count these items.</span> <a href="#/stock?neg=1">Show them</a></div>' : '') +
      '<div class="filters"><div class="field"><label for="sq">Search</label><input id="sq" data-change="q" value="' + esc(query.q || '') + '" placeholder="Name or code"></div>' +
      '<div class="field"><label for="sc">Category</label><select id="sc" data-change="cat">' + opt('', 'All categories', cat) + cats.map(c => opt(c, c, cat)).join('') + '</select></div>' +
      '<div class="chips"><button data-act="v" data-v="0" aria-pressed="' + !showValue + '">Quantities</button><button data-act="v" data-v="1" aria-pressed="' + showValue + '">Value (EGP)</button>' + (negOnly ? '<button data-act="clearNeg" aria-pressed="true">Below zero only ✕</button>' : '') + '</div></div>' +
      card('', table([
        { h: 'Raw material', f: r => '<a href="#/items/' + r.code + '">' + esc(r.name) + '</a>' }, { h: 'Unit', f: r => esc(r.unit) }
      ].concat(locs.map(l => ({ h: esc(l.name) + '<br><span class="faint" style="text-transform:none">counted ' + (sv.lastCount[l.code] ? esc(day(sv.lastCount[l.code])) : 'never') + '</span>', n: 1, f: r => cell(r, l.code), cls: r => r.byLocation[l.code] < -1e-6 ? 'neg' : (Math.abs(r.byLocation[l.code]) < 1e-9 ? 'zero' : '') })),
        [{ h: 'Total', n: 1, f: r => showValue ? nf0.format(r.value) : q(r.total, r.unit), cls: () => 'strong' }]), rows, {
        foot: '<tr class="tot"><td colspan="2">Value</td>' + locs.map(l => '<td class="n">' + kmoney(sv.valueByLocation[l.code]) + '</td>').join('') + '<td class="n">' + kmoney(Object.values(sv.valueByLocation).reduce((a, b) => a + b, 0)) + '</td></tr>'
      }), { raw: true });
    const go = o => { location.hash = '#/stock' + qs(Object.assign({}, query, o)); };
    bind({
      q: i => go({ q: i.value }), cat: s2 => go({ cat: s2.value }), v: b => go({ v: b.dataset.v }), clearNeg: () => go({ neg: '' }),
      count: () => countDialog(sv), waste: () => wasteDialog()
    });
  }
  function countDialog(sv) {
    const body = (loc) => table([
      { h: 'Raw material', f: r => esc(r.name) }, { h: 'System', n: 1, f: r => q(r.byLocation[loc], r.unit) + ' ' + esc(r.unit) },
      { h: 'Counted', n: 1, f: r => '<input class="qty" type="number" step="any" min="0" data-item="' + esc(r.code) + '" placeholder="not counted">' }
    ], sv.rows.filter(r => Math.abs(r.byLocation[loc]) > 1e-9 || BOOT.bom.some(b => b.component === r.code)));
    dialog({
      title: 'Count stock', submit: 'Post count',
      body: '<div class="form"><div class="field"><label for="cl">Location</label><select id="cl" name="location">' + locOptions('MAIN') + '</select></div><div class="field"><label for="cd">Count date</label><input id="cd" type="date" name="date" value="' + esc(addDays(BOOT.today, -1)) + '"></div></div>' +
        '<p class="muted">Enter what is physically there. Leave blank what you did not count. Differences are posted to the ledger as count adjustments. To upload a whole count sheet, use Settings and imports.</p><div id="cb">' + body('MAIN') + '</div>',
      init: f => { f.elements.location.onchange = () => { $('#cb', f).innerHTML = body(f.elements.location.value); }; },
      onSubmit: async f => {
        const lines = $$('[data-item]', f).filter(i => i.value !== '').map(i => ({ item: i.dataset.item, counted: i.value }));
        const r = await send('/stock/count', { location: val(f, 'location'), date: val(f, 'date'), lines });
        after('Count ' + r.ref + ' posted for ' + r.lines + ' items');
      }
    });
  }
  function wasteDialog() {
    const codes = '<optgroup label="Fresh products">' + BOOT.products.filter(p => p.madeAt === 'CK').map(p => opt(p.code, p.name)).join('') + '</optgroup><optgroup label="Raw materials">' + BOOT.items.map(i => opt(i.code, i.name + ' (' + i.unit + ')')).join('') + '</optgroup>';
    const reasons = ['Unsold at close', 'Expired', 'Damaged', 'Preparation error', 'Quality issue', 'Other'];
    const row = () => '<tr><td><select name="code">' + opt('', 'Choose…') + codes + '</select></td><td><input class="qty" type="number" step="any" min="0" name="qty"></td><td><select name="reason">' + reasons.map(r => opt(r, r)).join('') + '</select></td><td><button type="button" class="sm" data-rm>Remove</button></td></tr>';
    dialog({
      title: 'Record waste', submit: 'Save waste',
      body: '<div class="form"><div class="field"><label for="wl">Location</label><select id="wl" name="location">' + locOptions('', null) + '</select></div><div class="field"><label for="wd">Day</label><input id="wd" type="date" name="date" value="' + esc(addDays(BOOT.today, -1)) + '"></div></div>' +
        '<div class="tw"><table><thead><tr><th>What</th><th class="n">Quantity</th><th>Reason</th><th></th></tr></thead><tbody id="wb">' + row() + row() + row() + '</tbody></table></div><div><button type="button" class="sm" data-add>Add line</button></div>' +
        '<p class="muted">Raw materials are taken out of stock. Fresh products are logged for the waste report and the forecast.</p>',
      init: f => { $('[data-add]', f).onclick = () => $('#wb', f).insertAdjacentHTML('beforeend', row()); f.addEventListener('click', e => { if (e.target.matches('[data-rm]')) e.target.closest('tr').remove(); }); },
      onSubmit: async f => {
        const lines = $$('#wb tr', f).map(tr => ({ code: $('[name=code]', tr).value, qty: $('[name=qty]', tr).value, reason: $('[name=reason]', tr).value })).filter(l => l.code && l.qty);
        const r = await send('/waste', { location: val(f, 'location'), date: val(f, 'date'), lines });
        after('Waste ' + r.ref + ' recorded');
      }
    });
  }

  async function viewLedger(query) {
    const off = +query.offset || 0;
    const p = await get('/ledger' + qs({ location: query.location || '', type: query.type || '', q: query.q || '', from: query.from || '', to: query.to || '', item: query.item || '', offset: off, limit: 100 }));
    main.innerHTML = header('Stock ledger', 'Every stock movement, newest first. Stock on hand is the sum of these rows, so this is the audit trail for every balance.', '<button data-act="copy">Copy page for Excel</button>') +
      '<div class="filters"><div class="field"><label for="ll">Location</label><select id="ll" data-change="location">' + locOptions(query.location || '', null, 'All locations') + '</select></div>' +
      '<div class="field"><label for="lt">Movement</label><select id="lt" data-change="type">' + opt('', 'All movements', query.type) + Object.keys(LEDGER_TYPES).map(k => opt(k, LEDGER_TYPES[k], query.type)).join('') + '</select></div>' +
      '<div class="field"><label for="li">Raw material</label><select id="li" data-change="item">' + opt('', 'All raw materials', query.item) + BOOT.items.map(i => opt(i.code, i.name, query.item)).join('') + '</select></div>' +
      '<div class="field"><label for="lq">Search</label><input id="lq" data-change="q" value="' + esc(query.q || '') + '" placeholder="Reference, user, note"></div>' +
      '<div class="field"><label for="lf">From</label><input id="lf" type="date" data-change="from" value="' + esc(query.from || '') + '"></div><div class="field"><label for="lto">To</label><input id="lto" type="date" data-change="to" value="' + esc(query.to || '') + '"></div></div>' +
      card('', table([
        { h: 'Day', f: r => esc(day(r.date)) }, { h: 'Posted', f: r => '<span class="faint num">' + esc(stamp(r.at)) + '</span>' }, { h: 'Movement', f: r => esc(LEDGER_TYPES[r.type] || r.type) },
        { h: 'Location', f: r => esc(locName(r.location)) }, { h: 'Raw material', f: r => '<a href="#/items/' + r.item + '">' + esc((itemOf(r.item) || {}).name || r.item) + '</a>' },
        { h: 'Quantity', n: 1, f: r => (r.qty > 0 ? '+' : '') + q(r.qty, (itemOf(r.item) || {}).unit) + ' ' + esc((itemOf(r.item) || {}).unit || ''), cls: r => r.qty < 0 ? 'neg' : 'pos' },
        { h: 'Reference', f: r => refLink(r.ref) }, { h: 'By', f: r => esc(r.user) }, { h: 'Note', f: r => esc(r.note), cls: () => 'wrap' }
      ], p.rows, { empty: 'No movements match.' }) + pager(p, 'page'), { raw: true });
    const go = o => { location.hash = '#/ledger' + qs(Object.assign({}, query, { offset: '' }, o)); };
    bind({
      location: s => go({ location: s.value }), type: s => go({ type: s.value }), item: s => go({ item: s.value }), q: s => go({ q: s.value }), from: s => go({ from: s.value }), to: s => go({ to: s.value }),
      page: b => go({ offset: b.dataset.off }),
      copy: () => copyRows([['Day', 'Posted', 'Movement', 'Location', 'Item', 'Quantity', 'Reference', 'By', 'Note']].concat(p.rows.map(r => [r.date, r.at, LEDGER_TYPES[r.type] || r.type, locName(r.location), (itemOf(r.item) || {}).name || r.item, r.qty, r.ref, r.user, r.note])))
    });
  }
  function refLink(ref) {
    if (!ref) return '';
    const m = ref.match(/^(PO|TR|PRD|PLN)-/);
    if (m) return '<a href="#/' + { PO: 'pos', TR: 'transfers', PRD: 'production', PLN: 'plans' }[m[1]] + '/' + esc(ref) + '">' + esc(ref) + '</a>';
    if (ref.indexOf('SALES:') === 0) return '<a href="#/sales">Sales ' + esc(ref.slice(6, 16)) + '</a>';
    return esc(ref);
  }

  async function viewWaste(query) {
    const tab = query.tab || 'waste';
    const to = query.to || addDays(BOOT.today, -1), from = query.from || addDays(BOOT.today, -14);
    const [w, so] = await Promise.all([get('/waste' + qs({ from, to, location: query.location || '', limit: 1000 })), get('/stockouts' + qs({ from, to, location: query.location || '', limit: 1000 }))]);
    const total = w.rows.reduce((a, r) => a + r.cost, 0);
    const group = (rows, k, v) => { const m = new Map(); rows.forEach(r => m.set(k(r), (m.get(k(r)) || 0) + v(r))); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })); };
    main.innerHTML = header('Waste and sold out', 'The two numbers the plan balances: what was thrown away, and what customers could not buy.', '<button class="primary" data-act="waste">Record waste</button>') +
      '<div class="filters"><div class="field"><label for="wf">From</label><input id="wf" type="date" data-change="from" value="' + from + '"></div><div class="field"><label for="wt">To</label><input id="wt" type="date" data-change="to" value="' + to + '"></div>' +
      '<div class="field"><label for="wl2">Location</label><select id="wl2" data-change="location">' + locOptions(query.location || '', null, 'All locations') + '</select></div></div>' +
      '<div class="grid g4">' + kpi('Waste value', money(total), w.total + ' records', total ? 'bad' : '') + kpi('Fresh products thrown away', nf0.format(w.rows.filter(r => r.kind === 'product').reduce((a, r) => a + r.qty, 0)), 'units') +
      kpi('Sold out', nf0.format(so.rows.reduce((a, r) => a + r.lostUnits, 0)), 'units customers could not buy', 'bad') + kpi('Sold out events', nf0.format(so.total), 'product and branch days') + '</div>' +
      tabs('w', [['waste', 'Waste'], ['out', 'Sold out']], tab) +
      '<div data-pane="w" data-name="waste" class="grid"' + (tab === 'waste' ? '' : ' hidden') + '>' +
      '<div class="grid g3">' + card('By product or item', hbars(group(w.rows, r => r.name, r => r.cost).slice(0, 8), money, 'crit')) + card('By location', hbars(group(w.rows, r => locName(r.location), r => r.cost).slice(0, 8), money, 'crit')) + card('By reason', hbars(group(w.rows, r => r.reason, r => r.cost), money, 'crit')) + '</div>' +
      card('Records', table([
        { h: 'Day', f: r => esc(day(r.date)) }, { h: 'Location', f: r => esc(locName(r.location)) }, { h: 'What', f: r => esc(r.name) + (r.kind === 'product' ? ' <span class="pill vio">Fresh</span>' : '') },
        { h: 'Quantity', n: 1, f: r => q(r.qty) }, { h: 'Cost', n: 1, f: r => money(r.cost) }, { h: 'Reason', f: r => esc(r.reason) }, { h: 'By', f: r => esc(r.user) }
      ], w.rows.slice(0, 300)), { raw: true }) + '</div>' +
      '<div data-pane="w" data-name="out" class="grid"' + (tab === 'out' ? '' : ' hidden') + '>' +
      '<div class="grid g2">' + card('Most often sold out', hbars(group(so.rows, r => r.name, r => r.lostUnits).slice(0, 8), v => nf0.format(v) + ' units')) + card('By branch', hbars(group(so.rows, r => locName(r.branch), r => r.lostUnits).slice(0, 11), v => nf0.format(v) + ' units')) + '</div>' +
      card('Sold out events', table([
        { h: 'Day', f: r => esc(day(r.date)) }, { h: 'Branch', f: r => esc(locName(r.branch)) }, { h: 'Product', f: r => esc(r.name) }, { h: 'Sold out at', f: r => esc(r.soldOutAt || '') },
        { h: 'Units missed', n: 1, f: r => nf0.format(r.lostUnits) }
      ], so.rows.slice(0, 300)), { raw: true, sub: 'Sales on these days understate real demand. The next forecast version will correct for it.' }) + '</div>';
    const go = o => { location.hash = '#/waste' + qs(Object.assign({}, query, o)); };
    bind({ from: s => go({ from: s.value }), to: s => go({ to: s.value }), location: s => go({ location: s.value }), waste: () => wasteDialog() });
  }

  // ======================= sales =======================
  async function viewSales(query) {
    const to = query.to || addDays(BOOT.today, -1), from = query.from || addDays(BOOT.today, -14);
    const [s, imp] = await Promise.all([get('/sales/summary' + qs({ from, to, branch: query.branch || '' })), get('/imports?limit=30')]);
    const days = Object.keys(s.byDay).sort();
    const totalV = days.reduce((a, d) => a + s.byDay[d].value, 0), totalU = days.reduce((a, d) => a + s.byDay[d].units, 0);
    const prods = Object.entries(s.byProduct).map(([code, v]) => Object.assign({ code, name: (prodOf(code) || {}).name || code }, v)).sort((a, b) => b.value - a.value);
    const brs = Object.entries(s.byBranch).map(([code, v]) => Object.assign({ code, name: locName(code) }, v)).sort((a, b) => b.value - a.value);
    main.innerHTML = header('Sales', 'Daily sales per branch and product from the POS. ' + nf0.format(s.totalRows) + ' rows from ' + esc(s.firstDate) + ' to ' + esc(s.lastDate) + '.', '<button class="primary" data-act="up">Upload sales file</button>') +
      '<div class="filters"><div class="field"><label for="sf">From</label><input id="sf" type="date" data-change="from" value="' + from + '"></div><div class="field"><label for="st">To</label><input id="st" type="date" data-change="to" value="' + to + '"></div>' +
      '<div class="field"><label for="sb">Branch</label><select id="sb" data-change="branch">' + locOptions(query.branch || '', l => l.type === 'BRANCH', 'All branches') + '</select></div></div>' +
      '<div class="grid g3">' + kpi('Sales value', kmoney(totalV), 'at menu prices') + kpi('Units sold', nf0.format(totalU), days.length + ' days') + kpi('Average per day', kmoney(days.length ? totalV / days.length : 0), 'value') + '</div>' +
      card('Sales by day', barChart(days.map(d => [day(d), s.byDay[d].value]), money)) +
      '<div class="grid g2">' + card('By branch', table([{ h: 'Branch', f: r => esc(r.name) }, { h: 'Units', n: 1, f: r => nf0.format(r.units) }, { h: 'Value', n: 1, f: r => money(r.value) }], brs), { raw: true }) +
      card('By product', table([{ h: 'Product', f: r => '<a href="#/products/' + r.code + '">' + esc(r.name) + '</a>' }, { h: 'Units', n: 1, f: r => nf0.format(r.units) }, { h: 'Value', n: 1, f: r => money(r.value) }], prods), { raw: true }) + '</div>' +
      card('Import history', table([
        { h: 'Import', f: r => '<button class="link" data-act="imp" data-id="' + r.id + '">' + r.id + '</button>' }, { h: 'Type', f: r => esc(r.title) }, { h: 'File', f: r => esc(r.fileName) },
        { h: 'When', f: r => '<span class="num">' + esc(stamp(r.at)) + '</span>' }, { h: 'By', f: r => esc(r.user) }, { h: 'Rows', n: 1, f: r => nf0.format(r.rows) }, { h: 'Accepted', n: 1, f: r => nf0.format(r.accepted) },
        { h: 'Rejected', n: 1, f: r => r.rejected ? nf0.format(r.rejected) : '', cls: r => r.rejected ? 'neg' : '' }
      ], imp.rows), { raw: true });
    const go = o => { location.hash = '#/sales' + qs(Object.assign({}, query, o)); };
    bind({ from: i => go({ from: i.value }), to: i => go({ to: i.value }), branch: i => go({ branch: i.value }), up: () => importDialog('sales', () => render()), imp: b => showImport(imp.rows.find(r => r.id === b.dataset.id)) });
  }

  // ======================= products =======================
  async function viewProducts(query) {
    await reloadBoot();
    const s = (query.q || '').toLowerCase(), made = query.made || '';
    const compCount = new Map();
    BOOT.bom.forEach(b => compCount.set(b.product, (compCount.get(b.product) || 0) + 1));
    const rows = BOOT.products.filter(p => (!s || (p.code + ' ' + p.name + ' ' + (p.oracleCode || '') + ' ' + (p.category || '')).toLowerCase().indexOf(s) >= 0) && (!made || p.madeAt === made));
    main.innerHTML = header('Products and recipes', 'Every product you sell or make, with its SKU, Oracle code and recipe (bill of materials). Sales files match products by SKU or Oracle code.',
      '<button data-act="impP">Import products</button><button data-act="impB">Import recipes</button><a class="btn primary" href="#/products/new">New product</a>') +
      '<div class="filters"><div class="field"><label for="pq">Search</label><input id="pq" data-change="q" value="' + esc(query.q || '') + '" placeholder="Name, SKU or Oracle code"></div>' +
      '<div class="chips">' + [['', 'All'], ['BRANCH', 'Made at branch'], ['CK', 'Central kitchen'], ['SEMI', 'Semi finished']].map(c => '<button data-act="made" data-m="' + c[0] + '" aria-pressed="' + (c[0] === made) + '">' + c[1] + '</button>').join('') + '</div></div>' +
      card('', table([
        { h: 'SKU', f: p => '<a href="#/products/' + encodeURIComponent(p.code) + '">' + esc(p.code) + '</a>' }, { h: 'Oracle code', f: p => esc(p.oracleCode || '') }, { h: 'Name', f: p => esc(p.name) },
        { h: 'Category', f: p => esc(p.category || '') }, { h: 'Made at', f: p => esc(MADE_AT[p.madeAt] || p.madeAt) }, { h: 'Components', n: 1, f: p => compCount.get(p.code) || '<span class="pill crit">No recipe</span>' },
        { h: 'Price', n: 1, f: p => p.price ? nf0.format(p.price) : '' }, { h: 'Status', f: p => p.active === false ? '<span class="pill">Inactive</span>' : '<span class="pill ok">Active</span>' }
      ], rows, { href: p => '#/products/' + encodeURIComponent(p.code), empty: 'No products match.' }), { raw: true });
    const go = o => { location.hash = '#/products' + qs(Object.assign({}, query, o)); };
    bind({ q: i => go({ q: i.value }), made: b => go({ made: b.dataset.m }), impP: () => importDialog('products', () => render()), impB: () => importDialog('bom', () => render()) });
  }

  async function viewProduct(code) {
    await reloadBoot();
    const isNew = code === 'new';
    const info = isNew ? { product: { code: '', name: '', madeAt: 'BRANCH', active: true }, bom: [], raw: [], cost: 0, usedIn: [], sales28: { byBranch: {}, byDay: {} } } : await get('/products/' + encodeURIComponent(code));
    const p = info.product;
    const compOptions = sel => opt('', 'Choose a component…') + '<optgroup label="Raw materials">' + BOOT.items.map(i => opt(i.code, i.name + ' (' + i.unit + ')', sel)).join('') + '</optgroup>' +
      '<optgroup label="Semi finished and other products">' + BOOT.products.filter(x => x.code !== p.code).map(x => opt(x.code, x.name + ' (' + (MADE_AT[x.madeAt] || '') + ')', sel)).join('') + '</optgroup>';
    const unitOf = c => (itemOf(c) || {}).unit || (prodOf(c) ? 'unit' : '');
    const bomRow = l => '<tr><td><select name="component" aria-label="Component">' + compOptions(l.component) + '</select></td><td><input class="qty" name="qty" type="number" step="any" min="0" value="' + esc(l.qty || '') + '" aria-label="Quantity per unit"></td><td class="muted" data-unit>' + esc(unitOf(l.component)) + '</td><td><button type="button" class="sm" data-act="rmLine">Remove</button></td></tr>';
    const salesTotal = Object.values(info.sales28.byBranch).reduce((a, b) => a + b, 0);
    const margin = p.price && info.cost ? (p.price - info.cost) / p.price : null;
    main.innerHTML = header(isNew ? 'New product' : esc(p.name), isNew ? 'Create the product with its SKU, then add its recipe. Sales can be uploaded for it as soon as it is saved.' : 'SKU ' + esc(p.code) + (p.oracleCode ? ' · Oracle ' + esc(p.oracleCode) : '') + ' · ' + esc(MADE_AT[p.madeAt] || ''), '<button class="primary" data-act="save">Save product</button>', '<a href="#/products">Products and recipes</a>') +
      '<div class="grid g3"><div class="grid span2">' +
      card('Product', '<form id="pf" class="form" onsubmit="return false">' +
        '<div class="field"><label for="f1">SKU code</label><input id="f1" name="code" value="' + esc(p.code) + '"' + (isNew ? ' required' : ' readonly') + ' placeholder="For example P120"><span class="hint">Used in sales files. Cannot change later.</span></div>' +
        '<div class="field"><label for="f2">Oracle item code</label><input id="f2" name="oracleCode" value="' + esc(p.oracleCode || '') + '"><span class="hint">Links this product to Oracle.</span></div>' +
        '<div class="field" style="grid-column:span 2"><label for="f3">Name</label><input id="f3" name="name" value="' + esc(p.name) + '" required></div>' +
        '<div class="field"><label for="f4">Category</label><input id="f4" name="category" value="' + esc(p.category || '') + '" list="cats"><datalist id="cats">' + Array.from(new Set(BOOT.products.map(x => x.category).filter(Boolean))).map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div>' +
        '<div class="field"><label for="f5">Made at</label><select id="f5" name="madeAt">' + Object.keys(MADE_AT).map(k => opt(k, MADE_AT[k], p.madeAt)).join('') + '</select><span class="hint">Central kitchen products are pushed to branches daily.</span></div>' +
        '<div class="field"><label for="f6">Selling price (EGP)</label><input id="f6" name="price" type="number" step="any" min="0" value="' + esc(p.price == null ? '' : p.price) + '"></div>' +
        '<div class="field"><label for="f7">Status</label><select id="f7" name="active">' + opt('1', 'Active', p.active === false ? '0' : '1') + opt('0', 'Inactive', p.active === false ? '0' : '1') + '</select></div></form>') +
      card('Recipe (bill of materials)', '<div class="tw"><table><thead><tr><th>Component</th><th class="n">Per one unit</th><th>Unit</th><th></th></tr></thead><tbody id="bomRows">' +
        (info.bom.length ? info.bom : [{}, {}, {}]).map(bomRow).join('') + '</tbody></table></div><div><button type="button" class="sm" data-act="addLine">Add component</button></div>' +
        '<p class="muted">A component can be a raw material or another product with its own recipe (for example a cream mix). The planner breaks it down until only raw materials remain.</p>', { sub: 'Quantity of each component used to make one unit.' }) +
      '</div><div class="grid">' +
      (isNew ? '' : card('Cost and margin', '<div class="list"><div class="row"><span>Recipe cost</span><b class="num">' + nf2.format(info.cost) + '</b></div><div class="row"><span>Price</span><b class="num">' + (p.price ? nf2.format(p.price) : '–') + '</b></div><div class="row"><span>Margin</span><b class="num">' + (margin === null ? '–' : nf0.format(margin * 100) + '%') + '</b></div></div>')) +
      (isNew ? '' : card('Raw materials per unit', table([{ h: 'Raw material', f: r => '<a href="#/items/' + r.item + '">' + esc(r.name) + '</a>' }, { h: 'Qty', n: 1, f: r => nf4.format(r.qty) + ' ' + esc(r.unit) }, { h: 'Cost', n: 1, f: r => nf2.format(r.cost) }], info.raw, { empty: 'No recipe yet.' }), { raw: true, sub: 'All recipe levels broken down.' })) +
      (info.usedIn.length ? card('Used in', '<div class="list">' + info.usedIn.map(u => '<div class="row"><a href="#/products/' + u.product + '">' + esc(u.name) + '</a><span class="num">' + nf4.format(u.qty) + '</span></div>').join('') + '</div>') : '') +
      (isNew ? '' : card('Sales, last 28 days', '<p><b class="num">' + nf0.format(salesTotal) + '</b> <span class="muted">units</span></p>' + barChart(Object.keys(info.sales28.byDay).sort().map(d => [day(d), info.sales28.byDay[d]]), v => nf0.format(v) + ' units'))) +
      '</div></div>';
    bind({
      addLine: () => $('#bomRows').insertAdjacentHTML('beforeend', bomRow({})),
      rmLine: b => b.closest('tr').remove(),
      save: async () => {
        const f = $('#pf');
        const bom = $$('#bomRows tr').map(tr => ({ component: $('[name=component]', tr).value, qty: $('[name=qty]', tr).value })).filter(l => l.component);
        const body = { code: val(f, 'code'), oracleCode: val(f, 'oracleCode'), name: val(f, 'name'), category: val(f, 'category'), madeAt: val(f, 'madeAt'), price: val(f, 'price'), active: val(f, 'active') === '1', bom };
        if (isNew && BOOT.products.some(x => x.code === body.code)) throw new Error('SKU ' + body.code + ' already exists.');
        const saved = await send('/products', body);
        await reloadBoot();
        after('Product ' + saved.code + ' saved', '#/products/' + encodeURIComponent(saved.code));
      }
    });
    main.addEventListener('change', e => { if (e.target.name === 'component') { const u = e.target.closest('tr').querySelector('[data-unit]'); if (u) u.textContent = unitOf(e.target.value); } });
  }

  // ======================= raw materials =======================
  async function viewItems(query) {
    await reloadBoot();
    const s = (query.q || '').toLowerCase(), cat = query.cat || '', sup = query.sup || '';
    const sv = await get('/stock');
    const totals = new Map(sv.rows.map(r => [r.code, r.total]));
    const cats = Array.from(new Set(BOOT.items.map(i => i.category).filter(Boolean))).sort();
    const rows = BOOT.items.filter(i => (!s || (i.code + ' ' + i.name + ' ' + (i.oracleCode || '')).toLowerCase().indexOf(s) >= 0) && (!cat || i.category === cat) && (!sup || i.supplier === sup));
    main.innerHTML = header('Raw materials', BOOT.items.length + ' items with supplier, lead time, order rules, cost and shelf life. These drive every delivery and purchase order.', '<button data-act="imp">Import raw materials</button><button class="primary" data-act="new">New raw material</button>') +
      '<div class="filters"><div class="field"><label for="iq">Search</label><input id="iq" data-change="q" value="' + esc(query.q || '') + '" placeholder="Name or code"></div>' +
      '<div class="field"><label for="ic">Category</label><select id="ic" data-change="cat">' + opt('', 'All categories', cat) + cats.map(c => opt(c, c, cat)).join('') + '</select></div>' +
      '<div class="field"><label for="is">Supplier</label><select id="is" data-change="sup">' + opt('', 'All suppliers', sup) + BOOT.suppliers.map(x => opt(x.code, x.name, sup)).join('') + '</select></div></div>' +
      card('', table([
        { h: 'Code', f: i => '<a href="#/items/' + encodeURIComponent(i.code) + '">' + esc(i.code) + '</a>' }, { h: 'Oracle', f: i => esc(i.oracleCode || '') }, { h: 'Name', f: i => esc(i.name) },
        { h: 'Category', f: i => esc(i.category || '') }, { h: 'Unit', f: i => esc(i.unit) }, { h: 'Supplier', f: i => esc(supName(i.supplier)) }, { h: 'Lead time', n: 1, f: i => (i.leadTimeDays == null ? '' : i.leadTimeDays + ' d') },
        { h: 'MOQ', n: 1, f: i => q(i.moq, i.unit) }, { h: 'Pack', n: 1, f: i => q(i.packSize, i.unit) }, { h: 'Cost', n: 1, f: i => nf2.format(i.unitCost || 0) }, { h: 'Shelf life', n: 1, f: i => i.shelfLifeDays ? i.shelfLifeDays + ' d' : '' },
        { h: 'In stock (all)', n: 1, f: i => q(totals.get(i.code), i.unit), cls: i => totals.get(i.code) < 0 ? 'neg' : '' }
      ], rows, { href: i => '#/items/' + encodeURIComponent(i.code), empty: 'No raw materials match.' }), { raw: true });
    const go = o => { location.hash = '#/items' + qs(Object.assign({}, query, o)); };
    bind({ q: i => go({ q: i.value }), cat: i => go({ cat: i.value }), sup: i => go({ sup: i.value }), imp: () => importDialog('items', () => render()), new: () => { location.hash = '#/items/new'; } });
  }

  async function viewItem(code) {
    await reloadBoot();
    const isNew = code === 'new';
    const info = isNew ? { item: { code: '', active: true }, stock: {}, usedIn: [], pos: [], ledger: [] } : await get('/items/' + encodeURIComponent(code));
    const i = info.item;
    const f = (name, label, type, hint, extra) => '<div class="field"><label for="i_' + name + '">' + label + '</label><input id="i_' + name + '" name="' + name + '" type="' + (type || 'text') + '"' + (type === 'number' ? ' step="any" min="0"' : '') + ' value="' + esc(i[name] == null ? '' : i[name]) + '"' + (extra || '') + '>' + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
    main.innerHTML = header(isNew ? 'New raw material' : esc(i.name), isNew ? '' : 'Code ' + esc(i.code) + (i.oracleCode ? ' · Oracle ' + esc(i.oracleCode) : '') + ' · ' + esc(supName(i.supplier)), '<button class="primary" data-act="save">Save</button>', '<a href="#/items">Raw materials</a>') +
      card('Details', '<form id="itf" class="form" onsubmit="return false">' + f('code', 'Code', 'text', isNew ? 'Cannot change later.' : '', isNew ? ' required' : ' readonly') + f('oracleCode', 'Oracle item code') +
        '<div class="field" style="grid-column:span 2"><label for="i_name">Name</label><input id="i_name" name="name" value="' + esc(i.name || '') + '" required></div>' + f('unit', 'Unit', 'text', 'kg, L, pcs') + f('category', 'Category') +
        '<div class="field"><label for="i_sup">Supplier</label><select id="i_sup" name="supplier">' + opt('', 'Choose…', i.supplier) + BOOT.suppliers.map(s => opt(s.code, s.name, i.supplier)).join('') + '</select></div>' +
        f('leadTimeDays', 'Lead time (days)', 'number', 'Order to delivery') + f('orderEveryDays', 'Days between orders', 'number', 'Blank uses the supplier setting') + f('moq', 'Minimum order', 'number') + f('packSize', 'Pack size', 'number', 'Orders round up to this') +
        f('transferMultiple', 'Transfer multiple', 'number', 'Branch deliveries round up to this') + f('unitCost', 'Unit cost (EGP)', 'number') + f('shelfLifeDays', 'Shelf life (days)', 'number', '0 = does not expire') +
        '<div class="field"><label for="i_act">Status</label><select id="i_act" name="active">' + opt('1', 'Active', i.active === false ? '0' : '1') + opt('0', 'Inactive', i.active === false ? '0' : '1') + '</select></div></form>') +
      (isNew ? '' : '<div class="grid g3">' +
        card('Stock by location', '<div class="list">' + BOOT.locations.map(l => '<div class="row"><span>' + esc(l.name) + '</span><span class="num' + (info.stock[l.code] < 0 ? ' neg' : '') + '" style="' + (info.stock[l.code] < 0 ? 'color:var(--crit)' : '') + '">' + q(info.stock[l.code], i.unit) + ' ' + esc(i.unit) + '</span></div>').join('') + '</div>') +
        card('Used in', info.usedIn.length ? '<div class="list">' + info.usedIn.map(u => '<div class="row"><a href="#/products/' + u.product + '">' + esc(u.name) + '</a><span class="num">' + nf4.format(u.qty) + ' ' + esc(i.unit) + '</span></div>').join('') + '</div>' : '<div class="empty">Not used in any recipe.</div>') +
        card('Recent purchase orders', table([{ h: 'Order', f: p => '<a href="#/pos/' + p.id + '">' + p.id + '</a>' }, { h: 'Status', f: p => pill('po', p.status) }, { h: 'Qty', n: 1, f: p => q(p.qty, i.unit) }, { h: 'Expected', f: p => esc(day(p.expectedDate)) }], info.pos, { empty: 'No orders yet.' }), { raw: true }) +
        '</div>' +
        card('Latest movements', table([
          { h: 'Day', f: r => esc(day(r.date)) }, { h: 'Movement', f: r => esc(LEDGER_TYPES[r.type] || r.type) }, { h: 'Location', f: r => esc(locName(r.location)) },
          { h: 'Quantity', n: 1, f: r => (r.qty > 0 ? '+' : '') + q(r.qty, i.unit), cls: r => r.qty < 0 ? 'neg' : 'pos' }, { h: 'Reference', f: r => refLink(r.ref) }, { h: 'By', f: r => esc(r.user) }
        ], info.ledger), { raw: true, actions: '<a href="#/ledger?item=' + encodeURIComponent(i.code) + '">Full ledger</a>' }));
    bind({
      save: async () => {
        const fm = $('#itf');
        const body = {};
        ['code', 'oracleCode', 'name', 'unit', 'category', 'supplier', 'leadTimeDays', 'orderEveryDays', 'moq', 'packSize', 'transferMultiple', 'unitCost', 'shelfLifeDays'].forEach(k => { body[k] = val(fm, k); });
        body.active = val(fm, 'active') === '1';
        if (isNew && BOOT.items.some(x => x.code === body.code)) throw new Error('Code ' + body.code + ' already exists.');
        const saved = await send('/items', body);
        await reloadBoot();
        after('Saved ' + saved.name, '#/items/' + encodeURIComponent(saved.code));
      }
    });
  }

  // ======================= suppliers and locations =======================
  async function viewSuppliers() {
    await reloadBoot();
    const count = new Map();
    BOOT.items.forEach(i => count.set(i.supplier, (count.get(i.supplier) || 0) + 1));
    main.innerHTML = header('Suppliers', 'Lead time and order rhythm per supplier. A raw material can override the lead time.', '<button class="primary" data-act="edit" data-code="">New supplier</button>') +
      card('', table([
        { h: 'Code', f: s => esc(s.code) }, { h: 'Name', f: s => '<button class="link" data-act="edit" data-code="' + esc(s.code) + '">' + esc(s.name) + '</button>' },
        { h: 'Lead time', n: 1, f: s => (s.leadTimeDays == null ? '' : s.leadTimeDays + ' d') }, { h: 'Order every', n: 1, f: s => (s.orderEveryDays == null ? '' : s.orderEveryDays + ' d') },
        { h: 'Raw materials', n: 1, f: s => count.get(s.code) || 0 }, { h: 'Contact', f: s => esc([s.contact, s.phone, s.email].filter(Boolean).join(', ')) },
        { h: 'Orders', f: s => '<a href="#/pos?supplier=' + s.code + '">View orders</a>' }
      ], BOOT.suppliers), { raw: true });
    bind({
      edit: b => {
        const s = BOOT.suppliers.find(x => x.code === b.dataset.code) || { active: true };
        dialog({
          title: s.code ? 'Edit ' + s.name : 'New supplier',
          body: '<div class="form">' + [['name', 'Name', 'text'], ['leadTimeDays', 'Lead time (days)', 'number'], ['orderEveryDays', 'Order every (days)', 'number'], ['contact', 'Contact person', 'text'], ['phone', 'Phone', 'text'], ['email', 'Email', 'email']].map(x =>
            '<div class="field"><label for="s_' + x[0] + '">' + x[1] + '</label><input id="s_' + x[0] + '" name="' + x[0] + '" type="' + x[2] + '"' + (x[2] === 'number' ? ' step="any" min="0"' : '') + ' value="' + esc(s[x[0]] == null ? '' : s[x[0]]) + '"' + (x[0] === 'name' ? ' required' : '') + '></div>').join('') + '</div>',
          onSubmit: async f => {
            const body = { code: s.code || '' };
            ['name', 'leadTimeDays', 'orderEveryDays', 'contact', 'phone', 'email'].forEach(k => { body[k] = val(f, k); });
            await send('/suppliers', body); after('Supplier saved');
          }
        });
      }
    });
  }
  async function viewLocations() {
    await reloadBoot();
    const TYPES = { MAIN: 'Main warehouse', CK: 'Central kitchen', BRANCH: 'Branch' };
    main.innerHTML = header('Locations', 'The main warehouse, the central kitchen and every branch. Delivery days decide when a branch gets raw materials.', '<button class="primary" data-act="edit" data-code="">New branch</button>') +
      card('', table([
        { h: 'Code', f: l => esc(l.code) }, { h: 'Name', f: l => '<button class="link" data-act="edit" data-code="' + esc(l.code) + '">' + esc(l.name) + '</button>' }, { h: 'Type', f: l => esc(TYPES[l.type]) },
        { h: 'Delivery days', f: l => esc(l.type === 'MAIN' ? '' : (l.deliveryDays || 'daily')) }, { h: 'Status', f: l => l.active === false ? '<span class="pill">Closed</span>' : '<span class="pill ok">Open</span>' }
      ], BOOT.locations), { raw: true, sub: 'A new branch gets a plan as soon as it has some sales history.' });
    bind({
      edit: b => {
        const l = BOOT.locations.find(x => x.code === b.dataset.code) || { type: 'BRANCH', active: true, deliveryDays: 'daily' };
        dialog({
          title: l.code ? 'Edit ' + l.name : 'New branch',
          body: '<div class="form"><div class="field"><label for="l_code">Code</label><input id="l_code" name="code" value="' + esc(l.code || '') + '"' + (l.code ? ' readonly' : ' required placeholder="For example BR12"') + '></div>' +
            '<div class="field"><label for="l_name">Name</label><input id="l_name" name="name" value="' + esc(l.name || '') + '" required></div>' +
            '<div class="field"><label for="l_dd">Delivery days</label><input id="l_dd" name="deliveryDays" value="' + esc(l.deliveryDays || '') + '"><span class="hint">daily, or days such as Sun,Tue,Thu</span></div>' +
            '<div class="field"><label for="l_act">Status</label><select id="l_act" name="active">' + opt('1', 'Open', l.active === false ? '0' : '1') + opt('0', 'Closed', l.active === false ? '0' : '1') + '</select></div></div>',
          onSubmit: async f => { await send('/locations', { code: val(f, 'code'), name: val(f, 'name'), deliveryDays: val(f, 'deliveryDays'), active: val(f, 'active') === '1', type: l.type }); after('Location saved'); }
        });
      }
    });
  }

  // ======================= log and settings =======================
  async function viewLog(query) {
    const off = +query.offset || 0;
    const p = await get('/audit' + qs({ q: query.q || '', entity: query.entity || '', offset: off, limit: 100 }));
    const ents = ['Plan', 'Purchase order', 'Transfer', 'Production', 'Stock count', 'Waste', 'Import', 'Product', 'Raw material', 'Supplier', 'Location', 'Settings'];
    main.innerHTML = header('Activity log', 'Who did what and when, across the whole system.') +
      '<div class="filters"><div class="field"><label for="aq">Search</label><input id="aq" data-change="q" value="' + esc(query.q || '') + '" placeholder="User, action, reference"></div>' +
      '<div class="field"><label for="ae">Area</label><select id="ae" data-change="entity">' + opt('', 'All areas', query.entity) + ents.map(e => opt(e, e, query.entity)).join('') + '</select></div></div>' +
      card('', table([
        { h: 'When', f: a => '<span class="num">' + esc(stamp(a.at)) + '</span>' }, { h: 'Who', f: a => esc(a.user) }, { h: 'Action', f: a => esc(a.action) },
        { h: 'Area', f: a => esc(a.entity) }, { h: 'Reference', f: a => refLink(a.ref) }, { h: 'Detail', f: a => esc(a.detail), cls: () => 'wrap' }
      ], p.rows) + pager(p, 'page'), { raw: true });
    const go = o => { location.hash = '#/log' + qs(Object.assign({}, query, { offset: '' }, o)); };
    bind({ q: i => go({ q: i.value }), entity: i => go({ entity: i.value }), page: b => go({ offset: b.dataset.off }) });
  }

  async function viewSettings() {
    await reloadBoot();
    const s = BOOT.settings;
    const SET = [
      ['historyWeeks', 'Weeks of sales history', 'More weeks gives steadier forecasts; fewer reacts faster.', 1],
      ['branchServiceLevel', 'Branch service level (%)', 'Chance a branch has enough raw material until the next delivery.', 100],
      ['mainServiceLevel', 'Main WH service level (%)', 'Chance the main WH has stock until a supplier order arrives.', 100],
      ['orderEveryDays', 'Default days between supplier orders', 'Used when neither the item nor the supplier sets it.', 1],
      ['freshMinService', 'Fresh products: lowest target (%)', 'Floor for the margin based target.', 100],
      ['freshMaxService', 'Fresh products: highest target (%)', 'Ceiling for the margin based target.', 100],
      ['freshDefaultService', 'Fresh products without price (%)', 'Used when a product has no selling price.', 100],
      ['ckBufferPct', 'Extra kitchen production (%)', 'Added on top of the sum of branch plans.', 1]
    ];
    const types = Object.keys(BOOT.imports);
    main.innerHTML = header('Settings and imports', 'Planning rules, data imports from Oracle and the POS, and the example data.') +
      card('Planning rules', '<form id="setf" class="form" onsubmit="return false">' + SET.map(x => '<div class="field"><label for="st_' + x[0] + '">' + x[1] + '</label><input id="st_' + x[0] + '" name="' + x[0] + '" type="number" step="any" value="' + +(s[x[0]] * x[3]).toFixed(2) + '" data-scale="' + x[3] + '"><span class="hint">' + x[2] + '</span></div>').join('') + '</form>',
        { foot: '<button class="primary" data-act="saveSet">Save planning rules</button>' }) +
      card('Imports', table([
        { h: 'Data', f: t => '<b>' + esc(BOOT.imports[t].title) + '</b>' }, { h: 'Required columns', f: t => '<span class="num">' + esc(BOOT.imports[t].required.join(', ')) + '</span>' },
        { h: 'Optional columns', f: t => '<span class="num faint">' + esc(Object.keys(BOOT.imports[t].fields).filter(k => BOOT.imports[t].required.indexOf(k) < 0).join(', ')) + '</span>', cls: () => 'wrap' },
        { h: '', f: t => '<button class="sm" data-act="imp" data-t="' + t + '">Import file</button>' }
      ], types), { raw: true, sub: 'Export from Oracle or the POS as CSV or Excel. Products and raw materials are matched by code; new codes are created, existing ones updated.' }) +
      '<div class="grid g2">' + card('Who is using the system', '<p>Signed in as <b>' + esc(USER) + '</b>. Every action is logged with this name.</p>', { foot: '<button data-act="who">Change user</button>' }) +
      card('Example data', '<p class="muted">' + (BOOT.seeded ? 'The system holds example data with two weeks of simulated operations up to ' + esc(BOOT.seeded.yesterday) + '.' : 'The system holds your own data.') + ' Resetting deletes everything and rebuilds the example data.</p>', { foot: '<button class="danger" data-act="reset">Reset to example data</button>' }) + '</div>';
    bind({
      saveSet: async () => {
        const body = {};
        $$('#setf input').forEach(i => { if (i.value !== '') body[i.name] = parseFloat(i.value) / parseFloat(i.dataset.scale); });
        await send('/settings', body); await reloadBoot(); toast('Planning rules saved. They apply to the next plan run.');
      },
      imp: b => importDialog(b.dataset.t, () => render()),
      who: () => whoDialog(),
      reset: () => dialog({ title: 'Reset to example data', submit: 'Delete everything and reset', danger: true, body: '<p>This deletes all products, sales, orders, transfers and stock movements, and rebuilds the example data. It cannot be undone.</p>', onSubmit: async () => { await send('/reset'); await reloadBoot(); after('Example data rebuilt', '#/'); } })
    });
  }

  function whoDialog(first) {
    dialog({
      title: first ? 'Who is using the system?' : 'Change user', submit: 'Continue',
      body: '<p class="muted">Every action is logged with your name. This is a simple sign in for the pilot; real accounts and passwords come with the hosted version.</p>' +
        '<div class="form"><div class="field"><label for="un">Your name</label><input id="un" name="name" required value="' + esc(USER) + '"></div>' +
        '<div class="field"><label for="ur">Role</label><select id="ur" name="role">' + ['Supply chain', 'Planner', 'Purchasing', 'Warehouse', 'Kitchen', 'Branch manager', 'Management'].map(r => opt(r, r)).join('') + '</select></div></div>',
      onSubmit: async f => {
        USER = val(f, 'name') + ' (' + val(f, 'role') + ')';
        try { localStorage.setItem('scc.user', USER); } catch (e) { /* not saved */ }
        $('#whoName').textContent = USER;
        toast('Signed in as ' + USER);
      }
    });
  }

  // ======================= start =======================
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
  $('#whoSwitch').onclick = () => whoDialog();
  (async function start() {
    try { await reloadBoot(); }
    catch (e) { main.innerHTML = '<div class="loading">Cannot reach the server. Start it with <code>node server.js</code> and reload this page.</div>'; return; }
    $('#whoName').textContent = USER || 'Not set';
    render();
    refreshBadges();
    if (!USER) whoDialog(true);
  })();
})();
