/**
 * Shiply design tokens. Colors come from CSS variables defined in packages/ui/src/theme.css,
 * so both web apps share one palette and it can be re-themed in one place.
 */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: v('ink'), soft: v('ink-soft'), line: v('ink-line') },
        paper: v('paper'),
        surface: v('surface'),
        line: v('line'),
        text: v('text'),
        muted: v('muted'),
        accent: { DEFAULT: v('accent'), strong: v('accent-strong'), soft: v('accent-soft') },
      },
      fontFamily: {
        display: ['"Readex Pro"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans Arabic"', '"IBM Plex Sans"', 'system-ui', 'Tahoma', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 41 / 0.04), 0 1px 1px rgb(15 23 41 / 0.03)',
        lift: '0 8px 24px -12px rgb(15 23 41 / 0.25)',
      },
    },
  },
};
