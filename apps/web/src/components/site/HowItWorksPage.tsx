import { getTranslations } from 'next-intl/server';
import { Check, ClosingCta, PageHead } from './SiteParts';
import { SiteShell } from './SiteShell';

// /how-it-works: the five steps in depth, the four quality checks, what the customer sees and the
// courier against Shiply race.

const STEPS = ['1', '2', '3', '4', '5'] as const;

export async function HowItWorksPage() {
  const t = await getTranslations('site');

  return (
    <SiteShell page="how">
      <PageHead
        eyebrow={t('howPage.eyebrow')}
        title={t('howPage.title')}
        lead={t('howPage.lead')}
      />

      <section className="s-band">
        <div className="s-wrap">
          <ol className="s-steps-deep">
            {STEPS.map((n) => (
              <li key={n}>
                <span className="s-n" aria-hidden="true">
                  {n}
                </span>
                <div className="s-step-copy">
                  <span className="s-when">{t(`how.h${n}w`)}</span>
                  <h2>{t(`how.h${n}t`)}</h2>
                  <p>{t(`howPage.s${n}.p`)}</p>
                </div>
                <ul className="s-checks s-step-points" aria-label={t('howPage.details')}>
                  {(['b1', 'b2', 'b3'] as const).map((b) => (
                    <li key={b}>
                      <Check />
                      <span>{t(`howPage.s${n}.${b}`)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="s-band s-alt" id="quality">
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

      <section className="s-band" id="customer">
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

      <ClosingCta second={{ href: '/solutions', label: t('nav.solutions') }} />
    </SiteShell>
  );
}
