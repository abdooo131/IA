import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { verifyProxySignature } from '../src/shopify/security';
import { FakeShopify } from './fake-shopify';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const SECRET = 'test-shopify-secret';
process.env.SHOPIFY_API_KEY = 'test-client-id';
process.env.SHOPIFY_API_SECRET = SECRET;

const SHOP = 'widget-test.myshopify.com';
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');
const EARLY_CAIRO = new Date('2026-01-14T06:00:00Z');
const STORE = 'http://shop.test';
const ASSETS = join(__dirname, '../../shopify/extensions/zone-widget/assets');
const STOCKED = '9001';
const UNSTOCKED = '9002';

/**
 * Playwright comes with the machine's browsers rather than as an API dependency, so the
 * browser tests run where it is installed and are skipped elsewhere.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Playwright = { chromium: { launch: () => Promise<any> } };
interface Route {
  request(): { url(): string; postDataJSON(): unknown };
  fulfill(response: Record<string, unknown>): Promise<void>;
}
function loadPlaywright(): Playwright {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('playwright') as Playwright;
}
const canBrowse = (() => {
  try {
    loadPlaywright();
    return true;
  } catch {
    return false;
  }
})();

/** Signs app proxy parameters the way Shopify does. */
function signed(params: Record<string, string>) {
  const message = Object.keys(params)
    .map((k) => `${k}=${params[k]}`)
    .sort()
    .join('');
  return { ...params, signature: createHmac('sha256', SECRET).update(message).digest('hex') };
}
const proxyParams = (extra: Record<string, string> = {}) =>
  signed({
    shop: SHOP,
    logged_in_customer_id: '',
    path_prefix: '/apps/shiplynow',
    timestamp: '1767000000',
    ...extra,
  });

describe('storefront widget', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let merchantId: string;
  let ncrZone: { id: string; nameEn: string; nameAr: string };
  const clock = new FixedClock(NOON_CAIRO);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock, shopify: new FakeShopify() }));
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    clock.set(NOON_CAIRO);
    const { stores } = await resetAndSeed(prisma);
    merchantId = (await prisma.merchant.findFirstOrThrow()).id;
    await prisma.merchant.update({
      where: { id: merchantId },
      data: { expressPricePiastres: 4500 },
    });
    const shop = await prisma.shopifyShop.create({
      data: { merchantId, shopDomain: SHOP, status: 'active' },
    });
    let n = 0;
    for (const darkStoreId of stores.values())
      await prisma.shopifyLocation.create({
        data: {
          shopId: shop.id,
          darkStoreId,
          fulfillmentServiceId: `gid://shopify/FulfillmentService/${++n}`,
          locationId: `gid://shopify/Location/${n}`,
        },
      });
    await prisma.sku.update({
      where: { merchantId_sku: { merchantId, sku: 'EC-001' } },
      data: { shopifyVariantId: `gid://shopify/ProductVariant/${STOCKED}` },
    });
    ncrZone = await prisma.zone.findFirstOrThrow({
      where: { darkStoreId: stores.get('NCR') },
      orderBy: { code: 'asc' },
    });
  });

  it('answers only requests Shopify signed, with the areas and stock of the chosen one', async () => {
    const q = proxyParams();
    expect(verifyProxySignature(q, SECRET)).toBe(true);
    expect(verifyProxySignature({ ...q, shop: 'other.myshopify.com' }, SECRET)).toBe(false);
    await request(app.getHttpServer())
      .get('/shopify/proxy/areas')
      .query({ ...q, signature: 'bad' })
      .expect(401);

    const areas = await request(app.getHttpServer())
      .get('/shopify/proxy/areas')
      .query(q)
      .expect(200);
    expect(areas.body).toContainEqual(
      expect.objectContaining({
        zoneId: ncrZone.id,
        nameEn: ncrZone.nameEn,
        store: expect.objectContaining({ code: 'NCR' }),
      }),
    );

    const zone = ncrZone.id;
    const variants = `${STOCKED},${UNSTOCKED},abc`;
    const open = await request(app.getHttpServer())
      .get('/shopify/proxy/availability')
      .query(proxyParams({ zone, variants }))
      .expect(200);
    expect(open.body).toMatchObject({
      zone: { id: zone },
      store: { code: 'NCR' },
      offered: true,
      status: 'open',
      promiseMinutes: 60,
      variants: { [STOCKED]: true, [UNSTOCKED]: false },
    });

    clock.set(EARLY_CAIRO);
    const closed = await request(app.getHttpServer())
      .get('/shopify/proxy/availability')
      .query(proxyParams({ zone, variants: STOCKED }))
      .expect(200);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.nextOpenAt).toBe('2026-01-14T08:00:00.000Z');

    const unknownZone = await request(app.getHttpServer())
      .get('/shopify/proxy/availability')
      .query(proxyParams({ zone: 'nope', variants: STOCKED }))
      .expect(200);
    expect(unknownZone.body).toEqual({ zone: null });
  });

  it('shows the area page: only what the dark store of the area has, inside the theme', async () => {
    const shop = await prisma.shopifyShop.findUniqueOrThrow({ where: { shopDomain: SHOP } });
    await prisma.sku.update({
      where: { merchantId_sku: { merchantId, sku: 'EC-001' } },
      data: {
        shopifyProductId: 'gid://shopify/Product/501',
        titleEn: 'Rose {{ shop.secret }} oud',
      },
    });
    await prisma.shopProduct.create({
      data: {
        shopId: shop.id,
        merchantId,
        shopifyId: 'gid://shopify/Product/501',
        title: 'Rose oud',
        handle: 'rose-oud',
        status: 'ACTIVE',
        imageUrl: 'https://cdn.shopify.com/rose.jpg',
        raw: {},
      },
    });
    const page = await request(app.getHttpServer())
      .get('/shopify/proxy/store')
      .query(proxyParams({ zone: ncrZone.id, lang: 'en' }))
      .expect(200);
    expect(page.headers['content-type']).toContain('application/liquid');
    expect(page.text).toContain(`60 minute delivery to ${ncrZone.nameEn}`);
    expect(page.text).toContain(`/products/rose-oud?variant=${STOCKED}`);
    expect(page.text).toContain('rose.jpg');
    // A title can never run as Liquid in the merchant's theme.
    expect(page.text).not.toContain('{{');
    expect(page.text).toContain('Rose &#123;&#123; shop.secret &#125;&#125; oud');
    expect(page.text).toContain('data-shiplynow-change-area');

    const arabic = await request(app.getHttpServer())
      .get('/shopify/proxy/store')
      .query(proxyParams({ zone: ncrZone.id, lang: 'ar' }))
      .expect(200);
    expect(arabic.text).toContain('dir="rtl"');
    expect(arabic.text).toContain(`توصيل خلال 60 دقيقة إلى ${ncrZone.nameAr}`);

    // An unknown area, or a request Shopify did not sign.
    const none = await request(app.getHttpServer())
      .get('/shopify/proxy/store')
      .query(proxyParams({ zone: 'nope' }))
      .expect(200);
    expect(none.text).toContain('Choose your area first');
    await request(app.getHttpServer())
      .get('/shopify/proxy/store')
      .query({ ...proxyParams({ zone: ncrZone.id }), signature: 'bad' })
      .expect(401);
  });

  // ─── in a real browser ───────────────────────────────────────────────────────

  /** A tiny storefront: a collection page, a product page and the Shopify endpoints it uses. */
  async function storefront(options: { locale?: string; hide?: boolean } = {}) {
    const browser = await loadPlaywright().chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const cart: unknown[] = [];
    const embed = `<div id="shiplynow-widget" data-proxy="/apps/shiplynow"
      data-locale="${options.locale ?? 'en'}" data-hide-unavailable="${options.hide ?? false}"
      data-position="bottom" hidden></div>
      <link rel="stylesheet" href="/assets/zone-widget.css">
      <script src="/assets/zone-widget.js" defer></script>`;
    const pages: Record<string, string> = {
      '/collections/all': `<ul>
        <li class="grid__item"><a href="/products/rose-oud">Rose oud</a></li>
        <li class="grid__item"><a href="/products/old-musk?variant=${UNSTOCKED}">Old musk</a></li>
      </ul>${embed}`,
      '/products/rose-oud': `<h1>Rose oud</h1><form action="/cart/add">
        <input type="hidden" name="id" value="${STOCKED}"><button>Add</button></form>${embed}`,
    };
    await page.route(`${STORE}/**`, async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/apps/shiplynow/')) {
        const params = Object.fromEntries(url.searchParams);
        const res = await request(app.getHttpServer())
          .get(url.pathname.replace('/apps/shiplynow', '/shopify/proxy'))
          .query(proxyParams(params));
        return route.fulfill({ status: res.status, json: res.body });
      }
      if (url.pathname.startsWith('/assets/'))
        return route.fulfill({
          contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript',
          body: readFileSync(join(ASSETS, url.pathname.replace('/assets/', ''))),
        });
      if (url.pathname === '/products/rose-oud.js')
        return route.fulfill({ json: { variants: [{ id: Number(STOCKED) }] } });
      if (url.pathname === '/products/old-musk.js')
        return route.fulfill({ json: { variants: [{ id: Number(UNSTOCKED) }] } });
      if (url.pathname === '/cart/update.js') {
        cart.push(route.request().postDataJSON());
        return route.fulfill({ json: {} });
      }
      const html = pages[url.pathname];
      if (html)
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${html}</body></html>`,
        });
      return route.fulfill({ status: 404, body: '' });
    });
    return { browser, page, cart };
  }

  it.skipIf(!canBrowse)(
    'lets the customer pick an area and marks what can arrive in 60 minutes',
    async () => {
      const { browser, page, cart } = await storefront();
      try {
        const bar = page.locator('#shiplynow-widget');
        await page.goto(`${STORE}/collections/all`);
        await expect.poll(() => bar.getAttribute('data-state')).toBe('pick');
        expect(await bar.textContent()).toContain('Delivery in 60 minutes. Check your area');

        await page.getByRole('button', { name: 'Check' }).click();
        const dialog = page.getByRole('dialog', { name: 'Where should we deliver?' });
        await page.getByRole('searchbox').fill(ncrZone.nameEn.slice(0, 5));
        await dialog.getByRole('button', { name: new RegExp(ncrZone.nameEn) }).click();
        await expect.poll(() => bar.getAttribute('data-state')).toBe('open');
        expect(await bar.locator('.snw-label').textContent()).toBe(
          `60 minute delivery to ${ncrZone.nameEn}`,
        );
        expect(cart).toEqual([{ attributes: { _shiplynow_zone: ncrZone.id } }]);

        const stocked = page.locator('li', { hasText: 'Rose oud' });
        const unstocked = page.locator('li', { hasText: 'Old musk' });
        await expect.poll(() => stocked.locator('.snw-badge').textContent()).toBe('60 min');
        await expect.poll(() => unstocked.getAttribute('class')).toContain('snw-dim');
        expect(await unstocked.locator('.snw-standard').textContent()).toBe('Normal delivery');

        // The choice is remembered, and the product page says what to expect.
        await page.goto(`${STORE}/products/rose-oud`);
        await expect
          .poll(() => page.locator('.snw-product').textContent())
          .toBe(`Arrives in 60 minutes to ${ncrZone.nameEn}`);

        // Closed store: the bar says when it opens again.
        clock.set(EARLY_CAIRO);
        await page.reload();
        await expect.poll(() => bar.getAttribute('data-state')).toBe('closed');
        expect(await bar.locator('.snw-label').textContent()).toContain('starts again');

        // A merchant who stops offering 60 minutes hides the widget.
        await prisma.merchant.update({
          where: { id: merchantId },
          data: { expressPricePiastres: null },
        });
        await page.reload();
        await expect.poll(() => bar.isHidden()).toBe(true);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );

  it.skipIf(!canBrowse)(
    'speaks Arabic right to left and can hide products that cannot arrive in time',
    async () => {
      const { browser, page } = await storefront({ locale: 'ar', hide: true });
      try {
        await page.goto(`${STORE}/collections/all`);
        await page.evaluate(
          `localStorage.setItem('shiplynow_area', ${JSON.stringify(JSON.stringify({ zoneId: ncrZone.id }))})`,
        );
        await page.reload();
        const bar = page.locator('#shiplynow-widget');
        await expect.poll(() => bar.getAttribute('data-state')).toBe('open');
        expect(await bar.getAttribute('dir')).toBe('rtl');
        expect(await bar.locator('.snw-label').textContent()).toBe(
          `توصيل خلال 60 دقيقة لـ ${ncrZone.nameAr}`,
        );
        await expect.poll(() => page.locator('li', { hasText: 'Old musk' }).isHidden()).toBe(true);
        expect(await page.locator('li', { hasText: 'Rose oud' }).isVisible()).toBe(true);
      } finally {
        await browser.close();
      }
    },
    60_000,
  );
});
