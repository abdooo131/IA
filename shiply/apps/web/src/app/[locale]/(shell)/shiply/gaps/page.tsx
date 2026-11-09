'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { SHIPLY_MENU } from '../menu';
import { useLookups } from '../shared';

interface Gap {
  id: string;
  siteId: string;
  kind: string;
  step: string;
  parcelId: string | null;
  bagId: string | null;
  lastScanById: string | null;
  open: boolean;
  note: string | null;
  createdAt: string;
}

export default function GapsPage() {
  const t = useTranslations();
  const me = useMe();
  const look = useLookups();
  const [open, setOpen] = useState('true');
  const [rows, setRows] = useState<Gap[] | null>(null);
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const g = await api<Gap[]>(`/parcels/gaps?open=${open}`);
    setRows(g);
    const ids = [...new Set(g.map((x) => x.parcelId).filter(Boolean))] as string[];
    const found = await Promise.all(ids.map((id) => api<{ id: string; tracking: string }>(`/parcels/${id}`).catch(() => null)));
    setTracking(Object.fromEntries(found.filter(Boolean).map((p) => [p!.id, p!.tracking])));
  }, [open]);
  useEffect(() => {
    load().catch(() => toast.error(t('common.failed')));
  }, [load, t]);
  const resolve = async (id: string) => {
    try {
      await api(`/parcels/gaps/${id}/resolve`, { method: 'POST', json: { note: note[id] ?? '' } });
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'shiply'));
    }
  };
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <ListPage<Gap>
        title={t('shiply.gaps')}
        filters={
          <select aria-label={t('shiply.status')} value={open} onChange={(e) => setOpen(e.target.value)}>
            <option value="true">{t('shiply.open')}</option>
            <option value="false">{t('shiply.resolved')}</option>
          </select>
        }
        columns={[
          { key: 'kind', label: t('shiply.kind'), render: (r) => <span className="pill">{t(`shiply.gkind.${r.kind}` as never)}</span> },
          { key: 'parcel', label: t('shiply.tracking'), render: (r) => <span dir="ltr">{r.parcelId ? (tracking[r.parcelId] ?? '') : ''}</span> },
          { key: 'site', label: t('shiply.site'), render: (r) => look.site(r.siteId) },
          { key: 'step', label: t('shiply.step'), render: (r) => r.step },
          { key: 'who', label: t('shiply.lastScan'), render: (r) => look.person(r.lastScanById) },
          { key: 'when', label: t('shiply.when'), render: (r) => new Date(r.createdAt).toLocaleString() },
          {
            key: 'resolve',
            label: '',
            render: (r) =>
              r.open && atLeast(me.access.shiply, 'use') ? (
                <div className="row-actions">
                  <input aria-label={t('shiply.resolveNote')} value={note[r.id] ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
                  <button className="btn" onClick={() => void resolve(r.id)}>
                    {t('shiply.resolve')}
                  </button>
                </div>
              ) : (
                (r.note ?? '')
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
