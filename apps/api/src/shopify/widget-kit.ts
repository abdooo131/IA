import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { crc32 } from 'node:zlib';

// The kit a merchant downloads to give their own custom app our settings and the storefront
// widget: shopify.app.toml filled with their app's client id and our live addresses, the
// widget extension, and a README with the one command to run (shopify app deploy).

/** apps/shopify in the repository (or in the deployed image, which carries the whole repo). */
export function shopifyAppDir(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'apps', 'shopify');
    if (existsSync(join(candidate, 'shopify.app.toml'))) return candidate;
    const sibling = join(dir, 'shopify');
    if (existsSync(join(sibling, 'shopify.app.toml'))) return sibling;
    dir = dirname(dir);
  }
  return null;
}

/** The app name as a folder and package name: letters, digits and hyphens. */
export function kitSlug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'store'
  );
}

/** The app configuration for one merchant's app, pointing at our live server. */
export function kitToml(
  template: string,
  input: { clientId: string; name: string; publicUrl: string },
) {
  return template
    .replace(
      /^(#.*\n)+/,
      '# Shiply Now settings for this app, made by Shiply Now (Connect Shopify).\n',
    )
    .replace(/^client_id = ".*"$/m, `client_id = "${input.clientId}"`)
    .replace(/^name = ".*"$/m, `name = "${input.name.replace(/"/g, '')}"`)
    .replace(/https:\/\/shiplynow\.onrender\.com/g, input.publicUrl);
}

const README = (name: string) => `# ${name}: Shiply Now settings and storefront widget

This folder gives your Shopify app everything Shiply Now needs: the install and return
addresses, the permissions, the storefront proxy (/apps/shiplynow) and the 60 minute area
widget. You run it once; run it again only if Shiply Now asks you to.

1. Install Node.js 20 or newer from https://nodejs.org (the LTS button).
2. Unzip this file and open a terminal in the unzipped folder
   (Windows: right click the folder, Open in Terminal; Mac: Terminal, type cd and drag the folder in).
3. Run:

   npx @shopify/cli@latest app deploy

   Sign in with the Shopify account that created the app when the browser opens, and answer
   yes when it asks to release a new version.
4. Back in Shiply Now (Connect Shopify), press Open theme editor, switch on
   "Shiply Now 60 minutes" and press Save.
`;

interface ZipEntry {
  path: string;
  data: Buffer;
}

function walk(root: string, dir: string, out: ZipEntry[], prefix: string) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(root, full, out, prefix);
    else
      out.push({
        path: `${prefix}/${relative(root, full).split('\\').join('/')}`,
        data: readFileSync(full),
      });
  }
}

/** Every file of the kit, under one folder named after the app. */
export function kitFiles(
  appDir: string,
  input: { clientId: string; name: string; publicUrl: string },
): ZipEntry[] {
  const slug = kitSlug(input.name);
  const files: ZipEntry[] = [
    {
      path: `${slug}/shopify.app.toml`,
      data: Buffer.from(kitToml(readFileSync(join(appDir, 'shopify.app.toml'), 'utf8'), input)),
    },
    {
      path: `${slug}/package.json`,
      data: Buffer.from(
        `${JSON.stringify({ name: `shiplynow-${slug}`, private: true, version: '1.0.0' }, null, 2)}\n`,
      ),
    },
    { path: `${slug}/README.md`, data: Buffer.from(README(input.name)) },
  ];
  walk(appDir, join(appDir, 'extensions'), files, slug);
  return files;
}

/** A plain zip (stored, no compression): small text files, opened by every system. */
export function zip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const crc = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // names are UTF-8
    header.writeUInt16LE(0, 8); // stored
    header.writeUInt32LE(0, 10); // time and date
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(entry.data.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, entry.data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt32LE(0, 12);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(entry.data.length, 20);
    dir.writeUInt32LE(entry.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += header.length + name.length + entry.data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
