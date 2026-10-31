'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, Fragment, useState } from 'react';
import type { AdminSku } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import { parseCsv, toCsv } from '@/lib/csv';
import { formatCount, formatEgp } from '@/lib/format';

type Merchant = { id: string; name: string; isActive: boolean };
type ImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  errors: { row: number; sku?: string; error: string }[];
};

const KNOWN = ['sku_taken', 'barcode_taken', 'validation_failed'];
const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const primary =
  'h-10 rounded-md bg-primary px-5 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const secondary =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const TEMPLATE_HEADER = ['sku', 'barcode', 'title_en', 'title_ar', 'price_egp', 'weight_grams'];

/** EGP typed by a person to integer piastres, without going through a float. */
function toPiastres(text: string): number | null {
  const clean = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function ProductForm({
  initial,
  merchants,
  busy,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: AdminSku;
  merchants: Merchant[];
  busy: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit(body: Record<string, unknown>): void;
  onCancel(): void;
}) {
  const t = useTranslations('admin.productsEdit');
  const [priceError, setPriceError] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const price = toPiastres(String(form.get('price')));
    setPriceError(price === null);
    if (price === null) return;
    const weight = String(form.get('weight') ?? '').trim();
    onSubmit({
      ...(initial
        ? {}
        : { merchantId: form.get('merchantId'), sku: String(form.get('sku')).trim() }),
      barcode: String(form.get('barcode') ?? '').trim() || null,
      titleEn: form.get('titleEn'),
      titleAr: form.get('titleAr'),
      pricePiastres: price,
      weightGrams: weight ? Number(weight) : null,
      isActive: form.get('isActive') === 'on',
    });
  }
  return (
    <form
      onSubmit={submit}
      className="grid max-w-3xl gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-2"
    >
      {!initial && (
        <>
          <label className="block text-caption">
            {t('merchant')}
            <select name="merchantId" required className={field}>
              {merchants
                .filter((m) => m.isActive)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-caption">
            {t('sku')}
            <input name="sku" required maxLength={64} dir="ltr" className={field} />
          </label>
        </>
      )}
      <label className="block text-caption">
        {t('barcode')}
        <input
          name="barcode"
          maxLength={64}
          dir="ltr"
          defaultValue={initial?.barcode ?? ''}
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('price')}
        <input
          name="price"
          required
          inputMode="decimal"
          dir="ltr"
          defaultValue={initial ? formatEgp(initial.pricePiastres).replace(/,/g, '') : ''}
          className={field}
        />
        {priceError && <span className="text-danger">{t('errors.invalid_price')}</span>}
      </label>
      <label className="block text-caption">
        {t('titleEn')}
        <input
          name="titleEn"
          required
          maxLength={200}
          dir="ltr"
          defaultValue={initial?.titleEn}
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('titleAr')}
        <input
          name="titleAr"
          required
          maxLength={200}
          dir="rtl"
          defaultValue={initial?.titleAr}
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('weight')}
        <input
          name="weight"
          type="number"
          min={0}
          inputMode="numeric"
          dir="ltr"
          defaultValue={initial?.weightGrams ?? ''}
          className={field}
        />
      </label>
      <label className="flex items-center gap-2 self-end pb-2 text-body-sm">
        <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} />
        {t('active')}
      </label>
      {error && (
        <p role="alert" className="text-body-sm text-danger md:col-span-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 md:col-span-2">
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

function ImportPanel({ merchants, onDone }: { merchants: Merchant[]; onDone(): void }) {
  const t = useTranslations('admin.productsEdit');
  const [merchantId, setMerchantId] = useState(merchants.find((m) => m.isActive)?.id ?? '');
  const [file, setFile] = useState<{ name: string; rows: Record<string, string>[] } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose(f: File | undefined) {
    setResult(null);
    setError(null);
    if (!f) return setFile(null);
    const rows = parseCsv(await f.text());
    if (rows.length === 0) setError(t('errors.empty_file'));
    setFile({ name: f.name, rows });
  }

  async function run() {
    if (!file?.rows.length) return;
    setBusy(true);
    const res = await apiSend<ImportResult>('POST', '/admin/skus/import', {
      merchantId,
      rows: file.rows,
    });
    setBusy(false);
    if (!res.ok) return setError(t(`errors.${KNOWN.includes(res.error) ? res.error : 'generic'}`));
    setResult(res.data);
    if (res.data.errors.length === 0) onDone();
  }

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(
    toCsv(TEMPLATE_HEADER, [
      ['EC-101', '6221234567890', 'Lace bra black 75B', 'برا دانتيل أسود 75B', '449.00', '120'],
    ]),
  )}`;

  return (
    <section className="max-w-3xl space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-body font-bold">{t('importTitle')}</h2>
      <p className="text-body-sm text-text-muted">{t('importHelp')}</p>
      <a
        href={template}
        download="shiply-products-template.csv"
        className="text-body-sm font-bold text-link"
      >
        {t('template')}
      </a>
      <label className="block text-caption">
        {t('merchant')}
        <select
          value={merchantId}
          onChange={(e) => setMerchantId(e.target.value)}
          className={field}
        >
          {merchants
            .filter((m) => m.isActive)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </label>
      <label className="block text-caption">
        {t('chooseFile')}
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void choose(e.target.files?.[0])}
          className="mt-1 block text-body-sm"
        />
      </label>
      {file && file.rows.length > 0 && (
        <p className="text-body-sm">{t('rows', { count: file.rows.length, file: file.name })}</p>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      {result && result.errors.length === 0 && (
        <p role="status" className="text-body-sm">
          {t('result', {
            created: result.created,
            updated: result.updated,
            unchanged: result.unchanged,
          })}
        </p>
      )}
      {result && result.errors.length > 0 && (
        <div role="alert" className="rounded-md border border-danger p-3 text-body-sm">
          <p className="font-bold text-danger">{t('errorsTitle')}</p>
          <ul className="mt-1 space-y-0.5">
            {result.errors.map((e, i) => (
              <li key={i}>
                {t('row', { row: e.row })}
                {e.sku && (
                  <>
                    {' '}
                    · <span className="ltr-iso">{e.sku}</span>
                  </>
                )}
                :{' '}
                <span className="ltr-iso">
                  {t.has(`errors.${e.error}`) ? t(`errors.${e.error}`) : e.error}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        disabled={busy || !file?.rows.length || !merchantId}
        className={primary}
        onClick={() => void run()}
      >
        {t('importNow')}
      </button>
    </section>
  );
}

export function ProductsManager({
  skus,
  merchants,
  filters,
}: {
  skus: AdminSku[];
  merchants: Merchant[];
  filters: { merchant: string; q: string };
}) {
  const t = useTranslations('admin.productsEdit');
  const tp = useTranslations('admin.products');
  const locale = useLocale();
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
      return setError(t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    setMode(null);
    router.refresh();
  }

  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2 align-top';
  const filterField = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm';

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primary}
          onClick={() => setMode(mode === 'new' ? null : 'new')}
        >
          {t('new')}
        </button>
        <button
          type="button"
          className={secondary}
          onClick={() => setMode(mode === 'import' ? null : 'import')}
        >
          {t('import')}
        </button>
      </div>
      {mode === 'new' && (
        <ProductForm
          merchants={merchants}
          busy={busy}
          error={error}
          submitLabel={t('create')}
          onSubmit={(body) => void send('POST', '/admin/skus', body)}
          onCancel={() => setMode(null)}
        />
      )}
      {mode === 'import' && <ImportPanel merchants={merchants} onDone={() => router.refresh()} />}

      <form className="flex flex-wrap gap-2" method="get">
        <select
          name="merchant"
          defaultValue={filters.merchant}
          className={filterField}
          aria-label={t('merchant')}
        >
          <option value="">{t('filterMerchant')}</option>
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input
          name="q"
          defaultValue={filters.q}
          placeholder={t('search')}
          className={`${filterField} w-56`}
        />
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {tp('title')}
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[820px] text-body-sm">
          <thead className="border-b border-line bg-surface-raised">
            <tr>
              <th className={th}>{tp('sku')}</th>
              <th className={th}>{tp('name')}</th>
              <th className={th}>{tp('merchant')}</th>
              <th className={`${th} text-end`}>{tp('price')}</th>
              <th className={`${th} text-end`}>{tp('onHand')}</th>
              <th className={`${th} text-end`}>{tp('reserved')}</th>
              <th className={th}>{tp('shopify')}</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => (
              <Fragment key={s.id}>
                <tr
                  className={`border-b border-line last:border-0 ${s.isActive ? '' : 'opacity-60'}`}
                >
                  <td className={`${td} font-bold`}>
                    <span className="ltr-iso">{s.sku}</span>
                    {s.barcode && (
                      <div className="text-caption font-normal text-text-muted">
                        <span className="ltr-iso">{s.barcode}</span>
                      </div>
                    )}
                  </td>
                  <td className={td}>
                    {locale === 'ar' ? s.titleAr : s.titleEn}
                    {!s.isActive && (
                      <div className="text-caption text-text-muted">{t('inactive')}</div>
                    )}
                  </td>
                  <td className={td}>{s.merchant.name}</td>
                  <td className={`${td} text-end`}>
                    <span className="ltr-iso">{formatEgp(s.pricePiastres)}</span>
                  </td>
                  <td className={`${td} text-end`}>
                    <span className="ltr-iso">{formatCount(s.unitsOnHand)}</span>
                  </td>
                  <td className={`${td} text-end`}>
                    <span className="ltr-iso">{formatCount(s.unitsReserved)}</span>
                  </td>
                  <td className={`${td} text-text-muted`}>
                    {s.shopifyVariantId ? tp('linked') : tp('notLinked')}
                  </td>
                  <td className={td}>
                    <button
                      type="button"
                      className={secondary}
                      onClick={() => setMode(mode === s.id ? null : s.id)}
                    >
                      {t('edit')}
                    </button>
                  </td>
                </tr>
                {mode === s.id && (
                  <tr className="border-b border-line">
                    <td colSpan={8} className="p-3">
                      <ProductForm
                        initial={s}
                        merchants={merchants}
                        busy={busy}
                        error={error}
                        submitLabel={t('save')}
                        onSubmit={(body) => void send('PATCH', `/admin/skus/${s.id}`, body)}
                        onCancel={() => setMode(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
