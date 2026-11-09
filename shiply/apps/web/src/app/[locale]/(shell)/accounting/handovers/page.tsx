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
import type { Holder } from '../holders/page';
import { ACCOUNTING_MENU } from '../menu';

interface Handover {
  id: string;
  fromHolderId: string;
  toHolderId: string;
  amount: number;
  confirmedAmount: number | null;
  status: string;
  createdById: string;
  createdAt: string;
}

export default function HandoversPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const me = useMe();
  const [rows, setRows] = useState<Handover[] | null>(null);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [received, setReceived] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const status = new URLSearchParams(window.location.search).get('status') ?? '';
    const [h, hs] = await Promise.all([api<Handover[]>(`/money/handovers?status=${status}`), api<Holder[]>('/money/holders')]);
    setRows(h);
    setHolders(hs);
  }, []);
  useEffect(() => {
    load().catch(() => toast.error(t('common.failed')));
  }, [load, t]);
  const name = (id: string) => {
    const h = holders.find((x) => x.id === id);
    return h ? (locale === 'ar' ? h.nameAr : h.nameEn) : id;
  };
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'accounting'));
    }
  };
  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    void run(async () => {
      await api('/money/handovers', { method: 'POST', json: Object.fromEntries(new FormData(form)) });
      form.reset();
    });
  };
  const canUse = atLeast(me.access.accounting, 'use');
  const label = (h: Holder) => `${locale === 'ar' ? h.nameAr : h.nameEn} · ${formatEgp(h.held, locale)}`;
  return (
    <AppShell app="accounting" menu={ACCOUNTING_MENU}>
      {canUse && (
        <form className="inline-form card" onSubmit={create}>
          <label>
            {t('accounting.from')}
            <select name="fromHolderId" aria-label={t('accounting.from')} required defaultValue="">
              <option value="" disabled />
              {holders.filter((h) => h.active).map((h) => (
                <option key={h.id} value={h.id}>
                  {label(h)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('accounting.to')}
            <select name="toHolderId" aria-label={t('accounting.to')} required defaultValue="">
              <option value="" disabled />
              {holders.filter((h) => h.active).map((h) => (
                <option key={h.id} value={h.id}>
                  {label(h)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('accounting.amount')}
            <input name="amount" required inputMode="decimal" dir="ltr" />
          </label>
          <button className="btn primary">{t('accounting.handOver')}</button>
        </form>
      )}
      <ListPage<Handover>
        title={t('accounting.handovers')}
        columns={[
          { key: 'from', label: t('accounting.from'), render: (r) => name(r.fromHolderId) },
          { key: 'to', label: t('accounting.to'), render: (r) => name(r.toHolderId) },
          { key: 'amount', label: t('accounting.amount'), render: (r) => formatEgp(r.amount, locale) },
          { key: 'received', label: t('accounting.received'), render: (r) => (r.confirmedAmount === null ? '' : formatEgp(r.confirmedAmount, locale)) },
          { key: 'status', label: t('accounting.status'), render: (r) => <span className={`pill${r.status === 'confirmed' ? ' on' : ''}`}>{t(`accounting.hstatus.${r.status}`)}</span> },
          { key: 'when', label: t('accounting.when'), render: (r) => new Date(r.createdAt).toLocaleString() },
          {
            key: 'confirm',
            label: '',
            render: (r) =>
              canUse && r.status === 'pending' && r.createdById !== me.id ? (
                <div className="row-actions">
                  <input aria-label={t('accounting.receivedAmount')} value={received[r.id] ?? ''} onChange={(e) => setReceived({ ...received, [r.id]: e.target.value })} inputMode="decimal" dir="ltr" size={8} />
                  <button className="btn primary" onClick={() => void run(() => api(`/money/handovers/${r.id}/confirm`, { method: 'POST', json: { receivedAmount: received[r.id] ?? '' } }))}>
                    {t('accounting.confirmReceived')}
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
