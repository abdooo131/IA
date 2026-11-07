// Demo store: 30 days of orders and ad spend for a small Egyptian clothing brand.
// Seeded, so every visitor sees the same numbers.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SAMPLE_PRODUCTS = [
  { name: 'Linen shirt', price: 890, cost: 330, returnRisk: 0.10 },
  { name: 'Wide leg jeans', price: 1150, cost: 470, returnRisk: 0.24 },
  { name: 'Basic tee', price: 420, cost: 150, returnRisk: 0.07 },
  { name: 'Knit cardigan', price: 1290, cost: 560, returnRisk: 0.12 },
  { name: 'Canvas tote', price: 360, cost: 120, returnRisk: 0.05 },
  { name: 'Pleated skirt', price: 760, cost: 410, returnRisk: 0.30 },
];

export const SAMPLE_ZONES = [
  { name: 'Cairo', fee: 65, returnFee: 35, share: 0.38, riskBoost: 0.0 },
  { name: 'Giza', fee: 65, returnFee: 35, share: 0.2, riskBoost: 0.0 },
  { name: 'Alexandria', fee: 75, returnFee: 40, share: 0.17, riskBoost: 0.02 },
  { name: 'Delta', fee: 85, returnFee: 45, share: 0.15, riskBoost: 0.06 },
  { name: 'Upper Egypt', fee: 110, returnFee: 55, share: 0.1, riskBoost: 0.14 },
];

export const SAMPLE_CAMPAIGNS = [
  { name: 'Retargeting', share: 0.24, dailySpend: 1100, inflate: 1.1 },
  { name: 'Lookalike buyers', share: 0.36, dailySpend: 2600, inflate: 1.15 },
  { name: 'Broad prospecting', share: 0.18, dailySpend: 3900, inflate: 1.35 },
  { name: 'Reels video', share: 0.22, dailySpend: 1700, inflate: 1.2 },
];

function pick(r, items, weightKey) {
  const total = items.reduce((t, i) => t + i[weightKey], 0);
  let x = r() * total;
  for (const i of items) {
    x -= i[weightKey];
    if (x <= 0) return i;
  }
  return items[items.length - 1];
}

export function sampleData(endDate = '2026-10-31', days = 30) {
  const r = rng(20261031);
  const orders = [];
  const ads = [];
  const end = new Date(endDate + 'T00:00:00Z');
  let n = 5000;

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    // Friday is quiet, Thursday is busy.
    const base = dow === 5 ? 34 : dow === 4 ? 70 : 52;
    const count = Math.round(base + (r() - 0.5) * 18);

    for (let k = 0; k < count; k++) {
      const p = pick(r, SAMPLE_PRODUCTS.map((x) => ({ ...x, w: 1 })), 'w');
      const z = pick(r, SAMPLE_ZONES, 'share');
      const c = r() < 0.86 ? pick(r, SAMPLE_CAMPAIGNS, 'share') : null;
      const qty = r() < 0.15 ? 2 : 1;
      const card = r() < 0.18;
      const age = i; // days since the order
      const risk = p.returnRisk + z.riskBoost + (card ? -0.05 : 0) + (c && c.name === 'Broad prospecting' ? 0.06 : 0);
      let status;
      if (r() < 0.02) status = 'cancelled';
      else if (age < 3 && r() < 0.75 - age * 0.2) status = 'in_transit';
      else status = r() < risk ? 'returned' : 'delivered';

      orders.push({
        id: `#${n++}`,
        date,
        product: p.name,
        qty,
        total: p.price * qty,
        status,
        payment: card ? 'card' : 'cod',
        shippingFee: z.fee,
        returnFee: status === 'returned' ? z.returnFee : '',
        campaign: c ? c.name : '',
        zone: z.name,
      });
    }

    for (const c of SAMPLE_CAMPAIGNS) {
      const spend = Math.round(c.dailySpend * (0.8 + r() * 0.4) * (dow === 5 ? 0.7 : 1));
      ads.push({ date, campaign: c.name, spend, reportedValue: 0 });
    }
  }

  // Ad platforms count purchases at checkout, including ones that later come back.
  for (const c of SAMPLE_CAMPAIGNS) {
    const byDay = new Map();
    for (const o of orders) {
      if (o.campaign !== c.name || o.status === 'cancelled') continue;
      byDay.set(o.date, (byDay.get(o.date) || 0) + o.total);
    }
    for (const a of ads) {
      if (a.campaign === c.name) a.reportedValue = Math.round((byDay.get(a.date) || 0) * c.inflate);
    }
  }

  const productCosts = Object.fromEntries(SAMPLE_PRODUCTS.map((p) => [p.name, p.cost]));
  return { orders, ads, productCosts };
}
