// Many addresses at once: reading them out of a pasted list or a CSV file, and the summary.

import { parseAddress, type Result, type Status } from './engine.ts';

/** Splits CSV text into rows of cells (quotes and commas inside quotes are handled). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',' || ch === '\t' || ch === ';') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const ADDRESS_HEADER = /address|addr|street|city|province|area|zone|district|governorate|region|عنوان|العنوان|شارع|منطق|محافظ|مدينه|مدينة|حي/i;
const NOT_ADDRESS_HEADER = /phone|mobile|tel|email|name|price|total|cod|amount|sku|qty|quantity|date|id$|هاتف|موبايل|تليفون|اسم|سعر|مبلغ|تاريخ/i;

export interface Extracted {
  addresses: string[];
  /** how the addresses were read, in plain words */
  note: string;
}

/**
 * Reads addresses from pasted text or a file: one address per line, or a CSV whose address
 * columns (address, address 2, city, province, area...) are joined into one address.
 */
export function extractAddresses(text: string, limit = 20000): Extracted {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  const looksCsv = lines.length > 1 && lines.slice(0, 5).every((l) => /[,\t;]/.test(l)) && ADDRESS_HEADER.test(lines[0]);
  if (!looksCsv) {
    const addresses = lines.map((l) => l.trim().replace(/^"(.*)"$/, '$1')).slice(0, limit);
    return { addresses, note: `${addresses.length} lines, one address per line` };
  }
  const rows = parseCsv(clean);
  const header = rows[0];
  const cols = header
    .map((h, i) => ({ h: h.trim(), i }))
    .filter(({ h }) => ADDRESS_HEADER.test(h) && !NOT_ADDRESS_HEADER.test(h));
  const addresses = rows
    .slice(1)
    .map((r) => cols.map(({ i }) => (r[i] ?? '').trim()).filter(Boolean).join(', '))
    .filter(Boolean)
    .slice(0, limit);
  return { addresses, note: `${addresses.length} rows, joined from the columns: ${cols.map((c) => c.h).join(', ')}` };
}

export interface Summary {
  total: number;
  byStatus: Record<Status, number>;
  /** share (0 to 100) that got an area below governorate level: sure or likely */
  placedShare: number;
  unknownWords: { word: string; count: number }[];
  areas: { area: string; count: number }[];
}

const STATUSES: Status[] = ['sure', 'likely', 'unsure', 'partial', 'outside', 'not_found'];

export function summarize(results: Result[]): Summary {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  const words = new Map<string, number>();
  const areas = new Map<string, number>();
  for (const r of results) {
    byStatus[r.status]++;
    for (const w of new Set(r.unknownWords)) words.set(w, (words.get(w) ?? 0) + 1);
    if (r.area) {
      const key = r.path.map((p) => p.en).join(' › ');
      areas.set(key, (areas.get(key) ?? 0) + 1);
    }
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const total = results.length;
  return {
    total,
    byStatus,
    placedShare: total ? Math.round((1000 * (byStatus.sure + byStatus.likely)) / total) / 10 : 0,
    unknownWords: top(words, 60).map(([word, count]) => ({ word, count })),
    areas: top(areas, 60).map(([area, count]) => ({ area, count })),
  };
}

export function runBulk(addresses: string[]) {
  const results = addresses.map((a) => parseAddress(a));
  return { results, summary: summarize(results) };
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Results as CSV, with a byte order mark so Excel shows Arabic correctly. */
export function resultsToCsv(results: Result[]): string {
  const head = [
    'address', 'status', 'confidence', 'governorate', 'city_or_district', 'neighbourhood', 'compound',
    'street', 'building', 'floor', 'apartment', 'landmark', 'phone', 'unknown_words', 'reason',
  ];
  const lines = results.map((r) =>
    [
      r.input, r.status, r.confidence, r.parts.governorate, r.parts.city, r.parts.neighbourhood, r.parts.compound,
      r.parts.street, r.parts.building, r.parts.floor, r.parts.apartment, r.parts.landmark, r.parts.phone,
      r.unknownWords.join(' '), r.reasons[0],
    ]
      .map(csvCell)
      .join(','),
  );
  return '﻿' + [head.join(','), ...lines].join('\r\n');
}
