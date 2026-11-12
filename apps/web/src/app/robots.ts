import type { MetadataRoute } from 'next';
import { ROBOTS_DISALLOW, siteOrigin } from '@/components/site/site-nav';

// Read WEB_ORIGIN when asked, never frozen at build time.
export const dynamic = 'force-dynamic';

/** robots.txt: the public website may be read; signed in areas and the API may not. */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin(process.env.WEB_ORIGIN);
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...ROBOTS_DISALLOW] }],
    ...(origin ? { sitemap: `${origin}/sitemap.xml`, host: origin } : {}),
  };
}
