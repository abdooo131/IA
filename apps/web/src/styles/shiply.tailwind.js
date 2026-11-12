// Shiply brand v2 preset (tailwind.config.js: presets: [require('./src/styles/shiply.tailwind.js')]).
// Role colors read the CSS variables in shiply-tokens.css, so dark mode works automatically.
// Brand colors (shiply.*) are fixed; use roles in page code and brand colors only for brand moments.
/** A color variable that accepts Tailwind's opacity modifier (/15, /50). */
const withAlpha = (name) =>
  `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        shiply: { cream: '#FAF1E8', navy: '#082341', blue: '#0046FC', lime: '#CFF905' },
        bg: 'var(--shiply-bg)',
        surface: 'var(--shiply-surface)',
        'surface-raised': 'var(--shiply-surface-raised)',
        line: 'var(--shiply-line)',
        'line-strong': 'var(--shiply-line-strong)',
        text: 'var(--shiply-text)',
        'text-muted': 'var(--shiply-text-muted)',
        primary: 'var(--shiply-primary)',
        'on-primary': 'var(--shiply-on-primary)',
        'primary-pressed': 'var(--shiply-primary-pressed)',
        link: 'var(--shiply-link)',
        'selected-bg': 'var(--shiply-selected-bg)',
        // Lime: one highlight per screen at most, always with on-accent (Navy) text.
        accent: 'var(--shiply-accent)',
        'on-accent': 'var(--shiply-on-accent)',
        focus: 'var(--shiply-focus)',
        danger: 'var(--shiply-danger)',
        'on-status': 'var(--shiply-on-status)',
        // Status colors take an opacity (bg-status-delivered/15 is a 15% tint): the variable is
        // mixed with transparent, so the tints work in both themes without rgb channels.
        status: {
          new: withAlpha('--shiply-status-new'),
          'in-progress': withAlpha('--shiply-status-in-progress'),
          'heading-to-customer': withAlpha('--shiply-status-heading-to-customer'),
          delivered: withAlpha('--shiply-status-delivered'),
          'needs-action': withAlpha('--shiply-status-needs-action'),
          returning: withAlpha('--shiply-status-returning'),
        },
        hero: {
          DEFAULT: 'var(--shiply-hero)',
          ink: 'var(--shiply-hero-ink)',
          accent: 'var(--shiply-hero-accent)',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        arabic: ['"IBM Plex Sans Arabic"', '"Plus Jakarta Sans"', 'sans-serif'],
      },
      fontSize: {
        display: ['56px', { lineHeight: '1.05', letterSpacing: '-0.035em', fontWeight: '800' }],
        h1: ['40px', { lineHeight: '1.1', letterSpacing: '-0.03em', fontWeight: '800' }],
        h2: ['28px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '800' }],
        h3: ['20px', { lineHeight: '1.35', letterSpacing: '-0.01em', fontWeight: '700' }],
        'body-lg': ['18px', { lineHeight: '1.6', letterSpacing: '0em', fontWeight: '400' }],
        body: ['16px', { lineHeight: '1.6', letterSpacing: '0em', fontWeight: '400' }],
        'body-sm': ['14px', { lineHeight: '1.5', letterSpacing: '0em', fontWeight: '400' }],
        caption: ['13px', { lineHeight: '1.4', letterSpacing: '0em', fontWeight: '500' }],
        label: ['12px', { lineHeight: '1.3', letterSpacing: '0.08em', fontWeight: '700' }],
        'number-lg': ['28px', { lineHeight: '1.1', letterSpacing: '-0.01em', fontWeight: '800' }],
      },
      borderRadius: { sm: '8px', md: '12px', lg: '16px', xl: '24px', pill: '999px' },
      boxShadow: {
        sm: '0 1px 2px rgba(8,35,65,.06), 0 1px 1px rgba(8,35,65,.04)',
        md: '0 6px 16px rgba(8,35,65,.08)',
        lg: '0 16px 32px rgba(8,35,65,.14)',
      },
    },
  },
};
