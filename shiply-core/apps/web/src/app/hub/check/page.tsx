'use client';
import { Fragment } from 'react';
import { useHub } from '@/components/HubContext';
import { Icon } from '@/components/Icon';
import { Badge, Card, Empty, Loading, PageHeader, StatusBadge, Table, Td, cx } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

type Row = { id: string; trackingNumber: string; customerName: string; merchant: string; since: string; late: boolean };
type Stage = { key: string; from: string; to: string; title: string; rows: Row[] };
type Check = { lateAfterHours: number; stages: Stage[]; lost: { trackingNumber: string; customerName: string; status: string; note: string; at: string; type: string }[] };

function waited(since: string, t: (s: string, v?: Record<string, string | number>) => string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000));
  return mins < 60 ? t('{n} min', { n: mins }) : t('{h} h {m} min', { h: Math.floor(mins / 60), m: mins % 60 });
}

/**
 * Every handover between two teams, with what is waiting at each one. A parcel that waits too
 * long, or that is missing when a bag is opened, shows here: that is where it went missing.
 */
export default function HandoverCheckPage() {
  const hub = useHub();
  const t = useT();
  const check = useLoad<Check>(`/hubs/${hub.id}/handover-check`);
  if (!check.data) return <Loading />;
  const c = check.data;
  return (
    <>
      <PageHeader
        eyebrow={hub.isSorting ? t('Sorting facility') : t('Last mile hub')}
        title={`${t('Handover check')} · ${hub.name}`}
        subtitle={t('Every parcel is scanned at each handover. Here is what is waiting between two teams; red means it waited more than {h} hours.', { h: c.lateAfterHours })}
      />
      <div className="mb-6 flex flex-wrap items-stretch gap-2">
        {c.stages.map((st, i) => {
          const late = st.rows.filter((r) => r.late).length;
          return (
            <Fragment key={st.key}>
              {i > 0 && <span className="hidden items-center text-text-muted sm:flex"><Icon name="route" size={18} /></span>}
              <div className={cx('min-w-[150px] flex-1 rounded-xl bg-surface p-4 shadow-sm', late > 0 && 'ring-2 ring-danger')}>
                <p className="text-caption text-text-muted">{t(st.from)} → {t(st.to)}</p>
                <p className={cx('tabular mt-2 text-number-lg', late > 0 && 'text-danger')}>{st.rows.length}</p>
                <p className="text-caption">{late > 0 ? t('{n} late', { n: late }) : t('On time')}</p>
              </div>
            </Fragment>
          );
        })}
      </div>
      <div className="space-y-4">
        {c.stages.filter((st) => st.rows.length > 0).map((st) => (
          <Card key={st.key} title={<span className="flex items-center gap-2">{t(st.title)} <Badge tone="blue">{st.rows.length}</Badge></span>}>
            <Table head={[t('Parcel'), t('Merchant'), t('Customer'), t('Waiting')]}>
              {st.rows.map((r) => (
                <tr key={r.id}>
                  <Td><span className="ltr-iso font-mono">{r.trackingNumber}</span></Td>
                  <Td>{r.merchant}</Td>
                  <Td>{r.customerName}</Td>
                  <Td>{r.late ? <Badge tone="red">{waited(r.since, t)}</Badge> : <span className="tabular">{waited(r.since, t)}</span>}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        ))}
        {c.stages.every((st) => st.rows.length === 0) && <Empty>{t('Nothing is waiting between teams.')}</Empty>}
        <Card title={t('Marked lost here in the last 7 days')}>
          {c.lost.length === 0 ? <Empty>{t('No lost parcels.')}</Empty> : (
            <Table head={[t('Parcel'), t('Customer'), t('Now'), t('What happened'), t('When')]}>
              {c.lost.map((l, i) => (
                <tr key={i}>
                  <Td><span className="ltr-iso font-mono">{l.trackingNumber}</span></Td>
                  <Td>{l.customerName}</Td>
                  <Td><StatusBadge status={l.status} /></Td>
                  <Td className="whitespace-normal">{l.note}</Td>
                  <Td>{dateTime(l.at)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
