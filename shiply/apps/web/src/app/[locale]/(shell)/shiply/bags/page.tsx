'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { atLeast } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { SHIPLY_MENU } from '../menu';
import { useLookups } from '../shared';

interface Bag {
  id: string;
  seal: string;
  fromSiteId: string;
  toSiteId: string;
  status: string;
  count: number;
  single: boolean;
}
interface Car {
  id: string;
  fromSiteId: string;
  toSiteId: string;
  driverName: string;
  status: string;
  driverCount: number | null;
}

/** Bags waiting to close and cars being loaded. Scanning itself happens on the station screen. */
export default function BagsPage() {
  const t = useTranslations();
  const me = useMe();
  const look = useLookups();
  const [bags, setBags] = useState<Bag[] | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [count, setCount] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const [b, c] = await Promise.all([api<Bag[]>('/parcels/bags'), api<Car[]>('/parcels/cars')]);
    setBags(b);
    setCars(c);
  }, []);
  useEffect(() => {
    load().catch(() => toast.error(t('common.failed')));
  }, [load, t]);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'shiply'));
    }
  };
  const newCar = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    void run(() => api('/parcels/cars', { method: 'POST', json: Object.fromEntries(new FormData(form)) }));
  };
  const canUse = atLeast(me.access.shiply, 'use');
  const siteSelect = (name: string, label: string) => (
    <label>
      {label}
      <select name={name} aria-label={label} required defaultValue="">
        <option value="" disabled />
        {look.sites.map((s) => (
          <option key={s.id} value={s.id}>
            {look.label(s)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <ListPage<Bag>
        title={t('shiply.bags')}
        columns={[
          { key: 'seal', label: t('shiply.seal'), render: (r) => <span dir="ltr">{r.seal}</span> },
          { key: 'from', label: t('shiply.from'), render: (r) => look.site(r.fromSiteId) },
          { key: 'to', label: t('shiply.to'), render: (r) => look.site(r.toSiteId) },
          { key: 'count', label: t('shiply.count'), render: (r) => r.count },
          { key: 'status', label: t('shiply.status'), render: (r) => <span className="pill">{t(`shiply.bstatus.${r.status}` as never)}</span> },
          {
            key: 'close',
            label: '',
            render: (r) => (canUse && r.status === 'open' ? <button className="btn" onClick={() => void run(() => api(`/parcels/bags/${r.seal}/close`, { method: 'POST' }))}>{t('shiply.closeBag')}</button> : null),
          },
        ]}
        rows={bags ?? []}
        total={bags?.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!bags}
      />
      {canUse && (
        <form className="inline-form card" onSubmit={newCar}>
          {siteSelect('fromSiteId', t('shiply.from'))}
          {siteSelect('toSiteId', t('shiply.to'))}
          <label>
            {t('shiply.driver')}
            <input name="driverName" required />
          </label>
          <button className="btn primary">{t('shiply.addCar')}</button>
        </form>
      )}
      <ListPage<Car>
        title={t('shiply.cars')}
        columns={[
          { key: 'from', label: t('shiply.from'), render: (r) => look.site(r.fromSiteId) },
          { key: 'to', label: t('shiply.to'), render: (r) => look.site(r.toSiteId) },
          { key: 'driver', label: t('shiply.driver'), render: (r) => r.driverName },
          { key: 'status', label: t('shiply.status'), render: (r) => <span className="pill">{t(`shiply.cstatus.${r.status}` as never)}</span> },
          {
            key: 'depart',
            label: '',
            render: (r) =>
              canUse && r.status === 'loading' ? (
                <div className="row-actions">
                  <input aria-label={t('shiply.bags')} inputMode="numeric" size={4} value={count[r.id] ?? ''} onChange={(e) => setCount({ ...count, [r.id]: e.target.value })} />
                  <button className="btn primary" onClick={() => void run(() => api(`/parcels/cars/${r.id}/depart`, { method: 'POST', json: { driverCount: Number(count[r.id] ?? '') } }))}>
                    {t('shiply.out')}
                  </button>
                </div>
              ) : null,
          },
        ]}
        rows={cars}
        total={cars.length}
        page={1}
        pageSize={500}
        onPage={() => undefined}
      />
    </AppShell>
  );
}
