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
import { Badge, parcelTone } from '@/ui/Badge';
import { InfoCard, Journey } from '@/ui/Drawer';
import { SHIPLY_MENU } from '../../menu';
import { useLookups } from '../../shared';
import type { Parcel } from '../page';

interface Full extends Parcel {
  notes: string | null;
  openPackage: boolean;
  size: string;
  events: { id: string; status: string; note: string | null; at: string }[];
  scans: { id: string; step: string; ok: boolean; reason: string | null; at: string }[];
  attemptList: { id: string; number: number; result: string; reason: string | null; at: string }[];
}

const JOURNEY = ['created', 'picked_up', 'at_inbound', 'sorted', 'in_transit', 'at_hub', 'out_for_delivery', 'delivered'];
/** Statuses that sit between two journey steps show at the nearest one. */
const AT: Record<string, string> = { at_outbound: 'sorted', attempt_failed: 'out_for_delivery', on_hold: 'at_hub' };

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
  if (!p)
    return (
      <AppShell app="shiply" menu={SHIPLY_MENU}>
        <span className="skeleton" style={{ width: 240, height: 32 }} />
      </AppShell>
    );
  const cancel = async () => {
    if (!(await confirm({ title: t('shiply.cancelParcel'), body: t('shiply.cancelBody'), danger: true }))) return;
    try {
      await api(`/parcels/${p.id}/cancel`, { method: 'POST' });
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'shiply'));
    }
  };
  const copy = () => {
    void navigator.clipboard?.writeText(p.tracking).then(() => toast.success(t('shiply.copied')));
  };
  const step = JOURNEY.indexOf(AT[p.status] ?? p.status);
  const journeyFailed = ['attempt_failed', 'on_hold'].includes(p.status);
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <RecordPage
        back={
          <Link className="back-link" href="/shiply/parcels">
            ‹ {t('shiply.parcels')}
          </Link>
        }
        number={p.tracking}
        status={
          <>
            <button className="btn ghost icon-btn" onClick={copy} aria-label={t('shiply.copy')} title={t('shiply.copy')}>
              ⧉
            </button>
            <Badge tone={parcelTone(p.status)}>{t(`shiply.statuses.${p.status}` as never)}</Badge>
            {p.direction === 'return' && <Badge tone="returning">{t('shiply.returns')}</Badge>}
          </>
        }
        actions={
          p.status === 'created' && atLeast(me.access.shiply, 'use') ? (
            <button className="btn ghost" onClick={() => void cancel()}>
              {t('shiply.cancelParcel')}
            </button>
          ) : null
        }
        summary={
          <>
            {step >= 0 && <Journey steps={JOURNEY.map((k) => ({ key: k, label: t(`shiply.journey.${k}` as never) }))} current={step} failed={journeyFailed} />}
            <div className="info-grid">
              <InfoCard icon="customers" title={t('shiply.customer')}>
                <span className="big">{p.customerName}</span>
                <span className="line" dir="ltr">
                  {p.phone}
                </span>
                <span className="line">{p.addressText}</span>
              </InfoCard>
              <InfoCard icon="route" title={t('shiply.route')}>
                <span className="big" data-testid="parcel-route">
                  {p.zoneId ? `${look.site(p.originFacilityId)} → ${look.site(p.hubId)} → ${look.zone(p.zoneId)}` : t('shiply.noRoute')}
                </span>
                <span className="line">{look.merchant(p.merchantId)}</span>
                {p.courierId && (
                  <span className="line">
                    {t('shiply.courier')}: {look.person(p.courierId)}
                  </span>
                )}
              </InfoCard>
              <InfoCard icon="wallet" title={t('shiply.money')}>
                <span className="big mono">{formatEgp(p.codAmount, locale)}</span>
                <span className="line">
                  {t('shiply.price')}: <span data-testid="parcel-price">{p.price === null ? '' : formatEgp(p.price, locale)}</span>
                </span>
                <span className="line">
                  {t(`shiply.sizes.${p.size}` as never)}
                  {p.openPackage ? ` · ${t('shiply.openPackage')}` : ''}
                </span>
              </InfoCard>
            </div>
          </>
        }
        tabs={[
          {
            key: 'scans',
            label: `${t('shiply.scans')} (${p.scans.length})`,
            content: (
              <table className="table">
                <tbody>
                  {p.scans.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-main">{t.has(`field.steps.${s.step}` as never) ? t(`field.steps.${s.step}` as never) : s.step}</td>
                      <td>{s.ok ? <Badge tone="delivered">✓</Badge> : <Badge tone="returning">{s.reason}</Badge>}</td>
                      <td className="cell-sub">{new Date(s.at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          },
          {
            key: 'attempts',
            label: `${t('shiply.attempts')} (${p.attemptList.length})`,
            content: (
              <table className="table">
                <tbody>
                  {p.attemptList.map((a) => (
                    <tr key={a.id}>
                      <td className="cell-main">#{a.number}</td>
                      <td>
                        <Badge tone={a.result === 'delivered' ? 'delivered' : 'needs'}>{a.result === 'delivered' ? t('shiply.statuses.delivered') : t('shiply.statuses.attempt_failed')}</Badge>
                      </td>
                      <td>{a.reason ? t(`shiply.reasons.${a.reason}` as never) : ''}</td>
                      <td className="cell-sub">{new Date(a.at).toLocaleString()}</td>
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
