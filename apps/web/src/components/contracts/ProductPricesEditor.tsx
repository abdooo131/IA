'use client';

import { useLocale, useTranslations } from 'next-intl';
import { type ChangeEvent, useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { type MerchantProduct, searchProducts, setPrices } from '@/lib/contracts';
import { parseCsv } from '@/lib/csv';
import { formatEgp } from '@/lib/format';
import { egpInput } from '@/lib/sales-part2';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-body-sm';

interface CheckResult {
  rows: { skuId: string; pricePiastres: number }[];
  errors: { row: number; sku?: string; error: string }[];
}

/**
 * Per product prices of a draft: search the merchant's products, type a price per unit (empty:
 * no charge for that product), set one price for the products ticked, import a CSV (sku,
 * price_egp; checked by the API all or nothing) or download the saved version's prices.
 */
export function ProductPricesEditor({
  merchantId,
  products,
  value,
  onChange,
  csvHref,
}: {
  merchantId: string;
  products: readonly MerchantProduct[];
  /** Price typed per product id, in pounds */
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /** The saved version's prices as CSV, when there is a saved version */
  csvHref: string | null;
}) {
  const t = useTranslations('contracts.products');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [onlyPriced, setOnlyPriced] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const [bulk, setBulk] = useState('');
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<CheckResult['errors']>([]);
  const pricedCount = Object.values(value).filter((v) => v.trim()).length;
  const pool = onlyPriced ? products.filter((p) => value[p.id]?.trim()) : products;
  const { rows, total } = searchProducts(pool, query, 50);
  const name = (p: MerchantProduct) => (locale === 'ar' ? p.titleAr || p.titleEn : p.titleEn);
  const tick = (id: string) =>
    setTicked(ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id]);
  const allShown = rows.length > 0 && rows.every((p) => ticked.includes(p.id));

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setMessage(null);
    setErrors([]);
    const parsed = parseCsv(await file.text());
    if (!parsed.length) {
      setImporting(false);
      return setMessage(t('emptyFile'));
    }
    const r = await apiSend<CheckResult>(
      'POST',
      `/admin/merchants/${merchantId}/contract/product-prices/check`,
      { rows: parsed },
    );
    setImporting(false);
    if (!r.ok) return setMessage(t('importFailed'));
    if (r.data.errors.length) {
      setErrors(r.data.errors);
      return setMessage(t('importErrors', { n: r.data.errors.length }));
    }
    const next = { ...value };
    for (const row of r.data.rows) next[row.skuId] = egpInput(row.pricePiastres);
    onChange(next);
    setMessage(t('imported', { n: r.data.rows.length }));
  }

  return (
    <div className="space-y-3">
      <p className="text-body-sm">{t('priced', { n: pricedCount, total: products.length })}</p>
      {products.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('noProducts')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block min-w-0 flex-1 text-caption">
              {t('search')}
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchHint')}
                className={`${field} mt-1`}
              />
            </label>
            <label className="flex h-10 items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={onlyPriced}
                onChange={(e) => setOnlyPriced(e.target.checked)}
              />
              {t('onlyPriced')}
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-md bg-surface-raised p-2">
            <label className="block text-caption">
              {t('bulkPrice', { n: ticked.length })}
              <input
                inputMode="decimal"
                dir="ltr"
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder="EGP"
                className={`${field} mt-1 w-32`}
              />
            </label>
            <button
              type="button"
              className="btn-secondary h-10"
              disabled={ticked.length === 0}
              onClick={() => {
                onChange(setPrices(value, ticked, bulk));
                setTicked([]);
              }}
            >
              {bulk.trim() ? t('setSelected') : t('clearSelected')}
            </button>
          </div>
          <div className="overflow-hidden rounded-md border border-line">
            <div className="flex items-center gap-2 bg-surface-raised px-3 py-1.5 text-caption font-bold uppercase text-text-muted">
              <input
                type="checkbox"
                aria-label={t('tickAll')}
                checked={allShown}
                onChange={() =>
                  setTicked(
                    allShown
                      ? ticked.filter((id) => !rows.some((p) => p.id === id))
                      : [...new Set([...ticked, ...rows.map((p) => p.id)])],
                  )
                }
              />
              <span className="flex-1">{t('product')}</span>
              <span className="w-28 shrink-0 text-end">{t('unitPrice')}</span>
            </div>
            <ul>
              {rows.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 border-t border-line px-3 py-1.5 first:border-t-0"
                >
                  <input
                    type="checkbox"
                    aria-label={p.sku}
                    checked={ticked.includes(p.id)}
                    onChange={() => tick(p.id)}
                  />
                  <span className="min-w-0 flex-1 text-body-sm">
                    <span className="ltr-iso block truncate font-bold">{p.sku}</span>
                    <span className="block truncate text-caption text-text-muted">
                      {name(p)} · <span className="ltr-iso">{formatEgp(p.pricePiastres)}</span>
                      {!p.isActive && ` · ${t('inactive')}`}
                    </span>
                  </span>
                  <input
                    inputMode="decimal"
                    dir="ltr"
                    aria-label={`${t('unitPrice')} ${p.sku}`}
                    value={value[p.id] ?? ''}
                    placeholder="–"
                    onChange={(e) => onChange({ ...value, [p.id]: e.target.value })}
                    className={`${field} w-28 shrink-0`}
                  />
                </li>
              ))}
            </ul>
          </div>
          {total > rows.length && (
            <p className="text-caption text-text-muted">
              {t('more', { shown: rows.length, total })}
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn-secondary inline-flex h-10 cursor-pointer items-center">
          {importing ? t('importing') : t('import')}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={importing}
            onChange={(e) => void importFile(e)}
          />
        </label>
        {csvHref && (
          <a className="btn-secondary inline-flex h-10 items-center" href={csvHref}>
            {t('export')}
          </a>
        )}
      </div>
      <p className="text-caption text-text-muted">{t('csvHint')}</p>
      {message && (
        <p role="status" className="text-body-sm">
          {message}
        </p>
      )}
      {errors.length > 0 && (
        <ul className="space-y-0.5 text-caption text-danger">
          {errors.slice(0, 20).map((e) => (
            <li key={`${e.row}-${e.error}`}>
              {t('errorLine', {
                row: e.row,
                sku: e.sku ?? '–',
                error: t.has(`errors.${e.error}`) ? t(`errors.${e.error}`) : e.error,
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
