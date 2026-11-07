import type { MetadataRoute } from 'next';
import { siteOrigin, sitemapEntries } from '@/components/site/site-nav';

// Read WEB_ORIGIN when asked, never frozen at build time.
export const dynamic = 'force-dynamic';

/** sitemap.xml: the public website pages (empty while WEB_ORIGIN is not set). */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin(process.env.WEB_ORIGIN);
  if (!origin) return [];
  return sitemapEntries(origin).map(({ url, priority }) => ({
    url,
    priority,
    changeFrequency: 'monthly',
  }));
}
