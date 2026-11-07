// CSV reading and column matching. Accepts Rebh's own templates and the
// common column names from store, courier and ad exports.

import { normaliseStatus } from './engine.js';

/** RFC 4180 style parser: quotes, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  // Pick the delimiter from the header line: comma, semicolon or tab.
  const first = s.split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length]);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const key = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

function finder(row) {
  const map = new Map(Object.keys(row).map((h) => [key(h), h]));
  return (...aliases) => {
    for (const a of aliases) {
      const k = key(a);
      if (map.has(k)) return row[map.get(k)];
    }
    // Prefix match, so "Amount spent (EGP)" matches "amountspent".
    for (const a of aliases) {
      const k = key(a);
      for (const [mk, orig] of map) if (mk.startsWith(k)) return row[orig];
    }
    return undefined;
  };
}

const toNum = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Turn any date text into YYYY-MM-DD. */
export function toDate(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); // day first, as used in Egypt
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Orders. Store exports list one row per line item, repeating the order number;
 * rows with the same order number are merged into one order.
 */
export function readOrders(rows) {
  const byId = new Map();
  for (const row of rows) {
    const f = finder(row);
    const id = f('order', 'order id', 'name', 'order number', 'id');
    if (!id) continue;
    const product = f('product', 'lineitem name', 'item', 'title') || 'Unknown product';
    const qty = toNum(f('qty', 'quantity', 'lineitem quantity')) || 1;
    const linePrice = toNum(f('lineitem price', 'price', 'unit price'));
    const total = toNum(f('total', 'order total', 'amount'));
    const existing = byId.get(id);
    if (existing) {
      existing.qty += qty;
      if (!existing._hasTotal && linePrice) existing.total += linePrice * qty;
      continue;
    }
    const payment = String(f('payment', 'payment method', 'gateway') || '').toLowerCase();
    byId.set(id, {
      id,
      date: toDate(f('date', 'created at', 'order date', 'created')),
      product,
      qty,
      total: total || linePrice * qty,
      status: normaliseStatus(f('status', 'delivery status', 'fulfillment status', 'shipment status')),
      payment: /card|visa|paymob|geidea|fawry|online|stripe|paypal/.test(payment) ? 'card' : 'cod',
      shippingFee: toNum(f('shipping fee', 'shipping cost', 'delivery fee', 'courier fee')),
      returnFee: f('return fee', 'rto fee', 'return cost') ?? '',
      campaign: f('campaign', 'utm campaign', 'utmcampaign') || '',
      zone: f('zone', 'city', 'governorate', 'shipping province', 'shipping city') || '',
      _hasTotal: total > 0,
    });
  }
  return [...byId.values()].map(({ _hasTotal, ...o }) => o);
}

/**
 * Courier statement: updates status and fees on orders that are already loaded.
 * Returns how many orders it matched.
 */
export function applyCourier(orders, rows) {
  const byId = new Map(orders.map((o) => [String(o.id).replace(/^#/, ''), o]));
  let matched = 0;
  for (const row of rows) {
    const f = finder(row);
    const id = String(f('order', 'order id', 'reference', 'business reference', 'order number') || '').replace(/^#/, '');
    const o = byId.get(id);
    if (!o) continue;
    matched++;
    const status = f('status', 'state', 'delivery status');
    if (status) o.status = normaliseStatus(status);
    const fee = f('shipping fee', 'fees', 'delivery fee', 'shipping cost');
    if (fee !== undefined && fee !== '') o.shippingFee = toNum(fee);
    const rf = f('return fee', 'rto fee', 'return cost');
    if (rf !== undefined && rf !== '') o.returnFee = toNum(rf);
    const zone = f('zone', 'city', 'governorate');
    if (zone) o.zone = zone;
  }
  return matched;
}

/** Ad spend, one row per campaign per day. */
export function readAds(rows) {
  return rows.map((row) => {
    const f = finder(row);
    return {
      date: toDate(f('date', 'day', 'reporting starts')),
      campaign: f('campaign', 'campaign name') || 'Unnamed',
      spend: toNum(f('spend', 'amount spent', 'cost')),
      reportedValue: toNum(f('reported value', 'purchases conversion value', 'purchase conversion value', 'conversion value', 'website purchases conversion value')),
    };
  }).filter((a) => a.date && a.spend >= 0);
}

/** Product costs: product,cost */
export function readCosts(rows) {
  const out = {};
  for (const row of rows) {
    const f = finder(row);
    const p = f('product', 'name', 'title', 'sku');
    const c = f('cost', 'unit cost', 'cost per item');
    if (p && c !== undefined && c !== '') out[p] = toNum(c);
  }
  return out;
}

export const TEMPLATES = {
  orders: 'order,date,product,qty,total,status,payment,shipping fee,return fee,campaign,zone\n#1001,2026-10-01,Linen shirt,1,890,delivered,cod,65,,Retargeting,Cairo\n#1002,2026-10-01,Basic tee,2,840,returned,cod,85,45,Broad prospecting,Delta\n',
  courier: 'order,status,shipping fee,return fee,city\n#1001,Delivered,65,,Cairo\n#1002,Returned to sender,85,45,Delta\n',
  ads: 'date,campaign,spend,reported value\n2026-10-01,Retargeting,900,4200\n2026-10-01,Broad prospecting,2100,6100\n',
  costs: 'product,cost\nLinen shirt,330\nBasic tee,150\n',
};
