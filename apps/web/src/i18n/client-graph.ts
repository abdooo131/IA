import fs from 'node:fs';
import path from 'node:path';

// For tests only (never imported by the app): follows the imports of the web app from a scope's
// route files and lists the translation namespaces its client components use. A module is a
// client one when it starts with 'use client' or is imported (directly or not) by one; server
// components read the full messages on the server and need nothing from the client provider.

const SRC = path.resolve(__dirname, '..');
const EXTENSIONS = ['.tsx', '.ts', '/index.tsx', '/index.ts'];

const IMPORT =
  /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const USE_T = /useTranslations\(\s*([^)]*?)\s*\)/g;

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (/\.(tsx?|css|json|svg|png)$/.test(base))
    return fs.existsSync(base) && /\.tsx?$/.test(base) ? base : null;
  for (const ext of EXTENSIONS) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

interface ModuleInfo {
  client: boolean;
  imports: string[];
  /** Namespaces given to useTranslations ('' for the root, which needs everything) */
  namespaces: string[];
  /** useTranslations calls whose namespace is not a plain string */
  dynamic: number;
}

const cache = new Map<string, ModuleInfo>();

function info(file: string): ModuleInfo {
  const hit = cache.get(file);
  if (hit) return hit;
  const text = fs.readFileSync(file, 'utf8');
  const client = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(text);
  const imports: string[] = [];
  for (const m of text.matchAll(IMPORT)) {
    const target = resolve(file, (m[1] ?? m[2])!);
    if (target) imports.push(target);
  }
  const namespaces: string[] = [];
  let dynamic = 0;
  for (const m of text.matchAll(USE_T)) {
    const arg = m[1]!;
    if (arg === '') namespaces.push('');
    else if (/^'[^']*'$|^"[^"]*"$/.test(arg)) namespaces.push(arg.slice(1, -1));
    else dynamic += 1;
  }
  const found = { client, imports, namespaces, dynamic };
  cache.set(file, found);
  return found;
}

/** Every .ts/.tsx file under a path of src (a file or a folder), tests left out. */
export function sourceFiles(relative: string): string[] {
  const full = path.join(SRC, relative);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs
    .readdirSync(full, { recursive: true, encoding: 'utf8' })
    .map((f) => path.join(full, f))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
}

export interface ClientNeeds {
  /** Namespaces the scope's client components use, as written ('finance.payables') */
  namespaces: Set<string>;
  /** Client files with useTranslations() at the root or with a namespace not written out */
  unclear: string[];
}

/** What the client components reached from these route files use. */
export function clientNeeds(entries: string[]): ClientNeeds {
  const seen = new Set<string>();
  const namespaces = new Set<string>();
  const unclear: string[] = [];
  const visit = (file: string, inClient: boolean) => {
    const mod = info(file);
    const client = inClient || mod.client;
    const key = `${client ? 'c' : 's'}:${file}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (client) {
      for (const ns of mod.namespaces) if (ns) namespaces.add(ns);
      if (mod.dynamic || mod.namespaces.includes('')) unclear.push(path.relative(SRC, file));
    }
    for (const target of mod.imports) visit(target, client);
  };
  for (const entry of entries) for (const file of sourceFiles(entry)) visit(file, false);
  return { namespaces, unclear };
}

/** Whether a picked list covers a namespace (the namespace itself or one of its parents). */
export function covers(picked: readonly string[], namespace: string) {
  return picked.some((p) => namespace === p || namespace.startsWith(`${p}.`));
}
