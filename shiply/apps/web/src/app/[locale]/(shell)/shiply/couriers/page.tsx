'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { SHIPLY_MENU } from '../menu';
import { useLookups, type Person } from '../shared';

/** The zones each courier usually covers (moves to Agents & Fleet later). */
export default function CouriersPage() {
  const t = useTranslations();
  const locale = useLocale();
  const me = useMe();
  const look = useLookups();
  const [rows, setRows] = useState<(Person & { zoneIds: string[] })[]>([]);
  useEffect(() => {
    api<(Person & { zoneIds: string[] })[]>('/parcels/couriers').then(setRows, () => toast.error(t('common.failed')));
  }, [t]);
  const toggle = (id: string, zoneId: string) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, zoneIds: r.zoneIds.includes(zoneId) ? r.zoneIds.filter((z) => z !== zoneId) : [...r.zoneIds, zoneId] } : r)));
  const save = async (r: Person & { zoneIds: string[] }) => {
    try {
      await api(`/parcels/couriers/${r.id}/zones`, { method: 'PUT', json: { zoneIds: r.zoneIds } });
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(errorText(t, err, 'shiply'));
    }
  };
  const canUse = atLeast(me.access.shiply, 'use');
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <h1>{t('shiply.zones')}</h1>
      {rows.map((r) => (
        <div key={r.id} className="card" data-testid="row">
          <h3>{locale === 'ar' ? r.nameAr : r.name}</h3>
          <div className="row-actions">
            {look.zones.map((z) => (
              <label key={z.id} className="check">
                <input type="checkbox" disabled={!canUse} checked={r.zoneIds.includes(z.id)} onChange={() => toggle(r.id, z.id)} />
                {z.code}
              </label>
            ))}
            {canUse && (
              <button className="btn" onClick={() => void save(r)}>
                {t('shiply.saveZones')}
              </button>
            )}
          </div>
        </div>
      ))}
    </AppShell>
  );
}
