// Runs a whole file of addresses and prints how many were placed.
//   node src/cli.ts addresses.csv [--out results.csv]
// Keep real customer files out of the repository.

import { readFileSync, writeFileSync } from 'node:fs';
import { extractAddresses, resultsToCsv, runBulk } from './bulk.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
if (!file) {
  console.error('usage: node src/cli.ts <file> [--out results.csv]');
  process.exit(1);
}

const { addresses, note } = extractAddresses(readFileSync(file, 'utf8'));
const { results, summary } = runBulk(addresses);
const pct = (n: number) => `${summary.total ? Math.round((1000 * n) / summary.total) / 10 : 0}%`;

console.log(`Read ${note}\n`);
console.log(`Placed in an area (sure or likely): ${summary.placedShare}%\n`);
for (const [status, n] of Object.entries(summary.byStatus)) {
  console.log(`  ${status.padEnd(10)} ${String(n).padStart(6)}  ${pct(n)}`);
}
console.log('\nMost common unknown words (add them to src/places.ts):');
for (const { word, count } of summary.unknownWords.slice(0, 30)) console.log(`  ${String(count).padStart(5)}  ${word}`);
if (out) {
  writeFileSync(out, resultsToCsv(results));
  console.log(`\nResults written to ${out}`);
}
