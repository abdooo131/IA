// Starts Shiply Now in one container: applies database migrations, optionally loads
// the starting data, then runs the API and the web app. If either stops, the
// container stops too, so the host restarts it.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
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

// DATABASE_NAME points the whole app at another database on the same server: the address in
// DATABASE_URL keeps its host, user and options and only the database name changes (used on
// 2026-11-09 to give Shiply Now alone a fresh database beside the merged version's).
if (env.DATABASE_NAME) {
  const url = new URL(env.DATABASE_URL);
  url.pathname = `/${env.DATABASE_NAME}`;
  env.DATABASE_URL = url.toString();
  log(`using database ${env.DATABASE_NAME}`);
}

log('applying database migrations');
const migrate = spawnSync(
  path.join(root, 'packages/db/node_modules/.bin/prisma'),
  ['migrate', 'deploy', '--schema', path.join(root, 'packages/db/prisma/schema.prisma')],
  { env, stdio: 'inherit' },
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

// Fresh start, starting data and the demo month run in deploy/prepare.mjs, a separate process,
// so their memory is freed before the servers start.
const resultFile = path.join(os.tmpdir(), `shiply-prepare-${process.pid}.json`);
const prepare = spawnSync(process.execPath, [path.join(root, 'deploy/prepare.mjs')], {
  env: { ...env, PREPARE_RESULT: resultFile },
  stdio: 'inherit',
});
if (prepare.status !== 0)
  log(`preparation stopped (${prepare.status ?? prepare.signal}); starting anyway`);
try {
  if (!JSON.parse(readFileSync(resultFile, 'utf8')).demoLoad) env.DEMO_LOAD = 'false';
} catch {
  /* no result: keep the environment as it is */
}
if (env.DEMO_LOAD === 'true') env.JOBS_ENABLED = 'false';

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
// Both servers share one small instance (512 MB on Render's lower plans): each gets a heap
// limit so the garbage collector works before the instance runs out of memory. Raise them with
// API_HEAP_MB and WEB_HEAP_MB on a bigger plan.
const heap = (name, fallback) => `--max-old-space-size=${Number(env[name]) || fallback}`;
start('api', process.execPath, [heap('API_HEAP_MB', 192), 'dist/main.js'], 'apps/api');
start(
  'web',
  process.execPath,
  [
    heap('WEB_HEAP_MB', 256),
    'node_modules/next/dist/bin/next',
    'start',
    '-p',
    port,
    '-H',
    '0.0.0.0',
  ],
  'apps/web',
);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => children.forEach((child) => child.kill(signal)));
}
