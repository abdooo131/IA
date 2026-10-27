// Points the Shopify app at a local Shiply Now running behind a tunnel, for testing on a dev
// store without deploying the server:
//   pnpm shopify:tunnel                 starts a cloudflared tunnel and keeps it open
//   pnpm shopify:tunnel https://<words>.trycloudflare.com   uses a tunnel already running
//   pnpm local                          everything in one window: frees ports 3000 and 4000,
//                                       starts the database and applies its updates, the
//                                       tunnel and then pnpm dev
// It sets WEB_ORIGIN and the Shopify keys in .env (asking for the client secret without
// showing it), writes apps/shopify/shopify.app.local.toml with the tunnel address and runs
// `shopify app deploy` with it, which sends the URLs, scopes, webhooks, app proxy and the
// storefront widget to Shopify. Add --no-deploy to only update the files.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV = join(ROOT, '.env');
const APP = join(ROOT, 'apps/shopify');
const CLIENT_ID = 'f861196e9ba7d2e755655e4e29132d82';

const args = process.argv.slice(2);
const deploy = !args.includes('--no-deploy');
const dev = args.includes('--dev');
/** Processes this script started; Ctrl+C stops them all. */
const children = [];
process.on('SIGINT', () => {
  for (const child of children) {
    child.removeAllListeners('exit');
    child.kill('SIGINT');
  }
  console.log('\nStopped.');
  process.exit(0);
});
const given = args.find((a) => !a.startsWith('--'));

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** Starts a quick cloudflared tunnel to the web app and resolves with its address. */
function startTunnel() {
  return new Promise((resolve) => {
    console.log('Starting the tunnel (cloudflared)...');
    const child = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:3000'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', () =>
      fail('cloudflared is not installed. Install it with: brew install cloudflared'),
    );
    // Ctrl+C reaches every process in the window; stopping by signal is not an error.
    child.on('exit', (code, signal) =>
      signal ? process.exit(0) : fail(`The tunnel stopped (code ${code}). Run this again.`),
    );
    let found = false;
    const timer = setTimeout(() => fail('The tunnel gave no address within a minute.'), 60_000);
    const read = (chunk) => {
      const text = String(chunk);
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text);
      if (!found && match) {
        found = true;
        clearTimeout(timer);
        resolve({ url: match[0], child });
      } else if (found && /\bERR\b/.test(text)) {
        process.stdout.write(`[tunnel] ${text}`);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    children.push(child);
  });
}

if (dev) {
  // A previous run may still hold the ports; this run replaces it.
  for (const port of [3000, 4000]) {
    const pids = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' })
      .stdout?.split('\n')
      .filter(Boolean);
    for (const pid of pids ?? []) {
      try {
        process.kill(Number(pid));
      } catch {
        // already gone
      }
    }
  }
  console.log('Starting the database (docker compose)...');
  const db = spawnSync('docker', ['compose', 'up', '-d'], { cwd: ROOT, stdio: 'inherit' });
  if (db.status !== 0)
    fail('The database did not start. Open Docker Desktop, wait for it, then run this again.');
  // Database updates from a git pull; the database may need a few seconds after starting.
  console.log('Applying database updates...');
  let migrated = false;
  for (let attempt = 0; attempt < 10 && !migrated; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    migrated = spawnSync('pnpm', ['db:deploy'], { cwd: ROOT, stdio: 'ignore' }).status === 0;
  }
  if (!migrated) fail('Database updates failed. Run: pnpm db:deploy   to see why.');
}

let url;
let tunnel = null;
if (given) {
  let origin;
  try {
    origin = new URL(given);
  } catch {
    fail('That is not an address. Run it without one and the tunnel starts by itself.');
  }
  if (origin.protocol !== 'https:') fail('The tunnel address must start with https://');
  // The examples in the instructions are not real tunnels.
  if (/^(new-address|some-words|some-random-words|your)/i.test(origin.hostname))
    fail('That is the example address. Run: pnpm shopify:tunnel   (the tunnel starts by itself)');
  url = origin.origin;
} else {
  ({ url, child: tunnel } = await startTunnel());
  console.log(`Tunnel address: ${url}`);
}

/** Reads a line without echoing it, so the secret never shows on screen. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => {
      if (!muted) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = true;
  });
}

/** Sets KEY=value in the .env text, replacing the line or adding it at the end. */
function setVar(text, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(text) ? text.replace(pattern, () => line) : `${text.trimEnd()}\n${line}\n`;
}

if (!existsSync(ENV)) fail('No .env in the project folder. Copy .env.example to .env first.');
let env = readFileSync(ENV, 'utf8');
env = setVar(env, 'WEB_ORIGIN', url);
env = setVar(env, 'SHOPIFY_API_KEY', CLIENT_ID);
const secret = /^SHOPIFY_API_SECRET=(.*)$/m.exec(env)?.[1]?.trim();
if (!secret) {
  const typed = await askHidden(
    'Paste the Client secret from the Shopify Dev Dashboard (it stays hidden), then Enter: ',
  );
  if (!typed) fail('No secret given; nothing changed.');
  env = setVar(env, 'SHOPIFY_API_SECRET', typed);
}
// Checkout needs addresses placed on the map; without a Google key use OpenStreetMap locally.
const googleKey = /^GOOGLE_MAPS_API_KEY=(.*)$/m.exec(env)?.[1]?.trim();
if (!googleKey) env = setVar(env, 'GEOCODER', 'osm');
writeFileSync(ENV, env);
console.log(`.env updated: WEB_ORIGIN=${url}${googleKey ? '' : ', GEOCODER=osm'}`);

const toml = readFileSync(join(APP, 'shopify.app.toml'), 'utf8')
  .split('\n')
  .map((line) => (line.startsWith('#') ? line : line.replaceAll('RENDER_URL', url)))
  .join('\n');
writeFileSync(
  join(APP, 'shopify.app.local.toml'),
  `# Written by scripts/shopify-tunnel.mjs for ${url}. Not committed.\n${toml}`,
);
console.log('apps/shopify/shopify.app.local.toml written');

if (deploy) {
  console.log('\nSending the settings to Shopify. Sign in with your Shopify account if asked.\n');
  const status = await new Promise((resolve) => {
    const run = spawn(
      'npx',
      ['--yes', '@shopify/cli@3', 'app', 'deploy', '--config', 'local', '--path', APP],
      { stdio: 'inherit', cwd: ROOT },
    );
    run.on('exit', resolve);
    run.on('error', () => resolve(1));
  });
  if (status !== 0 && dev) {
    // Shopify itself can be briefly down; the app still runs and the settings can follow later.
    console.log(`
Shopify did not take the new settings (read the message above). The app starts anyway.
To retry only that step, open another Terminal window and run:
  cd ~/ShiplyNowApp && pnpm shopify:tunnel ${url}
`);
  } else if (status !== 0) {
    tunnel?.removeAllListeners('exit');
    tunnel?.kill();
    fail('shopify app deploy did not finish. Read the message above.');
  }
}

if (dev) {
  console.log('\nStarting the app (pnpm dev)...\n');
  const app = spawn('pnpm', ['dev'], { cwd: ROOT, stdio: 'inherit' });
  app.on('exit', (code, signal) =>
    signal ? process.exit(0) : fail(`The app stopped (code ${code}). Read the message above.`),
  );
  children.push(app);
  console.log(`
When you see "Ready" below, open ${url}/admin and sign in as admin.
Everything runs in THIS window: leave it open. Ctrl+C stops it all.
`);
} else {
  console.log(`
Done. Next:
  1. Restart the app: Ctrl+C in the pnpm dev window, then pnpm dev
  2. Open ${url}/admin and sign in as admin
  3. Shopify page: press Register locations (or Install if the shop is not installed yet)
${
  tunnel
    ? 'The tunnel runs in THIS window: leave it open. Ctrl+C here closes it.'
    : 'Keep the tunnel window open. A new tunnel address means running this again.'
}
`);
}
