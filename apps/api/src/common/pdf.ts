import { existsSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

// Printed documents in English or Arabic, made on the server with pdfkit and the brand fonts
// (assets/fonts: Plus Jakarta Sans for Latin, IBM Plex Sans Arabic for Arabic). pdfkit shapes
// Arabic letters through fontkit but lays out a line as one left to right run, so this module
// lays words out itself: each word is measured and drawn on its own, in visual order. Words
// with Arabic letters read right to left inside their run, numbers and Latin words left to
// right, and an Arabic page places the runs from the right. Lines wrap by words.

export type PdfLang = 'en' | 'ar';

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[' };
const mirror = (word: string) => word.replace(/[()[\]]/g, (c) => MIRROR[c]!);

/** The folder of the fonts, found from this file whether it runs from src or dist. */
function fontsDir() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'assets', 'fonts');
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('PDF fonts not found (apps/api/assets/fonts)');
}

/** A line's words in the order they are drawn from left to right. */
export function visualWords(text: string, rtl: boolean): { word: string; arabic: boolean }[] {
  const words = text.split(/\s+/).filter(Boolean);
  const runs: { arabic: boolean; words: string[] }[] = [];
  for (const word of words) {
    // A word of punctuation only (":", "·", "-") goes with the words around it.
    const arabic = LETTER_OR_DIGIT.test(word)
      ? ARABIC.test(word)
      : (runs[runs.length - 1]?.arabic ?? rtl);
    const last = runs[runs.length - 1];
    if (last && last.arabic === arabic) last.words.push(word);
    else runs.push({ arabic, words: [word] });
  }
  const ordered = rtl ? [...runs].reverse() : runs;
  return ordered.flatMap((r) =>
    (r.arabic ? [...r.words].reverse() : r.words).map((word) => ({ word, arabic: r.arabic })),
  );
}

export interface TextStyle {
  size?: number;
  bold?: boolean;
  color?: string;
}

export interface Cell {
  text: string;
  /** Share of the row's width (the shares of a row add up to 1) */
  width: number;
  /** start: the reading start (left in English, right in Arabic) */
  align?: 'start' | 'end' | 'center';
  bold?: boolean;
  color?: string;
}

export const BRAND = {
  navy: '#082341',
  blue: '#0046FC',
  lime: '#CFF905',
  cream: '#FAF1E8',
  text: '#082341',
  muted: '#55657A',
  line: '#D5DCE6',
  soft: '#F3F6FA',
};

/** A PDF page writer that lays words out in the page's reading direction. */
export class PdfWriter {
  readonly doc: PDFKit.PDFDocument;
  readonly rtl: boolean;
  readonly margin = 42;
  y: number;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;

  constructor(
    readonly lang: PdfLang,
    info: { title: string; subject?: string },
  ) {
    this.rtl = lang === 'ar';
    this.doc = new PDFDocument({
      size: 'A4',
      margin: this.margin,
      bufferPages: true,
      info: { Title: info.title, Subject: info.subject ?? info.title, Author: 'Shiply Now' },
    });
    const fonts = fontsDir();
    this.doc.registerFont('latin', path.join(fonts, 'PlusJakartaSans-Regular.ttf'));
    this.doc.registerFont('latin-bold', path.join(fonts, 'PlusJakartaSans-Bold.ttf'));
    this.doc.registerFont('arabic', path.join(fonts, 'IBMPlexSansArabic-Regular.ttf'));
    this.doc.registerFont('arabic-bold', path.join(fonts, 'IBMPlexSansArabic-Bold.ttf'));
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
    this.done = new Promise((resolve) =>
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks))),
    );
    this.y = this.margin;
  }

  get width() {
    return this.doc.page.width - this.margin * 2;
  }
  get bottom() {
    return this.doc.page.height - this.margin - 24;
  }

  /** Arabic pages use the Arabic font for every word (it carries Latin letters too). */
  private font(arabic: boolean, bold?: boolean) {
    const family = arabic || this.rtl ? 'arabic' : 'latin';
    return bold ? `${family}-bold` : family;
  }

  /** The width of a line of words. */
  measure(text: string, style: TextStyle = {}) {
    const size = style.size ?? 10;
    const words = visualWords(text, this.rtl);
    let w = 0;
    for (const [i, x] of words.entries()) {
      this.doc.font(this.font(x.arabic, style.bold)).fontSize(size);
      w += this.doc.widthOfString(x.word);
      if (i < words.length - 1) w += this.doc.widthOfString(' ');
    }
    return w;
  }

  /** Draws one line (no wrapping) inside a box, aligned to its start, end or centre. */
  line(
    text: string,
    box: { x: number; y: number; width: number },
    style: TextStyle & { align?: 'start' | 'end' | 'center' } = {},
  ) {
    const size = style.size ?? 10;
    const width = this.measure(text, style);
    const align = style.align ?? 'start';
    const left =
      align === 'center'
        ? box.x + (box.width - width) / 2
        : (align === 'start') !== this.rtl
          ? box.x
          : box.x + box.width - width;
    let x = left;
    for (const w of visualWords(text, this.rtl)) {
      this.doc
        .font(this.font(w.arabic, style.bold))
        .fontSize(size)
        .fillColor(style.color ?? BRAND.text);
      // An Arabic word is drawn right to left, so its brackets face the other way.
      const word = w.arabic ? mirror(w.word) : w.word;
      this.doc.text(word, x, box.y, { lineBreak: false });
      x += this.doc.widthOfString(w.word) + this.doc.widthOfString(' ');
    }
  }

  /** Splits text into lines that fit a width, by words (keeping paragraphs). */
  wrap(text: string, width: number, style: TextStyle = {}) {
    const lines: string[] = [];
    for (const para of text.split(/\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      let current = '';
      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (current && this.measure(next, style) > width) {
          lines.push(current);
          current = word;
        } else current = next;
      }
      lines.push(current);
    }
    return lines;
  }

  lineHeight(size = 10) {
    return size * (this.rtl ? 1.75 : 1.5);
  }

  /** A new page when less than `height` is left. */
  ensure(height: number) {
    if (this.y + height <= this.bottom) return;
    this.doc.addPage();
    this.y = this.margin;
  }

  /** A paragraph across the page (or a box), wrapped, moving down. */
  paragraph(text: string, style: TextStyle = {}, box?: { x: number; width: number }) {
    const size = style.size ?? 10;
    const x = box?.x ?? this.margin;
    const width = box?.width ?? this.width;
    for (const l of this.wrap(text, width, style)) {
      this.ensure(this.lineHeight(size));
      this.line(l, { x, y: this.y, width }, style);
      this.y += this.lineHeight(size);
    }
  }

  /** A section title with a thin brand rule under it. */
  heading(text: string) {
    this.ensure(48);
    this.y += 8;
    this.line(text, { x: this.margin, y: this.y, width: this.width }, { size: 12.5, bold: true });
    this.y += this.lineHeight(12.5);
    this.doc
      .moveTo(this.margin, this.y - 3)
      .lineTo(this.margin + this.width, this.y - 3)
      .lineWidth(1.2)
      .strokeColor(BRAND.blue)
      .stroke();
    this.y += 4;
  }

  /**
   * A table row: cells in reading order (the first at the left in English, at the right in
   * Arabic), each wrapped in its share of the width.
   */
  row(cells: Cell[], options: { size?: number; fill?: string; rule?: boolean } = {}) {
    const size = options.size ?? 9.5;
    const pad = 5;
    const widths = cells.map((c) => c.width * this.width);
    const wrapped = cells.map((c, i) =>
      this.wrap(c.text, widths[i]! - pad * 2, { size, bold: c.bold }),
    );
    const height = Math.max(...wrapped.map((l) => l.length)) * this.lineHeight(size) + pad;
    this.ensure(height);
    if (options.fill) this.doc.rect(this.margin, this.y, this.width, height).fill(options.fill);
    let offset = 0;
    for (const [i, c] of cells.entries()) {
      const w = widths[i]!;
      const x = this.rtl ? this.margin + this.width - offset - w : this.margin + offset;
      let ly = this.y + pad / 2 + 1;
      for (const l of wrapped[i]!) {
        this.line(
          l,
          { x: x + pad, y: ly, width: w - pad * 2 },
          { size, bold: c.bold, color: c.color, align: c.align },
        );
        ly += this.lineHeight(size);
      }
      offset += w;
    }
    this.y += height;
    if (options.rule !== false)
      this.doc
        .moveTo(this.margin, this.y)
        .lineTo(this.margin + this.width, this.y)
        .lineWidth(0.5)
        .strokeColor(BRAND.line)
        .stroke();
  }

  /** Label and value rows of a section. */
  pairs(rows: [string, string][], labelShare = 0.42) {
    for (const [label, value] of rows)
      this.row([
        { text: label, width: labelShare, color: BRAND.muted },
        { text: value, width: 1 - labelShare, bold: true },
      ]);
  }

  /** Page numbers and the document's name at the foot of every page. */
  footer(text: (page: number, pages: number) => string) {
    const range = this.doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      this.doc.switchToPage(range.start + i);
      // Writing below the bottom margin must not add a page.
      const margins = this.doc.page.margins;
      this.doc.page.margins = { ...margins, bottom: 0 };
      this.line(
        text(i + 1, range.count),
        { x: this.margin, y: this.doc.page.height - this.margin + 4, width: this.width },
        { size: 8, color: BRAND.muted, align: 'center' },
      );
      this.doc.page.margins = margins;
    }
  }

  async end() {
    this.doc.end();
    return this.done;
  }
}
