// Starts Shiply Now in one container: applies database migrations, optionally loads
// the starting data, then runs the API and the web app. If either stops, the
// container stops too, so the host restarts it.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
env.NODE_ENV ??= 'production';
env.API_PORT ??= '4000';
env.API_URL ??= `http://127.0.0.1:${env.API_PORT}`;
const port = env.PORT ?? '3000';
// Render provides its public address; anywhere else set WEB_ORIGIN yourself.
env.WEB_ORIGIN ??= env.RENDER_EXTERNAL_URL ?? `http://localhost:${port}`;
env.COOKIE_SECURE ??= env.WEB_ORIGIN.startsWith('https://') ? 'true' : 'false';

const log = (message) => console.log(`[start] ${message}`);

for (const name of ['DATABASE_URL', 'JWT_ACCESS_SECRET']) {
  if (!env[name]) {
    console.error(`[start] ${name} is not set. Add it to the service environment.`);
    process.exit(1);
  }
}

log('applying database migrations');
const migrate = spawnSync(
  path.join(root, 'packages/db/node_modules/.bin/prisma'),
  ['migrate', 'deploy', '--schema', path.join(root, 'packages/db/prisma/schema.prisma')],
  { env, stdio: 'inherit' },
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

// The one time fresh start (docs/DEPLOY.md): with FRESH_START set to the confirmation word,
// the demo activity is wiped after the migrations, before the seed and before the API (and
// its jobs) start. It is one transaction: on failure nothing changed and the app starts.
const loadDb = () => {
  const require = createRequire(import.meta.url);
  process.env.DATABASE_URL = env.DATABASE_URL;
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
        log,
      });
    } finally {
      await prisma.$disconnect();
    }
  }
}

const children = [];
function start(name, command, args, cwd) {
  const child = spawn(command, args, { cwd: path.join(root, cwd), env, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    log(`${name} stopped (${signal ?? code}); stopping the container`);
    for (const other of children) if (other !== child) other.kill('SIGTERM');
    process.exit(code ?? 1);
  });
  children.push(child);
}

// The demo month runs after the app is up (a slow host would pass the start time limit),
// with the API's background jobs paused so they never act on half simulated orders. Set
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

log(`starting API on 127.0.0.1:${env.API_PORT} and web on 0.0.0.0:${port}`);
start('api', process.execPath, ['dist/main.js'], 'apps/api');
start(
  'web',
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '-p', port, '-H', '0.0.0.0'],
  'apps/web',
);

if (env.DEMO_LOAD === 'true') {
  log('loading the demo month in the background (skipped when it was already loaded)');
  const db = loadDb();
  const prisma = new db.PrismaClient({
    transactionOptions: { maxWait: 20_000, timeout: 60_000 },
  });
  db.loadDemo(prisma, { demoPassword: env.SEED_DEMO_PASSWORD || env.SEED_ADMIN_PASSWORD, log })
    .then((result) =>
      log(`demo load: ${result.status}; set DEMO_LOAD to false to turn the jobs back on`),
    )
    .catch((error) => log(`demo load failed: ${error instanceof Error ? error.message : error}`))
    .finally(() => prisma.$disconnect());
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => children.forEach((child) => child.kill(signal)));
}
