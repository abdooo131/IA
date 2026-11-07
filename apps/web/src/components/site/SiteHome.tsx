import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LanguageSwitch } from './LanguageSwitch';
import { LeadForm } from './LeadForm';
import { OrderTicket } from './OrderTicket';
import './site.css';

// The public website at "/" for signed out visitors, a marketing page for online merchants
// (docs/site/preview.html is the agreed design). It never shows store locations, hubs,
// balances or internal numbers; the results band carries the owner's figures from the messages.

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const ICONS: Record<'clock' | 'store' | 'cash' | 'bag' | 'retry' | 'chart', ReactNode> = {
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
};

function Check() {
  return (
    <svg {...svgProps} strokeWidth={2.5}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

const bold = (chunks: ReactNode) => <b>{chunks}</b>;

export async function SiteHome() {
  const locale = await getLocale();
  const t = await getTranslations('site');
  const logo = (className: string) => (
    // The guide's logo file, never mirrored in Arabic.
    <img
      src="/brand/logo-horizontal-primary.svg"
      alt={t('brand')}
      className={className}
      dir="ltr"
      width={91}
      height={30}
    />
  );

  return (
    <div className={`shiply-site${locale === 'ar' ? ' s-ar' : ''}`}>
      <header className="s-top">
        <div className="s-wrap">
          <a href="#top" className="s-logo-link">
            {logo('s-logo')}
          </a>
          <nav className="s-links" aria-label={t('nav.mainLabel')}>
            <a href="#services">{t('nav.services')}</a>
            <a href="#how">{t('nav.how')}</a>
            <a href="#quality">{t('nav.quality')}</a>
            <a href="#money">{t('nav.money')}</a>
            <a href="#speed">{t('nav.speed')}</a>
            <a href="#faq">{t('nav.faq')}</a>
          </nav>
          <div className="s-top-actions">
            <LanguageSwitch />
            <Link href="/login" className="s-signin">
              {t('nav.signIn')}
            </Link>
            <a className="s-btn s-btn-primary" href="#contact">
              {t('nav.cta')}
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="s-hero">
          <svg
            className="s-route-bg"
            viewBox="0 0 1200 140"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M0 110 C 160 110 180 40 340 40 S 520 120 700 90 S 900 20 1060 50 S 1160 80 1200 70"
              fill="none"
              stroke="#0046fc"
              strokeWidth="2"
              strokeDasharray="6 10"
            />
          </svg>
          <div className="s-wrap">
            <div className="s-hero-copy">
              <span className="s-eyebrow">{t('hero.eyebrow')}</span>
              <h1>
                {t('hero.titleLine1')}
                <br />
                {t.rich('hero.titleLine2', {
                  clock: (chunks) => <span className="s-clock">{chunks}</span>,
                })}
              </h1>
              <p className="s-lead">{t('hero.lead')}</p>
              <div className="s-hero-ctas">
                <a className="s-btn s-btn-primary" href="#contact">
                  {t('hero.cta1')}
                </a>
                <a className="s-btn s-btn-ghost" href="#how">
                  {t('hero.cta2')}
                </a>
              </div>
              <span className="s-hero-note">
                <b>{t('hero.noteTag')}</b>
                <span>{t('hero.note')}</span>
              </span>
            </div>
            <OrderTicket />
          </div>
        </section>

        <div className="s-strip">
          <div className="s-wrap">
            {(['s1', 's2', 's3', 's4'] as const).map((k) => (
              <span key={k}>{t.rich(`strip.${k}`, { b: bold })}</span>
            ))}
          </div>
        </div>

        <section className="s-stats">
          <div className="s-wrap">
            <div className="s-stat">
              <div className="s-sv">
                {t('stats.v1')}
                <small>{t('stats.min')}</small>
              </div>
              <div className="s-sl">{t('stats.l1')}</div>
            </div>
            <div className="s-stat">
              <div className="s-sv">{t('stats.v2')}</div>
              <div className="s-sl">{t('stats.l2')}</div>
            </div>
            <div className="s-stat">
              <div className="s-sv">{t('stats.v3')}</div>
              <div className="s-sl">{t('stats.l3')}</div>
            </div>
            <div className="s-stat">
              <div className="s-sv">
                {t('stats.v4')}
                <small>{t('stats.of5')}</small>
              </div>
              <div className="s-sl">{t('stats.l4')}</div>
            </div>
          </div>
        </section>

        <section className="s-band" id="services">
          <div className="s-wrap">
            <div className="s-section-head">
              <span className="s-eyebrow">{t('services.eyebrow')}</span>
              <h2>{t('services.title')}</h2>
              <p className="s-lead">{t('services.lead')}</p>
            </div>
            <div className="s-services">
              <article className="s-svc s-feature">
                <div className="s-svc-body">
                  <span className="s-ico">{ICONS.clock}</span>
                  <h3>{t('services.f1t')}</h3>
                  <p>{t('services.f1p')}</p>
                </div>
                <div className="s-big">
                  {t('services.big')}
                  <small>{t('services.minShort')}</small>
                </div>
              </article>
              {(
                [
                  ['store', 'f2'],
                  ['cash', 'f3'],
                  ['bag', 'f4'],
                  ['retry', 'f5'],
                  ['chart', 'f6'],
                ] as const
              ).map(([icon, k]) => (
                <article className="s-svc" key={k}>
                  <span className="s-ico">{ICONS[icon]}</span>
                  <h3>{t(`services.${k}t`)}</h3>
                  <p>{t(`services.${k}p`)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="s-band s-alt" id="how">
          <div className="s-wrap">
            <div className="s-section-head">
              <span className="s-eyebrow">{t('how.eyebrow')}</span>
              <h2>{t('how.title')}</h2>
            </div>
            <ol className="s-flow">
              {(['h1', 'h2', 'h3', 'h4', 'h5'] as const).map((k, i) => (
                <li key={k}>
                  <span className="s-n">{i + 1}</span>
                  <span className="s-when">{t(`how.${k}w`)}</span>
                  <h3>{t(`how.${k}t`)}</h3>
                  <p>{t(`how.${k}p`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="s-band" id="money">
          <div className="s-wrap s-split">
            <div>
              <span className="s-eyebrow">{t('money.eyebrow')}</span>
              <h2 className="s-mt">{t('money.title')}</h2>
              <ul className="s-checks">
                {(['m1', 'm2', 'm3', 'm4'] as const).map((k) => (
                  <li key={k}>
                    <Check />
                    <span>{t(`money.${k}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="s-sched" role="group" aria-label={t('money.scheduleLabel')}>
              <div className="s-sched-lbl">{t('money.pLbl')}</div>
              <div className="s-sched-opts">
                {(['p1', 'p2', 'p3'] as const).map((k, i) => (
                  <div className={`s-opt${i === 0 ? ' s-on' : ''}`} key={k}>
                    <b>{t(`money.${k}`)}</b>
                    <span>{t(`money.${k}s`)}</span>
                  </div>
                ))}
              </div>
              <div className="s-sched-docs">
                <span>{t('money.d1')}</span>
                <span>{t('money.d2')}</span>
                <span>{t('money.d3')}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="s-band s-alt" id="speed">
          <div className="s-wrap">
            <div className="s-section-head">
              <span className="s-eyebrow">{t('speed.eyebrow')}</span>
              <h2>{t('speed.title')}</h2>
              <p className="s-lead">{t('speed.lead')}</p>
            </div>
            <div className="s-race">
              <div className="s-lane">
                <div className="s-lane-head">
                  <b>{t('speed.r1')}</b>
                  <span>{t('speed.r1s')}</span>
                </div>
                <div className="s-track">
                  <i className="s-slow" />
                </div>
              </div>
              <div className="s-lane s-me">
                <div className="s-lane-head">
                  <b>{t('speed.r2')}</b>
                  <span>{t('speed.r2s')}</span>
                </div>
                <div className="s-track">
                  <i className="s-fast" />
                </div>
              </div>
            </div>
            <div className="s-wins">
              {(['w1', 'w2', 'w3'] as const).map((k) => (
                <div key={k}>
                  <h3>{t(`speed.${k}t`)}</h3>
                  <p>{t(`speed.${k}p`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="s-band" id="quality">
          <div className="s-wrap s-split">
            <div>
              <span className="s-eyebrow">{t('quality.eyebrow')}</span>
              <h2 className="s-mt">{t('quality.title')}</h2>
              <p className="s-lead s-mt">{t('quality.lead')}</p>
            </div>
            <ol className="s-qsteps">
              {(['q1', 'q2', 'q3', 'q4'] as const).map((k, i) => (
                <li key={k}>
                  <span className="s-qi">{i + 1}</span>
                  <div>
                    <h3>{t(`quality.${k}t`)}</h3>
                    <p>{t(`quality.${k}p`)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="s-band s-alt" id="customer">
          <div className="s-wrap s-split">
            <div className="s-phone" role="group" aria-label={t('customer.label')}>
              <div className="s-ph-top">
                <b>{t('customer.phT')}</b>
                <span>{t('customer.phEta')}</span>
              </div>
              <div className="s-ph-map" aria-hidden="true">
                <svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
                  <rect width="300" height="170" fill="#eef1f6" />
                  <path
                    d="M0 120 L300 90 M60 0 L90 170 M180 0 L210 170 M0 40 L300 60"
                    stroke="#ffffff"
                    strokeWidth="10"
                  />
                  <path
                    d="M40 140 C 90 120 120 70 170 75 S 240 50 255 35"
                    fill="none"
                    stroke="#0046fc"
                    strokeWidth="4"
                    strokeDasharray="2 8"
                    strokeLinecap="round"
                  />
                  <circle cx="170" cy="75" r="9" fill="#0046fc" />
                  <circle cx="170" cy="75" r="16" fill="#0046fc" opacity=".18" />
                  <circle cx="255" cy="35" r="7" fill="#082341" />
                </svg>
              </div>
              <div className="s-ph-row">
                <span>{t('customer.phRider')}</span>
                <b>{t('customer.riderName')}</b>
              </div>
              <div className="s-ph-row">
                <span>{t('customer.phCode')}</span>
                <b className="s-code" dir="ltr">
                  {t('customer.code')}
                </b>
              </div>
              <div className="s-ph-row">
                <span>{t('customer.phCash')}</span>
                <b>{t('customer.phCashV')}</b>
              </div>
              <div className="s-ph-rate">
                <span>{t('customer.phRate')}</span>
                <span className="s-stars" aria-hidden="true">
                  {t('customer.stars')}
                </span>
              </div>
              <p className="s-sample">{t('customer.sample')}</p>
            </div>
            <div>
              <span className="s-eyebrow">{t('customer.eyebrow')}</span>
              <h2 className="s-mt">{t('customer.title')}</h2>
              <ul className="s-checks">
                {(['cu1', 'cu2', 'cu3', 'cu4'] as const).map((k) => (
                  <li key={k}>
                    <Check />
                    <span>{t(`customer.${k}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="s-band" id="shopify">
          <div className="s-wrap">
            <div className="s-section-head">
              <span className="s-eyebrow">{t('shopify.eyebrow')}</span>
              <h2>{t('shopify.title')}</h2>
            </div>
            <div className="s-shop">
              {(['sh1', 'sh2', 'sh3'] as const).map((k) => (
                <div key={k}>
                  <h3>{t(`shopify.${k}t`)}</h3>
                  <p>{t(`shopify.${k}p`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="s-band s-alt" id="faq">
          <div className="s-wrap">
            <div className="s-section-head">
              <span className="s-eyebrow">{t('faq.eyebrow')}</span>
              <h2>{t('faq.title')}</h2>
            </div>
            <div className="s-faq">
              {([1, 2, 3, 4, 5] as const).map((n) => (
                <details key={n} open={n === 1}>
                  <summary>{t(`faq.q${n}`)}</summary>
                  <p>{t(`faq.a${n}`)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="s-band" id="contact">
          <div className="s-wrap">
            <div className="s-cta">
              <div className="s-cta-copy">
                <h2>{t('contact.title')}</h2>
                <p>{t('contact.lead')}</p>
              </div>
              <LeadForm />
            </div>
          </div>
        </section>
      </main>

      <footer className="s-footer">
        <div className="s-wrap">
          {logo('s-logo')}
          <nav aria-label={t('nav.footerLabel')}>
            <a href="#services">{t('nav.services')}</a>
            <a href="#speed">{t('nav.speed')}</a>
            <a href="#faq">{t('nav.faq')}</a>
            <Link href="/login">{t('footer.signIn')}</Link>
          </nav>
          <span>{t('footer.copy')}</span>
        </div>
      </footer>
    </div>
  );
}
