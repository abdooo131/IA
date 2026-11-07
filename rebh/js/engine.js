// Rebh profit engine.
// Pure functions: orders + ad spend + cost settings in, a full profit picture out.
// No DOM access here, so the same file runs in the browser and in Node tests.

export const STATUS = Object.freeze({
  DELIVERED: 'delivered',
  RETURNED: 'returned',
  IN_TRANSIT: 'in_transit',
  CANCELLED: 'cancelled',
});

export const DEFAULT_SETTINGS = Object.freeze({
  currency: 'EGP',
  packagingPerOrder: 9,
  codFeePct: 1,
  cardFeePct: 2.5,
  // Used only when an order has no return fee of its own.
  defaultReturnFee: 40,
  // Used only when a product has no cost of its own: share of the item price.
  defaultCostPct: 40,
  fixedExpenses: 45000,
  // Keys are product names, values are unit cost.
  productCosts: {},
});

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

/** Normalise a free text status from a store or courier into one of STATUS. */
export function normaliseStatus(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return STATUS.IN_TRANSIT;
  if (/cancel|void/.test(s)) return STATUS.CANCELLED;
  if (/return|rto|refus|reject|rts/.test(s)) return STATUS.RETURNED;
  if (/deliver|paid|complete|collected|success/.test(s) && !/out for|undeliver|not deliver/.test(s)) {
    return STATUS.DELIVERED;
  }
  return STATUS.IN_TRANSIT;
}

/** Unit cost for a product, falling back to a share of its unit price. */
export function unitCost(product, unitPrice, settings) {
  const own = settings.productCosts?.[product];
  if (own !== undefined && own !== '' && Number.isFinite(num(own, NaN))) return num(own);
  return unitPrice * (num(settings.defaultCostPct) / 100);
}

/**
 * Money for one order. Recognises revenue only when the parcel was delivered
 * and paid; a return still costs the outbound trip, the return trip and packaging.
 */
export function orderEconomics(order, settings) {
  const qty = Math.max(0, num(order.qty, 1));
  const total = num(order.total);
  const status = order.status;
  const unitPrice = qty > 0 ? total / qty : 0;
  const isCod = String(order.payment ?? 'cod').toLowerCase() !== 'card';

  const base = {
    id: order.id, date: order.date, product: order.product, campaign: order.campaign || '',
    zone: order.zone || '', qty, total, status, isCod,
    revenue: 0, productCost: 0, shipping: 0, returnFee: 0, packaging: 0, paymentFee: 0,
    net: 0, pending: false,
  };

  if (status === STATUS.CANCELLED) return base;
  if (status === STATUS.IN_TRANSIT) return { ...base, pending: true };

  const shipping = num(order.shippingFee);
  const packaging = num(settings.packagingPerOrder);

  if (status === STATUS.RETURNED) {
    const returnFee = order.returnFee !== undefined && order.returnFee !== ''
      ? num(order.returnFee)
      : num(settings.defaultReturnFee);
    const net = -(shipping + returnFee + packaging);
    return { ...base, shipping, returnFee, packaging, net: round2(net) };
  }

  // Delivered.
  const productCost = unitCost(order.product, unitPrice, settings) * qty;
  const feePct = isCod ? num(settings.codFeePct) : num(settings.cardFeePct);
  const paymentFee = total * (feePct / 100);
  const net = total - productCost - shipping - packaging - paymentFee;
  return {
    ...base, revenue: total, productCost: round2(productCost), shipping, packaging,
    paymentFee: round2(paymentFee), net: round2(net),
  };
}

const sum = (arr, key) => arr.reduce((t, x) => t + (typeof key === 'function' ? key(x) : x[key]), 0);

function daysBetween(dates) {
  if (!dates.length) return [];
  const sorted = [...dates].sort();
  const out = [];
  const d = new Date(sorted[0] + 'T00:00:00Z');
  const end = new Date(sorted[sorted.length - 1] + 'T00:00:00Z');
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * The whole picture.
 * @param {Array} orders  {id,date,product,qty,total,status,payment,shippingFee,returnFee,campaign,zone}
 * @param {Array} ads     {date,campaign,spend,reportedValue}
 * @param {Object} settingsIn
 */
export function analyse(orders, ads = [], settingsIn = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...settingsIn, productCosts: { ...(settingsIn.productCosts || {}) } };
  const rows = orders.map((o) => orderEconomics(o, settings));
  const live = rows.filter((r) => r.status !== STATUS.CANCELLED);
  const delivered = rows.filter((r) => r.status === STATUS.DELIVERED);
  const returned = rows.filter((r) => r.status === STATUS.RETURNED);
  const pending = rows.filter((r) => r.status === STATUS.IN_TRANSIT);

  const adSpend = sum(ads, (a) => num(a.spend));
  const reportedValue = sum(ads, (a) => num(a.reportedValue));

  const days = daysBetween([...rows.map((r) => r.date), ...ads.map((a) => a.date)].filter(Boolean));
  const fixed = num(settings.fixedExpenses);
  // Fixed costs are monthly; charge the share that matches the period shown.
  const fixedForPeriod = days.length ? fixed * (days.length / 30) : 0;
  const fixedPerDay = days.length ? fixedForPeriod / days.length : 0;

  const bookedSales = sum(live, 'total');
  const revenue = sum(delivered, 'revenue');
  const productCost = sum(delivered, 'productCost');
  const shipping = sum([...delivered, ...returned], 'shipping');
  const returnFees = sum(returned, 'returnFee');
  const packaging = sum([...delivered, ...returned], 'packaging');
  const paymentFees = sum(delivered, 'paymentFee');
  const returnedValue = sum(returned, 'total');
  const pendingValue = sum(pending, 'total');

  const contribution = revenue - productCost - shipping - returnFees - packaging - paymentFees;
  const netProfit = contribution - adSpend - fixedForPeriod;

  const settled = delivered.length + returned.length;
  const returnRate = settled ? returned.length / settled : 0;

  const contributionMargin = revenue ? contribution / revenue : 0;
  const trueRoas = adSpend ? revenue / adSpend : 0;
  const reportedRoas = adSpend ? reportedValue / adSpend : 0;
  const breakEvenRoas = contributionMargin > 0 ? 1 / contributionMargin : Infinity;

  // Daily table.
  const daily = days.map((date) => {
    const dRows = rows.filter((r) => r.date === date);
    const dLive = dRows.filter((r) => r.status !== STATUS.CANCELLED);
    const dAds = sum(ads.filter((a) => a.date === date), (a) => num(a.spend));
    const dNetOrders = sum(dRows, 'net');
    return {
      date,
      orders: dLive.length,
      booked: round2(sum(dLive, 'total')),
      revenue: round2(sum(dRows, 'revenue')),
      adSpend: round2(dAds),
      delivery: round2(sum(dRows, (r) => r.shipping + r.returnFee)),
      returned: dRows.filter((r) => r.status === STATUS.RETURNED).length,
      net: round2(dNetOrders - dAds - fixedPerDay),
    };
  });

  // Products.
  const byProduct = new Map();
  for (const r of rows) {
    if (r.status === STATUS.CANCELLED) continue;
    const p = byProduct.get(r.product) || { product: r.product, orders: 0, delivered: 0, returned: 0, units: 0, revenue: 0, cost: 0, net: 0 };
    p.orders += 1;
    if (r.status === STATUS.DELIVERED) { p.delivered += 1; p.units += r.qty; }
    if (r.status === STATUS.RETURNED) p.returned += 1;
    p.revenue += r.revenue;
    p.cost += r.productCost;
    p.net += r.net;
    byProduct.set(r.product, p);
  }
  const products = [...byProduct.values()].map((p) => ({
    ...p,
    revenue: round2(p.revenue), cost: round2(p.cost), net: round2(p.net),
    margin: p.revenue ? p.net / p.revenue : 0,
    returnRate: (p.delivered + p.returned) ? p.returned / (p.delivered + p.returned) : 0,
  })).sort((a, b) => b.net - a.net);

  // Campaigns: what the ad platform says versus what was delivered and paid.
  const byCampaign = new Map();
  const camp = (name) => {
    if (!byCampaign.has(name)) byCampaign.set(name, { campaign: name, spend: 0, reportedValue: 0, revenue: 0, contribution: 0, orders: 0, returned: 0 });
    return byCampaign.get(name);
  };
  for (const a of ads) {
    const c = camp(a.campaign || 'Unnamed');
    c.spend += num(a.spend);
    c.reportedValue += num(a.reportedValue);
  }
  for (const r of rows) {
    if (!r.campaign || r.status === STATUS.CANCELLED) continue;
    const c = camp(r.campaign);
    c.orders += 1;
    if (r.status === STATUS.RETURNED) c.returned += 1;
    c.revenue += r.revenue;
    c.contribution += r.net;
  }
  const campaigns = [...byCampaign.values()].map((c) => ({
    ...c,
    spend: round2(c.spend), reportedValue: round2(c.reportedValue), revenue: round2(c.revenue),
    contribution: round2(c.contribution),
    reportedRoas: c.spend ? c.reportedValue / c.spend : 0,
    trueRoas: c.spend ? c.revenue / c.spend : 0,
    profitAfterAds: round2(c.contribution - c.spend),
  })).sort((a, b) => b.spend - a.spend);

  // Zones: where returns and delivery costs concentrate.
  const byZone = new Map();
  for (const r of rows) {
    if (!r.zone || r.status === STATUS.CANCELLED || r.status === STATUS.IN_TRANSIT) continue;
    const z = byZone.get(r.zone) || { zone: r.zone, parcels: 0, returned: 0, deliveryCost: 0 };
    z.parcels += 1;
    if (r.status === STATUS.RETURNED) z.returned += 1;
    z.deliveryCost += r.shipping + r.returnFee;
    byZone.set(r.zone, z);
  }
  const zones = [...byZone.values()].map((z) => ({
    ...z, deliveryCost: round2(z.deliveryCost),
    returnRate: z.parcels ? z.returned / z.parcels : 0,
    costPerParcel: z.parcels ? z.deliveryCost / z.parcels : 0,
  })).sort((a, b) => b.parcels - a.parcels);

  const summary = {
    currency: settings.currency,
    days: days.length,
    from: days[0] || null,
    to: days[days.length - 1] || null,
    ordersBooked: live.length,
    ordersDelivered: delivered.length,
    ordersReturned: returned.length,
    ordersPending: pending.length,
    ordersCancelled: rows.length - live.length,
    bookedSales: round2(bookedSales),
    revenue: round2(revenue),
    returnedValue: round2(returnedValue),
    pendingValue: round2(pendingValue),
    productCost: round2(productCost),
    shipping: round2(shipping),
    returnFees: round2(returnFees),
    packaging: round2(packaging),
    paymentFees: round2(paymentFees),
    adSpend: round2(adSpend),
    fixed: round2(fixedForPeriod),
    contribution: round2(contribution),
    netProfit: round2(netProfit),
    keepRate: bookedSales ? netProfit / bookedSales : 0,
    returnRate,
    contributionMargin,
    trueRoas,
    reportedRoas,
    breakEvenRoas,
    costPerDelivered: delivered.length
      ? (shipping + returnFees + packaging + paymentFees) / delivered.length
      : 0,
  };

  // Money walk from booked sales to net profit. Each step is signed.
  const waterfall = [
    { key: 'booked', label: 'Booked sales', value: summary.bookedSales, total: true },
    { key: 'returned', label: 'Returned or refused', value: -summary.returnedValue },
    { key: 'pending', label: 'Still on the road', value: -summary.pendingValue },
    { key: 'cogs', label: 'Product cost', value: -summary.productCost },
    { key: 'shipping', label: 'Shipping and return trips', value: -(summary.shipping + summary.returnFees) },
    { key: 'fees', label: 'COD and card fees', value: -summary.paymentFees },
    { key: 'packaging', label: 'Packaging', value: -summary.packaging },
    { key: 'ads', label: 'Ad spend', value: -summary.adSpend },
    { key: 'fixed', label: 'Fixed expenses', value: -summary.fixed },
    { key: 'net', label: 'Net profit', value: summary.netProfit, total: true },
  ];

  return { settings, summary, waterfall, daily, products, campaigns, zones, orders: rows, checks: findChecks(summary, products, campaigns, zones) };
}

/** Plain rules that point at the biggest leaks. Every check cites its numbers. */
export function findChecks(summary, products, campaigns, zones) {
  const out = [];
  const money = (n) => `${summary.currency} ${Math.round(n).toLocaleString('en-US')}`;
  const pct = (n) => `${(n * 100).toFixed(1)}%`;

  const losing = campaigns.filter((c) => c.spend > 0 && c.trueRoas < summary.breakEvenRoas);
  for (const c of losing.slice(0, 2)) {
    out.push({
      level: 'serious',
      title: `${c.campaign} loses money after delivery`,
      body: `The ad platform reports ${c.reportedRoas.toFixed(1)}x, but delivered sales give ${c.trueRoas.toFixed(1)}x. You need ${summary.breakEvenRoas.toFixed(1)}x to break even. It lost ${money(-c.profitAfterAds)} after ads.`,
      impact: Math.max(0, -c.profitAfterAds),
    });
  }

  const avgReturn = summary.returnRate;
  const badProducts = products.filter((p) => p.orders >= 10 && p.returnRate > Math.max(0.15, avgReturn * 1.5));
  for (const p of badProducts.slice(0, 2)) {
    out.push({
      level: 'warning',
      title: `${p.product} comes back too often`,
      body: `${pct(p.returnRate)} of its parcels were returned or refused, against ${pct(avgReturn)} for the store. Check sizing, photos and the description.`,
      impact: p.returned * (summary.costPerDelivered || 0),
    });
  }

  const badZones = zones.filter((z) => z.parcels >= 15 && z.returnRate > Math.max(0.15, avgReturn * 1.4));
  for (const z of badZones.slice(0, 1)) {
    out.push({
      level: 'warning',
      title: `Returns are high in ${z.zone}`,
      body: `${pct(z.returnRate)} of parcels to ${z.zone} came back, costing ${money(z.deliveryCost)} in delivery. Consider asking for a deposit or confirming orders by phone there.`,
      impact: z.returned * z.costPerParcel,
    });
  }

  const negative = products.filter((p) => p.delivered >= 5 && p.net < 0);
  for (const p of negative.slice(0, 1)) {
    out.push({
      level: 'critical',
      title: `${p.product} loses money on every sale`,
      body: `After product cost, delivery, returns and fees it is ${money(p.net)} for the period. Raise the price or cut its cost.`,
      impact: -p.net,
    });
  }

  if (summary.bookedSales > 0 && summary.keepRate < 0.1) {
    out.push({
      level: 'serious',
      title: 'You keep very little of what you sell',
      body: `Out of ${money(summary.bookedSales)} booked, ${money(summary.netProfit)} is profit (${pct(summary.keepRate)}).`,
      impact: 0,
    });
  }

  if (!out.length) {
    out.push({ level: 'good', title: 'No big leaks found', body: 'Every campaign clears break even and no product or zone has unusual returns.', impact: 0 });
  }
  return out.sort((a, b) => b.impact - a.impact);
}
