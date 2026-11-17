import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LeadForm } from './LeadForm';
import { Arrow, PageHead } from './SiteParts';
import { SiteShell } from './SiteShell';

// /contact: the lead form (POST /api/site/leads, unchanged), the ways into the merchant area and
// the merchants' questions. The "Request a call" bar is not shown here; the form is the page.
// The cost answer says nothing about a setup fee until the owner confirms one.

export async function ContactPage() {
  const t = await getTranslations('site');

  return (
    <SiteShell page="contact">
      <PageHead
        eyebrow={t('contactPage.eyebrow')}
        title={t('contactPage.title')}
        lead={t('contactPage.lead')}
      />

      <section className="s-band s-band-tight" id="contact">
        <div className="s-wrap">
          <div className="s-cta">
            <div className="s-cta-copy">
              <h2>{t('contact.title')}</h2>
              <p>{t('contact.lead')}</p>
            </div>
            <LeadForm />
          </div>
          <div className="s-doors">
            <div>
              <h3>{t('contactPage.accountTitle')}</h3>
              <p>{t('contactPage.accountP')}</p>
              <Link className="s-more" href="/signup">
                {t('contactPage.createAccount')}
                <Arrow />
              </Link>
            </div>
            <div>
              <h3>{t('contactPage.signInTitle')}</h3>
              <p>{t('contactPage.signInP')}</p>
              <Link className="s-more" href="/login">
                {t('contactPage.signIn')}
                <Arrow />
              </Link>
            </div>
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
    </SiteShell>
  );
}
