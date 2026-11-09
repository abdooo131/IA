'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { confirm, toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { SHIPLY_MENU } from '../menu';
import { SitePicker, useLookups, useSite } from '../shared';

interface Bag {
  id: string;
  seal: string;
  fromSiteId: string;
  status: string;
  count: number;
}

/** Bags coming to this hub; once a bag is empty, Bag empty flags what was missing or extra. */
export default function ReceivePage() {
  const t = useTranslations();
  const me = useMe();
  const look = useLookups();
  const [siteId, setSite, options] = useSite('last_mile_hub', look.sites);
  const [rows, setRows] = useState<Bag[] | null>(null);
  const load = useCallback(async () => {
    if (siteId) setRows((await api<(Bag & { toSiteId: string })[]>(`/parcels/bags?site=${siteId}`)).filter((b) => b.toSiteId === siteId && b.status !== 'done'));
  }, [siteId]);
  useEffect(() => {
    load().catch(() => toast.error(t('common.failed')));
  }, [load, t]);
  const done = async (seal: string) => {
    if (!(await confirm({ title: t('shiply.bagDone'), body: t('shiply.bagDoneBody') }))) return;
    try {
      await api(`/parcels/hub/bags/${seal}/done`, { method: 'POST' });
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'shiply'));
    }
  };
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <div className="inline-form card">
        <SitePicker label={t('shiply.hub')} value={siteId} onChange={setSite} options={options} render={look.label} />
      </div>
      <ListPage<Bag>
        title={t('shiply.receive')}
        columns={[
          { key: 'seal', label: t('shiply.seal'), render: (r) => <span dir="ltr">{r.seal}</span> },
          { key: 'from', label: t('shiply.from'), render: (r) => look.site(r.fromSiteId) },
          { key: 'count', label: t('shiply.count'), render: (r) => r.count },
          { key: 'status', label: t('shiply.status'), render: (r) => <span className="pill">{t(`shiply.bstatus.${r.status}` as never)}</span> },
          {
            key: 'done',
            label: '',
            render: (r) => (atLeast(me.access.shiply, 'use') && r.status === 'received' ? <button className="btn" onClick={() => void done(r.seal)}>{t('shiply.bagDone')}</button> : null),
          },
        ]}
        rows={rows ?? []}
        total={rows?.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!!siteId && !rows}
      />
    </AppShell>
  );
}
