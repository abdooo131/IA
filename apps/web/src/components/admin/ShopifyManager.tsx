'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime, formatEgp } from '@/lib/format';

type StoreRef = { id: string; code: string; nameEn: string; nameAr: string };

export interface ShopifyOverview {
  configured: boolean;
  publicUrl: string;
  setup: {
    appUrl: string;
    redirectUrl: string;
    webhooksUrl: string;
    proxyUrl: string;
    scopes: string;
  };
  apps: { id: string; name: string; clientId: string; shops: number }[];
  shops: {
    id: string;
    appId: string | null;
    merchant: { id: string; name: string };
    shopDomain: string;
    status: 'pending' | 'active' | 'uninstalled';
    scopes: string | null;
    missingScopes: string[];
    installedAt: string | null;
    installUrl: string;
    expressPricePiastres: number | null;
    carrierServiceId: string | null;
    locations: {
      id: string;
      darkStore: StoreRef;
      locationId: string;
      isActive: boolean;
      addressSynced: boolean;
    }[];
    linkedProducts: number;
    products: number;
    pendingCalls: number;
    failedCalls: number;
    logs: {
      id: string;
      at: string;
      direction: string;
      kind: string;
      ok: boolean;
      message: string | null;
    }[];
  }[];
}

const KNOWN = [
  'shop_linked_to_other_merchant',
  'shop_not_installed',
  'validation_failed',
  'app_exists',
  'app_is_main_app',
  'app_in_use',
  'app_not_found',
];
const field = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm';
const button =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';

function useAction() {
  const t = useTranslations('admin.shopify');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function send<T>(path: string, body: unknown, done: (data: T) => string) {
    setBusy(true);
    setMessage(null);
    const result = await apiSend<T>('POST', path, body);
    setBusy(false);
    if (!result.ok) {
      setMessage({
        text: t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`),
        error: true,
      });
      return null;
    }
    setMessage({ text: done(result.data), error: false });
    router.refresh();
    return result.data;
  }
  return { busy, message, send };
}

function Message({ message }: { message: { text: string; error: boolean } | null }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
    >
      {message.text}
    </p>
  );
}

function CopyLink({ url }: { url: string }) {
  const t = useTranslations('admin.shopify');
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="ltr-iso min-w-0 flex-1 break-all rounded-md bg-surface-raised px-3 py-2 text-caption">
        {url}
      </code>
      <button
        type="button"
        className={button}
        onClick={() => {
          void navigator.clipboard?.writeText(url);
          setCopied(true);
        }}
      >
        {copied ? t('copied') : t('copy')}
      </button>
    </div>
  );
}

function ShopCard({ shop }: { shop: ShopifyOverview['shops'][number] }) {
  const t = useTranslations('admin.shopify');
  const locale = useLocale();
  const action = useAction();
  const [createMissing, setCreateMissing] = useState(false);
  const active = shop.status === 'active';
  const chip =
    shop.status === 'active'
      ? 'border-status-delivered text-status-delivered'
      : shop.status === 'pending'
        ? 'border-status-needs-action text-status-needs-action'
        : 'border-danger text-danger';

  return (
    <li className="space-y-4 rounded-lg border border-line bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h3">{shop.merchant.name}</h2>
          <p className="ltr-iso text-body-sm text-text-muted">{shop.shopDomain}</p>
        </div>
        <span className={`rounded-pill border px-3 py-1 text-caption font-bold ${chip}`}>
          {t(`statuses.${shop.status}`)}
        </span>
      </div>

      {!active && (
        <div className="space-y-2">
          <p className="text-body-sm font-bold">{t('installLink')}</p>
          <p className="text-caption text-text-muted">{t('installHelp')}</p>
          <CopyLink url={shop.installUrl} />
        </div>
      )}

      {active && shop.missingScopes.length > 0 && (
        <div
          role="status"
          className="space-y-2 rounded-md border border-s-4 border-status-needs-action p-3"
        >
          <p className="text-body-sm font-bold">{t('missingScopes')}</p>
          <p className="ltr-iso text-caption">{shop.missingScopes.join(', ')}</p>
          <p className="text-caption text-text-muted">{t('missingScopesHelp')}</p>
          <CopyLink url={shop.installUrl} />
        </div>
      )}

      {active && (
        <>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <dt className="text-caption text-text-muted">{t('catalog')}</dt>
              <dd className="ltr-iso text-h3">
                {shop.linkedProducts} / {shop.products}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">{t('locations')}</dt>
              <dd className="ltr-iso text-h3">{shop.locations.length}</dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">{t('pending')}</dt>
              <dd className="ltr-iso text-h3">{shop.pendingCalls}</dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">{t('failed')}</dt>
              <dd className={`ltr-iso text-h3 ${shop.failedCalls ? 'text-danger' : ''}`}>
                {shop.failedCalls}
              </dd>
            </div>
          </dl>

          <div className="grid gap-3 rounded-md border border-line p-3 md:grid-cols-2">
            <div>
              <p className="text-caption text-text-muted">{t('checkout')}</p>
              <p
                className={`text-body-sm font-bold ${
                  shop.carrierServiceId ? 'text-status-delivered' : 'text-status-needs-action'
                }`}
              >
                {shop.carrierServiceId ? t('checkoutOn') : t('checkoutOff')}
              </p>
              {!shop.carrierServiceId && (
                <button
                  type="button"
                  className={`${button} mt-2`}
                  disabled={action.busy}
                  onClick={() =>
                    void action.send(`/admin/shopify/${shop.id}/carrier-service`, {}, () =>
                      t('result.checkout'),
                    )
                  }
                >
                  {t('turnOnCheckout')}
                </button>
              )}
            </div>
            <div>
              <p className="text-caption text-text-muted">{t('merchantPrice')}</p>
              <p className="text-body-sm font-bold">
                {shop.expressPricePiastres == null
                  ? t('noPrice')
                  : t('price', { price: formatEgp(shop.expressPricePiastres) })}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={primary}
              disabled={action.busy}
              onClick={() =>
                void action.send(`/admin/shopify/${shop.id}/sync-now`, {}, () => t('result.sync'))
              }
            >
              {t('syncNow')}
            </button>
            <button
              type="button"
              className={button}
              disabled={action.busy}
              onClick={() =>
                void action.send<{ created: unknown[]; failed: unknown[] }>(
                  `/admin/shopify/${shop.id}/register-locations`,
                  {},
                  (d) =>
                    t('result.register', { created: d.created.length, failed: d.failed.length }),
                )
              }
            >
              {t('register')}
            </button>
            <button
              type="button"
              className={button}
              disabled={action.busy}
              onClick={() =>
                void action.send<{
                  linked: number;
                  created: number;
                  alreadyLinked: number;
                  notInCatalog: unknown[];
                  withoutSku: number;
                }>(`/admin/shopify/${shop.id}/sync-catalog`, { createMissing }, (d) =>
                  t('result.catalog', {
                    linked: d.linked,
                    created: d.created,
                    already: d.alreadyLinked,
                    missing: d.notInCatalog.length,
                    withoutSku: d.withoutSku,
                  }),
                )
              }
            >
              {t('syncCatalog')}
            </button>
            <label className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={createMissing}
                onChange={(e) => setCreateMissing(e.target.checked)}
              />
              {t('createMissing')}
            </label>
            <button
              type="button"
              className={`${button} ms-auto text-danger`}
              disabled={action.busy}
              onClick={() => {
                if (!window.confirm(t('disconnectConfirm', { shop: shop.shopDomain }))) return;
                void action.send<{ notRemovedInShopify: number }>(
                  `/admin/shopify/${shop.id}/disconnect`,
                  {},
                  (d) =>
                    d.notRemovedInShopify > 0
                      ? t('result.disconnectPartly', { count: d.notRemovedInShopify })
                      : t('result.disconnect'),
                );
              }}
            >
              {t('disconnect')}
            </button>
          </div>
          <Message message={action.message} />

          <div>
            <h3 className="text-body font-bold">{t('locations')}</h3>
            {shop.locations.length === 0 ? (
              <p className="text-body-sm text-text-muted">{t('noLocations')}</p>
            ) : (
              <ul className="mt-1 flex flex-wrap gap-2">
                {shop.locations.map((l) => (
                  <li key={l.id} className="rounded-pill border border-line px-3 py-1 text-caption">
                    {localized(l.darkStore, locale)}
                    {!l.addressSynced && (
                      <span className="text-status-needs-action"> · {t('addressMissing')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div>
        <h3 className="text-body font-bold">{t('log')}</h3>
        {shop.logs.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noLog')}</p>
        ) : (
          <ul className="mt-1 max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
            {shop.logs.map((l) => (
              <li key={l.id} className="flex flex-wrap gap-x-3 px-3 py-1.5 text-caption">
                <span className="ltr-iso whitespace-nowrap text-text-muted">
                  {formatCairoDateTime(l.at, locale)}
                </span>
                <span className={`ltr-iso font-bold ${l.ok ? '' : 'text-danger'}`}>
                  {l.direction === 'in' ? '←' : '→'} {l.kind}
                </span>
                {l.message && <span className="ltr-iso min-w-0 break-words">{l.message}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * Custom apps: one per pilot merchant, made in the Partner Dashboard with custom distribution
 * (no App Store review). Shows what to paste there, then takes the app's client id and secret.
 */
function AppsPanel({ data }: { data: ShopifyOverview }) {
  const t = useTranslations('admin.shopify');
  const action = useAction();
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    void action
      .send(
        '/admin/shopify/apps',
        {
          name: form.get('name'),
          clientId: form.get('clientId'),
          clientSecret: form.get('clientSecret'),
        },
        () => t('appAdded'),
      )
      .then((done) => done && formEl.reset());
  }
  const rows: [string, string][] = [
    [t('setupAppUrl'), data.setup.appUrl],
    [t('setupRedirect'), data.setup.redirectUrl],
    [t('setupWebhooks'), data.setup.webhooksUrl],
    [t('setupProxy'), data.setup.proxyUrl],
    [t('setupScopes'), data.setup.scopes],
  ];
  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div>
        <h2 className="text-h3">{t('apps')}</h2>
        <p className="mt-1 text-body-sm text-text-muted">{t('appsIntro')}</p>
      </div>
      <details className="rounded-md border border-line p-3">
        <summary className="cursor-pointer text-body-sm font-bold">{t('setupTitle')}</summary>
        <div className="mt-3 space-y-3">
          {rows.map(([label, value]) => (
            <div key={label}>
              <p className="text-caption text-text-muted">{label}</p>
              <CopyLink url={value} />
            </div>
          ))}
        </div>
      </details>
      {data.apps.length > 0 && (
        <ul className="divide-y divide-line">
          {data.apps.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-body-sm">
                <strong>{a.name}</strong>
                <span className="ltr-iso block text-caption text-text-muted">{a.clientId}</span>
                <span className="block text-caption text-text-muted">
                  {t('appShops', { count: a.shops })}
                </span>
              </span>
              <button
                type="button"
                className={button}
                disabled={action.busy || a.shops > 0}
                onClick={() => {
                  if (!window.confirm(t('removeAppConfirm', { name: a.name }))) return;
                  void action.send(`/admin/shopify/apps/${a.id}/remove`, {}, () => t('appRemoved'));
                }}
              >
                {t('removeApp')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <label className="text-caption">
          {t('appName')}
          <input name="name" required minLength={2} className={`${field} mt-1 block`} />
        </label>
        <label className="text-caption">
          {t('clientId')}
          <input
            name="clientId"
            required
            minLength={10}
            dir="ltr"
            className={`${field} mt-1 block`}
          />
        </label>
        <label className="text-caption">
          {t('clientSecret')}
          <input
            name="clientSecret"
            type="password"
            required
            minLength={10}
            autoComplete="off"
            dir="ltr"
            className={`${field} mt-1 block`}
          />
        </label>
        <button type="submit" className={button} disabled={action.busy}>
          {t('addApp')}
        </button>
        <div className="w-full">
          <Message message={action.message} />
        </div>
      </form>
    </section>
  );
}

export function ShopifyManager({
  data,
  merchants,
}: {
  data: ShopifyOverview;
  merchants: { id: string; name: string }[];
}) {
  const t = useTranslations('admin.shopify');
  const action = useAction();
  const linkedIds = new Set(data.shops.map((s) => s.merchant.id));

  function link(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void action.send(
      '/admin/shopify/link',
      {
        merchantId: form.get('merchantId'),
        shopDomain: form.get('shopDomain'),
        appId: form.get('appId') || null,
      },
      () => t('installLink'),
    );
  }

  return (
    <div className="mt-4 space-y-6">
      {!data.configured && (
        <p
          role="alert"
          className="rounded-md border border-status-needs-action px-4 py-3 text-body-sm"
        >
          {t('notConfigured')}
        </p>
      )}

      <AppsPanel data={data} />

      {merchants.length > 0 && (
        <form
          onSubmit={link}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4"
        >
          <p className="w-full text-body font-bold">{t('link')}</p>
          <label className="text-caption">
            {t('merchant')}
            <select name="merchantId" required className={`${field} mt-1 block`}>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {linkedIds.has(m.id) ? t('alreadyLinked', { name: m.name }) : m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-caption">
            {t('appChoice')}
            <select name="appId" defaultValue="" className={`${field} mt-1 block`}>
              <option value="">{t('mainApp')}</option>
              {data.apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 flex-1 text-caption">
            {t('domain')}
            <input
              name="shopDomain"
              required
              dir="ltr"
              placeholder="evechantelle.myshopify.com"
              className={`${field} mt-1 block w-full`}
            />
            <span className="text-text-muted">{t('domainHint')}</span>
          </label>
          <button type="submit" className={button} disabled={action.busy}>
            {t('linkButton')}
          </button>
          <div className="w-full">
            <Message message={action.message} />
          </div>
        </form>
      )}

      <ul className="space-y-4">
        {data.shops.map((s) => (
          <ShopCard key={s.id} shop={s} />
        ))}
      </ul>
    </div>
  );
}
