'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import { title } from '@/lib/store-types';

export interface CoverageArea {
  zoneId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  darkStore: { id: string; code: string; nameEn: string; nameAr: string };
  point: { latitude: number; longitude: number };
}
export interface OrderableSku {
  id: string;
  sku: string;
  titleEn: string;
  titleAr: string;
  merchantId?: string;
}

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const KNOWN = ['outside_zones', 'store_closed', 'at_capacity', 'network'];

/**
 * Places a manual 60 minute order. The area picks the point that coverage checks; the
 * store is chosen by the API, never by the form.
 */
export function NewOrderForm({
  endpoint,
  detailBase,
  areas,
  skus,
  merchants,
}: {
  endpoint: string;
  detailBase: string;
  areas: CoverageArea[];
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
  const [areaNote, setAreaNote] = useState<{ text: string; ok: boolean } | null>(null);

  /** Tells the user straight away whether the area's store can take the order now. */
  async function checkArea(zoneId: string) {
    const area = areas.find((a) => a.zoneId === zoneId);
    if (!area) return setAreaNote(null);
    setAreaNote({ text: t('areaChecking'), ok: true });
    const result = await apiGetClient<{
      covered: boolean;
      reason?: string;
      darkStore?: { nameEn: string; nameAr: string };
      nextOpenAt?: string;
    }>(`/coverage?lat=${area.point.latitude}&lng=${area.point.longitude}`);
    if (!result.ok) return setAreaNote(null);
    const store = localized(result.data.darkStore ?? area.darkStore, locale);
    if (result.data.covered) setAreaNote({ text: t('areaOpen', { store }), ok: true });
    else if (result.data.reason === 'store_closed')
      setAreaNote({
        text: t('areaClosed', {
          store,
          time: result.data.nextOpenAt ? formatCairoDateTime(result.data.nextOpenAt, locale) : '',
        }),
        ok: false,
      });
    else if (result.data.reason === 'at_capacity')
      setAreaNote({ text: t('areaFull', { store }), ok: false });
    else setAreaNote({ text: tErr('outside_zones'), ok: false });
  }

  function changeMerchant(id: string) {
    setMerchantId(id);
    const first = skus.find((s) => s.merchantId === id);
    setLines([{ skuId: first?.id ?? '', quantity: 1 }]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const area = areas.find((a) => a.zoneId === form.get('zoneId'));
    if (!area) return setError(t('chooseArea'));
    const fee = Math.round(Number(form.get('deliveryFee') || 0) * 100);
    setBusy(true);
    setError(null);
    const result = await apiSend<{ id: string }>('POST', endpoint, {
      merchantId: merchants ? merchantId : undefined,
      customerName: form.get('customerName'),
      customerPhone: form.get('customerPhone'),
      addressText: form.get('addressText'),
      customerNote: (form.get('customerNote') as string) || undefined,
      latitude: area.point.latitude,
      longitude: area.point.longitude,
      paymentMethod: form.get('paymentMethod'),
      deliveryFeePiastres: Number.isFinite(fee) && fee >= 0 ? fee : 0,
      items: lines.filter((l) => l.skuId),
    });
    setBusy(false);
    if (!result.ok) return setError(tErr(KNOWN.includes(result.error) ? result.error : 'generic'));
    router.push(`${detailBase}/${result.data.id}?created=1`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-4 max-w-xl space-y-4">
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
      <label className="block text-caption">
        {t('area')}
        <select
          name="zoneId"
          required
          defaultValue=""
          className={field}
          onChange={(e) => void checkArea(e.target.value)}
        >
          <option value="" disabled>
            {t('chooseArea')}
          </option>
          {areas.map((a) => (
            <option key={a.zoneId} value={a.zoneId}>
              {localized(a, locale)} · {localized(a.darkStore, locale)}
            </option>
          ))}
        </select>
        {areaNote && (
          <span
            role="status"
            className={`mt-1 block text-body-sm ${areaNote.ok ? 'text-text-muted' : 'text-danger'}`}
          >
            {areaNote.text}
          </span>
        )}
      </label>
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
      <button
        type="submit"
        disabled={busy || choices.length === 0}
        className="h-10 rounded-md bg-primary px-6 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]"
      >
        {t('submit')}
      </button>
    </form>
  );
}
