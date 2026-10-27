'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { apiSend } from '@/lib/api-client';

export interface AdminMerchant {
  id: string;
  name: string;
  isActive: boolean;
  approval: 'pending' | 'approved' | 'rejected';
  rejectReason: string | null;
  createdAt: string;
  contactEmail: string | null;
  contactPhone: string | null;
  shopifyShopDomain: string | null;
  skuCount: number;
  shipmentCount: number;
}

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const primary =
  'h-10 rounded-md bg-primary px-5 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const secondary =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

function MerchantForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  busy,
  error,
}: {
  initial?: AdminMerchant;
  submitLabel: string;
  onSubmit(body: Record<string, unknown>): void;
  onCancel(): void;
  busy: boolean;
  error: string | null;
}) {
  const t = useTranslations('admin.merchants');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      name: form.get('name'),
      contactEmail: (form.get('contactEmail') as string) || null,
      contactPhone: (form.get('contactPhone') as string) || null,
    });
  }
  return (
    <form
      onSubmit={submit}
      className="max-w-xl space-y-3 rounded-lg border border-line bg-surface p-4"
    >
      <label className="block text-caption">
        {t('name')}
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          defaultValue={initial?.name}
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('contactEmail')}
        <input
          name="contactEmail"
          type="email"
          dir="ltr"
          defaultValue={initial?.contactEmail ?? ''}
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('contactPhone')}
        <input
          name="contactPhone"
          type="tel"
          dir="ltr"
          defaultValue={initial?.contactPhone ?? ''}
          className={field}
        />
      </label>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primary}>
          {submitLabel}
        </button>
        <button type="button" className={secondary} onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

export function MerchantsManager({ merchants }: { merchants: AdminMerchant[] }) {
  const t = useTranslations('admin.merchants');
  const router = useRouter();
  const [mode, setMode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(method: 'POST' | 'PATCH', path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const result = await apiSend(method, path, body);
    setBusy(false);
    if (!result.ok)
      return setError(
        t(`errors.${result.error === 'validation_failed' ? 'validation_failed' : 'generic'}`),
      );
    setMode(null);
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      {mode === 'new' ? (
        <MerchantForm
          submitLabel={t('create')}
          busy={busy}
          error={error}
          onSubmit={(body) => void send('POST', '/admin/merchants', body)}
          onCancel={() => setMode(null)}
        />
      ) : (
        <button type="button" className={primary} onClick={() => setMode('new')}>
          {t('new')}
        </button>
      )}
      <ul className="space-y-3">
        {merchants.map((m) => (
          <li key={m.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-h3">{m.name}</p>
                <p className="ltr-iso text-caption text-text-muted">
                  {[m.contactEmail, m.contactPhone].filter(Boolean).join(' · ')}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-4 text-body-sm">
                  <Link className="font-bold text-link" href={`/admin/products?merchant=${m.id}`}>
                    {t('products')} (<span className="ltr-iso">{m.skuCount}</span>)
                  </Link>
                  <Link className="font-bold text-link" href={`/admin/shipments?merchant=${m.id}`}>
                    {t('shipments')} (<span className="ltr-iso">{m.shipmentCount}</span>)
                  </Link>
                  {m.shopifyShopDomain && (
                    <span className="ltr-iso text-text-muted">
                      {t('shopify')}: {m.shopifyShopDomain}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-pill border px-2.5 py-0.5 text-caption ${m.isActive ? 'border-line' : 'border-danger text-danger'}`}
                >
                  {m.isActive ? t('active') : t('inactive')}
                </span>
                <button
                  type="button"
                  className={secondary}
                  onClick={() => setMode(mode === m.id ? null : m.id)}
                >
                  {t('edit')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={secondary}
                  onClick={() =>
                    void send('PATCH', `/admin/merchants/${m.id}`, { isActive: !m.isActive })
                  }
                >
                  {m.isActive ? t('pause') : t('resume')}
                </button>
              </div>
            </div>
            {mode === m.id && (
              <div className="mt-3">
                <MerchantForm
                  initial={m}
                  submitLabel={t('save')}
                  busy={busy}
                  error={error}
                  onSubmit={(body) => void send('PATCH', `/admin/merchants/${m.id}`, body)}
                  onCancel={() => setMode(null)}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
