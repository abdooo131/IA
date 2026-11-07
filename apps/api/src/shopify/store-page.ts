// The area landing page the widget opens after a customer picks their area. Shopify's app
// proxy renders the answer (application/liquid) inside the merchant's theme, so the page keeps
// the store's header, footer and fonts; only the product grid is ours.

export type PageLocale = 'en' | 'ar';

const TEXT = {
  en: {
    title: '60 minute delivery to {area}',
    from: 'From our {store} dark store',
    open: 'Order now: delivered within {minutes} minutes.',
    full: 'Busy right now: you can still order, delivery may take a little longer.',
    closed: 'Closed now. Opens {next}.',
    off: 'This store does not offer 60 minute delivery yet.',
    none: 'Nothing is in stock at this dark store right now. Try another area or come back later.',
    count: '{count} products ready to deliver',
    change: 'Change area',
    noArea: 'Choose your area first to see what we can deliver in 60 minutes.',
    view: 'View',
  },
  ar: {
    title: 'توصيل خلال 60 دقيقة إلى {area}',
    from: 'من مخزن {store}',
    open: 'اطلب الآن: يصلك خلال {minutes} دقيقة.',
    full: 'ضغط طلبات الآن: يمكنك الطلب وقد يتأخر التوصيل قليلاً.',
    closed: 'مغلق الآن. يفتح {next}.',
    off: 'هذا المتجر لا يقدم توصيل الـ 60 دقيقة بعد.',
    none: 'لا توجد منتجات متاحة في هذا المخزن الآن. جرب منطقة أخرى أو عد لاحقاً.',
    count: '{count} منتج جاهز للتوصيل',
    change: 'غيّر المنطقة',
    noArea: 'اختر منطقتك أولاً لترى ما يمكننا توصيله خلال 60 دقيقة.',
    view: 'عرض',
  },
} as const;

type Key = keyof (typeof TEXT)['en'];

export function pageText(locale: PageLocale, key: Key, vars: Record<string, string | number> = {}) {
  let text: string = TEXT[locale][key];
  for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

/**
 * Escapes text for HTML and for Liquid: a product title containing "{{" or "{%" must never run
 * as Liquid in the merchant's theme.
 */
export function safe(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/{/g, '&#123;')
    .replace(/}/g, '&#125;');
}

export interface PageProduct {
  title: string;
  handle: string;
  variantId: string | null;
  imageUrl: string | null;
  pricePiastres: number;
}

export interface PageInput {
  locale: PageLocale;
  area: string;
  store: string;
  status: 'open' | 'at_capacity' | 'closed';
  nextOpen: string | null;
  promiseMinutes: number;
  offered: boolean;
  currency: string;
  products: PageProduct[];
}

const price = (piastres: number, currency: string) =>
  `${(piastres / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const STYLE = `<style>
.snp{max-width:1200px;margin:0 auto;padding:24px 16px}
.snp h1{margin:0 0 4px}
.snp .snp-sub{opacity:.75;margin:0 0 12px}
.snp .snp-state{padding:10px 12px;border-radius:8px;background:rgba(0,0,0,.05);margin:0 0 16px}
.snp .snp-change{display:inline-block;margin:0 0 16px;text-decoration:underline;cursor:pointer;background:none;border:0;padding:0;font:inherit;color:inherit}
.snp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px}
.snp-card{display:block;text-decoration:none;color:inherit;border:1px solid rgba(0,0,0,.1);border-radius:8px;overflow:hidden}
.snp-card img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:rgba(0,0,0,.04)}
.snp-card .snp-info{padding:8px 10px}
.snp-card .snp-name{margin:0 0 4px;font-size:.95em}
.snp-card .snp-price{margin:0;font-weight:700}
</style>`;

/** The page body: the area, the store and its state, then every product it has in stock. */
export function renderStorePage(p: PageInput) {
  const t = (key: Key, vars?: Record<string, string | number>) =>
    safe(pageText(p.locale, key, vars));
  const state = !p.offered
    ? t('off')
    : p.status === 'open'
      ? t('open', { minutes: p.promiseMinutes })
      : p.status === 'at_capacity'
        ? t('full')
        : t('closed', { next: p.nextOpen ?? '' });
  const cards = p.products
    .map((x) => {
      const href = `/products/${encodeURIComponent(x.handle)}${x.variantId ? `?variant=${encodeURIComponent(x.variantId)}` : ''}`;
      const image = x.imageUrl
        ? `<img src="${safe(x.imageUrl)}" alt="${safe(x.title)}" loading="lazy" width="320" height="320">`
        : '';
      return `<a class="snp-card" href="${safe(href)}">${image}<div class="snp-info"><p class="snp-name">${safe(x.title)}</p><p class="snp-price">${safe(price(x.pricePiastres, p.currency))}</p></div></a>`;
    })
    .join('');
  return `${STYLE}<div class="snp" dir="${p.locale === 'ar' ? 'rtl' : 'ltr'}">
<h1>${t('title', { area: p.area })}</h1>
<p class="snp-sub">${t('from', { store: p.store })}</p>
<p class="snp-state">${state}</p>
<button type="button" class="snp-change" data-shiplynow-change-area>${t('change')}</button>
${p.products.length ? `<p>${t('count', { count: p.products.length })}</p><div class="snp-grid">${cards}</div>` : `<p>${t('none')}</p>`}
</div>`;
}

/** Shown when the page is opened without a known area (or one this store does not serve). */
export function renderNoArea(locale: PageLocale) {
  return `${STYLE}<div class="snp" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><p>${safe(pageText(locale, 'noArea'))}</p>
<button type="button" class="snp-change" data-shiplynow-change-area>${safe(pageText(locale, 'change'))}</button></div>`;
}
