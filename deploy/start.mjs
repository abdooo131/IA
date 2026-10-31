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

if (env.SEED_ON_START === 'true') {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    log(
      'SEED_ON_START is true but SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD is missing; skipping seed',
    );
  } else {
    log('loading starting data (only missing rows are created)');
    const require = createRequire(import.meta.url);
    const db = require(path.join(root, 'packages/db/dist/index.js'));
    process.env.DATABASE_URL = env.DATABASE_URL;
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

log(`starting API on 127.0.0.1:${env.API_PORT} and web on 0.0.0.0:${port}`);
start('api', process.execPath, ['dist/main.js'], 'apps/api');
start(
  'web',
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '-p', port, '-H', '0.0.0.0'],
  'apps/web',
);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => children.forEach((child) => child.kill(signal)));
}
