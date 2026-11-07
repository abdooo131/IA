import { describe, expect, it } from 'vitest';
import {
  navItems,
  ROBOTS_DISALLOW,
  SITE_NAV,
  SITE_PATHS,
  showsCallBar,
  siteOrigin,
  sitemapEntries,
} from './site-nav';

describe('website navigation', () => {
  it('marks only the page being shown', () => {
    for (const { key } of SITE_NAV) {
      const items = navItems(key);
      expect(items.filter((i) => i.current).map((i) => i.key)).toEqual([key]);
    }
  });

  it('marks nothing on the home page', () => {
    expect(navItems('home').some((i) => i.current)).toBe(false);
  });

  it('lists the menu in the agreed order', () => {
    expect(navItems('home').map((i) => i.href)).toEqual([
      '/how-it-works',
      '/solutions',
      '/team',
      '/contact',
    ]);
  });

  it('hides the call bar only on Contact', () => {
    expect(showsCallBar('contact')).toBe(false);
    for (const page of ['home', 'how', 'solutions', 'team'] as const)
      expect(showsCallBar(page)).toBe(true);
  });

  it('never points a website page at a signed in area', () => {
    for (const path of Object.values(SITE_PATHS))
      expect(ROBOTS_DISALLOW.some((p) => path.startsWith(p))).toBe(false);
  });
});

describe('site address and sitemap', () => {
  it('takes the origin of WEB_ORIGIN', () => {
    expect(siteOrigin('https://shiply.example/')).toBe('https://shiply.example');
    expect(siteOrigin('http://localhost:3970')).toBe('http://localhost:3970');
  });

  it('answers null for a missing or odd address', () => {
    expect(siteOrigin(undefined)).toBeNull();
    expect(siteOrigin('')).toBeNull();
    expect(siteOrigin('not a url')).toBeNull();
    expect(siteOrigin('ftp://files.example')).toBeNull();
  });

  it('lists every public page once, home first', () => {
    const urls = sitemapEntries('https://shiply.example').map((e) => e.url);
    expect(urls).toEqual([
      'https://shiply.example/',
      'https://shiply.example/how-it-works',
      'https://shiply.example/solutions',
      'https://shiply.example/team',
      'https://shiply.example/contact',
    ]);
  });
});
