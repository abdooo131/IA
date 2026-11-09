// The place list turned into lookup tables: every name of every place under its matching key.

import { foldText, skeleton } from './normalize';
import { SEED_PLACES, type Kind, type Place } from './seed-places';

/** A word someone taught: it names this place from now on. */
export interface Taught {
  name: string;
  placeId: string;
}

/** How deep a kind sits: governorate 1, city or district 2, neighbourhood 3, compound 4. */
export const LEVEL: Record<Kind, number> = {
  governorate: 1,
  city: 2,
  district: 2,
  neighbourhood: 3,
  compound: 4,
  landmark: 0,
  street: 0,
};

export interface Gazetteer {
  byId: Map<string, Place>;
  /** folded name → ids of the places that carry it */
  exact: Map<string, string[]>;
  /** consonant skeleton of Latin names → ids */
  skeletons: Map<string, string[]>;
  /** folded names grouped by word count, for the typo pass */
  byWordCount: Map<number, { key: string; ids: string[] }[]>;
  maxWords: number;
}

function push(map: Map<string, string[]>, key: string, id: string) {
  const list = map.get(key);
  if (!list) map.set(key, [id]);
  else if (!list.includes(id)) list.push(id);
}

export function buildGazetteer(all: readonly Place[] = SEED_PLACES, taught: readonly Taught[] = []): Gazetteer {
  const extra = new Map<string, string[]>();
  for (const t of taught) extra.set(t.placeId, [...(extra.get(t.placeId) ?? []), t.name]);
  const places = all
    .filter((p) => p.active !== false)
    .map((p) => (extra.has(p.id) ? { ...p, names: [...(p.names ?? []), ...extra.get(p.id)!] } : p));
  const byId = new Map<string, Place>();
  const exact = new Map<string, string[]>();
  const skeletons = new Map<string, string[]>();
  for (const place of places) {
    if (byId.has(place.id)) throw new Error(`Duplicate place id ${place.id}`);
    byId.set(place.id, place);
  }
  for (const place of places) {
    // A place whose parent was retired keeps working; it just has no family above it.
    if (place.parent && !byId.has(place.parent)) continue;
    for (const name of [place.en, place.ar, ...(place.names ?? [])]) {
      const key = foldText(name);
      if (!key) continue;
      push(exact, key, place.id);
      const sk = skeleton(key);
      if (sk) push(skeletons, sk, place.id);
    }
  }
  const byWordCount = new Map<number, { key: string; ids: string[] }[]>();
  let maxWords = 1;
  for (const [key, ids] of exact) {
    const n = key.split(' ').length;
    maxWords = Math.max(maxWords, n);
    if (!byWordCount.has(n)) byWordCount.set(n, []);
    byWordCount.get(n)!.push({ key, ids });
  }
  return { byId, exact, skeletons, byWordCount, maxWords };
}

/** The place itself and every place above it, nearest first. */
export function chainOf(g: Gazetteer, id: string): Place[] {
  const out: Place[] = [];
  let cur = g.byId.get(id);
  while (cur) {
    out.push(cur);
    cur = cur.parent ? g.byId.get(cur.parent) : undefined;
  }
  return out;
}

/** The area a match points at: a landmark or a street points at the area it sits in. */
export function areaOf(g: Gazetteer, id: string): Place {
  let cur = g.byId.get(id)!;
  while ((cur.kind === 'landmark' || cur.kind === 'street') && cur.parent) {
    cur = g.byId.get(cur.parent)!;
  }
  return cur;
}
