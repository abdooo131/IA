import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';

// Pieces the website's pages share: icons, the page heading, the results band, the closing call
// to action and the sections that appear on more than one page.

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export type IconName =
  'clock' | 'store' | 'cash' | 'bag' | 'retry' | 'chart' | 'people' | 'percent' | 'build';

export const ICONS: Record<IconName, ReactNode> = {
  clock: (
    <svg {...svgProps}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M9 2h6" />
    </svg>
  ),
  store: (
    <svg {...svgProps}>
      <path d="M3 9l9-5 9 5v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M8 20v-6h8v6" />
    </svg>
  ),
  cash: (
    <svg {...svgProps}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  ),
  bag: (
    <svg {...svgProps}>
      <path d="M5 17h14l-1.5-9h-11z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  ),
  retry: (
    <svg {...svgProps}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  ),
  chart: (
    <svg {...svgProps}>
      <path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6" />
    </svg>
  ),
  people: (
    <svg {...svgProps}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </svg>
  ),
  percent: (
    <svg {...svgProps}>
      <path d="M19 5L5 19" />
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </svg>
  ),
  build: (
    <svg {...svgProps}>
      <path d="M3 21h18M5 21V10l7-5 7 5v11" />
      <path d="M9 21v-5h6v5" />
    </svg>
  ),
};

export function Check() {
  return (
    <svg {...svgProps} strokeWidth={2.5}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** An arrow that points forward in either reading direction. */
export function Arrow() {
  return (
    <svg {...svgProps} className="s-arrow">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export const bold = (chunks: ReactNode) => <b>{chunks}</b>;

/** A list of short lines, each with a green check. */
export function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="s-checks">
      {items.map((item, i) => (
        <li key={i}>
          <Check />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** The Cream heading band at the top of every page but Home. */
export function PageHead({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  children?: ReactNode;
}) {
  return (
    <section className="s-page-head">
      <div className="s-wrap">
        <span className="s-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="s-lead">{lead}</p>
        {children}
      </div>
    </section>
  );
}

/** The owner's four results on the Navy band. */
export async function StatsBand() {
  const t = await getTranslations('site.stats');
  return (
    <section className="s-stats" aria-label={t('label')}>
      <div className="s-wrap">
        <div className="s-stat">
          <div className="s-sv">
            {t('v1')}
            <small>{t('min')}</small>
          </div>
          <div className="s-sl">{t('l1')}</div>
        </div>
        <div className="s-stat">
          <div className="s-sv">{t('v2')}</div>
          <div className="s-sl">{t('l2')}</div>
        </div>
        <div className="s-stat">
          <div className="s-sv">{t('v3')}</div>
          <div className="s-sl">{t('l3')}</div>
        </div>
        <div className="s-stat">
          <div className="s-sv">
            {t('v4')}
            <small>{t('of5')}</small>
          </div>
          <div className="s-sl">{t('l4')}</div>
        </div>
      </div>
    </section>
  );
}

/** The blue closing band: one line, a button to Contact and a second link. */
export async function ClosingCta({ second }: { second?: { href: string; label: string } }) {
  const t = await getTranslations('site.closing');
  return (
    <section className="s-band">
      <div className="s-wrap">
        <div className="s-closing">
          <div className="s-cta-copy">
            <h2>{t('title')}</h2>
            <p>{t('lead')}</p>
          </div>
          <div className="s-closing-actions">
            <Link className="s-btn s-btn-light" href="/contact">
              {t('cta')}
            </Link>
            {second && (
              <Link className="s-btn s-btn-ghost" href={second.href}>
                {second.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** The payout schedule picker (an illustration, the first option shown as chosen). */
export async function PayoutSchedule() {
  const t = await getTranslations('site.money');
  return (
    <div className="s-sched" role="group" aria-label={t('scheduleLabel')}>
      <div className="s-sched-lbl">{t('pLbl')}</div>
      <div className="s-sched-opts">
        {(['p1', 'p2', 'p3'] as const).map((k, i) => (
          <div className={`s-opt${i === 0 ? ' s-on' : ''}`} key={k}>
            <b>{t(k)}</b>
            <span>{t(`${k}s`)}</span>
          </div>
        ))}
      </div>
      <div className="s-sched-docs">
        <span>{t('d1')}</span>
        <span>{t('d2')}</span>
        <span>{t('d3')}</span>
      </div>
    </div>
  );
}

/** The Shopify connection's three cards. */
export async function ShopifySection({ alt }: { alt?: boolean }) {
  const t = await getTranslations('site.shopify');
  return (
    <section className={`s-band${alt ? ' s-alt' : ''}`} id="shopify">
      <div className="s-wrap">
        <div className="s-section-head">
          <span className="s-eyebrow">{t('eyebrow')}</span>
          <h2>{t('title')}</h2>
        </div>
        <div className="s-shop">
          {(['sh1', 'sh2', 'sh3'] as const).map((k) => (
            <div key={k}>
              <h3>{t(`${k}t`)}</h3>
              <p>{t(`${k}p`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
