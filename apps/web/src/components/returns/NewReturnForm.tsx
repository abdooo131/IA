'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiGetClient, apiSend } from '@/lib/api-client';
import type { ReturnableRow, StockSource } from '@/lib/return-types';
import { type StoreRef, title } from '@/lib/store-types';

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const SOURCES: StockSource[] = ['sellable', 'damaged', 'held'];
const KNOWN = ['not_enough_available', 'validation_failed', 'duplicate_sku'];

/** The merchant picks a store, sees what is there, and asks for units back. */
export function NewReturnForm({ stores }: { stores: StoreRef[] }) {
  const t = useTranslations('returns');
  const locale = useLocale();
  const router = useRouter();
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [rows, setRows] = useState<ReturnableRow[] | null>(null);
  const [wanted, setWanted] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    setRows(null);
    setWanted({});
    void apiGetClient<ReturnableRow[]>(`/merchant/returns/stock?darkStoreId=${storeId}`).then((r) =>
      setRows(r.ok ? r.data : []),
    );
  }, [storeId]);

  const lines = Object.entries(wanted)
    .filter(([, q]) => q > 0)
    .map(([k, quantity]) => {
      const [skuId, source] = k.split(':') as [string, StockSource];
      return { skuId, source, quantity };
    });

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await apiSend<{ id: string }>('POST', '/merchant/returns', {
      darkStoreId: storeId,
      note: note.trim() || undefined,
      lines,
    });
    setBusy(false);
    if (!result.ok)
      return setError(t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    router.push(`/merchant/returns/${result.data.id}`);
    router.refresh();
  }

  return (
    <div className="mt-4 max-w-3xl space-y-4">
      <label className="block max-w-sm text-caption">
        {t('store')}
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={field}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {localized(s, locale)}
            </option>
          ))}
        </select>
      </label>

      {rows === null ? (
        <p className="text-body-sm text-text-muted">{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-body text-text-muted">{t('nothingInStore')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {rows.map((r) => (
            <li key={r.skuId} className="flex flex-wrap items-end justify-between gap-3 p-3">
              <p className="min-w-0 flex-1 text-body-sm">
                <span className="ltr-iso font-bold">{r.sku}</span> · {title(r, locale)}
              </p>
              <div className="flex flex-wrap gap-3">
                {SOURCES.filter((s) => r[s] > 0).map((s) => (
                  <label key={s} className="w-36 text-caption">
                    {t(`sources.${s}`)} ({t('max', { count: r[s] })})
                    <input
                      type="number"
                      min={0}
                      max={r[s]}
                      inputMode="numeric"
                      dir="ltr"
                      className={field}
                      value={wanted[`${r.skuId}:${s}`] ?? 0}
                      onChange={(e) => {
                        const q = Math.min(
                          r[s],
                          Math.max(0, Math.floor(Number(e.target.value) || 0)),
                        );
                        setWanted((w) => ({ ...w, [`${r.skuId}:${s}`]: q }));
                      }}
                    />
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <label className="block text-caption">
        {t('note')}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          className={field}
        />
      </label>
      <p className="text-caption text-text-muted">{t('feeHint')}</p>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy || lines.length === 0}
        onClick={() => void submit()}
        className="h-10 rounded-md bg-primary px-6 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]"
      >
        {t('submit', { count: lines.reduce((s, l) => s + l.quantity, 0) })}
      </button>
    </div>
  );
}
