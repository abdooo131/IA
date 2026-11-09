'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { atLeast } from '@shiply/shared';
import { api, ApiError } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { LOCATION_MENU } from '../menu';

interface Brief {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  active?: boolean;
}
interface Site extends Brief {
  kind: 'sorting_facility' | 'last_mile_hub' | 'dark_store';
  sortingFacility: Brief | null;
}
interface Zone extends Brief {
  hub: Brief;
}
interface Row {
  id: string;
  place: { id: string; kind: string; nameEn: string; nameAr: string };
  zone?: Brief;
  hub?: Brief;
  facility?: Brief;
  darkStore?: Brief;
  notServed: boolean;
  gap?: string;
}

export default function MapPage() {
  const t = useTranslations('location');
  const tc = useTranslations('common');
  const ar = useLocale() === 'ar';
  const me = useMe();
  const canManage = atLeast(me.access.location, 'manage');
  const [tab, setTab] = useState<'areas' | 'sites' | 'zones'>('areas');
  const [sites, setSites] = useState<Site[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [map, setMap] = useState<{ rows: Row[]; total: number } | null>(null);
  const [kind, setKind] = useState<Site['kind']>('sorting_facility');
  const nm = (b?: Brief) => (b ? `${b.code} · ${ar ? b.nameAr : b.nameEn}` : '');
  const fail = (err: unknown) => {
    const code = err instanceof ApiError ? err.body.error : undefined;
    toast.error(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : tc('failed'));
  };

  const loadLists = useCallback(async () => {
    const [s, z] = await Promise.all([api<Site[]>('/location/sites'), api<Zone[]>('/location/zones')]);
    setSites(s);
    setZones(z);
  }, []);
  const loadMap = useCallback(
    () => api<{ rows: Omit<Row, 'id'>[]; total: number }>(`/location/map?page=${page}&q=${encodeURIComponent(q)}`).then((m) => setMap({ ...m, rows: m.rows.map((r) => ({ ...r, id: r.place.id })) }), fail),
    [page, q],
  );
  useEffect(() => {
    loadLists().catch(fail);
  }, [loadLists]);
  useEffect(() => {
    void loadMap();
  }, [loadMap]);

  const setService = async (row: Row, patch: { zoneId?: string | null; darkStoreId?: string | null; notServed?: boolean }) => {
    try {
      await api(`/location/map/${row.place.id}`, {
        method: 'PUT',
        json: { zoneId: row.zone?.id ?? null, darkStoreId: row.darkStore?.id ?? null, notServed: row.notServed, ...patch },
      });
      await loadMap();
    } catch (err) {
      fail(err);
    }
  };
  const addSite = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api('/location/sites', { method: 'POST', json: { kind, code: f.code, nameEn: f.nameEn, nameAr: f.nameAr, sortingFacilityId: f.sortingFacilityId || undefined } });
      e.currentTarget?.reset();
      toast.success(tc('saved'));
      await loadLists();
    } catch (err) {
      fail(err);
    }
  };
  const addZone = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    try {
      await api('/location/zones', { method: 'POST', json: f });
      form.reset();
      toast.success(tc('saved'));
      await loadLists();
    } catch (err) {
      fail(err);
    }
  };
  const facilities = sites.filter((s) => s.kind === 'sorting_facility' && s.active);
  const hubs = sites.filter((s) => s.kind === 'last_mile_hub' && s.active);
  const stores = sites.filter((s) => s.kind === 'dark_store' && s.active);
  const tabs = ['areas', 'sites', 'zones'] as const;

  return (
    <AppShell app="location" menu={LOCATION_MENU}>
      <h1>{t('map')}</h1>
      <div className="tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'tab active' : 'tab'} onClick={() => setTab(x)}>
            {t(x)}
          </button>
        ))}
      </div>

      {tab === 'areas' && (
        <ListPage<Row>
          title={t('areas')}
          filters={<input type="search" value={q} onChange={(e) => (setPage(1), setQ(e.target.value))} placeholder={t('searchAreas')} aria-label={t('searchAreas')} />}
          columns={[
            { key: 'place', label: t('area'), render: (r) => `${ar ? r.place.nameAr : r.place.nameEn}` },
            {
              key: 'zone',
              label: t('zone'),
              render: (r) =>
                canManage ? (
                  <select aria-label={t('zone')} value={r.zone?.id ?? ''} onChange={(e) => void setService(r, { zoneId: e.target.value || null })}>
                    <option value="">{t('none')}</option>
                    {zones.filter((z) => z.active).map((z) => (
                      <option key={z.id} value={z.id}>
                        {nm(z)}
                      </option>
                    ))}
                  </select>
                ) : (
                  nm(r.zone)
                ),
            },
            { key: 'hub', label: t('hub'), render: (r) => nm(r.hub) },
            { key: 'facility', label: t('facility'), render: (r) => nm(r.facility) },
            {
              key: 'darkStore',
              label: t('darkStore'),
              render: (r) =>
                canManage ? (
                  <select aria-label={t('darkStore')} value={r.darkStore?.id ?? ''} onChange={(e) => void setService(r, { darkStoreId: e.target.value || null })}>
                    <option value="">{t('none')}</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {nm(s)}
                      </option>
                    ))}
                  </select>
                ) : (
                  nm(r.darkStore)
                ),
            },
            {
              key: 'notServed',
              label: t('notServed'),
              render: (r) => <input type="checkbox" aria-label={t('notServed')} checked={r.notServed} disabled={!canManage} onChange={(e) => void setService(r, { notServed: e.target.checked })} />,
            },
            { key: 'gap', label: '', render: (r) => (r.gap ? <span className="gap">{t(`gap.${r.gap}`)}</span> : null) },
          ]}
          rows={map?.rows ?? []}
          total={map?.total ?? 0}
          page={page}
          onPage={setPage}
          loading={!map}
        />
      )}

      {tab === 'sites' && (
        <section>
          {canManage && (
            <form className="inline-form card" onSubmit={addSite}>
              <label>
                {t('kind')}
                <select aria-label={t('kind')} value={kind} onChange={(e) => setKind(e.target.value as Site['kind'])}>
                  {(['sorting_facility', 'last_mile_hub', 'dark_store'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('code')}
                <input name="code" required dir="ltr" />
              </label>
              <label>
                {t('name')}
                <input name="nameEn" required />
              </label>
              <label>
                {t('nameAr')}
                <input name="nameAr" required dir="rtl" />
              </label>
              {kind === 'last_mile_hub' && (
                <label>
                  {t('facility')}
                  <select aria-label={t('facility')} name="sortingFacilityId" required defaultValue="">
                    <option value="" disabled />
                    {facilities.map((s) => (
                      <option key={s.id} value={s.id}>
                        {nm(s)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button className="btn primary">{t('addSite')}</button>
            </form>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('code')}</th>
                  <th>{t('name')}</th>
                  <th>{t('kind')}</th>
                  <th>{t('facility')}</th>
                  <th>{t('active')}</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td>{s.code}</td>
                    <td>{ar ? s.nameAr : s.nameEn}</td>
                    <td>{t(`kinds.${s.kind}`)}</td>
                    <td>{nm(s.sortingFacility ?? undefined)}</td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={t('active')}
                        checked={s.active}
                        disabled={!canManage}
                        onChange={(e) => api(`/location/sites/${s.id}`, { method: 'PATCH', json: { active: e.target.checked } }).then(loadLists, fail)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'zones' && (
        <section>
          {canManage && (
            <form className="inline-form card" onSubmit={addZone}>
              <label>
                {t('hub')}
                <select aria-label={t('hub')} name="hubId" required defaultValue="">
                  <option value="" disabled />
                  {hubs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {nm(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('code')}
                <input name="code" required dir="ltr" />
              </label>
              <label>
                {t('name')}
                <input name="nameEn" required />
              </label>
              <label>
                {t('nameAr')}
                <input name="nameAr" required dir="rtl" />
              </label>
              <button className="btn primary">{t('addZone')}</button>
            </form>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('code')}</th>
                  <th>{t('name')}</th>
                  <th>{t('hub')}</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id}>
                    <td>{z.code}</td>
                    <td>{ar ? z.nameAr : z.nameEn}</td>
                    <td>{nm(z.hub)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </AppShell>
  );
}
