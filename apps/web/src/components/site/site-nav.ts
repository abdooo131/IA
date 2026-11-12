// The public website's pages, its top navigation and what search engines may read. Kept free of
// React so the rules are unit tested (site-nav.test.ts).

/** The pages linked from the top bar, in menu order. */
export const SITE_NAV = [
  { key: 'how', href: '/how-it-works' },
  { key: 'solutions', href: '/solutions' },
  { key: 'contact', href: '/contact' },
] as const;

export type SiteNavKey = (typeof SITE_NAV)[number]['key'];
/**
 * Our team stays hidden until the owner sends the people (owner's choice): off the menus and the
 * sitemap, and /team answers not found. Set to true and add it back to SITE_NAV to show it.
 */
export const TEAM_PAGE_LIVE = false;

/** Every public website page: home, the menu pages and the team page. */
export type SitePage = 'home' | SiteNavKey | 'team';

export const SITE_PATHS: Record<SitePage, string> = {
  home: '/',
  ...(Object.fromEntries(SITE_NAV.map((p) => [p.key, p.href])) as Record<SiteNavKey, string>),
  team: '/team',
};

export interface SiteNavItem {
  key: SiteNavKey;
  href: string;
  current: boolean;
}

/** The top bar's links with the page being shown marked (home marks none). */
export function navItems(page: SitePage): SiteNavItem[] {
  return SITE_NAV.map((item) => ({ ...item, current: item.key === page }));
}

/** The "Request a call" bar stays at the bottom of every page but Contact, which has the form. */
export function showsCallBar(page: SitePage): boolean {
  return page !== 'contact';
}

/** Signed in areas and the API: never listed by search engines. */
export const ROBOTS_DISALLOW = [
  '/admin',
  '/finance',
  '/store',
  '/rider',
  '/merchant',
  '/api',
  '/home',
  '/t/',
] as const;

/** The site's address (WEB_ORIGIN) without a trailing slash, or null when unset or invalid. */
export function siteOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** sitemap.xml rows: every public website page, home first. */
export function sitemapEntries(origin: string): { url: string; priority: number }[] {
  return (Object.keys(SITE_PATHS) as SitePage[])
    .filter((page) => page !== 'team' || TEAM_PAGE_LIVE)
    .map((page) => ({
      url: `${origin}${SITE_PATHS[page]}`,
      priority: page === 'home' ? 1 : 0.8,
    }));
}
