'use client';

import type { ZonePolygon } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { type AdminStore, type AdminZone, localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import { CapacityForm, HoursForm } from './StoreSettings';
import type { ZoneMapHandle } from './ZoneMap';

// Leaflet needs the browser, so the map never renders on the server.
const ZoneMap = dynamic(() => import('./ZoneMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] w-full animate-pulse rounded-lg bg-surface-raised md:h-[540px]" />
  ),
});

const STORE_COLORS = ['#0047BB', '#7C3AED', '#C026D3', '#16A34A', '#64748B'];

const secondary =
  'h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const outline =
  'h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold text-text';
const input =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';

type Mode = 'idle' | 'editing' | 'drawing' | 'naming';

const KNOWN_ERRORS = ['zone_geometry_invalid', 'zone_code_taken', 'validation_failed', 'network'];

export function ZonesWorkspace({
  stores,
  zones,
  initialStoreId,
}: {
  stores: AdminStore[];
  zones: AdminZone[];
  initialStoreId?: string;
}) {
  const t = useTranslations('admin.zones');
  const locale = useLocale();
  const router = useRouter();
  const mapRef = useRef<ZoneMapHandle>(null);

  const [storeId, setStoreId] = useState(
    stores.some((s) => s.id === initialStoreId) ? initialStoreId! : (stores[0]?.id ?? ''),
  );
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [draft, setDraft] = useState<ZonePolygon | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const colors = useMemo(
    () => Object.fromEntries(stores.map((s, i) => [s.id, STORE_COLORS[i % STORE_COLORS.length]!])),
    [stores],
  );
  const store = stores.find((s) => s.id === storeId);
  const zone = zones.find((z) => z.id === zoneId);
  const storeZones = zones.filter((z) => z.darkStoreId === storeId);

  function fail(error: string) {
    setMessage({
      text: t(`errors.${KNOWN_ERRORS.includes(error) ? error : 'generic'}`),
      error: true,
    });
  }

  function select(id: string) {
    if (mode !== 'idle') return;
    const z = zones.find((x) => x.id === id);
    setZoneId(id);
    if (z) setStoreId(z.darkStoreId);
    setMessage(null);
  }

  async function saveBorder() {
    if (!zone) return;
    const polygon = mapRef.current?.finishEdit();
    setMode('idle');
    if (!polygon) return;
    if (polygon === 'multi') {
      mapRef.current?.cancelEdit();
      setMessage({ text: t('multiPart'), error: true });
      return;
    }
    setBusy(true);
    const result = await apiSend('PUT', `/admin/zones/${zone.id}/area`, { area: polygon });
    setBusy(false);
    if (!result.ok) return fail(result.error);
    setMessage({ text: t('saved'), error: false });
    router.refresh();
  }

  async function toggleActive() {
    if (!zone) return;
    setBusy(true);
    const result = await apiSend('PATCH', `/admin/zones/${zone.id}`, { isActive: !zone.isActive });
    setBusy(false);
    if (!result.ok) return fail(result.error);
    router.refresh();
  }

  async function createZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !store) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const result = await apiSend<{ id: string }>('POST', '/admin/zones', {
      darkStoreId: store.id,
      code: form.get('code'),
      nameEn: form.get('nameEn'),
      nameAr: form.get('nameAr'),
      area: draft,
    });
    setBusy(false);
    if (!result.ok) return fail(result.error);
    setDraft(null);
    setMode('idle');
    setZoneId(result.data.id);
    setMessage({ text: t('saved'), error: false });
    router.refresh();
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_440px]">
      <div>
        <ZoneMap
          ref={mapRef}
          zones={zones}
          stores={stores}
          colors={colors}
          selectedZoneId={zoneId}
          onSelect={select}
          onDrawn={(polygon) => {
            if (polygon === 'multi') return setMessage({ text: t('multiPart'), error: true });
            setDraft(polygon);
            setMode('naming');
          }}
        />
        <p className="mt-2 text-caption text-text-muted">
          {mode === 'drawing' ? t('drawHint') : t('mapHint')}
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="tablist">
          {stores.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === storeId}
              disabled={mode !== 'idle'}
              onClick={() => {
                setStoreId(s.id);
                setZoneId(null);
                setMessage(null);
              }}
              className={`inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-body-sm font-bold ${
                s.id === storeId
                  ? 'border-transparent bg-selected-bg text-link'
                  : 'border-line bg-surface text-text'
              }`}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: colors[s.id] }}
              />
              {localized(s, locale)}
            </button>
          ))}
        </div>

        <section className="rounded-lg border border-line bg-surface p-4">
          <ul className="space-y-1">
            {storeZones.map((z) => (
              <li key={z.id}>
                <button
                  type="button"
                  disabled={mode !== 'idle'}
                  onClick={() => select(z.id)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-start text-body-sm ${
                    z.id === zoneId ? 'bg-selected-bg text-link' : 'hover:bg-surface-raised'
                  }`}
                >
                  <span>
                    <span className="ltr-iso font-bold">{z.code}</span> · {localized(z, locale)}
                  </span>
                  <span className="text-caption text-text-muted">
                    {z.isActive ? t('active') : t('inactive')}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {!zone && mode === 'idle' && (
            <p className="mt-2 text-body-sm text-text-muted">{t('selectZone')}</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {zone && mode === 'idle' && (
              <>
                <button
                  type="button"
                  className={secondary}
                  disabled={busy || !zone.area}
                  onClick={() => {
                    mapRef.current?.startEdit(zone.id);
                    setMode('editing');
                    setMessage(null);
                  }}
                >
                  {t('editBorder')}
                </button>
                <button type="button" className={outline} disabled={busy} onClick={toggleActive}>
                  {zone.isActive ? t('switchOff') : t('switchOn')}
                </button>
              </>
            )}
            {mode === 'editing' && (
              <>
                <button type="button" className={secondary} disabled={busy} onClick={saveBorder}>
                  {t('saveBorder')}
                </button>
                <button
                  type="button"
                  className={outline}
                  onClick={() => {
                    mapRef.current?.cancelEdit();
                    setMode('idle');
                  }}
                >
                  {t('cancel')}
                </button>
              </>
            )}
            {mode === 'idle' && (
              <button
                type="button"
                className={outline}
                onClick={() => {
                  setZoneId(null);
                  setMode('drawing');
                  setMessage(null);
                  mapRef.current?.startDraw();
                }}
              >
                {t('drawNew')}
              </button>
            )}
            {mode === 'drawing' && (
              <button
                type="button"
                className={outline}
                onClick={() => {
                  mapRef.current?.stopDraw();
                  setMode('idle');
                }}
              >
                {t('cancel')}
              </button>
            )}
          </div>

          {mode === 'naming' && store && (
            <form className="mt-4 space-y-3 border-t border-line pt-4" onSubmit={createZone}>
              <p className="text-body-sm font-bold">
                {t('newZone', { store: localized(store, locale) })}
              </p>
              <label className="block text-caption">
                {t('code')}
                <input
                  name="code"
                  required
                  dir="ltr"
                  placeholder={`${store.code}-NEW`}
                  className={input}
                />
              </label>
              <label className="block text-caption">
                {t('nameEn')}
                <input name="nameEn" required dir="ltr" className={input} />
              </label>
              <label className="block text-caption">
                {t('nameAr')}
                <input name="nameAr" required dir="rtl" className={input} />
              </label>
              <div className="flex gap-2">
                <button type="submit" className={secondary} disabled={busy}>
                  {t('createZone')}
                </button>
                <button
                  type="button"
                  className={outline}
                  onClick={() => {
                    setDraft(null);
                    setMode('idle');
                  }}
                >
                  {t('cancel')}
                </button>
              </div>
            </form>
          )}

          {message && (
            <p
              role="status"
              className={`mt-3 text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
            >
              {message.text}
            </p>
          )}
        </section>

        {store && (
          <>
            <HoursForm key={`hours-${store.id}`} store={store} />
            <CapacityForm key={`capacity-${store.id}-${store.capacityPerHour}`} store={store} />
          </>
        )}
      </div>
    </div>
  );
}
