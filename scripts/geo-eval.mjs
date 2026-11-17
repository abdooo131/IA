// Measures how the one delivery decision (resolveDelivery, docs/ZONES.md) places addresses:
// the share served, unsure and outside, the reasons, and what decided. Read only: it never
// writes to the database, never calls Google, and prints no address.
//
//   pnpm build:packages
//   DATABASE_URL=<database to measure> node scripts/geo-eval.mjs <file> [--by-store]
//
// <file> holds one address per line (address1, address2, city, province joined by ", ", as the
// checkout and fulfillment build them). Keep such files out of the repository: they are
// customer data.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { PrismaClient, resolveDelivery } = require('../packages/db/dist/index.js');

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/geo-eval.mjs <file with one address per line> [--by-store]');
  process.exit(1);
}
const byStore = process.argv.includes('--by-store');
const lines = readFileSync(file, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);

const prisma = new PrismaClient();
const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const status = new Map();
const reasons = new Map();
const decidedBy = new Map();
const stores = new Map();
try {
  for (const text of lines) {
    const d = await resolveDelivery(prisma, { addressText: text });
    count(status, d.status);
    count(reasons, `${d.status}: ${d.reason}`);
    if (d.status === 'served') {
      count(decidedBy, `${d.confidence}, area level ${d.area?.level ?? '-'}`);
      count(stores, d.store.code);
    }
  }
} finally {
  await prisma.$disconnect();
}

const pct = (n) => `${((100 * n) / lines.length).toFixed(1)}%`;
const show = (title, map) => {
  console.log(`\n${title}`);
  for (const [k, n] of [...map].sort((a, b) => b[1] - a[1]))
    console.log(`  ${k.padEnd(44)} ${String(n).padStart(5)}  ${pct(n)}`);
};
console.log(`${lines.length} addresses`);
show('Decision', status);
show('Reason', reasons);
show('Served, decided by', decidedBy);
if (byStore) show('Served, by store', stores);
