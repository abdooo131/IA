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
import { FLEET_MENU } from '../menu';
import { AgentSelect, useFleetLookups } from '../shared';

interface Route {
  id: string;
  code: string;
  fromSiteId: string;
  toSiteId: string;
  departAt: string;
  agentId: string;
  active: boolean;
}

export default function RoutesPage() {
  const t = useTranslations();
  const me = useMe();
  const look = useFleetLookups();
  const [rows, setRows] = useState<Route[] | null>(null);
  const load = useCallback(() => api<Route[]>('/agents/routes').then(setRows, () => toast.error(t('common.failed'))), [t]);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api('/agents/routes', { method: 'POST', json: Object.fromEntries(new FormData(form)) });
      form.reset();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'fleet'));
    }
  };
  const siteSelect = (name: string, label: string) => (
    <label>
      {label}
      <select name={name} aria-label={label} required defaultValue="">
        <option value="" disabled />
        {look.sites.filter((s) => s.kind !== 'dark_store').map((s) => (
          <option key={s.id} value={s.id}>{`${s.code} · ${s.nameEn}`}</option>
        ))}
      </select>
    </label>
  );
  return (
    <AppShell app="fleet" menu={FLEET_MENU}>
      {atLeast(me.access.fleet, 'use') && (
        <form className="inline-form card" onSubmit={(e) => void create(e)}>
          <label>
            {t('fleet.code')}
            <input name="code" required dir="ltr" size={10} />
          </label>
          {siteSelect('fromSiteId', t('fleet.from'))}
          {siteSelect('toSiteId', t('fleet.to'))}
          <label>
            {t('fleet.departAt')}
            <input name="departAt" type="time" required />
          </label>
          <AgentSelect name="agentId" agents={look.agents} label={t('fleet.agent')} render={look.agentLabel} />
          <button className="btn primary">{t('fleet.addRoute')}</button>
        </form>
      )}
      <ListPage<Route>
        title={t('fleet.routes')}
        columns={[
          { key: 'code', label: t('fleet.code'), render: (r) => r.code },
          { key: 'way', label: t('fleet.from'), render: (r) => `${look.site(r.fromSiteId)} → ${look.site(r.toSiteId)}` },
          { key: 'at', label: t('fleet.departAt'), render: (r) => r.departAt },
          { key: 'agent', label: t('fleet.agent'), render: (r) => look.agent(r.agentId) },
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
