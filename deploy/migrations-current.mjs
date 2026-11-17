// Asked by deploy/start.mjs before it runs `prisma migrate deploy`: exits 0 when every
// migration folder in the image is already applied (finished, not rolled back) and no
// migration is left failed, so a plain restart (a free instance waking up) skips the
// migration tool, which alone takes about 13 seconds. Any doubt (no table yet, a folder not
// applied, a failed row, an error) exits 1 and the launcher runs the real migration tool.
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, 'packages/db/prisma/migrations');
const wanted = readdirSync(folder, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const require = createRequire(import.meta.url);
const { PrismaClient } = require(path.join(root, 'packages/db/dist/index.js'));
const prisma = new PrismaClient();
let current = false;
try {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations',
  );
  const failed = rows.some((row) => row.finished_at === null && row.rolled_back_at === null);
  const applied = new Set(
    rows
      .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
      .map((row) => row.migration_name),
  );
  current = !failed && wanted.every((name) => applied.has(name));
} catch {
  current = false;
} finally {
  await prisma.$disconnect();
}
process.exit(current ? 0 : 1);
