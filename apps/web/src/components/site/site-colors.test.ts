import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** The website's own colors (site.css): every text pair it uses passes WCAG AA (4.5:1). */
const css = readFileSync(path.join(__dirname, 'site.css'), 'utf8');
const block = css.match(/\.shiply-site \{([\s\S]*?)\n\}/)![1]!;
const vars: Record<string, string> = {};
for (const [, name, value] of block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi))
  vars[name!] = value!.toLowerCase();
const color = (c: string) => (c.startsWith('#') ? c : vars[c]!);

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(color(a)), luminance(color(b))].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** [text, ground] as the page uses them. */
const PAIRS: [string, string][] = [
  ['ink', 'bg'],
  ['ink', 'band'],
  ['muted', 'bg'],
  ['muted', 'band'],
  ['faint', 'bg'],
  ['blue', 'bg'],
  ['blue', 'band'],
  ['ok', 'bg'],
  ['ok', 'band'],
  ['#ffffff', 'blue'],
  ['#dfe7ff', 'blue'],
  ['navy', 'lime'],
  ['cream', 'navy'],
  ['#b9c3d3', 'navy'],
  ['#ffffff', 'navy'],
  ['muted', '#eef3ff'],
];

describe('website colors', () => {
  it('reads the palette from site.css', () => {
    expect(vars).toMatchObject({ navy: '#082341', blue: '#0046fc', lime: '#cff905' });
  });

  it.each(PAIRS)('%s on %s passes AA', (text, ground) => {
    expect(contrast(text, ground)).toBeGreaterThanOrEqual(4.5);
  });
});
