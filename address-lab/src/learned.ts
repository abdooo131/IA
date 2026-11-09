// Names taught from the tester: "this word means this place". Saved in data/learned.json and
// added to the place list straight away, so every later address with that word is placed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeText } from './normalize.ts';
import { PLACES, type Place } from './places.ts';

const FILE = fileURLToPath(new URL('../data/learned.json', import.meta.url));

export interface Learned {
  name: string;
  placeId: string;
  at: string;
}

export function loadLearned(file = FILE): Learned[] {
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')) as Learned[];
}

/** The place list with every taught name added to its place. */
export function placesWithLearned(learned: Learned[] = loadLearned()): Place[] {
  const extra = new Map<string, string[]>();
  for (const l of learned) {
    if (!extra.has(l.placeId)) extra.set(l.placeId, []);
    extra.get(l.placeId)!.push(l.name);
  }
  return PLACES.map((p) => (extra.has(p.id) ? { ...p, names: [...(p.names ?? []), ...extra.get(p.id)!] } : p));
}

export function teach(name: string, placeId: string, file = FILE): Learned {
  const clean = normalizeText(name);
  if (clean.length < 2) throw new Error('The name is too short');
  if (!PLACES.some((p) => p.id === placeId)) throw new Error(`Unknown place ${placeId}`);
  const all = loadLearned(file).filter((l) => !(normalizeText(l.name) === clean && l.placeId === placeId));
  const entry = { name: name.trim(), placeId, at: new Date().toISOString() };
  all.push(entry);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
  return entry;
}

export function forget(name: string, placeId: string, file = FILE) {
  const clean = normalizeText(name);
  const all = loadLearned(file).filter((l) => !(normalizeText(l.name) === clean && l.placeId === placeId));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
}
