// The preparation step of deploy/start.mjs, run as its own process so the database toolkit it
// loads (Prisma, the seed, the demo month) is freed before the servers start: on a 512 MB
// instance the launcher must stay small. It runs the one time fresh start, the starting data and
// the demo month, then writes what the launcher needs to know to PREPARE_RESULT and exits.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const port = env.PORT ?? '3000';
const log = (message) => console.log(`[start] ${message}`);

// The one time fresh start (docs/DEPLOY.md): with FRESH_START set to the confirmation word,
// the demo activity is wiped after the migrations, before the seed and before the API (and
// its jobs) start. It is one transaction: on failure nothing changed and the app starts.
const loadDb = () => {
  const require = createRequire(import.meta.url);
  return require(path.join(root, 'packages/db/dist/index.js'));
};
if (env.FRESH_START) {
  const db = loadDb();
  const prisma = new db.PrismaClient();
  try {
    if (env.FRESH_START !== db.FRESH_START_CONFIRMATION) {
      log('FRESH_START is set but is not the confirmation word; nothing was wiped');
    } else if (await db.freshStartDone(prisma)) {
      log('fresh start already done on this database; remove FRESH_START');
    } else {
      log('fresh start: wiping the demo activity (one transaction)');
      const result = await db.freshStart(prisma, { confirm: env.FRESH_START });
      log(`fresh start done; kept merchants: ${result.keptMerchants.join(', ') || 'none'}`);
      log(`fresh start: kept users: ${result.keptUsers}`);
      for (const table of Object.keys(result.before)) {
        const before = result.before[table];
        const after = result.after[table];
        if (before !== after) log(`fresh start: ${table} ${before} -> ${after}`);
      }
      log('fresh start: remove FRESH_START from the service environment');
    }
  } catch (error) {
    log(`fresh start failed, nothing changed: ${error instanceof Error ? error.message : error}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (env.SEED_ON_START === 'true') {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    log(
      'SEED_ON_START is true but SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD is missing; skipping seed',
    );
  } else {
    log('loading starting data (only missing rows are created)');
    const db = loadDb();
    const prisma = new db.PrismaClient();
    try {
      await db.seed(prisma, {
        admin: {
          email: env.SEED_ADMIN_EMAIL,
          password: env.SEED_ADMIN_PASSWORD,
          name: env.SEED_ADMIN_NAME ?? 'Shiply Admin',
        },
        demoPassword: env.SEED_DEMO_PASSWORD || env.SEED_ADMIN_PASSWORD,
        // The parcel network (docs/MERGE.md): facilities, hubs, prices and, unless
        // SEED_NETWORK_DEMO is off, its demo agents, hub staff, couriers and merchants.
        network: true,
        networkDemo: env.SEED_NETWORK_DEMO !== 'off',
        networkEverywhere: env.SEED_COVERAGE === 'all',
        log,
      });
    } finally {
      await prisma.$disconnect();
    }
  }
}

// The demo month (DEMO_LOAD=true) runs once before the servers start, and the API's background
// jobs stay paused while DEMO_LOAD is set so they never act on half simulated orders. Set
// DEMO_LOAD back to false afterwards: the next start turns the jobs on again.
// Never after the fresh start: the demo loader refuses, and the jobs must keep running.
if (env.DEMO_LOAD === 'true') {
  const db = loadDb();
  const prisma = new db.PrismaClient();
  try {
    if (await db.freshStartDone(prisma)) {
      log('DEMO_LOAD is ignored: this database had its fresh start; remove DEMO_LOAD');
      env.DEMO_LOAD = 'false';
    }
  } finally {
    await prisma.$disconnect();
  }
}
if (env.DEMO_LOAD === 'true') env.JOBS_ENABLED = 'false';

// The demo month runs first, alone: on a 512 MB instance the servers and the loader do not fit
// together (a restart midway leaves a partial month that the loader then refuses to finish).
// Meanwhile a small page answers on the public port so the host sees the service alive.
if (env.DEMO_LOAD === 'true') {
  const http = await import('node:http');
  const holding = http.createServer((_req, res) => {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' });
    res.end('Shiply is loading its demo month. Try again in a few minutes.\n');
  });
  await new Promise((resolve) => holding.listen(Number(port), '0.0.0.0', resolve));
  log('loading the demo month before the servers start (skipped when it was already loaded)');
  const db = loadDb();
  const prisma = new db.PrismaClient({
    transactionOptions: { maxWait: 20_000, timeout: 60_000 },
  });
  try {
    const result = await db.loadDemo(prisma, {
      demoPassword: env.SEED_DEMO_PASSWORD || env.SEED_ADMIN_PASSWORD,
      log,
    });
    log(`demo load: ${result.status}; set DEMO_LOAD to false to turn the jobs back on`);
  } catch (error) {
    log(`demo load failed: ${error instanceof Error ? error.message : error}`);
  } finally {
    await prisma.$disconnect();
    await new Promise((resolve) => holding.close(resolve));
  }
}

writeFileSync(env.PREPARE_RESULT, JSON.stringify({ demoLoad: env.DEMO_LOAD === 'true' }));
