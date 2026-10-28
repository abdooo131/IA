'use client';

import { createLocationSchema } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import { formatCount } from '@/lib/format';

interface Governorate {
  id: number;
  nameEn: string;
  nameAr: string;
}

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const KNOWN = ['code_taken', 'governorate_not_found', 'validation'];

/** Dark stores and sorting facilities: the list, and the form to open a new one. */
export function LocationsManager({
  stores,
  governorates,
}: {
  stores: AdminStore[];
  governorates: Governorate[];
}) {
  const t = useTranslations('admin.locations');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shelvesFor, setShelvesFor] = useState<string | null>(null);
  const [count, setCount] = useState(4);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const parsed = createLocationSchema.safeParse({
      kind: f.get('kind'),
      code: f.get('code'),
      nameEn: f.get('nameEn'),
      nameAr: f.get('nameAr'),
      addressEn: f.get('addressEn'),
      addressAr: f.get('addressAr'),
      governorateId: Number(f.get('governorateId')),
      latitude: Number(f.get('latitude')),
      longitude: Number(f.get('longitude')),
      shelves: Number(f.get('shelves')),
    });
    if (!parsed.success) return setError(t('errors.validation'));
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', '/admin/dark-stores', parsed.data);
    setBusy(false);
    if (!result.ok)
      return setError(t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    setOpen(false);
    router.refresh();
  }

  async function addShelves(id: string) {
    setBusy(true);
    const result = await apiSend('POST', `/admin/dark-stores/${id}/shelves`, { count });
    setBusy(false);
    if (!result.ok) return setError(t('errors.generic'));
    setShelvesFor(null);
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      {open ? (
        <form
          onSubmit={create}
          className="max-w-2xl space-y-3 rounded-lg border border-line bg-surface p-4"
        >
          <fieldset className="flex flex-wrap gap-4 text-body-sm">
            <legend className="text-caption">{t('kind')}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="kind" value="dark_store" defaultChecked />{' '}
              {t('kinds.dark_store')}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="kind" value="hub" /> {t('kinds.hub')}
            </label>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-caption">
              {t('code')}
              <input
                name="code"
                required
                maxLength={8}
                dir="ltr"
                placeholder="HLW"
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('governorate')}
              <select name="governorateId" defaultValue={1} className={field}>
                {governorates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {localized(g, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-caption">
              {t('nameEn')}
              <input name="nameEn" required dir="ltr" className={field} />
            </label>
            <label className="block text-caption">
              {t('nameAr')}
              <input name="nameAr" required dir="rtl" className={field} />
            </label>
            <label className="block text-caption">
              {t('addressEn')}
              <input name="addressEn" required dir="ltr" className={field} />
            </label>
            <label className="block text-caption">
              {t('addressAr')}
              <input name="addressAr" required dir="rtl" className={field} />
            </label>
            <label className="block text-caption">
              {t('latitude')}
              <input
                name="latitude"
                required
                inputMode="decimal"
                dir="ltr"
                placeholder="30.0444"
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('longitude')}
              <input
                name="longitude"
                required
                inputMode="decimal"
                dir="ltr"
                placeholder="31.2357"
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('shelves')}
              <input
                name="shelves"
                type="number"
                min={1}
                max={200}
                defaultValue={8}
                dir="ltr"
                className={field}
              />
            </label>
          </div>
          <p className="text-caption text-text-muted">{t('pinHint')}</p>
          {error && (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="h-10 rounded-md bg-primary px-5 font-bold text-on-primary disabled:opacity-50"
            >
              {t('create')}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-10 rounded-md bg-primary px-5 font-bold text-on-primary"
        >
          {t('new')}
        </button>
      )}

      <ul className="space-y-3">
        {stores.map((s) => (
          <li key={s.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-h3">
                  {localized(s, locale)} <span className="ltr-iso text-text-muted">· {s.code}</span>
                </p>
                <p className="text-body-sm text-text-muted">
                  {localized({ nameEn: s.addressEn, nameAr: s.addressAr }, locale)}
                </p>
                <p className="mt-1 text-body-sm">
                  {t('stock', {
                    units: formatCount(s.unitsOnHand),
                    skus: formatCount(s.skusInStock),
                  })}
                  {s.kind === 'dark_store' && ` · ${t('zones', { count: s.zoneCount })}`}
                </p>
              </div>
              <span className="rounded-pill border border-line px-3 py-1 text-caption font-bold">
                {t(`kinds.${s.kind}`)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {s.kind === 'dark_store' && (
                <Link href="/admin/zones" className="text-body-sm text-link underline">
                  {t('editZones')}
                </Link>
              )}
              <Link href={`/store/${s.id}`} className="text-body-sm text-link underline">
                {t('openStaffApp')}
              </Link>
              {shelvesFor === s.id ? (
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={count}
                    dir="ltr"
                    aria-label={t('shelvesToAdd')}
                    onChange={(e) =>
                      setCount(Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1))))
                    }
                    className="h-10 w-20 rounded-md border border-line bg-surface px-2 text-body-sm"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void addShelves(s.id)}
                    className="h-10 rounded-md bg-selected-bg px-3 text-body-sm font-bold text-link"
                  >
                    {t('addShelves')}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setShelvesFor(s.id)}
                  className="h-10 rounded-md border border-line px-3 text-body-sm font-bold"
                >
                  {t('moreShelves')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
