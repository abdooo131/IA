'use client';

import { FormFooter } from '@/components/workflow/FormFooter';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { AreaSearchBox } from '@/components/geo/AreaSearchBox';
import type { Pin } from '@/components/geo/PinMap';
import { localized } from '@/lib/admin-types';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import { parseEgp } from '@/lib/money';
import { title } from '@/lib/store-types';
import {
  type CoverageAnswer,
  coverageMessage,
  coverageQuery,
  type ServedArea,
} from '@/lib/zone-areas';

// Leaflet needs the browser, so the pin map never renders on the server.
const PinMap = dynamic(() => import('@/components/geo/PinMap'), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-lg bg-surface-raised" />,
});

export interface OrderableSku {
  id: string;
  sku: string;
  titleEn: string;
  titleAr: string;
  merchantId?: string;
}

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const KNOWN = ['outside_zones', 'address_unsure', 'store_closed', 'at_capacity', 'network'];

/**
 * Places a manual 60 minute order. The customer's neighbourhood (searched by name) and an
 * optional map pin go to the API, which decides the store; the form never sends a made up
 * point such as a zone centre.
 */
export function NewOrderForm({
  endpoint,
  detailBase,
  skus,
  merchants,
}: {
  endpoint: string;
  detailBase: string;
  skus: OrderableSku[];
  /** Admin only: choose whose order this is */
  merchants?: { id: string; name: string }[];
}) {
  const t = useTranslations('merchant.orders');
  const tErr = useTranslations('orders.errors');
  const locale = useLocale();
  const router = useRouter();
  const [merchantId, setMerchantId] = useState(merchants?.[0]?.id ?? '');
  const choices = merchants ? skus.filter((s) => s.merchantId === merchantId) : skus;
  const [lines, setLines] = useState([{ skuId: choices[0]?.id ?? '', quantity: 1 }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [areaNote, setAreaNote] = useState<{ text: string; ok: boolean } | null>(null);

  const [area, setArea] = useState<ServedArea | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  const [showMap, setShowMap] = useState(false);

  // Tells the user straight away whether the place's store can take the order now.
  useEffect(() => {
    const query = coverageQuery({ areaId: area?.id, pin });
    if (!query) return setAreaNote(null);
    let current = true;
    setAreaNote({ text: t('areaChecking'), ok: true });
    void apiGetClient<CoverageAnswer>(`/coverage?${query}`).then((result) => {
      if (!current) return;
      if (!result.ok) return setAreaNote(null);
      const answer = result.data;
      const { key, ok } = coverageMessage(answer);
      const store = answer.darkStore ? localized(answer.darkStore, locale) : '';
      const time = answer.nextOpenAt ? formatCairoDateTime(answer.nextOpenAt, locale) : '';
      setAreaNote({ text: t(key, { store, time }), ok });
    });
    return () => {
      current = false;
    };
  }, [area, pin, locale, t]);

  function changeMerchant(id: string) {
    setMerchantId(id);
    const first = skus.find((s) => s.merchantId === id);
    setLines([{ skuId: first?.id ?? '', quantity: 1 }]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!area && !pin) return setError(t('chooseArea'));
    const feeText = String(form.get('deliveryFee') ?? '').trim();
    const fee = feeText ? parseEgp(feeText) : 0;
    if (fee === null) return setError(t('invalidFee'));
    setBusy(true);
    setError(null);
    const result = await apiSend<{ id: string }>('POST', endpoint, {
      merchantId: merchants ? merchantId : undefined,
      customerName: form.get('customerName'),
      customerPhone: form.get('customerPhone'),
      addressText: form.get('addressText'),
      customerNote: (form.get('customerNote') as string) || undefined,
      areaId: area?.id,
      latitude: pin?.latitude,
      longitude: pin?.longitude,
      paymentMethod: form.get('paymentMethod'),
      deliveryFeePiastres: Number.isFinite(fee) && fee >= 0 ? fee : 0,
      items: lines.filter((l) => l.skuId),
    });
    setBusy(false);
    if (!result.ok) return setError(tErr(KNOWN.includes(result.error) ? result.error : 'generic'));
    setDirty(false);
    router.push(`${detailBase}/${result.data.id}?created=1`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-4 max-w-xl space-y-4" onChange={() => setDirty(true)}>
      {merchants && (
        <label className="block text-caption">
          {t('merchant')}
          <select
            value={merchantId}
            onChange={(e) => changeMerchant(e.target.value)}
            className={field}
          >
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-caption">
        {t('customerName')}
        <input name="customerName" required minLength={2} maxLength={120} className={field} />
      </label>
      <label className="block text-caption">
        {t('customerPhone')}
        <input
          name="customerPhone"
          required
          type="tel"
          inputMode="tel"
          placeholder="01xxxxxxxxx"
          dir="ltr"
          className={field}
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-caption">{t('area')}</legend>
        {area ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2">
            <span className="text-body-sm">
              <span className="font-bold">{localized(area, locale)}</span>
              {area.parent && (
                <span className="text-text-muted"> · {localized(area.parent, locale)}</span>
              )}
              <span className="block text-caption text-text-muted">
                {t('areaStore', { store: localized(area.store, locale) })}
              </span>
            </span>
            <button
              type="button"
              className="h-9 rounded-md border border-line px-3 text-body-sm"
              onClick={() => {
                setArea(null);
                setDirty(true);
              }}
            >
              {t('areaChange')}
            </button>
          </div>
        ) : (
          <AreaSearchBox<ServedArea>
            label={t('areaSearch')}
            placeholder={t('areaSearchHint')}
            emptyText={t('areaNone')}
            failedText={t('areaSearchFailed')}
            search={async (q) => {
              const result = await apiGetClient<ServedArea[]>(
                `/coverage/search?q=${encodeURIComponent(q)}`,
              );
              return result.ok ? result.data : null;
            }}
            keyOf={(a) => a.id}
            render={(a) => (
              <>
                <span className="font-bold">{localized(a, locale)}</span>
                {a.parent && <span> · {localized(a.parent, locale)}</span>}
                <span className="block text-caption text-text-muted">
                  {localized(a.store, locale)}
                </span>
              </>
            )}
            onPick={(a) => {
              setArea(a);
              setDirty(true);
            }}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={showMap}
            className="h-9 rounded-md bg-selected-bg px-3 text-body-sm font-bold text-link"
            onClick={() => setShowMap((v) => !v)}
          >
            {showMap ? t('pinHide') : pin ? t('pinShow') : t('pinAdd')}
          </button>
          {pin && (
            <>
              <span className="ltr-iso text-caption text-text-muted" dir="ltr">
                {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
              </span>
              <button
                type="button"
                className="h-9 rounded-md border border-line px-3 text-body-sm"
                onClick={() => {
                  setPin(null);
                  setDirty(true);
                }}
              >
                {t('pinRemove')}
              </button>
            </>
          )}
        </div>
        {showMap && (
          <>
            <p className="text-caption text-text-muted">{t('pinHint')}</p>
            <PinMap
              pin={pin}
              frame={area?.bbox ?? null}
              label={t('pinMapLabel')}
              onPin={(p) => {
                setPin(p);
                setDirty(true);
              }}
            />
          </>
        )}
        {areaNote && (
          <p
            role="status"
            className={`text-body-sm ${areaNote.ok ? 'text-text-muted' : 'text-danger'}`}
          >
            {areaNote.text}
          </p>
        )}
      </fieldset>
      <label className="block text-caption">
        {t('address')}
        <textarea
          name="addressText"
          required
          minLength={5}
          maxLength={500}
          rows={2}
          className={`${field} h-auto py-2`}
        />
      </label>
      <label className="block text-caption">
        {t('note')}
        <input name="customerNote" maxLength={500} className={field} />
      </label>
      <div className="flex flex-wrap gap-4">
        <label className="block flex-1 text-caption">
          {t('payment')}
          <select name="paymentMethod" defaultValue="cod" className={field}>
            <option value="cod">{t('cod')}</option>
            <option value="prepaid">{t('prepaid')}</option>
          </select>
        </label>
        <label className="block w-40 text-caption">
          {t('deliveryFee')}
          <input
            name="deliveryFee"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            defaultValue="0"
            dir="ltr"
            className={field}
          />
        </label>
      </div>

      <fieldset className="space-y-2 rounded-lg border border-line bg-surface p-3">
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-caption">
              {t('product')}
              <select
                className={field}
                value={line.skuId}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((l, j) => (j === i ? { ...l, skuId: e.target.value } : l)),
                  )
                }
              >
                {choices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sku} · {title(s, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-24 text-caption">
              {t('quantity')}
              <input
                type="number"
                min={1}
                inputMode="numeric"
                dir="ltr"
                className={field}
                value={line.quantity}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((l, j) =>
                      j === i
                        ? { ...l, quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) }
                        : l,
                    ),
                  )
                }
              />
            </label>
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                className="h-10 rounded-md border border-line px-3 text-body-sm"
              >
                {t('remove')}
              </button>
            )}
          </div>
        ))}
        {lines.length < choices.length && (
          <button
            type="button"
            onClick={() =>
              setLines((ls) => [
                ...ls,
                {
                  skuId: choices.find((s) => !ls.some((l) => l.skuId === s.id))?.id ?? '',
                  quantity: 1,
                },
              ])
            }
            className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
          >
            {t('addLine')}
          </button>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <FormFooter
        dirty={dirty}
        busy={busy}
        saveLabel={t('submit')}
        disabled={choices.length === 0}
        cancelHref={detailBase}
      />
    </form>
  );
}
