import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { SITE_PATHS, type SitePage, siteOrigin } from './site-nav';

/** A website page's title, description and Open Graph card, in the visitor's language. */
export async function siteMetadata(page: SitePage): Promise<Metadata> {
  const [site, locale] = await Promise.all([getTranslations('site'), getLocale()]);
  const title = site(`meta.${page}.title`);
  const description = site(`meta.${page}.description`);
  const origin = siteOrigin(process.env.WEB_ORIGIN);
  const path = SITE_PATHS[page];
  return {
    title: { absolute: title },
    description,
    metadataBase: origin ? new URL(origin) : null,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: site('brand'),
      title,
      description,
      locale: locale === 'ar' ? 'ar_EG' : 'en_EG',
      alternateLocale: locale === 'ar' ? 'en_EG' : 'ar_EG',
      url: path,
      images: [
        { url: '/brand/app-icon-512.png', width: 512, height: 512, alt: site('meta.ogAlt') },
      ],
    },
    twitter: { card: 'summary', title, description },
  };
}
