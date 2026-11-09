'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { atLeast, formatEgp } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { confirm, toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { FLEET_MENU } from '../menu';
import { AgentSelect, useFleetLookups } from '../shared';

interface Settlement {
  id: string;
  agentId: string;
  from: string;
  to: string;
  gross: number;
  cashHeld: number;
  net: number;
  status: string;
  preparedById: string;
  invoiceNumber: string | null;
}

export default function SettlementsPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const me = useMe();
  const look = useFleetLookups();
  const [rows, setRows] = useState<Settlement[] | null>(null);
  const [inv, setInv] = useState<Record<string, string>>({});
  const load = useCallback(() => api<Settlement[]>('/agents/settlements').then(setRows, () => toast.error(t('common.failed'))), [t]);
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
    void run(() => api('/agents/settlements', { method: 'POST', json: Object.fromEntries(new FormData(form)) }));
  };
  const canUse = atLeast(me.access.fleet, 'use');
  const manage = atLeast(me.access.fleet, 'manage');
  return (
    <AppShell app="fleet" menu={FLEET_MENU}>
      {canUse && (
        <form className="inline-form card" onSubmit={create}>
          <AgentSelect name="agentId" agents={look.agents} label={t('fleet.agent')} render={look.agentLabel} />
          <label>
            {t('fleet.from')}
            <input name="from" type="date" required />
          </label>
          <label>
            {t('fleet.to')}
            <input name="to" type="date" required />
          </label>
          <button className="btn primary">{t('fleet.prepare')}</button>
        </form>
      )}
      <ListPage<Settlement>
        title={t('fleet.settlements')}
        columns={[
          { key: 'agent', label: t('fleet.agent'), render: (r) => look.agent(r.agentId) },
          { key: 'period', label: t('fleet.period'), render: (r) => `${r.from.slice(0, 10)} → ${r.to.slice(0, 10)}` },
          { key: 'gross', label: t('fleet.gross'), render: (r) => formatEgp(r.gross, locale) },
          { key: 'cash', label: t('fleet.cashHeld'), render: (r) => formatEgp(r.cashHeld, locale) },
          { key: 'net', label: t('fleet.net'), render: (r) => formatEgp(r.net, locale) },
          { key: 'status', label: t('fleet.status'), render: (r) => <span className="pill">{t(`fleet.sstatus.${r.status}` as never)}{r.invoiceNumber ? ` · ${r.invoiceNumber}` : ''}</span> },
          {
            key: 'actions',
            label: '',
            render: (r) => (
              <div className="row-actions">
                {r.status === 'draft' && manage && r.preparedById !== me.id && (
                  <button
                    className="btn primary"
                    onClick={() =>
                      void confirm({ title: t('fleet.approve'), body: t('fleet.approveBody') }).then(async (ok) => {
                        if (ok) await run(() => api(`/agents/settlements/${r.id}/approve`, { method: 'POST' }));
                      })
                    }
                  >
                    {t('fleet.approve')}
                  </button>
                )}
                {r.status === 'approved' && canUse && (
                  <>
                    <input aria-label={t('fleet.invoiceNumber')} value={inv[r.id] ?? ''} onChange={(e) => setInv({ ...inv, [r.id]: e.target.value })} dir="ltr" size={10} />
                    <button className="btn primary" onClick={() => void run(() => api(`/agents/settlements/${r.id}/invoice`, { method: 'POST', json: { invoiceNumber: inv[r.id] ?? '' } }))}>
                      {t('fleet.billIt')}
                    </button>
                  </>
                )}
                {(r.status === 'draft' || r.status === 'approved') && canUse && (
                  <button className="btn" onClick={() => void run(() => api(`/agents/settlements/${r.id}/cancel`, { method: 'POST' }))}>
                    {t('fleet.cancel')}
                  </button>
                )}
              </div>
            ),
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
