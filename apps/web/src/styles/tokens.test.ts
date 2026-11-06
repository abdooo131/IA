import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tileInk } from '@/components/AppTileIcon';
import { APPS, STORE_TILE } from '@/lib/apps';

/**
 * Brand v2 color tokens: every text and UI pair the components use passes WCAG AA
 * (4.5:1 for text, 3:1 for large text and UI parts) in the light and the dark theme.
 */
const css = readFileSync(path.join(__dirname, 'shiply-tokens.css'), 'utf8');

function block(selector: RegExp) {
  const m = css.match(selector);
  if (!m) throw new Error(`token block not found: ${selector}`);
  const vars: Record<string, string> = {};
  for (const [, name, value] of m[1]!.matchAll(/--shiply-([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)) {
    vars[name!] = value!.toLowerCase();
  }
  return vars;
}

const light = block(/:root \{([\s\S]*?)\n\}/);
const darkExplicit = block(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/);
const darkSystem = block(/:root:not\(\[data-theme='light'\]\) \{([\s\S]*?)\n {2}\}/);
const onNavy = block(/\.shiply-on-navy \{([\s\S]*?)\n\}/);
const dark = { ...light, ...darkExplicit };

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const GROUNDS = ['bg', 'surface', 'surface-raised'];
const STATUSES = [
  'status-new',
  'status-in-progress',
  'status-heading-to-customer',
  'status-delivered',
  'status-needs-action',
  'status-returning',
];

/** [foreground, background, minimum ratio] */
const PAIRS: [string, string, number][] = [
  ...GROUNDS.flatMap((g): [string, string, number][] => [
    ['text', g, 4.5],
    ['text-muted', g, 4.5],
    ['link', g, 4.5],
    ['danger', g, 4.5],
    ...STATUSES.map((s): [string, string, number] => [s, g, 4.5]),
    ['line-strong', g, 3],
    ['focus', g, 3],
  ]),
  // Buttons and selected marks stand out from the page and from cards.
  ['primary', 'bg', 3],
  ['primary', 'surface', 3],
  ['text', 'selected-bg', 4.5],
  ['link', 'selected-bg', 4.5],
  ['on-primary', 'primary', 4.5],
  ['on-primary', 'primary-pressed', 4.5],
  ['on-accent', 'accent', 4.5],
  ['on-status', 'danger', 4.5],
  ...STATUSES.map((s): [string, string, number] => ['on-status', s, 4.5]),
  ['hero-ink', 'hero', 4.5],
  ['hero-accent', 'hero', 4.5],
];

describe('brand v2 tokens', () => {
  it('uses the brand palette', () => {
    expect(light.cream).toBe('#faf1e8');
    expect(light.navy).toBe('#082341');
    expect(light.blue).toBe('#0046fc');
    expect(light.lime).toBe('#cff905');
    expect(light.bg).toBe(light.cream);
    expect(light.text).toBe(light.navy);
    expect(light.primary).toBe(light.blue);
    expect(light.accent).toBe(light.lime);
    expect(light['on-accent']).toBe(light.navy);
    expect(dark.bg).toBe(light.navy);
  });

  it('keeps the dark theme the same for the OS setting, the explicit choice and Navy panels', () => {
    expect(darkSystem).toEqual(darkExplicit);
    expect(onNavy).toEqual(darkExplicit);
  });

  for (const [theme, vars] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it.each(PAIRS)(`${theme}: %s on %s passes %s:1`, (fg, bg, min) => {
      expect(vars[fg], fg).toBeDefined();
      expect(vars[bg], bg).toBeDefined();
      expect(contrast(vars[fg]!, vars[bg]!)).toBeGreaterThanOrEqual(min);
    });
  }

  // Status pills (the guide's "Heading to customer" pill): the status color as text on a 14%
  // tint of itself over the card or the page.
  const mix = (fg: string, bg: string, share: number) => {
    const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    return `#${[0, 1, 2]
      .map((i) => Math.round(ch(fg, i) * share + ch(bg, i) * (1 - share)))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')}`;
  };
  for (const [theme, vars] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it.each(STATUSES.flatMap((s) => ['bg', 'surface'].map((g) => [s, g])))(
      `${theme}: %s pill on its tint over %s passes 4.5:1`,
      (status, ground) => {
        const fg = vars[status]!;
        expect(contrast(fg, mix(fg, vars[ground]!, 0.14))).toBeGreaterThanOrEqual(4.5);
      },
    );
  }

  it('never puts Lime text on white or Cream', () => {
    expect(contrast(light.lime!, '#ffffff')).toBeLessThan(3);
    expect(contrast(light.lime!, light.cream!)).toBeLessThan(3);
    // which is why accent only ever appears with on-accent (Navy) text, or on Navy and Blue
    expect(contrast(light.lime!, light.navy!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.lime!, light.blue!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([...APPS, { id: 'store', ...STORE_TILE }].map((a) => [a.id, a.color]))(
    'app tile %s (%s) shows its icon at 3:1 or more',
    (_id, color) => {
      expect(contrast(tileInk(color), color)).toBeGreaterThanOrEqual(3);
    },
  );
});
