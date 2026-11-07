import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { OrderTicket } from './OrderTicket';
import { Arrow, Check, ClosingCta, ICONS, StatsBand } from './SiteParts';
import { SiteShell } from './SiteShell';

// The website's home page at "/" for signed out visitors: the overview that sends people on to
// How it works, For brands and Contact. The one Lime highlight is the hero's 2:51.

export async function SiteHome() {
  const t = await getTranslations('site');

  return (
    <SiteShell page="home">
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
              <Link className="s-btn s-btn-primary" href="/contact">
                {t('hero.cta1')}
              </Link>
              <Link className="s-btn s-btn-ghost" href="/how-it-works">
                {t('hero.cta2')}
              </Link>
            </div>
            <ul className="s-promises" aria-label={t('hero.promisesLabel')}>
              {(['p1', 'p2', 'p3', 'p4'] as const).map((k) => (
                <li key={k}>
                  <Check />
                  <span>{t(`hero.${k}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <OrderTicket />
        </div>
      </section>

      <StatsBand />

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
          <Link className="s-more" href="/solutions">
            {t('services.more')}
            <Arrow />
          </Link>
        </div>
      </section>

      <section className="s-band s-alt" id="why">
        <div className="s-wrap">
          <div className="s-section-head">
            <span className="s-eyebrow">{t('why.eyebrow')}</span>
            <h2>{t('why.title')}</h2>
            <p className="s-lead">{t('why.lead')}</p>
          </div>
          <div className="s-why">
            {(
              [
                ['clock', 'w1'],
                ['percent', 'w2'],
                ['build', 'w3'],
              ] as const
            ).map(([icon, k]) => (
              <article key={k}>
                <span className="s-ico">{ICONS[icon]}</span>
                <h3>{t(`why.${k}t`)}</h3>
                <p>{t(`why.${k}p`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="s-band" id="how">
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
          <Link className="s-more" href="/how-it-works">
            {t('howTeaser.more')}
            <Arrow />
          </Link>
        </div>
      </section>

      <ClosingCta second={{ href: '/how-it-works', label: t('closing.cta2') }} />
    </SiteShell>
  );
}
