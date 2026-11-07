'use client';
import { RouteChain } from '@/components/RouteChain';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FAIL_REASONS, FAIL_REASON_LABELS_AR, STATUS_LABELS_AR, isTerminal, type FailReason, type ShipmentStatus } from '@shiply/shared';
import { StatusBar } from '@/components/StatusBar';
import { Alert, Badge, Button, Card, Loading, PageHeader, StatusBadge, Table, Td, cx } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, egp, shortDate, statusLabel } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useLocale, useT } from '@/lib/i18n';

interface Detail {
  id: string;
  trackingNumber: string;
  merchant: { id: string; name: string; code: string; phone: string };
  merchantRef: string;
  customerName: string;
  customerPhone: string;
  address: string;
  governorateCode: string;
  size: string;
  description: string;
  notes: string;
  allowOpen: boolean;
  codAmount: number;
  codCollected: number;
  shippingFee: number;
  codFee: number;
  returnFee: number;
  status: string;
  direction: string;
  originHubId: string;
  destinationHubId: string;
  currentHubId: string | null;
  attempts: number;
  lastFailReason: string | null;
  holdReason: string | null;
  promisedDate: string | null;
  payoutId: string | null;
  createdAt: string;
  deliveredAt: string | null;
  hubCodes: Record<string, string>;
  route?: string[];
  next: { kind: string; hubCode?: string; hubName?: string; reason?: string | null };
  events: { id: string; type: string; fromStatus: string | null; toStatus: string; hubCode: string | null; userName: string | null; note: string; createdAt: string }[];
  runItems: { id: string; direction: string; result: string; failReason: string | null; codCollected: number; recipient: string; resolvedAt: string | null; run: { code: string; date: string } }[];
}

/** Plain words for each history event. */
const EVENT_TEXT: Record<string, string> = {
  CREATED: 'Parcel created',
  CANCELLED: 'Cancelled',
  PICKED_UP: 'Picked up from the merchant',
  DROPPED_OFF: 'Dropped off at the sorting facility',
  RECEIVED_FROM_PICKUP: 'Received by inbound',
  SORTED: 'Sorted into a bag',
  UNBAGGED: 'Taken out of a bag',
  HANDED_TO_OUTBOUND: 'Handed to outbound',
  BAGGED_BY_OUTBOUND: 'Scanned into a bag by outbound',
  MISSING_FROM_BAG: 'Missing when its bag was opened',
  DEPARTED: 'Left on a line haul trip',
  RECEIVED_FROM_TRANSFER: 'Received from line haul',
  UNEXPECTED_ARRIVAL: 'Arrived somewhere unexpected',
  RETURN_SHELF: 'Put on the return shelf',
  LOADED_ON_RUN: 'Loaded on a courier run',
  REMOVED_FROM_RUN: 'Taken off a courier run',
  OUT_FOR_DELIVERY: 'Out for delivery',
  OUT_FOR_RETURN: 'Out for return to the merchant',
  DELIVERED: 'Delivered',
  ATTEMPT_FAILED: 'Delivery attempt failed',
  RETURN_ATTEMPT_FAILED: 'Return attempt failed',
  NOT_ATTEMPTED: 'Back from courier, not attempted',
  BACK_FROM_COURIER: 'Back from courier',
  ON_HOLD: 'On hold for the merchant',
  REATTEMPT_REQUESTED: 'Merchant asked to try again',
  RETURN_REQUESTED: 'Return requested',
  RETURN_STARTED: 'Return started',
  RETURNED: 'Returned to the merchant',
  MARKED_LOST: 'Marked lost',
  FOUND: 'Found',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-body-sm last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className="text-end font-semibold">{children}</span>
    </div>
  );
}

export default function ShipmentDetail() {
  const t = useT();
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const { data: d, error, loading, reload } = useLoad<Detail>(`/admin/shipments/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !d) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!d) return null;

  const reasonLabel = (code: string | null) => {
    if (!code) return '';
    if (code === 'NOT_ATTEMPTED') return t('Not attempted');
    if (locale === 'ar') return FAIL_REASON_LABELS_AR[code as FailReason] ?? code;
    return (FAIL_REASONS as Record<string, { label: string }>)[code]?.label ?? code.replace(/_/g, ' ').toLowerCase();
  };
  const status = (s: string, direction?: string) => (locale === 'ar' ? STATUS_LABELS_AR[s as ShipmentStatus] ?? s : statusLabel(s, direction));
  const nextText = () => {
    switch (d.next.kind) {
      case 'SEND':
        return t('Sort into a bag for {name} ({code})', { name: d.next.hubName ?? '', code: d.next.hubCode ?? '' });
      case 'DELIVER':
        return t('Ready to go out on a delivery run');
      case 'RETURN_TO_MERCHANT':
        return t('Ready to go back to the merchant on a run');
      case 'HOLD':
        return t('Waiting for the merchant: {reason}', { reason: reasonLabel(d.next.reason ?? null) });
      default:
        return isTerminal(d.status as ShipmentStatus) ? t('Closed') : t('Moving; nothing to do in a hub right now');
    }
  };
  const hub = (hubId: string | null) => (hubId ? d.hubCodes[hubId] ?? '' : '');
  const canMarkLost = !isTerminal(d.status as ShipmentStatus) && d.status !== 'LOST';
  const events = [...d.events].reverse();

  const markLost = async () => {
    const note = window.prompt(t('Mark {code} as lost? Write what happened.', { code: d.trackingNumber }));
    if (note === null) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/admin/shipments/${d.id}/lost`, { body: { note } });
      await reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Link href="/admin/shipments" className="inline-flex items-center gap-1 text-body-sm font-bold text-link">
        <span aria-hidden="true" className="rtl:rotate-180">←</span> {t('Parcels')}
      </Link>
      <PageHeader
        eyebrow={t('Parcel')}
        title={d.trackingNumber}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} direction={d.direction} />
            {d.direction === 'RETURN' && <Badge tone="red">{t('Return to merchant')}</Badge>}
            {d.payoutId && <Badge tone="green">{t('Paid out')}</Badge>}
          </span>
        }
        actions={canMarkLost && <Button tone="danger" disabled={busy} onClick={markLost}>{t('Mark lost')}</Button>}
      />
      <StatusBar flow={d.direction === 'RETURN' ? 'returnParcel' : 'parcel'} status={d.status} />
      {actionError && <Alert>{actionError}</Alert>}
      <Alert tone="info">
        <span className="font-bold">{t('Next step:')}</span> {nextText()}
      </Alert>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={t('Customer')}>
          <Row label={t('Name')}>{d.customerName}</Row>
          <Row label={t('Phone')}><span className="ltr-iso">{d.customerPhone}</span></Row>
          <Row label={t('Address')}>{d.address}</Row>
          <Row label={t('Governorate')}><span className="ltr-iso">{d.governorateCode}</span></Row>
          <Row label={t('Can open parcel')}>{d.allowOpen ? t('Yes') : t('No')}</Row>
          {d.notes && <Row label={t('Notes')}>{d.notes}</Row>}
        </Card>
        <Card title={t('Parcel')}>
          <Row label={t('Merchant')}>{d.merchant.name}</Row>
          {d.merchantRef && <Row label={t('Merchant ref')}><span className="ltr-iso">{d.merchantRef}</span></Row>}
          <Row label={t('Size')}>{d.size}</Row>
          {d.description && <Row label={t('Contents')}>{d.description}</Row>}
          <Row label={t('Route')}>
            {d.route?.length ? <RouteChain route={d.route} here={hub(d.currentHubId) || null} done={['DELIVERED', 'RETURNED'].includes(d.status)} /> : <span className="ltr-iso">{hub(d.originHubId)} → {hub(d.destinationHubId)}</span>}
          </Row>
          <Row label={t('Now at')}>{hub(d.currentHubId) || status(d.status, d.direction)}</Row>
          <Row label={t('Promised')}>{shortDate(d.promisedDate) || t('Set when it enters the network')}</Row>
          <Row label={t('Attempts')}>
            <span className="tabular">{d.attempts}</span>
            {d.lastFailReason && <span className="ms-1 font-normal text-text-muted">({reasonLabel(d.lastFailReason)})</span>}
          </Row>
          <Row label={t('Created')}>{dateTime(d.createdAt)}</Row>
          {d.deliveredAt && <Row label={t('Delivered')}>{dateTime(d.deliveredAt)}</Row>}
        </Card>
        <Card title={t('Money')}>
          <Row label={t('COD to collect')}><span className="tabular ltr-iso">{egp(d.codAmount)}</span></Row>
          <Row label={t('COD collected')}><span className="tabular ltr-iso">{egp(d.codCollected)}</span></Row>
          <Row label={t('Shipping fee')}><span className="tabular ltr-iso">{egp(d.shippingFee)}</span></Row>
          <Row label={t('COD fee')}><span className="tabular ltr-iso">{egp(d.codFee)}</span></Row>
          <Row label={t('Return fee')}><span className="tabular ltr-iso">{egp(d.returnFee)}</span></Row>
        </Card>
      </div>

      <Card title={t('Timeline')}>
        <ol className="relative ms-2 space-y-5 border-s-2 border-line ps-6">
          {events.map((e, i) => (
            <li key={e.id} className="relative">
              <span
                aria-hidden="true"
                className={cx('absolute -start-[33px] top-1 h-4 w-4 rounded-pill ring-4 ring-surface', i === 0 ? 'bg-accent' : 'bg-line-strong')}
              />
              <div className="flex flex-wrap items-center gap-2 text-body-sm">
                <span className="font-bold">{t(EVENT_TEXT[e.type] ?? e.type.replace(/_/g, ' ').toLowerCase())}</span>
                {e.hubCode && <Badge tone="blue"><span className="ltr-iso">{e.hubCode}</span></Badge>}
                {e.fromStatus && e.fromStatus !== e.toStatus && (
                  <span className="text-caption text-text-muted">
                    {status(e.fromStatus)} → {status(e.toStatus)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-caption text-text-muted">
                {dateTime(e.createdAt)}
                {e.userName && ` · ${e.userName}`}
              </div>
              {e.note && <div className="mt-1 text-body-sm">{e.note}</div>}
            </li>
          ))}
        </ol>
      </Card>

      {d.runItems.length > 0 && (
        <Card title={t('Courier runs')}>
          <Table head={[t('Run'), t('Date'), t('Type'), t('Result'), t('Reason'), t('Cash'), t('Received by'), t('Time')]}>
            {d.runItems.map((r) => (
              <tr key={r.id}>
                <Td className="ltr-iso font-bold">{r.run.code}</Td>
                <Td>{shortDate(r.run.date)}</Td>
                <Td>{r.direction === 'RETURN' ? t('Return') : t('Delivery')}</Td>
                <Td>
                  <Badge tone={r.result === 'FAILED' ? 'red' : r.result === 'PENDING' ? 'amber' : 'green'}>
                    {t({ FAILED: 'Failed', PENDING: 'Pending', DELIVERED: 'Delivered', RETURNED: 'Returned' }[r.result] ?? r.result)}
                  </Badge>
                </Td>
                <Td>{reasonLabel(r.failReason)}</Td>
                <Td className="tabular ltr-iso">{egp(r.codCollected)}</Td>
                <Td>{r.recipient}</Td>
                <Td className="text-text-muted">{dateTime(r.resolvedAt)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
