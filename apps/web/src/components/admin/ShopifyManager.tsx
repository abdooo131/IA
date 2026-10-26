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
  shops: {
    id: string;
    merchant: { id: string; name: string };
    shopDomain: string;
    status: 'pending' | 'active' | 'uninstalled';
    scopes: string | null;
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

const KNOWN = ['shop_linked_to_other_merchant', 'shop_not_installed', 'validation_failed'];
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

export function ShopifyManager({
  data,
  merchants,
}: {
  data: ShopifyOverview;
  merchants: { id: string; name: string }[];
}) {
  const t = useTranslations('admin.shopify');
  const action = useAction();
  const unlinked = merchants.filter((m) => !data.shops.some((s) => s.merchant.id === m.id));

  function link(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void action.send(
      '/admin/shopify/link',
      { merchantId: form.get('merchantId'), shopDomain: form.get('shopDomain') },
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

      {unlinked.length > 0 && (
        <form
          onSubmit={link}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4"
        >
          <p className="w-full text-body font-bold">{t('link')}</p>
          <label className="text-caption">
            {t('merchant')}
            <select name="merchantId" required className={`${field} mt-1 block`}>
              {unlinked.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
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
