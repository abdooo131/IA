import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import {
  CheckList,
  ClosingCta,
  ICONS,
  type IconName,
  PageHead,
  PayoutSchedule,
  ShopifySection,
} from './SiteParts';
import { SiteShell } from './SiteShell';

// /solutions ("For brands"): every service in its own section, then who it is for.

function Solution({
  id,
  icon,
  eyebrow,
  title,
  text,
  points,
  aside,
  alt,
}: {
  id: string;
  icon: IconName;
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
  aside: ReactNode;
  alt?: boolean;
}) {
  return (
    <section className={`s-band${alt ? ' s-alt' : ''}`} id={id}>
      <div className="s-wrap s-split">
        <div>
          <span className="s-eyebrow s-eyebrow-ico">
            <span className="s-ico">{ICONS[icon]}</span>
            {eyebrow}
          </span>
          <h2 className="s-mt">{title}</h2>
          <p className="s-lead s-mt">{text}</p>
          <CheckList items={points} />
        </div>
        {aside}
      </div>
    </section>
  );
}

export async function SolutionsPage() {
  const t = await getTranslations('site');
  const s = (key: string) => t(`solutionsPage.${key}`);
  const points = (section: string, n = 3) =>
    Array.from({ length: n }, (_, i) => s(`${section}.b${i + 1}`));

  return (
    <SiteShell page="solutions">
      <PageHead eyebrow={s('eyebrow')} title={s('title')} lead={s('lead')} />

      <Solution
        id="delivery"
        icon="clock"
        eyebrow={s('delivery.eyebrow')}
        title={s('delivery.title')}
        text={s('delivery.p')}
        points={points('delivery')}
        aside={
          <div className="s-big-card" aria-hidden="true">
            <span className="s-big">
              {t('services.big')}
              <small>{t('services.minShort')}</small>
            </span>
            <span>{t('stats.l1')}</span>
          </div>
        }
      />

      <Solution
        id="storage"
        icon="store"
        alt
        eyebrow={s('storage.eyebrow')}
        title={s('storage.title')}
        text={s('storage.p')}
        points={points('storage')}
        aside={
          <ol className="s-qsteps">
            {(['h2', 'h3'] as const).map((k, i) => (
              <li key={k}>
                <span className="s-qi">{i + 1}</span>
                <div>
                  <h3>{t(`how.${k}t`)}</h3>
                  <p>{t(`how.${k}p`)}</p>
                </div>
              </li>
            ))}
          </ol>
        }
      />

      <Solution
        id="money"
        icon="cash"
        eyebrow={t('money.eyebrow')}
        title={t('money.title')}
        text={t('services.f3p')}
        points={(['m1', 'm2', 'm3', 'm4'] as const).map((k) => t(`money.${k}`))}
        aside={<PayoutSchedule />}
      />

      <Solution
        id="returns"
        icon="retry"
        alt
        eyebrow={s('returns.eyebrow')}
        title={s('returns.title')}
        text={s('returns.p')}
        points={points('returns')}
        aside={
          <div className="s-faq">
            <details open>
              <summary>{t('faq.q3')}</summary>
              <p>{t('faq.a3')}</p>
            </details>
          </div>
        }
      />

      <ShopifySection />

      <Solution
        id="dashboard"
        icon="chart"
        alt
        eyebrow={s('dashboard.eyebrow')}
        title={s('dashboard.title')}
        text={s('dashboard.p')}
        points={points('dashboard', 4)}
        aside={
          <div className="s-svc">
            <span className="s-ico">{ICONS.chart}</span>
            <h3>{t('services.f6t')}</h3>
            <p>{t('services.f6p')}</p>
          </div>
        }
      />

      <section className="s-band" id="who">
        <div className="s-wrap">
          <div className="s-section-head">
            <span className="s-eyebrow">{s('who.eyebrow')}</span>
            <h2>{s('who.title')}</h2>
            <p className="s-lead">{s('who.lead')}</p>
          </div>
          <ul className="s-chips">
            {(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] as const).map((k) => (
              <li key={k}>{s(`who.${k}`)}</li>
            ))}
          </ul>
        </div>
      </section>

      <ClosingCta second={{ href: '/how-it-works', label: t('closing.cta2') }} />
    </SiteShell>
  );
}
