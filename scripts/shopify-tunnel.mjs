// Points the Shopify app at a local Shiply Now running behind a tunnel, for testing on a dev
// store without deploying the server:
//   pnpm shopify:tunnel https://<words>.trycloudflare.com
// It sets WEB_ORIGIN and the Shopify keys in .env (asking for the client secret without
// showing it), writes apps/shopify/shopify.app.local.toml with the tunnel address and runs
// `shopify app deploy` with it, which sends the URLs, scopes, webhooks, app proxy and the
// storefront widget to Shopify. Add --no-deploy to only update the files.
import { spawnSync } from 'node:child_process';
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
const given = args.find((a) => !a.startsWith('--'));

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

let origin;
try {
  origin = new URL(given ?? '');
} catch {
  fail(
    'Give the tunnel address, for example:\n  pnpm shopify:tunnel https://some-words.trycloudflare.com',
  );
}
if (origin.protocol !== 'https:') fail('The tunnel address must start with https://');
const url = origin.origin;

/** Reads a line without echoing it, so the secret never shows on screen. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    rl._writeToOutput = () => {};
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
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
writeFileSync(ENV, env);
console.log(`.env updated: WEB_ORIGIN=${url}`);

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
  const run = spawnSync(
    'npx',
    ['--yes', '@shopify/cli@3', 'app', 'deploy', '--config', 'local', '--path', APP],
    { stdio: 'inherit', cwd: ROOT },
  );
  if (run.status !== 0) fail('shopify app deploy did not finish. Read the message above.');
}

console.log(`
Done. Next:
  1. Restart the app: Ctrl+C in the pnpm dev window, then pnpm dev
  2. Open ${url}/admin and sign in as admin
  3. Shopify page: link shiplynow-test to a merchant, then press Install
Keep the tunnel window open. A new tunnel address means running this again.
`);
