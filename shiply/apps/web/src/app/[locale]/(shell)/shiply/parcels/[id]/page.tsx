'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { atLeast, formatEgp } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { Link } from '@/i18n/routing';
import { AppShell } from '@/shell/AppShell';
import { RecordPage } from '@/shell/RecordPage';
import { confirm, toast } from '@/shell/feedback';
import { LoadError } from '@/shell/LoadError';
import { useMe } from '@/shell/me';
import { SHIPLY_MENU } from '../../menu';
import { StatusPill, useLookups } from '../../shared';
import type { Parcel } from '../page';

interface Full extends Parcel {
  notes: string | null;
  openPackage: boolean;
  events: { id: string; status: string; note: string | null; at: string }[];
  scans: { id: string; step: string; ok: boolean; reason: string | null; at: string }[];
  attemptList: { id: string; number: number; result: string; reason: string | null; at: string }[];
}

export default function ParcelRecord() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const me = useMe();
  const look = useLookups();
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<Full | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const load = useCallback(() => api<Full>(`/parcels/${id}`).then(setP, setFailed), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (failed) return <AppShell app="shiply" menu={SHIPLY_MENU}><LoadError error={failed} /></AppShell>;
  if (!p) return <AppShell app="shiply" menu={SHIPLY_MENU}>{null}</AppShell>;
  const cancel = async () => {
    if (!(await confirm({ title: t('shiply.cancelParcel'), body: t('shiply.cancelBody'), danger: true }))) return;
    try {
      await api(`/parcels/${p.id}/cancel`, { method: 'POST' });
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'shiply'));
    }
  };
  const row = (k: string, v: React.ReactNode, testId?: string) => (
    <div className="field">
      <span>{k}</span>
      <strong data-testid={testId}>{v}</strong>
    </div>
  );
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <RecordPage
        back={<Link href="/shiply/parcels">{t('shiply.parcels')}</Link>}
        number={p.tracking}
        status={<StatusPill status={p.status} />}
        actions={p.status === 'created' && atLeast(me.access.shiply, 'use') ? <button className="btn" onClick={() => void cancel()}>{t('shiply.cancelParcel')}</button> : null}
        tabs={[
          {
            key: 'details',
            label: t('shiply.details'),
            content: (
              <div className="fields">
                {row(t('shiply.merchant'), look.merchant(p.merchantId))}
                {row(t('shiply.customerName'), p.customerName)}
                {row(t('shiply.phone'), <span dir="ltr">{p.phone}</span>)}
                {row(t('shiply.address'), p.addressText)}
                {row(t('shiply.route'), p.zoneId ? `${look.site(p.originFacilityId)} → ${look.site(p.hubId)} → ${look.zone(p.zoneId)}` : t('shiply.noRoute'), 'parcel-route')}
                {row(t('shiply.price'), p.price === null ? '' : formatEgp(p.price, locale), 'parcel-price')}
                {row(t('shiply.cod'), formatEgp(p.codAmount, locale))}
                {row(t('shiply.courier'), look.person(p.courierId))}
                {p.notes ? row(t('shiply.notes'), p.notes) : null}
              </div>
            ),
          },
          {
            key: 'scans',
            label: t('shiply.scans'),
            content: (
              <table className="table">
                <tbody>
                  {p.scans.map((s) => (
                    <tr key={s.id}>
                      <td>{s.step}</td>
                      <td>{s.ok ? '✓' : s.reason}</td>
                      <td>{new Date(s.at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          },
          {
            key: 'attempts',
            label: t('shiply.attempts'),
            content: (
              <table className="table">
                <tbody>
                  {p.attemptList.map((a) => (
                    <tr key={a.id}>
                      <td>{a.number}</td>
                      <td>{a.result}</td>
                      <td>{a.reason ? t(`shiply.reasons.${a.reason}` as never) : ''}</td>
                      <td>{new Date(a.at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          },
        ]}
        timeline={p.events.map((e) => ({ at: e.at, text: `${t(`shiply.statuses.${e.status}` as never)}${e.note ? `: ${e.note}` : ''}` }))}
      />
    </AppShell>
  );
}
