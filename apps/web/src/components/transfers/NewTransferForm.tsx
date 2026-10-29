'use client';

import { FormFooter } from '@/components/workflow/FormFooter';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { title } from '@/lib/store-types';

interface StockRow {
  sku: { id: string; sku: string; titleEn: string; titleAr: string };
  onHand: number;
  reserved: number;
}

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const KNOWN = ['not_enough_available', 'same_location', 'duplicate_sku', 'validation_failed'];

/** Admin picks where from and where to, sees what is free at the sender, and sets quantities. */
export function NewTransferForm({ stores }: { stores: AdminStore[] }) {
  const t = useTranslations('transfers');
  const locale = useLocale();
  const router = useRouter();
  const [fromId, setFromId] = useState(stores[0]?.id ?? '');
  const [toId, setToId] = useState(stores[1]?.id ?? '');
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [wanted, setWanted] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const from = stores.find((s) => s.id === fromId);
  const to = stores.find((s) => s.id === toId);
  const hub = stores.find((s) => s.kind === 'hub');
  const viaHub = hub && from?.kind === 'dark_store' && to?.kind === 'dark_store';

  useEffect(() => {
    if (!fromId) return;
    setRows(null);
    setWanted({});
    void apiGetClient<StockRow[]>(`/admin/stock?darkStoreId=${fromId}`).then((r) =>
      setRows(r.ok ? r.data.filter((x) => x.onHand - x.reserved > 0) : []),
    );
  }, [fromId]);

  const lines = Object.entries(wanted)
    .filter(([, q]) => q > 0)
    .map(([skuId, quantity]) => ({ skuId, quantity }));

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await apiSend<{ id: string }>('POST', '/admin/transfers', {
      fromId,
      toId,
      note: note.trim() || undefined,
      lines,
    });
    setBusy(false);
    if (!result.ok)
      return setError(t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    setDirty(false);
    router.push(`/admin/transfers/${result.data.id}`);
    router.refresh();
  }

  return (
    <div className="mt-4 max-w-3xl space-y-4" onChange={() => setDirty(true)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-caption">
          {t('from')}
          <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={field}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {localized(s, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('to')}
          <select value={toId} onChange={(e) => setToId(e.target.value)} className={field}>
            {stores
              .filter((s) => s.id !== fromId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {localized(s, locale)}
                </option>
              ))}
          </select>
        </label>
      </div>
      {viaHub && <p className="text-body-sm">{t('viaHub', { hub: localized(hub, locale) })}</p>}

      {rows === null ? (
        <p className="text-body-sm text-text-muted">{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-body text-text-muted">{t('nothingFree')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {rows.map((r) => {
            const free = r.onHand - r.reserved;
            return (
              <li key={r.sku.id} className="flex flex-wrap items-end justify-between gap-3 p-3">
                <p className="min-w-0 flex-1 text-body-sm">
                  <span className="ltr-iso font-bold">{r.sku.sku}</span> · {title(r.sku, locale)}
                </p>
                <label className="w-36 text-caption">
                  {t('free', { count: free })}
                  <input
                    type="number"
                    min={0}
                    max={free}
                    inputMode="numeric"
                    dir="ltr"
                    className={field}
                    value={wanted[r.sku.id] ?? 0}
                    onChange={(e) => {
                      const q = Math.min(
                        free,
                        Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      );
                      setWanted((w) => ({ ...w, [r.sku.id]: q }));
                    }}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <label className="block text-caption">
        {t('note')}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          className={field}
        />
      </label>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <FormFooter
        dirty={dirty}
        busy={busy}
        saveLabel={t('create', { count: lines.reduce((s, l) => s + l.quantity, 0) })}
        disabled={lines.length === 0 || !toId || fromId === toId}
        cancelHref="/admin/transfers"
        onSave={() => void submit()}
      />
    </div>
  );
}
