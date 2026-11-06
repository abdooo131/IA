import { PrismaClient } from '@prisma/client';
import { loadDemo } from '../src/demo';

// Loads one month of demo activity (see src/demo). Refuses to run unless DEMO_LOAD=true and
// does nothing when the demo was already loaded.
const prisma = new PrismaClient({ transactionOptions: { maxWait: 20_000, timeout: 60_000 } });

async function main() {
  if (process.env.DEMO_LOAD !== 'true') {
    console.error('Refusing to load demo data: set DEMO_LOAD=true to confirm.');
    process.exitCode = 1;
    return;
  }
  const password = process.env.SEED_DEMO_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('Set SEED_DEMO_PASSWORD (or SEED_ADMIN_PASSWORD) in .env first');
  const result = await loadDemo(prisma, {
    demoPassword: password,
    days: process.env.DEMO_DAYS ? Number(process.env.DEMO_DAYS) : undefined,
    ordersPerDay: process.env.DEMO_ORDERS_PER_DAY
      ? Number(process.env.DEMO_ORDERS_PER_DAY)
      : undefined,
    log: (message) => console.log(message),
  });
  if (result.status === 'loaded') console.log(JSON.stringify(result.counts, null, 2));
  if (result.status === 'partial_run_found' || result.status === 'fresh_start_done')
    process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
