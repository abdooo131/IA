'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { apiSend } from '@/lib/api-client';

export interface MerchantShopify {
  configured: boolean;
  setup: {
    appUrl: string;
    redirectUrl: string;
    webhooksUrl: string;
    proxyUrl: string;
    scopes: string[];
  };
  shop: {
    shopDomain: string;
    status: 'pending' | 'active' | 'uninstalled';
    ownApp: boolean;
    clientId: string | null;
    missingScopes: string[];
    installUrl: string;
    themeEditorUrl: string | null;
    linkedProducts: number;
    readiness: {
      connected: boolean;
      shopifyVariants: number;
      variantsWithoutSku: number;
      unitsWithUs: number;
      priceSet: boolean;
      rateService: boolean;
    };
  } | null;
}

const field = 'mt-1 block h-11 w-full rounded-md border border-line bg-surface px-3 text-body';
const primary =
  'inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'inline-flex h-11 items-center justify-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold disabled:opacity-50';
const ERRORS = [
  'shop_linked_to_other_merchant',
  'app_used_by_other_merchant',
  'app_is_main_app',
  'validation_failed',
];

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <li className="rounded-lg border border-line bg-surface p-5">
      <h2 className="flex items-center gap-3 text-h3">
        <span
          aria-hidden
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-caption font-bold ${
            done ? 'bg-status-delivered text-white' : 'border border-line'
          }`}
        >
          {done ? '✓' : n}
        </span>
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-body-sm">{children}</div>
    </li>
  );
}

function Copy({ value }: { value: string }) {
  const t = useTranslations('merchant.shopify');
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="ltr-iso min-w-0 flex-1 break-all rounded-md bg-surface-raised px-3 py-2 text-caption">
        {value}
      </code>
      <button
        type="button"
        className={secondary}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? t('copied') : t('copy')}
      </button>
    </div>
  );
}

/** Connecting a Shopify store, done by the merchant alone, one step at a time. */
export function ShopifyConnect({ data }: { data: MerchantShopify }) {
  const t = useTranslations('merchant.shopify');
  const router = useRouter();
  const shop = data.shop;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [editing, setEditing] = useState(!shop?.ownApp);
  const active = shop?.status === 'active';
  const r = shop?.readiness;

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    const result = await apiSend<{ status: 'active' | 'approve'; installUrl?: string }>(
      'POST',
      '/merchant/shopify/connect',
      {
        shopDomain: String(form.get('shopDomain') ?? '').trim(),
        clientId: String(form.get('clientId') ?? '').trim(),
        clientSecret: String(form.get('clientSecret') ?? '').trim(),
      },
    );
    setBusy(false);
    if (!result.ok) {
      setMessage({
        text: t(`errors.${ERRORS.includes(result.error) ? result.error : 'generic'}`),
        error: true,
      });
      return;
    }
    setEditing(false);
    setMessage({
      text: result.data.status === 'active' ? t('connected') : t('saved'),
      error: false,
    });
    router.refresh();
  }

  async function check() {
    setBusy(true);
    setMessage(null);
    const result = await apiSend<{ status: 'active' | 'approve' }>(
      'POST',
      '/merchant/shopify/check',
      {},
    );
    setBusy(false);
    setMessage(
      result.ok
        ? { text: result.data.status === 'active' ? t('connected') : t('notYet'), error: false }
        : { text: t('errors.generic'), error: true },
    );
    router.refresh();
  }

  if (!data.configured) return <p className="mt-4 text-body">{t('notConfigured')}</p>;

  return (
    <ol className="mt-4 max-w-3xl space-y-4">
      <Step n={1} title={t('step1')} done={!!shop?.ownApp && !editing}>
        <ol className="list-inside list-decimal space-y-1">
          <li>{t('step1a')}</li>
          <li>{t('step1b')}</li>
          <li>{t('step1c')}</li>
        </ol>
        {editing ? (
          <form className="space-y-3" onSubmit={connect} noValidate>
            <label className="block text-caption">
              {t('shopDomain')}
              <input
                name="shopDomain"
                required
                dir="ltr"
                defaultValue={shop?.shopDomain ?? ''}
                placeholder="mystore.myshopify.com"
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('clientId')}
              <input
                name="clientId"
                required
                dir="ltr"
                defaultValue={shop?.clientId ?? ''}
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('clientSecret')}
              <input
                name="clientSecret"
                required
                dir="ltr"
                type="password"
                autoComplete="off"
                className={field}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={primary} disabled={busy}>
                {t('save')}
              </button>
              {shop?.ownApp && (
                <button type="button" className={secondary} onClick={() => setEditing(false)}>
                  {t('cancel')}
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="ltr-iso font-bold">{shop?.shopDomain}</span>
            <button type="button" className={secondary} onClick={() => setEditing(true)}>
              {t('change')}
            </button>
          </div>
        )}
      </Step>

      {shop?.ownApp && !editing && (
        <>
          <Step n={2} title={t('step2')} done={active}>
            <p>{t('step2Intro')}</p>
            <a href="/api/merchant/shopify/kit" className={primary} download>
              {t('downloadKit')}
            </a>
            <p className="text-text-muted">{t('step2Run')}</p>
            <Copy value="npx @shopify/cli@latest app deploy" />
            <details className="rounded-md border border-line p-3">
              <summary className="cursor-pointer font-bold">{t('byHand')}</summary>
              <div className="mt-3 space-y-2">
                <p>{t('appUrl')}</p>
                <Copy value={data.setup.appUrl} />
                <p>{t('redirectUrl')}</p>
                <Copy value={data.setup.redirectUrl} />
                <p>{t('proxyUrl')}</p>
                <Copy value={data.setup.proxyUrl} />
                <p>{t('scopes')}</p>
                <Copy value={data.setup.scopes.join(',')} />
              </div>
            </details>
          </Step>

          <Step n={3} title={t('step3')} done={active && shop.missingScopes.length === 0}>
            <p>{active ? t('step3Done') : t('step3Intro')}</p>
            {shop.missingScopes.length > 0 && active && (
              <p className="text-danger">
                {t('missing', { scopes: shop.missingScopes.join(', ') })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {(!active || shop.missingScopes.length > 0) && (
                <a href={shop.installUrl} className={primary}>
                  {t('install')}
                </a>
              )}
              <button type="button" className={secondary} onClick={check} disabled={busy}>
                {t('checkAgain')}
              </button>
            </div>
          </Step>

          <Step n={4} title={t('step4')} done={false}>
            <p>{t('step4Intro')}</p>
            {shop.themeEditorUrl && (
              <a href={shop.themeEditorUrl} target="_blank" rel="noreferrer" className={primary}>
                {t('openThemeEditor')}
              </a>
            )}
          </Step>

          {active && r && (
            <Step
              n={5}
              title={t('step5')}
              done={r.rateService && shop.linkedProducts > 0 && r.unitsWithUs > 0 && r.priceSet}
            >
              <ul className="space-y-1">
                <Check
                  ok={r.rateService}
                  text={r.rateService ? t('ready.rates') : t('ready.ratesTodo')}
                />
                <Check
                  ok={shop.linkedProducts > 0}
                  text={
                    shop.linkedProducts > 0
                      ? t('ready.products', { count: shop.linkedProducts })
                      : t('ready.productsTodo', { noSku: r.variantsWithoutSku })
                  }
                />
                <Check
                  ok={r.unitsWithUs > 0}
                  text={
                    r.unitsWithUs > 0
                      ? t('ready.stock', { units: r.unitsWithUs })
                      : t('ready.stockTodo')
                  }
                />
                <Check
                  ok={r.priceSet}
                  text={r.priceSet ? t('ready.price') : t('ready.priceTodo')}
                />
              </ul>
              <p className="text-text-muted">{t('planNote')}</p>
            </Step>
          )}
        </>
      )}
      {message && (
        <li
          role="status"
          className={`list-none text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </li>
      )}
    </ol>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className={ok ? 'text-status-delivered' : 'text-status-needs-action'}>
        {ok ? '✓' : '•'}
      </span>
      {text}
    </li>
  );
}
