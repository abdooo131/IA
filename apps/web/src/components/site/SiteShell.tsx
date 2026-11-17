import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LanguageSwitch } from './LanguageSwitch';
import { SiteMenu } from './SiteMenu';
import { navItems, showsCallBar, type SitePage } from './site-nav';
import './site.css';

// The public website's frame (docs/site/preview.html is the agreed look): the top bar with the
// page links, the footer and the "Request a call" bar that stays at the bottom of the screen.
// It never shows store locations, hubs, balances or internal numbers.

export async function SiteShell({ page, children }: { page: SitePage; children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations('site');
  const items = navItems(page);
  const callBar = showsCallBar(page);
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
          <Link
            href="/"
            className="s-logo-link"
            aria-current={page === 'home' ? 'page' : undefined}
          >
            {logo('s-logo')}
          </Link>
          <nav className="s-links" aria-label={t('nav.mainLabel')}>
            {items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={item.current ? 'page' : undefined}
                className={item.current ? 's-on' : undefined}
              >
                {t(`nav.${item.key}`)}
              </Link>
            ))}
          </nav>
          <div className="s-top-actions">
            <LanguageSwitch />
            <Link href="/login" className="s-signin">
              {t('nav.signIn')}
            </Link>
            <Link className="s-btn s-btn-primary s-top-cta" href="/contact">
              {t('nav.cta')}
            </Link>
            <SiteMenu items={items} />
          </div>
        </div>
      </header>

      <main id="top">{children}</main>

      <footer className="s-footer">
        <div className="s-wrap">
          <div className="s-foot-brand">
            <Link href="/" className="s-logo-link">
              {logo('s-logo')}
            </Link>
            <p>{t('footer.line')}</p>
          </div>
          <nav className="s-foot-cols" aria-label={t('nav.footerLabel')}>
            <div>
              <h2>{t('footer.product')}</h2>
              <Link href="/how-it-works">{t('nav.how')}</Link>
              <Link href="/solutions">{t('nav.solutions')}</Link>
            </div>
            <div>
              <h2>{t('footer.company')}</h2>
              <Link href="/contact">{t('nav.contact')}</Link>
            </div>
            <div>
              <h2>{t('footer.merchants')}</h2>
              <Link href="/login">{t('footer.signIn')}</Link>
              <Link href="/signup">{t('footer.createAccount')}</Link>
            </div>
          </nav>
          <span className="s-copy">{t('footer.copy')}</span>
        </div>
      </footer>

      {callBar && (
        <aside className="s-callbar" aria-label={t('callBar.label')}>
          <div className="s-wrap">
            <span>{t('callBar.text')}</span>
            <Link className="s-btn s-btn-primary" href="/contact">
              {t('callBar.cta')}
            </Link>
          </div>
        </aside>
      )}
    </div>
  );
}
