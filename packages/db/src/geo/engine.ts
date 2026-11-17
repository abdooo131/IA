import {
  ADDRESS_FILLER,
  foldPlaceText,
  GENERIC_AREA_WORDS,
  normalizeAddressText,
  OTHER_GOVERNORATE_NAMES,
  STREET_WORDS,
} from '@shiplynow/shared';
import type { Db } from '../client';

// The area engine reads an address and finds the area it names. It never decides the store:
// resolveDelivery (delivery.ts) asks who serves the area it found (docs/ZONES.md).
//
//   text ──clean──▶ names found (whole words, longest wins) ──rules──▶ deepest named area(s)
//
// Rules (docs/ZONES.md section 3):
// - The governorate never backs a street or a neighbourhood on its own.
// - A district or neighbourhood named outright wins over anything outside it; a street only
//   narrows inside an area already chosen and never picks the district.
// - Whole words only, and a name inside a longer name that was found does not count.
// - Generic or numbered names (Street 9, Neighbourhood 8, Italian district) need an area above
//   them named; a name found in several districts with none of them named is not used.
// - When several areas remain they are all returned; the caller answers unsure unless they
//   are all served the same way.

/** Names are reloaded from the database at most this often (areas change rarely). */
const NAMES_TTL_MS = 5 * 60_000;

interface NamedArea {
  id: string;
  level: number;
  parentId: string | null;
  nameEn: string;
  nameAr: string;
  /** Every name, cleaned with today's normalizeAddressText */
  aliases: string[];
  /** The aliases spelled loosely (foldPlaceText), long enough to be trusted that way */
  folded: string[];
}

interface AreaIndex {
  areas: NamedArea[];
  byId: Map<string, NamedArea>;
}

let cache: { at: number; index: AreaIndex } | null = null;

/** Forgets the cached names, after an import or a new name. */
export function forgetAreaNames() {
  cache = null;
}

type AreaRow = Omit<NamedArea, 'folded'>;

/** An index of areas to read addresses against (the database's, or a test's own). */
export function buildAreaIndex(rows: AreaRow[]): AreaIndex {
  const areas = rows.map((a) => {
    const aliases = [...new Set(a.aliases.map(normalizeAddressText))].filter((n) => n.length >= 2);
    return {
      ...a,
      aliases,
      folded: [...new Set(aliases.map(foldPlaceText))].filter(
        (f) => f.length >= 4 && !aliases.includes(f),
      ),
    };
  });
  return { areas, byId: new Map(areas.map((a) => [a.id, a])) };
}

async function areaIndex(db: Db): Promise<AreaIndex> {
  if (cache && Date.now() - cache.at < NAMES_TTL_MS) return cache.index;
  const rows = await db.geoArea.findMany({
    where: { isActive: true },
    select: { id: true, level: true, parentId: true, nameEn: true, nameAr: true, aliases: true },
  });
  const index = buildAreaIndex(rows);
  cache = { at: Date.now(), index };
  return index;
}

export interface AreaStep {
  id: string;
  level: number;
  nameEn: string;
  nameAr: string;
}

export type UnsureReason =
  | 'no_area_named'
  | 'too_coarse'
  | 'ambiguous_name'
  | 'generic_without_parent'
  | 'street_without_area';

/** What the address names, before anyone asks which store serves it. */
export type AddressReading =
  | {
      status: 'area';
      /** The deepest area named; several when the address is equally consistent with each */
      areas: AreaStep[];
      /** The first area with everything above it, governorate first */
      chain: AreaStep[];
      matched: string[];
    }
  | { status: 'outside'; reason: 'other_governorate'; chain: AreaStep[]; matched: string[] }
  | { status: 'unsure'; reason: UnsureReason; chain: AreaStep[]; matched: string[] };

interface Hit {
  area: NamedArea;
  /** The longest name of the area found */
  name: string;
  /** The name spelled loosely, used to compare names and positions */
  key: string;
  /** Word positions [start, end) of every place the name was found, in the loose text */
  spans: [number, number][];
}

function spansOf(words: string[], name: string): [number, number][] {
  const parts = name.split(' ').filter(Boolean);
  const out: [number, number][] = [];
  if (parts.length === 0) return out;
  for (let i = 0; i + parts.length <= words.length; i++)
    if (parts.every((p, j) => words[i + j] === p)) out.push([i, i + parts.length]);
  return out;
}

/**
 * The names of every area mentioned in the text as whole words, longest name kept per area.
 * Names match as written, or spelled loosely when the loose form is long enough to trust.
 */
function findHits(text: string, areas: NamedArea[]): Hit[] {
  const padded = ` ${text} `;
  const folded = foldPlaceText(text);
  const paddedFolded = ` ${folded} `;
  const foldedWords = folded.split(' ');
  const hits = new Map<string, Hit>();
  const keep = (area: NamedArea, name: string) => {
    const best = hits.get(area.id);
    if (best && name.length <= best.name.length) return;
    const key = foldPlaceText(name);
    const spans = spansOf(foldedWords, key);
    if (spans.length === 0) return;
    hits.set(area.id, { area, name, key, spans });
  };
  for (const area of areas) {
    for (const name of area.aliases) if (padded.includes(` ${name} `)) keep(area, name);
    for (const name of area.folded) if (paddedFolded.includes(` ${name} `)) keep(area, name);
  }
  return [...hits.values()];
}

/**
 * True when the text names a governorate (or its main city) outside Greater Cairo as where the
 * address is, not as a street's name ("شارع بورسعيد", "Suez Road", "جسر السويس" stay ours).
 */
export function namesOtherGovernorate(text: string) {
  const words = text.split(' ');
  return OTHER_GOVERNORATE_NAMES.some((name) => {
    const parts = name.split(' ');
    for (let i = 0; i + parts.length <= words.length; i++) {
      if (parts.some((p, j) => words[i + j] !== p)) continue;
      const before = words[i - 1];
      const after = words[i + parts.length];
      if ((before && STREET_WORDS.has(before)) || (after && STREET_WORDS.has(after))) continue;
      return true;
    }
    return false;
  });
}

/** A name that says little on its own: holds a number or a generic word ("Street 9"). */
export function isGenericName(name: string) {
  return name.split(' ').some((w) => /\d/.test(w) || GENERIC_AREA_WORDS.has(w));
}

const step = (a: NamedArea): AreaStep => ({
  id: a.id,
  level: a.level,
  nameEn: a.nameEn,
  nameAr: a.nameAr,
});

/** Reads an address against the given areas (exported for tests and the measurement). */
export function readAddressWith(index: AreaIndex, address: string): AddressReading {
  const text = normalizeAddressText(address);
  const { areas, byId } = index;
  const ancestorsCache = new Map<string, NamedArea[]>();
  const ancestors = (a: NamedArea) => {
    let out = ancestorsCache.get(a.id);
    if (out) return out;
    out = [];
    const seen = new Set([a.id]);
    let p = a.parentId ? byId.get(a.parentId) : undefined;
    while (p && !seen.has(p.id)) {
      out.push(p);
      seen.add(p.id);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    ancestorsCache.set(a.id, out);
    return out;
  };
  const isAncestor = (up: NamedArea, of: NamedArea) => ancestors(of).some((a) => a.id === up.id);
  const districtOf = (a: NamedArea) =>
    a.level === 2 ? a.id : (ancestors(a).find((p) => p.level === 2)?.id ?? null);
  const chainOf = (a: NamedArea) => [...ancestors(a)].reverse().concat(a).map(step);

  let hits = findHits(text, areas);

  // Whole words, longest wins: a name lying inside a longer name found elsewhere in the text
  // ("حسن" inside "حسن الاكبر") does not count, unless it names an area above that one.
  hits = hits.filter(
    (h) =>
      !hits.some(
        (o) =>
          o !== h &&
          o.key.length > h.key.length &&
          !isAncestor(h.area, o.area) &&
          h.spans.every(([s, e]) => o.spans.some(([os, oe]) => os <= s && e <= oe)),
      ),
  );

  // An address in Alexandria or Mansoura often shares street names with Cairo ("الجمهوريه").
  // When another governorate is named, only a district of ours named outright keeps the
  // address ours ("Cairo" alone does not: shoppers often pick it whatever their city).
  if (namesOtherGovernorate(text)) {
    const named = hits.filter((h) => h.area.level === 2);
    if (named.length === 0)
      return { status: 'outside', reason: 'other_governorate', chain: [], matched: [] };
    const keep = new Set(named.map((h) => h.area.id));
    hits = hits.filter((h) => keep.has(h.area.id) || ancestors(h.area).some((a) => keep.has(a.id)));
  }

  // "Giza" names the governorate and a district: the word counts once, for the larger area.
  // (A neighbourhood sharing its district's name is the more precise of the two and stays.)
  hits = hits.filter(
    (h) =>
      !ancestors(h.area).some(
        (a) => a.level === 1 && hits.some((o) => o.area.id === a.id && o.key === h.key),
      ),
  );

  const matched = hits.map((h) => h.name);
  const hitIds = new Set(hits.map((h) => h.area.id));
  const governorates = hits.filter((h) => h.area.level === 1);
  const districts = hits.filter((h) => h.area.level === 2);
  const namedDistrictIds = new Set(districts.map((h) => h.area.id));
  /** An area above it (district or finer; never the governorate) is named too */
  const backed = (a: NamedArea) => ancestors(a).some((p) => p.level >= 2 && hitIds.has(p.id));
  // A district named outright wins over anything outside it.
  const insideNamed = (a: NamedArea) =>
    namedDistrictIds.size === 0 || ancestors(a).some((p) => namedDistrictIds.has(p.id));

  let droppedGeneric = false;
  let droppedAmbiguous = false;
  const deep = hits.filter((h) => {
    if (h.area.level < 3 || h.area.level > 4 || !insideNamed(h.area)) return false;
    if (backed(h.area)) return true;
    if (isGenericName(h.name)) {
      droppedGeneric = true;
      return false;
    }
    // The same name in several districts, none of them named: no arbitrary pick.
    const own = districtOf(h.area);
    const elsewhere = hits.some(
      (o) =>
        o !== h &&
        o.key === h.key &&
        districtOf(o.area) !== null &&
        own !== null &&
        districtOf(o.area) !== own,
    );
    if (elsewhere) {
      droppedAmbiguous = true;
      return false;
    }
    return true;
  });

  let chosen: NamedArea[];
  if (deep.length > 0) {
    const named = (a: NamedArea) =>
      ancestors(a).filter((p) => p.level >= 2 && hitIds.has(p.id)).length;
    const rank = (h: Hit) => named(h.area) * 1000 + h.area.level * 100 + h.key.length;
    // Keep only the deepest of a chain (a compound inside a neighbourhood that is also named).
    const leaves = deep.filter((h) => !deep.some((o) => o !== h && isAncestor(h.area, o.area)));
    const top = Math.max(...leaves.map(rank));
    chosen = leaves.filter((h) => rank(h) === top).map((h) => h.area);
  } else if (districts.length > 0) {
    chosen = districts
      .filter((h) => !districts.some((o) => o !== h && isAncestor(h.area, o.area)))
      .map((h) => h.area);
  } else {
    const streets = hits.some((h) => h.area.level === 5);
    const reason: UnsureReason = droppedAmbiguous
      ? 'ambiguous_name'
      : droppedGeneric
        ? 'generic_without_parent'
        : streets
          ? 'street_without_area'
          : governorates.length > 0
            ? 'too_coarse'
            : 'no_area_named';
    const chain = governorates[0] ? chainOf(governorates[0].area) : [];
    return { status: 'unsure', reason, chain, matched };
  }

  // A street only narrows inside the one area already chosen: to the street itself, or to the
  // smallest area holding every piece of a street name that repeats inside it.
  if (chosen.length === 1) {
    const base = chosen[0]!;
    const groups = new Map<string, NamedArea[]>();
    for (const h of hits)
      if (h.area.level === 5 && isAncestor(base, h.area))
        groups.set(h.key, [...(groups.get(h.key) ?? []), h.area]);
    // Every piece of a street sits in an area table row of its own; gather pieces that share
    // a name, since findHits keeps one per area.
    for (const [key, pieces] of groups) {
      for (const a of areas)
        if (
          a.level === 5 &&
          (a.folded.includes(key) || a.aliases.some((n) => foldPlaceText(n) === key)) &&
          !pieces.includes(a) &&
          isAncestor(base, a)
        )
          pieces.push(a);
    }
    let narrowed: NamedArea | null = null;
    for (const pieces of groups.values()) {
      let target: NamedArea | null = pieces.length === 1 ? pieces[0]! : null;
      if (!target) {
        // The deepest area above every piece, still inside the chosen one.
        const common = ancestors(pieces[0]!).filter((p) =>
          pieces.every((x) => isAncestor(p, x)),
        )[0];
        target = common && common.id !== base.id && isAncestor(base, common) ? common : null;
      }
      if (!target) continue;
      if (!narrowed || isAncestor(narrowed, target)) narrowed = target;
      else if (!isAncestor(target, narrowed)) {
        narrowed = null; // two streets pointing different ways: keep the chosen area
        break;
      }
    }
    if (narrowed) chosen = [narrowed];
  }

  return { status: 'area', areas: chosen.map(step), chain: chainOf(chosen[0]!), matched };
}

/** Reads an address and finds the area it names, from the area map alone. */
export async function readAddress(db: Db, address: string): Promise<AddressReading> {
  return readAddressWith(await areaIndex(db), address);
}

/**
 * After Google placed an address, notes the words the engine did not know as a suggested name
 * for the most precise area holding Google's point. Admin approves it in the address tool.
 */
export async function learnFromPoint(
  db: Db,
  address: string,
  point: { latitude: number; longitude: number },
) {
  const text = normalizeAddressText(address);
  const { areas } = await areaIndex(db);
  const known = new Set(findHits(text, areas).flatMap((h) => h.name.split(' ')));
  const unknown = text
    .split(' ')
    // Plain numbers are building or flat numbers; words like "90th" or "5th" are kept.
    .filter((w) => !known.has(w) && !ADDRESS_FILLER.has(w) && !/^\d+$/.test(w) && w.length > 1);
  if (unknown.length === 0) return null;
  const [holder] = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM geo_areas
    WHERE is_active AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326))
    ORDER BY level DESC, ST_Area(geom) ASC LIMIT 1`;
  if (!holder) return null;
  const phrase = unknown.slice(0, 5).join(' ');
  await db.$executeRaw`
    INSERT INTO geo_suggestions (id, phrase, area_id, sample_address, updated_at)
    VALUES (gen_random_uuid()::text, ${phrase}, ${holder.id}, ${address.slice(0, 300)}, now())
    ON CONFLICT (phrase, area_id) DO UPDATE SET seen = geo_suggestions.seen + 1, updated_at = now()`;
  return { phrase, areaId: holder.id };
}

export type { AreaIndex };
/** The cached area index, for the measurement script. */
export { areaIndex };
