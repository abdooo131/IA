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

interface Pickup {
  id: string;
  merchantId: string;
  date: string;
  courierId: string | null;
  status: string;
}

export default function PickupsPage() {
  const t = useTranslations();
  const me = useMe();
  const look = useLookups();
  const [rows, setRows] = useState<Pickup[] | null>(null);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const load = useCallback(() => api<Pickup[]>('/parcels/pickups').then(setRows, () => toast.error(t('common.failed'))), [t]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'shiply'));
    }
  };
  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    void run(async () => {
      await api('/parcels/pickups', { method: 'POST', json: Object.fromEntries(new FormData(form)) });
      form.reset();
    });
  };
  const canUse = atLeast(me.access.shiply, 'use');
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      {canUse && (
        <form className="inline-form card" onSubmit={create}>
          <label>
            {t('shiply.merchant')}
            <select name="merchantId" aria-label={t('shiply.merchant')} required defaultValue="">
              <option value="" disabled />
              {look.merchants.map((m) => (
                <option key={m.id} value={m.id}>{`${m.name} · ${m.code}`}</option>
              ))}
            </select>
          </label>
          <label>
            {t('shiply.date')}
            <input name="date" type="date" required />
          </label>
          <button className="btn primary">{t('shiply.schedule')}</button>
        </form>
      )}
      <ListPage<Pickup>
        title={t('shiply.pickups')}
        columns={[
          { key: 'date', label: t('shiply.date'), render: (r) => r.date.slice(0, 10) },
          { key: 'merchant', label: t('shiply.merchant'), render: (r) => look.merchant(r.merchantId) },
          { key: 'courier', label: t('shiply.courier'), render: (r) => look.person(r.courierId) },
          { key: 'status', label: t('shiply.status'), render: (r) => <span className="pill">{t(`shiply.pstatus.${r.status}` as never)}</span> },
          {
            key: 'assign',
            label: '',
            render: (r) =>
              canUse && (r.status === 'scheduled' || r.status === 'assigned') ? (
                <div className="row-actions">
                  <select aria-label={t('shiply.courier')} value={assign[r.id] ?? ''} onChange={(e) => setAssign({ ...assign, [r.id]: e.target.value })}>
                    <option value="" disabled />
                    {look.couriers.filter((c) => c.active).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn" onClick={() => void run(() => api(`/parcels/pickups/${r.id}/assign`, { method: 'POST', json: { courierId: assign[r.id] ?? '' } }))}>
                    {t('shiply.assign')}
                  </button>
                </div>
              ) : null,
          },
        ]}
        rows={rows ?? []}
        total={rows?.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!rows}
      />
    </AppShell>
  );
}
