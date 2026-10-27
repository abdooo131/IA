// Load test: many orders at once, then many people watching their screens at once.
// Run against a throwaway database, never production:
//   node scripts/load-test.mjs <api url> <orders> <reads> <at a time>
// See docs/LOAD_TEST.md for how it was run and the results.
const BASE = process.argv[2] ?? 'http://localhost:4100';
const ORDERS = Number(process.argv[3] ?? 400);
const READS = Number(process.argv[4] ?? 2000);
const CONCURRENCY = Number(process.argv[5] ?? 20);

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email} ${res.status}`);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
const times = new Map();
const statuses = new Map();
async function call(name, cookie, path, init = {}) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  if (!times.has(name)) times.set(name, []);
  times.get(name).push(ms);
  const key = `${name} ${res.status}`;
  statuses.set(key, (statuses.get(key) ?? 0) + 1);
  return { status: res.status, json: async () => JSON.parse(text) };
}
async function pool(n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < n) await fn(i++);
    }),
  );
}
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const pct = (list, p) => {
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const merchant = await login('merchant@evechantelle.example', 'ShiplyDemo2026');
const staff = await login('staff.newcairo@shiplynow.local', 'ShiplyDemo2026');
const admin = await login('admin@shiplynow.local', 'ShiplyAdmin2026');
const skus = await (await call('merchant skus', merchant, '/merchant/skus')).json();
const stores = await (await call('admin stores', admin, '/admin/dark-stores')).json();
const ncr = stores.find((s) => s.code === 'NCR').id;
const points = [{ latitude: 30.03, longitude: 31.47 }];

let t0 = performance.now();
await pool(ORDERS, async (i) => {
  const sku = skus[i % skus.length];
  await call('create order', merchant, '/merchant/orders', {
    method: 'POST',
    body: JSON.stringify({
      customerName: `Load ${i}`,
      customerPhone: '0101 234 5678',
      addressText: `Street ${i}`,
      ...points[0],
      paymentMethod: 'cod',
      deliveryFeePiastres: 3000,
      items: [{ skuId: sku.id, quantity: 1 }],
    }),
  });
});
const orderSeconds = (performance.now() - t0) / 1000;

t0 = performance.now();
const reads = [
  ['store queue', staff, `/stores/${ncr}/orders`],
  ['store summary', staff, `/stores/${ncr}/summary`],
  ['admin live', admin, '/admin/live'],
  ['admin kpis 30 days', admin, `/admin/kpis?from=${daysAgo(29)}&to=${daysAgo(0)}`],
  ['admin orders list', admin, '/admin/orders'],
  ['merchant orders', merchant, '/merchant/orders'],
  ['merchant kpis', merchant, '/merchant/orders/kpis'],
  ['coverage', merchant, `/coverage?lat=30.03&lng=31.47`],
];
await pool(READS, async (i) => {
  const [n, c, p] = reads[i % reads.length];
  await call(n, c, p);
});
const readSeconds = (performance.now() - t0) / 1000;

console.log(
  `${ORDERS} orders in ${orderSeconds.toFixed(1)} s (${(ORDERS / orderSeconds).toFixed(1)}/s), ${READS} reads in ${readSeconds.toFixed(1)} s (${(READS / readSeconds).toFixed(1)}/s), ${CONCURRENCY} at a time`,
);
console.log('endpoint'.padEnd(22), 'count', '  p50', '  p95', '  max  (ms)');
for (const [name, list] of times)
  console.log(
    name.padEnd(22),
    String(list.length).padStart(5),
    pct(list, 50).toFixed(0).padStart(5),
    pct(list, 95).toFixed(0).padStart(5),
    Math.max(...list)
      .toFixed(0)
      .padStart(5),
  );
console.log([...statuses].map(([k, v]) => `${k}: ${v}`).join('\n'));
