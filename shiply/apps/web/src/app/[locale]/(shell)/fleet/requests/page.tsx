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

export interface RequestRow {
  id: string;
  siteId: string;
  date: string;
  role: string;
  count: number;
  vehicleType: string | null;
  note: string | null;
  agentId: string | null;
  answeredAgentId: string | null;
  status: string;
}
const ROLES = ['delivery', 'pickup', 'rider', 'truck_driver'];

export default function RequestsPage() {
  const t = useTranslations();
  const me = useMe();
  const look = useFleetLookups();
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const load = useCallback(() => api<RequestRow[]>('/agents/requests').then(setRows, () => toast.error(t('common.failed'))), [t]);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    try {
      await api('/agents/requests', { method: 'POST', json: { siteId: f.siteId, date: f.date, role: f.role, count: Number(f.count), agentId: f.agentId || undefined, note: f.note || undefined } });
      form.reset();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'fleet'));
    }
  };
  return (
    <AppShell app="fleet" menu={FLEET_MENU}>
      {atLeast(me.access.fleet, 'use') && (
        <form className="inline-form card" onSubmit={(e) => void create(e)}>
          <label>
            {t('fleet.site')}
            <select name="siteId" aria-label={t('fleet.site')} required defaultValue="">
              <option value="" disabled />
              {look.sites.map((s) => (
                <option key={s.id} value={s.id}>{`${s.code} · ${s.nameEn}`}</option>
              ))}
            </select>
          </label>
          <label>
            {t('fleet.date')}
            <input name="date" type="date" required />
          </label>
          <label>
            {t('fleet.role')}
            <select name="role" aria-label={t('fleet.role')}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`fleet.roles.${r}` as never)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('fleet.count')}
            <input name="count" inputMode="numeric" required size={4} />
          </label>
          <AgentSelect name="agentId" agents={look.agents} label={t('fleet.agent')} render={look.agentLabel} any={t('fleet.anyAgent')} />
          <label>
            {t('fleet.note')}
            <input name="note" />
          </label>
          <button className="btn primary">{t('fleet.addRequest')}</button>
        </form>
      )}
      <ListPage<RequestRow>
        title={t('fleet.requests')}
        columns={[
          { key: 'date', label: t('fleet.date'), render: (r) => r.date.slice(0, 10) },
          { key: 'site', label: t('fleet.site'), render: (r) => look.site(r.siteId) },
          { key: 'need', label: t('fleet.role'), render: (r) => `${r.count} × ${t(`fleet.roles.${r.role}` as never)}` },
          { key: 'agent', label: t('fleet.agent'), render: (r) => look.agent(r.answeredAgentId ?? r.agentId) || t('fleet.anyAgent') },
          { key: 'status', label: t('fleet.status'), render: (r) => <span className="pill">{t(`fleet.rstatus.${r.status}` as never)}</span> },
          { key: 'note', label: t('fleet.note'), render: (r) => r.note ?? '' },
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
