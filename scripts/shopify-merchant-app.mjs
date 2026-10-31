#!/usr/bin/env node
// Gives one merchant's custom app everything the main app has: the install and return
// addresses, the access scopes, the compliance webhooks, the app proxy (/apps/shiplynow, used by
// the area widget and the area page) and the storefront widget itself.
//
//   pnpm shopify:merchant-app --name nabta --client-id <the custom app's client id>
//
// It writes apps/shopify/shopify.app.<name>.toml from shopify.app.toml with that app's client
// id, then runs `shopify app deploy` with it (sign in with the Shopify account that owns the
// app when asked). Add --no-deploy to only write the file. The client secret is never needed
// here: it goes into Admin, Shopify, Custom apps.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps/shopify');
const args = process.argv.slice(2);
const arg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (message) => {
  console.error(`\n${message}\n`);
  process.exit(1);
};

const name = (arg('--name') ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
const clientId = (arg('--client-id') ?? '').trim();
if (!name || !/^[a-z0-9]{16,64}$/.test(clientId))
  fail('Usage: pnpm shopify:merchant-app --name <merchant> --client-id <the custom app client id>');
if (name === 'local') fail('"local" is kept for pnpm shopify:tunnel. Choose another name.');

const title = `Shiply Now ${name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`;
const toml = readFileSync(join(APP, 'shopify.app.toml'), 'utf8')
  .replace(/^client_id = ".*"$/m, `client_id = "${clientId}"`)
  .replace(/^name = ".*"$/m, `name = "${title}"`);
const file = `shopify.app.${name}.toml`;
writeFileSync(
  join(APP, file),
  `# Written by scripts/shopify-merchant-app.mjs for the custom app ${title}. Not committed.\n${toml}`,
);
console.log(`apps/shopify/${file} written`);

if (!args.includes('--no-deploy')) {
  console.log('\nSending the settings and the widget to Shopify. Sign in if asked.\n');
  const status = await new Promise((resolve) => {
    const run = spawn(
      'npx',
      ['--yes', '@shopify/cli@3', 'app', 'deploy', '--config', name, '--path', APP],
      { stdio: 'inherit', cwd: ROOT },
    );
    run.on('exit', resolve);
    run.on('error', () => resolve(1));
  });
  if (status !== 0) fail('shopify app deploy did not finish. Read the message above.');
  console.log(`
Done. In the merchant's Shopify admin: Online Store, Themes, Customize, App embeds,
switch on "Shiply Now 60 minutes" and save.`);
}
