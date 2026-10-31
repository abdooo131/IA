'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import { title } from '@/lib/store-types';

interface Store {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}
export interface RefillOverview {
  stores: Store[];
  hub: Store | null;
  defaults: { storeId: string; min: number; max: number }[];
  rows: {
    id: string;
    sku: string;
    titleEn: string;
    titleAr: string;
    hubOnHand: number;
    stores: { storeId: string; onHand: number; min: number | null; max: number | null }[];
  }[];
}

/** Product by store grid: stock now, and min to max levels (blank uses the store default). */
export function RefillManager({ data, drafts }: { data: RefillOverview; drafts: number }) {
  const t = useTranslations('refill');
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [edits, setEdits] = useState<Record<string, { min: string; max: string }>>({});

  async function run() {
    setBusy(true);
    setMessage(null);
    const result = await apiSend<{ created: unknown[]; alreadyPlanned: boolean }>(
      'POST',
      '/admin/refill/run',
      {},
    );
    setBusy(false);
    if (!result.ok) return setMessage({ text: t('error'), error: true });
    setMessage({
      text: result.data.alreadyPlanned
        ? t('alreadyPlanned')
        : t('planned', { count: result.data.created.length }),
      error: false,
    });
    router.refresh();
  }

  async function save(storeId: string, skuId: string) {
    const e = edits[`${storeId}:${skuId}`];
    if (!e) return;
    const blank = e.min.trim() === '' && e.max.trim() === '';
    const body = {
      darkStoreId: storeId,
      skuId,
      minUnits: blank ? null : Number(e.min),
      maxUnits: blank ? null : Number(e.max),
    };
    if (
      !blank &&
      (!Number.isInteger(body.minUnits) ||
        !Number.isInteger(body.maxUnits) ||
        body.minUnits! > body.maxUnits!)
    )
      return setMessage({ text: t('badLevels'), error: true });
    const result = await apiSend('PUT', '/admin/refill/targets', body);
    if (!result.ok) return setMessage({ text: t('badLevels'), error: true });
    setMessage({ text: t('saved'), error: false });
    router.refresh();
  }

  const input = 'h-9 w-14 rounded-md border border-line bg-surface px-1 text-center text-body-sm';
  return (
    <div className="mt-4 space-y-4">
      {!data.hub && (
        <p className="rounded-md border border-status-needs-action p-3 text-body-sm">
          {t('noHub')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !data.hub}
          onClick={() => void run()}
          className="h-10 rounded-md bg-primary px-5 font-bold text-on-primary disabled:opacity-50"
        >
          {t('runNow')}
        </button>
        <Link href="/admin/transfers?status=draft" className="text-body-sm text-link underline">
          {t('drafts', { count: drafts })}
        </Link>
      </div>
      {message && (
        <p role="status" className={`text-body-sm ${message.error ? 'text-danger' : ''}`}>
          {message.text}
        </p>
      )}
      <p className="text-body-sm text-text-muted">
        {t('defaults')}{' '}
        {data.defaults
          .map((d) => {
            const s = data.stores.find((x) => x.id === d.storeId)!;
            return `${localized(s, locale)} ${d.min}–${d.max}`;
          })
          .join(' · ')}
      </p>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[720px] text-body-sm">
          <thead className="border-b border-line bg-surface-raised">
            <tr>
              <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                {t('product')}
              </th>
              {data.hub && (
                <th className="px-3 py-2 text-end text-label uppercase text-text-muted">
                  {localized(data.hub, locale)}
                </th>
              )}
              {data.stores.map((s) => (
                <th
                  key={s.id}
                  className="px-3 py-2 text-start text-label uppercase text-text-muted"
                >
                  {localized(s, locale)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2">
                  <span className="ltr-iso font-bold">{r.sku}</span>
                  <span className="block truncate text-caption text-text-muted">
                    {title(r, locale)}
                  </span>
                </td>
                {data.hub && <td className="ltr-iso px-3 py-2 text-end">{r.hubOnHand}</td>}
                {r.stores.map((c) => {
                  const k = `${c.storeId}:${r.id}`;
                  const e = edits[k] ?? {
                    min: c.min?.toString() ?? '',
                    max: c.max?.toString() ?? '',
                  };
                  const def = data.defaults.find((d) => d.storeId === c.storeId)!;
                  return (
                    <td key={c.storeId} className="px-3 py-2">
                      <span className="ltr-iso block">{t('has', { count: c.onHand })}</span>
                      <span className="flex items-center gap-1" dir="ltr">
                        <input
                          aria-label={t('min')}
                          placeholder={String(def.min)}
                          inputMode="numeric"
                          value={e.min}
                          onChange={(ev) =>
                            setEdits((x) => ({ ...x, [k]: { ...e, min: ev.target.value } }))
                          }
                          onBlur={() => void save(c.storeId, r.id)}
                          className={input}
                        />
                        –
                        <input
                          aria-label={t('max')}
                          placeholder={String(def.max)}
                          inputMode="numeric"
                          value={e.max}
                          onChange={(ev) =>
                            setEdits((x) => ({ ...x, [k]: { ...e, max: ev.target.value } }))
                          }
                          onBlur={() => void save(c.storeId, r.id)}
                          className={input}
                        />
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
