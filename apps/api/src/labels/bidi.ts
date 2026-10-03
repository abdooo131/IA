/**
 * Minimal bidi support for pdfkit labels. pdfkit/fontkit shape Arabic but pick one script per call,
 * so a mixed line is split into runs, ordered visually for a right to left paragraph, and each run
 * is drawn on its own. Good enough for names, addresses and notes; not a full Unicode bidi.
 */
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const ARABIC_DIGITS = /^[٠-٩]+([.,،][٠-٩]+)*[.,،]?$/;

export function hasArabic(s: string): boolean {
  return ARABIC.test(s);
}

export interface Run {
  text: string;
  rtl: boolean;
}

/** Splits a logical line into runs (Arabic vs everything else), returned in visual left to right order. */
export function visualRuns(line: string): Run[] {
  const tokens = line.split(/\s+/).filter(Boolean);
  const runs: { tokens: string[]; rtl: boolean }[] = [];
  for (const t of tokens) {
    const rtl = hasArabic(t) || ARABIC_DIGITS.test(t);
    const last = runs[runs.length - 1];
    if (last && last.rtl === rtl) last.tokens.push(t);
    else runs.push({ tokens: [t], rtl });
  }
  if (!runs.some((r) => r.rtl)) return [{ text: tokens.join(' '), rtl: false }];
  return runs.reverse().map((r) =>
    r.rtl
      ? {
          // fontkit lays out each Arabic word correctly but keeps word order, so reverse words;
          // Arabic-Indic digit groups are reversed so they read left to right after layout.
          text: r.tokens
            .slice()
            .reverse()
            .map((t) => (ARABIC_DIGITS.test(t) ? [...t].reverse().join('') : t))
            .join(' '),
          rtl: true,
        }
      : { text: r.tokens.join(' '), rtl: false },
  );
}

/** Greedy line breaking in logical order. */
export function breakLines(s: string, width: number, measure: (w: string) => number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && measure(next) > width) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Draws one logical line with mixed scripts. align defaults to right when the line has Arabic. */
export function drawBidiLine(
  doc: PDFKit.PDFDocument,
  line: string,
  x: number,
  y: number,
  width: number,
  align: 'left' | 'right' | 'center' = hasArabic(line) ? 'right' : 'left',
) {
  const runs = visualRuns(line);
  const space = doc.widthOfString(' ');
  const widths = runs.map((r) => doc.widthOfString(r.text));
  const total = widths.reduce((a, b) => a + b, 0) + space * (runs.length - 1);
  let cx = align === 'right' ? x + width - total : align === 'center' ? x + (width - total) / 2 : x;
  runs.forEach((r, i) => {
    doc.text(r.text, cx, y, { lineBreak: false });
    cx += widths[i] + space;
  });
}
