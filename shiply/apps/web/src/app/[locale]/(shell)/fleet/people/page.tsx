'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { atLeast } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { useRouter } from '@/i18n/routing';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { confirm, toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { FLEET_MENU } from '../menu';
import { AgentSelect, useFleetLookups, useReason } from '../shared';

export interface PersonRow {
  id: string;
  agentId: string;
  userId: string;
  role: string;
  status: string;
  blocked: boolean;
  blockedReason: string | null;
  createdById: string;
  name: string;
  nameAr: string;
  mobile: string | null;
}

const ROLES = ['delivery', 'pickup', 'rider', 'truck_driver'];

export default function PeoplePage() {
  const t = useTranslations();
  const me = useMe();
  const router = useRouter();
  const look = useFleetLookups();
  const reason = useReason();
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const load = useCallback(() => api<PersonRow[]>(`/agents/people?status=${status}`).then(setRows, () => toast.error(t('common.failed'))), [status, t]);
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
    void run(async () => {
      await api('/agents/people', { method: 'POST', json: Object.fromEntries(new FormData(form)) });
      form.reset();
    });
  };
  const approve = async (id: string) => {
    if (await confirm({ title: t('fleet.approve'), body: t('fleet.approveBody') })) await run(() => api(`/agents/people/${id}/approve`, { method: 'POST' }));
  };
  const manage = atLeast(me.access.fleet, 'manage');
  return (
    <AppShell app="fleet" menu={FLEET_MENU}>
      {atLeast(me.access.fleet, 'use') && (
        <form className="inline-form card" onSubmit={create}>
          <AgentSelect name="agentId" agents={look.agents} label={t('fleet.agent')} render={look.agentLabel} />
          <label>
            {t('fleet.role')}
            <select name="role" aria-label={t('fleet.role')} defaultValue="delivery">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`fleet.roles.${r}` as never)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('fleet.name')}
            <input name="name" required />
          </label>
          <label>
            {t('fleet.nameAr')}
            <input name="nameAr" required />
          </label>
          <label>
            {t('fleet.mobile')}
            <input name="mobile" required dir="ltr" inputMode="tel" />
          </label>
          <label>
            {t('fleet.password')}
            <input name="password" type="password" required minLength={10} />
          </label>
          <button className="btn primary">{t('fleet.addPerson')}</button>
        </form>
      )}
      <ListPage<PersonRow>
        title={t('fleet.people')}
        filters={
          <select aria-label={t('fleet.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('shiply.all')}</option>
            {['pending', 'approved', 'rejected'].map((s) => (
              <option key={s} value={s}>
                {t(`fleet.pstatus.${s}` as never)}
              </option>
            ))}
            <option value="blocked">{t('fleet.blocked')}</option>
          </select>
        }
        columns={[
          { key: 'name', label: t('fleet.name'), render: (r) => r.name },
          { key: 'agent', label: t('fleet.agent'), render: (r) => look.agent(r.agentId) },
          { key: 'role', label: t('fleet.role'), render: (r) => t(`fleet.roles.${r.role}` as never) },
          { key: 'mobile', label: t('fleet.mobile'), render: (r) => <span dir="ltr">{r.mobile}</span> },
          { key: 'status', label: t('fleet.status'), render: (r) => <span className={`pill${r.status === 'approved' && !r.blocked ? ' on' : ''}`}>{t(`fleet.pstatus.${r.status}` as never)}</span> },
          { key: 'blocked', label: t('fleet.blocked'), render: (r) => (r.blocked ? reason(r.blockedReason) : '') },
          {
            key: 'approve',
            label: '',
            render: (r) =>
              manage && r.status === 'pending' && r.createdById !== me.id ? (
                <button
                  className="btn primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    void approve(r.id);
                  }}
                >
                  {t('fleet.approve')}
                </button>
              ) : null,
          },
        ]}
        rows={rows ?? []}
        total={rows?.length ?? 0}
        page={1}
        pageSize={1000}
        onPage={() => undefined}
        onRowClick={(r) => router.push(`/fleet/people/${r.id}`)}
        loading={!rows}
      />
    </AppShell>
  );
}
