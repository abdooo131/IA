'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { atLeast, formatEgp } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { FLEET_MENU } from '../menu';

interface Agent {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  contactName: string;
  phone: string;
  services: string[];
  perDelivery: number;
  perPickup: number;
  perTrip: number;
  active: boolean;
}

export default function AgentsPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const me = useMe();
  const [rows, setRows] = useState<Agent[] | null>(null);
  const load = useCallback(() => api<Agent[]>('/agents').then(setRows, () => toast.error(t('common.failed'))), [t]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'fleet'));
    }
  };
  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    void run(async () => {
      await api('/agents', { method: 'POST', json: { ...f, services: [f.shiply ? 'shiply' : '', f.shiply_now ? 'shiply_now' : ''].filter(Boolean) } });
      form.reset();
    });
  };
  const manage = atLeast(me.access.fleet, 'manage');
  const field = (name: string, label: string, extra: object = {}) => (
    <label>
      {label}
      <input name={name} required {...extra} />
    </label>
  );
  return (
    <AppShell app="fleet" menu={FLEET_MENU}>
      {manage && (
        <form className="inline-form card" onSubmit={create}>
          {field('code', t('fleet.code'), { dir: 'ltr', size: 8 })}
          {field('name', t('fleet.name'))}
          {field('nameAr', t('fleet.nameAr'))}
          {field('contactName', t('fleet.contactName'))}
          {field('phone', t('fleet.phone'), { dir: 'ltr', inputMode: 'tel' })}
          {field('perDelivery', t('fleet.perDelivery'), { dir: 'ltr', inputMode: 'decimal', size: 6 })}
          {field('perPickup', t('fleet.perPickup'), { dir: 'ltr', inputMode: 'decimal', size: 6 })}
          {field('perTrip', t('fleet.perTrip'), { dir: 'ltr', inputMode: 'decimal', size: 6 })}
          <label className="check">
            <input type="checkbox" name="shiply" defaultChecked />
            {t('apps.shiply')}
          </label>
          <label className="check">
            <input type="checkbox" name="shiply_now" />
            {t('apps.shiply_now')}
          </label>
          <button className="btn primary">{t('fleet.addAgent')}</button>
        </form>
      )}
      <ListPage<Agent>
        title={t('fleet.agentsList')}
        columns={[
          { key: 'code', label: t('fleet.code'), render: (r) => r.code },
          { key: 'name', label: t('fleet.name'), render: (r) => (locale === 'ar' ? r.nameAr : r.name) },
          { key: 'contact', label: t('fleet.contactName'), render: (r) => `${r.contactName} · ${r.phone}` },
          { key: 'rates', label: t('fleet.perDelivery'), render: (r) => `${formatEgp(r.perDelivery, locale)} / ${formatEgp(r.perPickup, locale)} / ${formatEgp(r.perTrip, locale)}` },
          {
            key: 'active',
            label: t('fleet.status'),
            render: (r) =>
              manage ? (
                <button className="btn" onClick={() => void run(() => api(`/agents/${r.id}`, { method: 'PATCH', json: { active: !r.active } }))}>
                  {r.active ? t('fleet.active') : t('fleet.inactive')}
                </button>
              ) : r.active ? t('fleet.active') : t('fleet.inactive'),
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
