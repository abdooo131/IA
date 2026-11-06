'use client';

import type { ZonePolygon } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AreaSearchBox } from '@/components/geo/AreaSearchBox';
import { type AdminStore, type AdminZone, localized } from '@/lib/admin-types';
import { apiGetClient, apiSend } from '@/lib/api-client';
import {
  clickAction,
  countByLevel,
  levelsForZoom,
  MAP_COLORS,
  type MapArea,
  NEIGHBOURHOOD_ZOOM,
  type ReviewArea,
} from '@/lib/zone-areas';
import type { AreaZoneMapHandle } from './AreaZoneMap';
import { CapacityForm, HoursForm } from './StoreSettings';

// Leaflet needs the browser, so the map never renders on the server.
const AreaZoneMap = dynamic(() => import('./AreaZoneMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] w-full animate-pulse rounded-lg bg-surface-raised md:h-[580px]" />
  ),
});

const STORE_COLORS = ['#0047BB', '#0E9384', '#C026D3', '#B45309', '#7C3AED', '#16A34A'];

const secondary =
  'h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const outline =
  'h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold text-text disabled:opacity-50';
const small = 'h-8 rounded-md border border-line bg-surface px-2 text-caption font-bold text-text';
const input =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';

/** At most this many pages of areas for one view of the map */
const MAX_PAGES = 8;

const KNOWN_ERRORS = [
  'zone_geometry_invalid',
  'zone_code_taken',
  'zone_has_orders',
  'area_served_by_other_store',
  'area_level_not_assignable',
  'hub_has_no_zones',
  'zone_uses_areas',
  'validation_failed',
  'network',
];

type Tab = 'zones' | 'review';
type Message = { text: string; error: boolean; moveShape?: ZonePolygon };

function nameOf(a: { nameEn: string; nameAr: string }, locale: string) {
  return (locale === 'ar' ? a.nameAr : a.nameEn) || a.nameEn || a.nameAr;
}

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
  const mapRef = useRef<AreaZoneMapHandle>(null);

  const [storeId, setStoreId] = useState(
    stores.some((s) => s.id === initialStoreId) ? initialStoreId! : (stores[0]?.id ?? ''),
  );
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('zones');
  const [view, setView] = useState<{ bbox: [number, number, number, number]; zoom: number }>();
  const [areas, setAreas] = useState<MapArea[]>([]);
  const [extra, setExtra] = useState<MapArea | null>(null);
  const [focus, setFocus] = useState<MapArea | null>(null);
  const [zoneAreas, setZoneAreas] = useState<MapArea[]>([]);
  const [review, setReview] = useState<ReviewArea[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [shapeLevel, setShapeLevel] = useState(3);
  const [naming, setNaming] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const asked = useRef(0);

  const colors = useMemo(
    () => Object.fromEntries(stores.map((s, i) => [s.id, STORE_COLORS[i % STORE_COLORS.length]!])),
    [stores],
  );
  const store = stores.find((s) => s.id === storeId);
  const zone = zones.find((z) => z.id === zoneId);
  const storeZones = zones.filter((z) => z.darkStoreId === storeId);
  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);
  const storeById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);
  const detailed = (view?.zoom ?? 0) >= NEIGHBOURHOOD_ZOOM;

  // The areas in view, page by page; an answer for an older view is dropped.
  useEffect(() => {
    if (!view) return;
    const turn = ++asked.current;
    void (async () => {
      const found: MapArea[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({
          bbox: view.bbox.join(','),
          levels: levelsForZoom(view.zoom).join(','),
          limit: '500',
        });
        if (cursor) query.set('cursor', cursor);
        const result = await apiGetClient<{ areas: MapArea[]; nextCursor: string | null }>(
          `/admin/zones/areas?${query}`,
        );
        if (turn !== asked.current) return;
        if (!result.ok) break;
        found.push(...result.data.areas);
        setAreas([...found]);
        cursor = result.data.nextCursor;
        if (!cursor) break;
      }
    })();
  }, [view, version]);

  // The selected zone's own areas, for its list.
  useEffect(() => {
    if (!zoneId) return setZoneAreas([]);
    let current = true;
    void apiGetClient<{ areas: MapArea[] }>(
      `/admin/zones/areas?zoneId=${encodeURIComponent(zoneId)}&levels=2,3,4&limit=1000`,
    ).then((result) => {
      if (current && result.ok) setZoneAreas(result.data.areas);
    });
    return () => {
      current = false;
    };
  }, [zoneId, version]);

  useEffect(() => {
    let current = true;
    void apiGetClient<ReviewArea[]>('/admin/zones/areas/review').then((result) => {
      if (current && result.ok) setReview(result.data);
    });
    return () => {
      current = false;
    };
  }, [version]);

  // A searched area stays drawn even when it is outside the levels shown at this zoom.
  const shown = useMemo(() => {
    if (!extra || areas.some((a) => a.id === extra.id)) return areas;
    return [...areas, extra];
  }, [areas, extra]);

  // Keep the focused area's owner fresh after a change.
  useEffect(() => {
    if (!focus) return;
    const fresh = shown.find((a) => a.id === focus.id);
    if (fresh && fresh !== focus) setFocus(fresh);
  }, [shown, focus]);

  const onView = useCallback(
    (bbox: [number, number, number, number], zoom: number) => setView({ bbox, zoom }),
    [],
  );

  function fail(error: string) {
    setMessage({
      text: t(`errors.${KNOWN_ERRORS.includes(error) ? error : 'generic'}`),
      error: true,
    });
  }

  /** After any change: the map, the lists and the zone outlines (server data) again. */
  function changed(text?: string) {
    setVersion((v) => v + 1);
    if (extra) setExtra(null);
    if (text) setMessage({ text, error: false });
    router.refresh();
  }

  function ownerText(area: MapArea) {
    const o = area.owner;
    if (!o) return t('ownerNobody');
    if (o.excluded) return t('ownerExcluded');
    const s = o.darkStoreId ? storeById.get(o.darkStoreId) : undefined;
    const z = o.zoneId ? zoneById.get(o.zoneId) : undefined;
    const where = [s && localized(s, locale), z && `${z.code}`].filter(Boolean).join(' · ');
    return o.inherited ? t('ownerInherited', { where }) : t('ownerOwn', { where });
  }

  async function assign(
    area: { id: string; nameEn: string; nameAr: string },
    target: AdminZone,
    move: boolean,
  ) {
    setBusy(true);
    const result = await apiSend('POST', `/admin/zones/${target.id}/areas`, {
      areaId: area.id,
      move: move || undefined,
    });
    setBusy(false);
    if (!result.ok) return fail(result.error);
    changed(t('assigned', { area: nameOf(area, locale), zone: localized(target, locale) }));
  }

  async function unassign(area: { id: string; nameEn: string; nameAr: string }) {
    setBusy(true);
    const result = await apiSend('DELETE', `/admin/zones/areas/${area.id}`);
    setBusy(false);
    if (!result.ok) return fail(result.error);
    changed(t('removed', { area: nameOf(area, locale) }));
  }

  async function exclude(area: { id: string; nameEn: string; nameAr: string }) {
    setBusy(true);
    const result = await apiSend('POST', `/admin/zones/areas/${area.id}/exclude`, {});
    setBusy(false);
    if (!result.ok) return fail(result.error);
    changed(t('excludedDone', { area: nameOf(area, locale) }));
  }

  /** Click on the map: assign to the selected zone, or remove it when it is already its own. */
  async function clickArea(area: MapArea) {
    if (busy || drawing) return;
    setFocus(area);
    setMessage(null);
    if (!zone) return;
    const action = clickAction(area.owner, zone);
    if (action === 'unassign') return unassign(area);
    if (action === 'inherited') return;
    if (action === 'move') {
      const other = storeById.get(area.owner!.darkStoreId!);
      const ok = window.confirm(
        t('moveConfirm', {
          area: nameOf(area, locale),
          store: other ? localized(other, locale) : '',
          zone: localized(zone, locale),
        }),
      );
      if (!ok) return;
    }
    return assign(area, zone, action === 'move');
  }

  async function selectInShape(shape: ZonePolygon, move: boolean) {
    if (!zone) return;
    setBusy(true);
    const result = await apiSend<{
      assigned: number;
      skipped: { areaId: string; error: string }[];
    }>('POST', `/admin/zones/${zone.id}/areas/select`, {
      shape,
      level: shapeLevel,
      move: move || undefined,
    });
    setBusy(false);
    if (!result.ok) return fail(result.error);
    const otherStore = result.data.skipped.filter(
      (s) => s.error === 'area_served_by_other_store',
    ).length;
    changed();
    setMessage({
      text: t('shapeDone', { assigned: result.data.assigned, skipped: otherStore }),
      error: false,
      moveShape: otherStore > 0 && !move ? shape : undefined,
    });
  }

  async function toggleActive() {
    if (!zone) return;
    setBusy(true);
    const result = await apiSend('PATCH', `/admin/zones/${zone.id}`, { isActive: !zone.isActive });
    setBusy(false);
    if (!result.ok) return fail(result.error);
    router.refresh();
  }

  /** Only a zone that never had an order can go; the server says so otherwise. */
  async function deleteZone() {
    if (!zone || !window.confirm(t('deleteConfirm', { name: localized(zone, locale) }))) return;
    setBusy(true);
    const result = await apiSend('DELETE', `/admin/zones/${zone.id}`);
    setBusy(false);
    if (!result.ok) return fail(result.error);
    setZoneId(null);
    changed(t('deleted'));
  }

  async function createZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const result = await apiSend<{ id: string }>('POST', '/admin/zones', {
      darkStoreId: store.id,
      code: form.get('code'),
      nameEn: form.get('nameEn'),
      nameAr: form.get('nameAr'),
    });
    setBusy(false);
    if (!result.ok) return fail(result.error);
    setNaming(false);
    setZoneId(result.data.id);
    changed(t('zoneCreated'));
  }

  function selectZone(id: string | null) {
    if (drawing) return;
    setZoneId(id);
    setMessage(null);
    if (id) {
      const z = zoneById.get(id);
      if (z) setStoreId(z.darkStoreId);
      mapRef.current?.showZone(id);
    }
  }

  const counts = countByLevel(zoneAreas);
  const levelName = (level: number) =>
    level === 2 ? t('levelDistrict') : level === 4 ? t('levelCompound') : t('levelNeighbourhood');

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
      <div className="min-w-0 space-y-3">
        <AreaSearchBox<MapArea>
          label={t('searchArea')}
          placeholder={t('searchHint')}
          emptyText={t('searchNone')}
          failedText={t('errors.network')}
          search={async (q) => {
            const result = await apiGetClient<{ areas: MapArea[] }>(
              `/admin/zones/areas?q=${encodeURIComponent(q)}&levels=2,3,4&limit=10`,
            );
            return result.ok ? result.data.areas : null;
          }}
          keyOf={(a) => a.id}
          render={(a) => (
            <>
              <span className="font-bold">{nameOf(a, locale)}</span>
              <span className="text-text-muted"> · {levelName(a.level)}</span>
              <span className="block text-caption text-text-muted">{ownerText(a)}</span>
            </>
          )}
          onPick={(a) => {
            setExtra(a);
            setFocus(a);
            mapRef.current?.showArea(a.geometry);
          }}
        />

        <AreaZoneMap
          ref={mapRef}
          areas={shown}
          zones={zones}
          stores={stores}
          colors={colors}
          locale={locale}
          selectedZoneId={zoneId}
          focusAreaId={focus?.id ?? null}
          detailed={detailed}
          onView={onView}
          onAreaClick={(a) => void clickArea(a)}
          onShape={(polygon) => {
            setDrawing(false);
            if (polygon === 'multi') return setMessage({ text: t('multiPart'), error: true });
            void selectInShape(polygon, false);
          }}
        />

        <ul
          className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-text-muted"
          aria-label={t('legend')}
        >
          {stores.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-3 w-3 rounded-sm"
                style={{ background: colors[s.id] }}
              />
              {localized(s, locale)}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-3 w-3 rounded-sm border border-dashed"
              style={{ background: `${MAP_COLORS.excluded}55`, borderColor: MAP_COLORS.excluded }}
            />
            {t('legendExcluded')}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-3 w-3 rounded-sm border-2 border-dashed"
              style={{ borderColor: MAP_COLORS.review }}
            />
            {t('legendReview')}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-3 w-3 rounded-sm border"
              style={{ borderColor: MAP_COLORS.nobody }}
            />
            {t('legendNobody')}
          </li>
        </ul>
        <p className="text-caption text-text-muted">
          {drawing
            ? t('shapeHint')
            : zone
              ? t('mapHintZone', { zone: localized(zone, locale) })
              : t('mapHint')}
          {!drawing && !detailed && ` ${t('zoomHint')}`}
        </p>

        {focus && (
          <section
            aria-live="polite"
            className="rounded-lg border border-line bg-surface p-4"
            aria-label={t('areaCard')}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-body font-bold">{nameOf(focus, locale)}</p>
                <p className="text-caption text-text-muted">
                  {levelName(focus.level)} · {ownerText(focus)}
                  {focus.owner?.needsReview && ` · ${t('legendReview')}`}
                </p>
              </div>
              <button
                type="button"
                className={small}
                aria-label={t('close')}
                onClick={() => setFocus(null)}
              >
                ×
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {zone &&
                clickAction(focus.owner, zone) !== 'unassign' &&
                clickAction(focus.owner, zone) !== 'inherited' && (
                  <button
                    type="button"
                    className={secondary}
                    disabled={busy}
                    onClick={() => void clickArea(focus)}
                  >
                    {t('addTo', { zone: zone.code })}
                  </button>
                )}
              {focus.owner && !focus.owner.inherited && (
                <button
                  type="button"
                  className={outline}
                  disabled={busy}
                  onClick={() => void unassign(focus)}
                >
                  {focus.owner.excluded ? t('serveAgain') : t('removeArea')}
                </button>
              )}
              {!focus.owner?.excluded && (
                <button
                  type="button"
                  className={`${outline} text-status-needs-action`}
                  disabled={busy}
                  onClick={() => void exclude(focus)}
                >
                  {t('notServed')}
                </button>
              )}
              {!zone && focus.owner?.zoneId && zoneById.has(focus.owner.zoneId) && (
                <button
                  type="button"
                  className={outline}
                  onClick={() => selectZone(focus.owner!.zoneId)}
                >
                  {t('selectItsZone')}
                </button>
              )}
            </div>
            {!zone && (
              <p className="mt-2 text-caption text-text-muted">{t('selectZoneToAssign')}</p>
            )}
          </section>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <div className="flex gap-1 rounded-md border border-line bg-surface p-1" role="tablist">
          {(['zones', 'review'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`h-9 flex-1 rounded px-3 text-body-sm font-bold ${
                tab === key ? 'bg-selected-bg text-link' : 'text-text'
              }`}
            >
              {key === 'zones' ? t('tabZones') : t('tabReview', { count: review.length })}
            </button>
          ))}
        </div>

        {tab === 'zones' && (
          <>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('store')}>
              {stores.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={s.id === storeId}
                  disabled={drawing}
                  onClick={() => {
                    setStoreId(s.id);
                    setZoneId(null);
                    setNaming(false);
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
                      disabled={drawing}
                      aria-pressed={z.id === zoneId}
                      onClick={() => selectZone(z.id === zoneId ? null : z.id)}
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
              {storeZones.length === 0 && (
                <p className="text-body-sm text-text-muted">{t('noZones')}</p>
              )}
              {!zone && storeZones.length > 0 && (
                <p className="mt-2 text-body-sm text-text-muted">{t('selectZone')}</p>
              )}

              {zone && (
                <div className="mt-4 space-y-3 border-t border-line pt-4">
                  <p className="text-body-sm">
                    {t('zoneCounts', {
                      districts: counts[2] ?? 0,
                      neighbourhoods: counts[3] ?? 0,
                      compounds: counts[4] ?? 0,
                    })}
                  </p>
                  {zoneAreas.length > 0 ? (
                    <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label={t('zoneAreas')}>
                      {zoneAreas.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate rounded px-1 py-1 text-start text-body-sm hover:bg-surface-raised"
                            onClick={() => {
                              setExtra(a);
                              setFocus(a);
                              mapRef.current?.showArea(a.geometry);
                            }}
                          >
                            {nameOf(a, locale)}
                            <span className="text-caption text-text-muted">
                              {' '}
                              · {levelName(a.level)}
                              {a.owner?.needsReview && ` · ${t('legendReview')}`}
                            </span>
                          </button>
                          <button
                            type="button"
                            className={small}
                            disabled={busy}
                            aria-label={t('removeNamed', { area: nameOf(a, locale) })}
                            onClick={() => void unassign(a)}
                          >
                            {t('remove')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-body-sm text-text-muted">
                      {zone.area ? t('zoneOutlineOnly') : t('zoneEmpty')}
                    </p>
                  )}

                  <div className="flex flex-wrap items-end gap-2">
                    {!drawing ? (
                      <>
                        <label className="text-caption" htmlFor="zone-shape-level">
                          {t('shapeLevel')}
                          <select
                            id="zone-shape-level"
                            value={shapeLevel}
                            onChange={(e) => setShapeLevel(Number(e.target.value))}
                            className={`${input} w-auto`}
                          >
                            <option value={3}>{t('levelNeighbourhoods')}</option>
                            <option value={2}>{t('levelDistricts')}</option>
                            <option value={4}>{t('levelCompounds')}</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          className={secondary}
                          disabled={busy}
                          onClick={() => {
                            setDrawing(true);
                            setMessage(null);
                            mapRef.current?.startShape();
                          }}
                        >
                          {t('selectInShape')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={outline}
                        onClick={() => {
                          mapRef.current?.stopShape();
                          setDrawing(false);
                        }}
                      >
                        {t('cancel')}
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={outline}
                      disabled={busy}
                      onClick={toggleActive}
                    >
                      {zone.isActive ? t('switchOff') : t('switchOn')}
                    </button>
                    <button
                      type="button"
                      className={`${outline} text-status-needs-action`}
                      disabled={busy}
                      onClick={deleteZone}
                    >
                      {t('deleteZone')}
                    </button>
                  </div>
                </div>
              )}

              {!naming && !drawing && store && (
                <button
                  type="button"
                  className={`${outline} mt-3`}
                  onClick={() => {
                    setNaming(true);
                    setMessage(null);
                  }}
                >
                  {t('newZoneButton')}
                </button>
              )}

              {naming && store && (
                <form className="mt-4 space-y-3 border-t border-line pt-4" onSubmit={createZone}>
                  <p className="text-body-sm font-bold">
                    {t('newZone', { store: localized(store, locale) })}
                  </p>
                  <p className="text-caption text-text-muted">{t('newZoneHelp')}</p>
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
                    <button type="button" className={outline} onClick={() => setNaming(false)}>
                      {t('cancel')}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </>
        )}

        {tab === 'review' && (
          <section className="rounded-lg border border-line bg-surface p-4">
            <p className="text-body-sm text-text-muted">{t('reviewHelp')}</p>
            {review.length === 0 && <p className="mt-3 text-body-sm">{t('reviewEmpty')}</p>}
            <ul className="mt-3 space-y-3">
              {review.map((r) => {
                const z = r.zoneId ? zoneById.get(r.zoneId) : undefined;
                const s = r.darkStoreId ? storeById.get(r.darkStoreId) : undefined;
                return (
                  <li key={r.areaId} className="rounded-md border border-line p-3">
                    <p className="text-body-sm font-bold">{nameOf(r, locale)}</p>
                    <p className="text-caption text-text-muted">
                      {levelName(r.level)} ·{' '}
                      {s && z
                        ? t('reviewNow', { store: localized(s, locale), zone: z.code })
                        : t('ownerExcluded')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {z && (
                        <button
                          type="button"
                          className={secondary}
                          disabled={busy}
                          onClick={() => void assign({ ...r, id: r.areaId }, z, false)}
                        >
                          {t('reviewKeep', { zone: z.code })}
                        </button>
                      )}
                      {zone && zone.id !== r.zoneId && (
                        <button
                          type="button"
                          className={outline}
                          disabled={busy}
                          onClick={() => void assign({ ...r, id: r.areaId }, zone, true)}
                        >
                          {t('reviewMove', { zone: zone.code })}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${outline} text-status-needs-action`}
                        disabled={busy}
                        onClick={() => void exclude({ ...r, id: r.areaId })}
                      >
                        {t('notServed')}
                      </button>
                      <button
                        type="button"
                        className={outline}
                        onClick={async () => {
                          // The area itself: "inside" an area starts with the area.
                          const result = await apiGetClient<{ areas: MapArea[] }>(
                            `/admin/zones/areas?districtId=${encodeURIComponent(r.areaId)}&levels=${r.level}&limit=5`,
                          );
                          const found = result.ok
                            ? result.data.areas.find((a) => a.id === r.areaId)
                            : undefined;
                          if (!found) return;
                          setExtra(found);
                          setFocus(found);
                          mapRef.current?.showArea(found.geometry);
                        }}
                      >
                        {t('showOnMap')}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {message && (
          <div
            role="status"
            className={`rounded-md border border-line bg-surface p-3 text-body-sm ${
              message.error ? 'text-danger' : 'text-text'
            }`}
          >
            {message.text}
            {message.moveShape && (
              <button
                type="button"
                className={`${small} ms-2`}
                disabled={busy}
                onClick={() => void selectInShape(message.moveShape!, true)}
              >
                {t('moveThemToo')}
              </button>
            )}
          </div>
        )}

        {store && tab === 'zones' && (
          <>
            <HoursForm key={`hours-${store.id}`} store={store} />
            <CapacityForm key={`capacity-${store.id}-${store.capacityPerHour}`} store={store} />
          </>
        )}
      </div>
    </div>
  );
}
