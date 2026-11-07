import { inflateRawSync } from 'node:zlib';
import { DomainError } from '@shiplynow/db';

// Reads the first sheet of a bank statement file into rows of text cells. Excel files
// (.xlsx) are a zip of XML parts, read here with Node's own inflate, so no spreadsheet
// library is needed. CSV and tab separated files are read as UTF-8 (a byte order mark is
// dropped). The old binary .xls format is refused: Excel's "Save as .xlsx" or "CSV" fixes it.

const MAX_ROWS = 5000;
const MAX_COLS = 40;

/** The files inside a zip, by name (stored or deflated entries only). */
function unzip(data: Buffer): Map<string, Buffer> {
  // The central directory ends with a 22 byte record (plus an optional comment).
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--)
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new DomainError('file_unreadable', 400);
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (data.readUInt32LE(at) !== 0x02014b50) throw new DomainError('file_unreadable', 400);
    const method = data.readUInt16LE(at + 10);
    const size = data.readUInt32LE(at + 20);
    const nameLength = data.readUInt16LE(at + 28);
    const extra = data.readUInt16LE(at + 30);
    const comment = data.readUInt16LE(at + 32);
    const offset = data.readUInt32LE(at + 42);
    const name = data.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extra + comment;
    if (
      !/^xl\/(sharedStrings|workbook|worksheets\/sheet\d+|_rels\/workbook)\.xml(\.rels)?$/.test(
        name,
      )
    )
      continue;
    const start = offset + 30 + data.readUInt16LE(offset + 26) + data.readUInt16LE(offset + 28);
    const raw = data.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, inflateRawSync(raw, { maxOutputLength: 50_000_000 }));
  }
  return files;
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(
          e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
        )
      : (entities[e.toLowerCase()] ?? _),
  );
/** All the text of an XML fragment's <t> elements (rich text has several). */
const texts = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join('');

/** Column letters to a 0 based index: A → 0, AB → 27. */
function column(ref: string) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function readXlsx(data: Buffer): string[][] {
  const files = unzip(data);
  const strings = [
    ...(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(
      /<si>([\s\S]*?)<\/si>/g,
    ),
  ].map((m) => texts(m[1]!));
  // The first sheet in the workbook's order, through its relationship id.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = files.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const firstRel = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  const target = firstRel
    ? (new RegExp(`<Relationship\\b[^>]*Id="${firstRel}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ??
      new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstRel}"`).exec(rels)?.[1])
    : undefined;
  if (target) sheetPath = `xl/${target.replace(/^\/?xl\//, '').replace(/^\//, '')}`;
  const sheet = files.get(sheetPath)?.toString('utf8');
  if (!sheet) throw new DomainError('file_unreadable', 400);
  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const body = c[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's') text = strings[Number(value)] ?? '';
      else if (type === 'inlineStr') text = texts(body);
      else if (value !== undefined) text = decode(value);
      const index = ref ? column(ref) : cells.length;
      if (index >= MAX_COLS) continue;
      while (cells.length < index) cells.push('');
      cells[index] = text.trim();
    }
    rows.push(cells);
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

function readDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length,
  )[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row.slice(0, MAX_COLS));
      row = [];
      cell = '';
      if (rows.length >= MAX_ROWS) return rows;
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row.slice(0, MAX_COLS));
  }
  return rows;
}

/** The rows of a statement file, empty rows dropped. */
export function readSpreadsheet(data: Buffer): string[][] {
  if (data.length === 0) throw new DomainError('file_empty', 400);
  // Old Excel 97 to 2003 files start with the OLE signature.
  if (data.readUInt32LE(0) === 0xe011cfd0) throw new DomainError('old_excel_format', 400);
  const rows =
    data.readUInt32LE(0) === 0x04034b50
      ? readXlsx(data)
      : readDelimited(data.toString('utf8').replace(/^\uFEFF/, ''));
  return rows.filter((r) => r.some((c) => c !== ''));
}
