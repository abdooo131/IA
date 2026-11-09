// The address engine: one address in, its parts and its area out.
//
// 1. Clean the text and split it into words.
// 2. Take out the numbered parts (building, floor, apartment, villa, block, entrance, phone).
// 3. Find place names: exact first, then by consonant skeleton, then allowing a small typo.
// 4. Take out the street and the landmark around their marker words.
// 5. Pick the area that the most evidence agrees on, following the family tree of places, and
//    say how sure it is and why.
// 6. List the words nobody recognised, so they can be added to the place list.

import { areaOf, buildGazetteer, chainOf, LEVEL, type Gazetteer } from './gazetteer.ts';
import { editDistance, foldWord, normalizeText, skeleton } from './normalize.ts';
import { placesWithLearned } from './learned.ts';
import type { Kind, Place } from './places.ts';

const words = (s: string) => new Set(s.split(' ').map((w) => normalizeText(w)));

const BUILDING = words('عمارة عماره برج عقار منزل بيت مبنى مبني bldg building bld bldng tower house');
const FLOOR = words('دور الدور ط طابق الطابق floor fl flr');
const APARTMENT = words('شقة شقه apt apartment flat app unit');
const VILLA = words('فيلا فيلة villa');
const BLOCK = words('بلوك block blk');
const ENTRANCE = words('مدخل entrance');
const NUMBER_WORDS = words('رقم no number num nr');
const STREET = words('شارع ش طريق محور street st str road rd');
const LANDMARK_MARKERS = words(
  'بجوار جنب امام أمام قدام خلف ورا وراء قرب بالقرب عند قصاد بجانب near beside behind opposite besides nearby infront next',
);
const LANDMARK_LINKS = words('من to of the الى ل');
const LANDMARK_NOUNS = words(
  'مسجد جامع كنيسة مول صيدلية مدرسة مستشفى مستشفي نادي بنك سوبرماركت ماركت محطة مترو كافيه مطعم فندق جامعة كلية مخبز فرن mosque church mall pharmacy school hospital club bank market supermarket station metro cafe restaurant hotel university college bakery',
);
const FLOOR_VALUES = words(
  'ارضي الارضي ارضى اول الاول تاني ثاني الثاني التاني ثالث الثالث تالت التالت رابع الرابع خامس الخامس سادس السادس سابع السابع ثامن الثامن تامن التامن تاسع التاسع عاشر العاشر اخير الاخير ground first second third fourth fifth sixth seventh eighth ninth tenth last',
);
const FILLER = words(
  'egypt مصر governorate محافظة city مدينة مدينه حي منطقة area district zone compound كمبوند كومبوند residence apartments the and in of on at from to و في من الى على علي عند ال el al new the el ح مركز center centre بعد قبل ثم',
);
const MARKERS = new Set([
  ...BUILDING, ...FLOOR, ...APARTMENT, ...VILLA, ...BLOCK, ...ENTRANCE, ...NUMBER_WORDS, ...STREET, ...LANDMARK_MARKERS,
]);

type Use = 'part' | 'place' | 'street' | 'landmark' | null;

interface Token {
  raw: string;
  norm: string;
  key: string;
  use: Use;
}

export type Method = 'exact' | 'skeleton' | 'typo';

export interface Match {
  text: string;
  start: number;
  end: number;
  ids: string[];
  method: Method;
  afterStreet: boolean;
}

export type Status = 'sure' | 'likely' | 'unsure' | 'partial' | 'outside' | 'not_found';

export interface AreaRef {
  id: string;
  kind: Kind;
  en: string;
  ar: string;
}

export interface Parts {
  governorate?: string;
  city?: string;
  neighbourhood?: string;
  compound?: string;
  street?: string;
  building?: string;
  floor?: string;
  apartment?: string;
  villa?: string;
  block?: string;
  entrance?: string;
  landmark?: string;
  phone?: string;
}

export interface Result {
  input: string;
  status: Status;
  /** 0 to 100 */
  confidence: number;
  area: AreaRef | null;
  /** governorate first, the area last */
  path: AreaRef[];
  parts: Parts;
  reasons: string[];
  candidates: { label: string; score: number }[];
  matches: { text: string; place: string; kind: Kind; method: Method }[];
  unknownWords: string[];
}

const ref = (p: Place): AreaRef => ({ id: p.id, kind: p.kind, en: p.en, ar: p.ar });
const label = (g: Gazetteer, p: Place) =>
  chainOf(g, p.id)
    .filter((x) => x.kind !== 'landmark' && x.kind !== 'street')
    .map((x) => x.en)
    .join(', ');

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const rawWord of text.split(/[\s,،;؛.\-_/\\|()[\]{}"'«»:]+/u)) {
    if (!rawWord) continue;
    const pieces = normalizeText(rawWord).split(' ').filter(Boolean);
    for (const norm of pieces) {
      out.push({ raw: pieces.length === 1 ? rawWord : norm, norm, key: foldWord(norm), use: null });
    }
  }
  return out;
}

const PHONE = /(?:\+?20|0020)?\s?0?1[0125][\s-]?\d{3,4}[\s-]?\d{4}/;

function takePhone(text: string): { text: string; phone?: string } {
  const latin = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const m = latin.match(PHONE);
  if (!m || m.index === undefined) return { text: latin };
  let digits = m[0].replace(/\D/g, '');
  if (digits.startsWith('0020')) digits = digits.slice(4);
  else if (digits.startsWith('20')) digits = digits.slice(2);
  if (!digits.startsWith('0')) digits = '0' + digits;
  return { text: latin.slice(0, m.index) + ' ' + latin.slice(m.index + m[0].length), phone: digits };
}

/** Building, floor, apartment and the like: a marker word followed by its value. */
function takeNumberedParts(tokens: Token[], parts: Parts) {
  const groups: [Set<string>, keyof Parts][] = [
    [BUILDING, 'building'],
    [FLOOR, 'floor'],
    [APARTMENT, 'apartment'],
    [VILLA, 'villa'],
    [BLOCK, 'block'],
    [ENTRANCE, 'entrance'],
  ];
  for (let i = 0; i < tokens.length; i++) {
    const group = groups.find(([set]) => set.has(tokens[i].norm));
    if (!group) continue;
    const [, field] = group;
    let j = i + 1;
    while (j < tokens.length && NUMBER_WORDS.has(tokens[j].norm)) j++;
    const value = tokens[j];
    if (!value || value.use) continue;
    const isNumberish = /\d/.test(value.norm) || (value.norm.length <= 2 && !MARKERS.has(value.norm));
    const ok = field === 'floor' ? isNumberish || FLOOR_VALUES.has(value.norm) : isNumberish;
    if (!ok || parts[field]) continue;
    parts[field] = value.raw;
    for (let k = i; k <= j; k++) tokens[k].use = 'part';
    i = j;
  }
  // "12 شارع ..." : a number just before a street word is the building number.
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (!parts.building && !tokens[i].use && /^\d+[a-z]?$/.test(tokens[i].norm) && STREET.has(tokens[i + 1].norm)) {
      parts.building = tokens[i].raw;
      tokens[i].use = 'part';
    }
  }
}

/** Content positions (tokens with a key, not used yet) and runs of them with nothing between. */
function contentRuns(tokens: Token[]): number[][] {
  const runs: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.use) {
      if (cur.length) runs.push(cur);
      cur = [];
      continue;
    }
    if (!t.key) continue; // "el", "al": skipped inside a name
    cur.push(i);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function findPlaces(tokens: Token[], g: Gazetteer): Match[] {
  const matches: Match[] = [];
  const passes: Method[] = ['exact', 'skeleton', 'typo'];
  for (const method of passes) {
    for (let n = g.maxWords; n >= 1; n--) {
      for (const run of contentRuns(tokens)) {
        for (let s = 0; s + n <= run.length; s++) {
          const idx = run.slice(s, s + n);
          if (idx.some((i) => tokens[i].use)) continue;
          const keys = idx.map((i) => tokens[i].key);
          const key = keys.join(' ');
          let ids: string[] | undefined;
          if (method === 'exact') {
            ids = g.exact.get(key);
          } else if (method === 'skeleton') {
            const sk = skeleton(key);
            ids = sk ? g.skeletons.get(sk) : undefined;
          } else {
            if (/^\d+$/.test(key.replace(/ /g, ''))) continue;
            if (idx.some((i) => MARKERS.has(tokens[i].norm) || FILLER.has(tokens[i].norm))) continue;
            const allowed = key.length >= 10 ? 2 : key.length >= 5 ? 1 : 0;
            if (!allowed) continue;
            let best = allowed + 1;
            let bestIds: string[] = [];
            for (const entry of g.byWordCount.get(n) ?? []) {
              if (Math.abs(entry.key.length - key.length) > allowed) continue;
              // Numbers must match exactly ("hay 7" is never "hay 8").
              if ((entry.key.match(/\d+/g) ?? []).join() !== (key.match(/\d+/g) ?? []).join()) continue;
              const d = editDistance(key, entry.key, allowed);
              if (d < best) {
                best = d;
                bestIds = [...entry.ids];
              } else if (d === best) {
                for (const id of entry.ids) if (!bestIds.includes(id)) bestIds.push(id);
              }
            }
            ids = best <= allowed ? bestIds : undefined;
          }
          if (!ids || ids.length === 0) continue;
          const start = idx[0];
          const end = idx[idx.length - 1];
          for (let i = start; i <= end; i++) tokens[i].use = 'place';
          matches.push({
            text: tokens.slice(start, end + 1).map((t) => t.raw).join(' '),
            start,
            end,
            ids: [...ids],
            method,
            afterStreet: false,
          });
        }
      }
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

function takeStreetAndLandmark(tokens: Token[], matches: Match[], parts: Parts, g: Gazetteer) {
  const matchAt = (i: number) => matches.find((m) => m.start === i);
  const landmarks: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.use) continue;

    if (STREET.has(t.norm)) {
      let j = i + 1;
      while (j < tokens.length && NUMBER_WORDS.has(tokens[j].norm)) j++;
      const m = matchAt(j);
      if (m) {
        const allStreets = m.ids.every((id) => g.byId.get(id)!.kind === 'street');
        if (!allStreets) m.afterStreet = true;
        if (!parts.street) parts.street = m.text;
        t.use = 'street';
        continue;
      }
      const taken: Token[] = [];
      while (j < tokens.length && taken.length < 4) {
        const n = tokens[j];
        if (n.use || MARKERS.has(n.norm) || LANDMARK_NOUNS.has(n.norm) || matchAt(j)) break;
        taken.push(n);
        j++;
        if (/^\d+$/.test(n.norm) && taken.length > 1) break;
      }
      if (taken.length) {
        t.use = 'street';
        for (const x of taken) x.use = 'street';
        if (!parts.street) parts.street = taken.map((x) => x.raw).join(' ');
      }
      continue;
    }

    const isMarker = LANDMARK_MARKERS.has(t.norm);
    const isNoun = LANDMARK_NOUNS.has(t.norm);
    if (isMarker || isNoun) {
      let j = i + 1;
      while (isMarker && j < tokens.length && LANDMARK_LINKS.has(tokens[j].norm)) j++;
      const taken: Token[] = isNoun ? [t] : [];
      const limit = isNoun ? 4 : 5;
      while (j < tokens.length && taken.length < limit) {
        const n = tokens[j];
        if (n.use === 'part' || n.use === 'street' || STREET.has(n.norm) || LANDMARK_MARKERS.has(n.norm)) break;
        if (n.use === 'place') {
          const m = matches.find((x) => x.start <= j && j <= x.end);
          const isLandmark = !!m && m.ids.every((id) => g.byId.get(id)!.kind === 'landmark');
          // A landmark name is the landmark; an area name ends it ("محطة الطالبية" keeps the area
          // name only when nothing else names the landmark).
          if (m && (isLandmark || taken.length === (isNoun ? 1 : 0))) {
            for (let k = m.start; k <= m.end; k++) taken.push(tokens[k]);
            j = m.end + 1;
          }
          break;
        }
        taken.push(n);
        j++;
      }
      if (taken.length) {
        t.use = t.use ?? 'landmark';
        for (const x of taken) if (!x.use) x.use = 'landmark';
        landmarks.push(taken.map((x) => x.raw).join(' '));
        i = j - 1;
      }
    }
  }
  if (landmarks.length) parts.landmark = landmarks.join(' ؛ ');
}

const KIND_WEIGHT: Record<Kind, number> = {
  governorate: 1,
  city: 3,
  district: 3,
  neighbourhood: 3,
  compound: 3,
  landmark: 2,
  street: 1.5,
};
const METHOD_WEIGHT: Record<Method, number> = { exact: 1, skeleton: 0.85, typo: 0.7 };

interface Evidence {
  match: Match;
  place: Place;
  area: Place;
  weight: number;
}

export function parseAddress(input: string, g: Gazetteer = defaultGazetteer()): Result {
  const parts: Parts = {};
  const reasons: string[] = [];
  const { text, phone } = takePhone(input);
  if (phone) parts.phone = phone;

  const tokens = tokenize(text);
  takeNumberedParts(tokens, parts);
  const matches = findPlaces(tokens, g);
  takeStreetAndLandmark(tokens, matches, parts, g);

  // Every match becomes evidence for the area it points at.
  let evidence: Evidence[] = [];
  for (const m of matches) {
    for (const id of m.ids) {
      const place = g.byId.get(id)!;
      let weight = (KIND_WEIGHT[place.kind] * METHOD_WEIGHT[m.method]) / m.ids.length;
      if (m.afterStreet && place.kind !== 'street') weight *= 0.5;
      evidence.push({ match: m, place, area: areaOf(g, id), weight });
    }
  }

  // Shared or generic names count only when a place above them is written too.
  const lineOf = (id: string) => chainOf(g, id).map((p) => p.id);
  const kept = evidence.filter((e) => {
    if (!e.place.needsParent) return true;
    const mine = lineOf(e.area.id);
    return evidence.some(
      (o) => o.match !== e.match && !o.place.needsParent && (mine.includes(o.area.id) || lineOf(o.area.id).includes(e.area.id)),
    );
  });
  for (const m of matches) {
    const before = evidence.some((e) => e.match === m);
    const after = kept.some((e) => e.match === m);
    if (before && !after && kept.length > 0) reasons.push(`"${m.text}" ignored: a shared name, and no place it belongs to is written`);
  }
  // A shared name with nothing above it is still a clue: show where it could be, never a guess.
  const onlyShared = kept.length === 0 && evidence.length > 0;
  evidence = onlyShared ? evidence.map((e) => ({ ...e, weight: e.weight * 0.5 })) : kept;

  for (const m of matches) {
    if (m.method === 'typo') {
      const names = [...new Set(m.ids.map((id) => g.byId.get(id)!.en))].join(' or ');
      reasons.push(`"${m.text}" read as ${names} (spelling was close)`);
    }
  }

  const matchList = matches.flatMap((m) =>
    m.ids.map((id) => {
      const p = g.byId.get(id)!;
      return { text: m.text, place: label(g, p) || p.en, kind: p.kind, method: m.method };
    }),
  );
  const unknownWords = tokens
    .filter((t) => !t.use && t.key && !/\d/.test(t.norm) && t.norm.length >= 3 && !FILLER.has(t.norm) && !MARKERS.has(t.norm) && !LANDMARK_NOUNS.has(t.norm))
    .map((t) => t.norm);

  const base = { input, parts, matches: matchList, unknownWords };

  if (evidence.length === 0) {
    reasons.push(matches.length ? 'Only shared names were found, with nothing above them' : 'No known place name was found');
    return { ...base, status: 'not_found', confidence: 0, area: null, path: [], reasons, candidates: [] };
  }

  // Score each area by the evidence on its own family line.
  const areas = new Map<string, Place>();
  for (const e of evidence) areas.set(e.area.id, e.area);
  const chainIds = new Map<string, string[]>();
  for (const id of areas.keys()) chainIds.set(id, chainOf(g, id).map((p) => p.id));
  const scored = [...areas.values()].map((area) => {
    const line = chainIds.get(area.id)!;
    const support = evidence.filter((e) => line.includes(e.area.id));
    return { area, score: support.reduce((s, e) => s + e.weight, 0), support };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      chainIds.get(b.area.id)!.length - chainIds.get(a.area.id)!.length ||
      b.support.length - a.support.length,
  );
  const best = scored[0];
  const bestLine = chainIds.get(best.area.id)!;
  const rivals = scored.filter((c) => {
    const line = chainIds.get(c.area.id)!;
    return !bestLine.includes(c.area.id) && !line.includes(best.area.id);
  });
  let rival = rivals[0];
  let rivalScore = rival?.score ?? 0;
  let area = best.area;
  let narrowed: string | null = null;
  if (rival && rivalScore >= 0.75 * best.score) {
    const rivalLine = chainIds.get(rival.area.id)!;
    const common = bestLine.find((id) => rivalLine.includes(id));
    const commonPlace = common ? g.byId.get(common)! : undefined;
    if (commonPlace && LEVEL[commonPlace.kind] >= 2) {
      narrowed = `Both ${best.area.en} and ${rival.area.en} were written; they are both in ${commonPlace.en}, so the answer stops there`;
      area = commonPlace;
      // Other rivals still count against the common area.
      const commonLine = lineOf(common!);
      const others = scored.filter((c) => !chainIds.get(c.area.id)!.includes(common!) && !commonLine.includes(c.area.id));
      rival = others[0];
      rivalScore = rival?.score ?? 0;
    }
  }

  const path = chainOf(g, area.id).reverse().map(ref);
  const top = path[0];
  const govPlace = g.byId.get(top.id)!;
  for (const p of path) {
    if (p.kind === 'governorate') parts.governorate = p.en;
    else if (p.kind === 'city' || p.kind === 'district') parts.city = p.en;
    else if (p.kind === 'neighbourhood') parts.neighbourhood = p.en;
    else if (p.kind === 'compound') parts.compound = p.en;
  }

  for (const e of best.support) {
    const where = e.place.kind === 'landmark' || e.place.kind === 'street' ? `, a ${e.place.kind} in ${e.area.en}` : '';
    reasons.push(`Found "${e.match.text}" → ${e.place.en}${where}`);
  }
  // A governorate written that does not fit the area found.
  for (const e of evidence) {
    if (e.place.kind === 'governorate' && !bestLine.includes(e.place.id) && govPlace.served !== false) {
      reasons.push(`"${e.match.text}" says ${e.place.en}, but ${area.en} is in ${govPlace.en}`);
    }
  }

  const candidates = scored.slice(0, 5).map((c) => ({ label: label(g, c.area), score: Math.round(c.score * 100) / 100 }));
  const share = best.score / (best.score + rivalScore);
  let status: Status;
  let confidence = Math.round(100 * share);

  if (onlyShared) {
    const where = scored.map((c) => label(g, c.area));
    status = where.length > 1 ? 'unsure' : 'likely';
    reasons.unshift(
      where.length > 1
        ? `"${matches.map((m) => m.text).join(', ')}" exists in more than one place: ${where.join(' or ')}. Write the city or district to decide`
        : `Found only a shared name; it points to ${where[0]}`,
    );
    confidence = Math.min(confidence, where.length > 1 ? 50 : 70);
  } else if (govPlace.served === false) {
    status = 'outside';
    reasons.unshift(`The address is in ${govPlace.en}, outside Greater Cairo`);
  } else if (rival && rivalScore >= 0.75 * best.score) {
    status = 'unsure';
    reasons.unshift(`Two areas fit: ${label(g, best.area)} and ${label(g, rival.area)}`);
    confidence = Math.min(confidence, 55);
  } else if (area.kind === 'governorate') {
    status = 'partial';
    reasons.unshift(`Only the governorate (${area.en}) was found`);
    confidence = Math.min(confidence, 30);
  } else {
    const strong = best.support.some(
      (e) => e.match.method === 'exact' && !e.match.afterStreet && e.place.kind !== 'governorate' && e.place.kind !== 'street',
    );
    const agreeing = new Set(best.support.map((e) => e.match)).size;
    if (strong || agreeing >= 2) {
      status = 'sure';
      if (narrowed) reasons.unshift(narrowed);
      if (rival) reasons.push(`Also found ${label(g, rival.area)}, but the evidence for it is weaker`);
    } else {
      status = 'likely';
      reasons.unshift('Found from one weaker clue only (a typo match, a street or a landmark)');
      confidence = Math.min(confidence, 75);
    }
  }

  if (!parts.street) {
    const st = best.support.find((e) => e.place.kind === 'street');
    if (st) parts.street = st.match.text;
  }
  return { ...base, status, confidence, area: ref(area), path, reasons, candidates };
}

let cached: Gazetteer | null = null;
/** The place list plus every name taught in data/learned.json. */
export function defaultGazetteer(): Gazetteer {
  cached ??= buildGazetteer(placesWithLearned());
  return cached;
}
/** Call after teaching a name, so the next address uses it. */
export function reloadGazetteer() {
  cached = null;
}
