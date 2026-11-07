'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FAIL_REASONS, isTerminal, type ShipmentStatus } from '@shiply/shared';
import { Alert, Badge, Button, Card, Loading, PageHeader, StatusBadge, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, egp, shortDate, statusLabel } from '@/lib/format';
import { useLoad } from '@/lib/hooks';

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
  next: { kind: string; hubCode?: string; hubName?: string; reason?: string | null };
  events: { id: string; type: string; fromStatus: string | null; toStatus: string; hubCode: string | null; userName: string | null; note: string; createdAt: string }[];
  runItems: { id: string; direction: string; result: string; failReason: string | null; codCollected: number; recipient: string; resolvedAt: string | null; run: { code: string; date: string } }[];
}

function reasonLabel(code: string | null): string {
  if (!code) return '';
  return (FAIL_REASONS as Record<string, { label: string }>)[code]?.label ?? code.replace(/_/g, ' ').toLowerCase();
}

function nextText(d: Detail): string {
  switch (d.next.kind) {
    case 'SEND':
      return `Sort into a bag for ${d.next.hubName} (${d.next.hubCode})`;
    case 'DELIVER':
      return 'Ready to go out on a delivery run';
    case 'RETURN_TO_MERCHANT':
      return 'Ready to go back to the merchant on a run';
    case 'HOLD':
      return `Waiting for the merchant: ${reasonLabel(d.next.reason ?? null)}`;
    default:
      return isTerminal(d.status as ShipmentStatus) ? 'Closed' : 'Moving; nothing to do in a hub right now';
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{children}</span>
    </div>
  );
}

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: d, error, loading, reload } = useLoad<Detail>(`/admin/shipments/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !d) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!d) return null;

  const hub = (hubId: string | null) => (hubId ? d.hubCodes[hubId] ?? '' : '');
  const canMarkLost = !isTerminal(d.status as ShipmentStatus) && d.status !== 'LOST';

  const markLost = async () => {
    const note = window.prompt(`Mark ${d.trackingNumber} as lost? Write what happened.`);
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
      <div className="text-sm">
        <Link href="/admin/shipments" className="text-brand-700">← Parcels</Link>
      </div>
      <PageHeader
        title={d.trackingNumber}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} direction={d.direction} />
            {d.direction === 'RETURN' && <Badge tone="red">Return to merchant</Badge>}
            {d.payoutId && <Badge tone="green">Paid out</Badge>}
          </span>
        }
        actions={canMarkLost && <Button tone="danger" disabled={busy} onClick={markLost}>Mark lost</Button>}
      />
      {actionError && <Alert>{actionError}</Alert>}
      <Alert tone="info">
        <span className="font-semibold">Next step:</span> {nextText(d)}
      </Alert>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Customer">
          <Row label="Name">{d.customerName}</Row>
          <Row label="Phone">{d.customerPhone}</Row>
          <Row label="Address">{d.address}</Row>
          <Row label="Governorate">{d.governorateCode}</Row>
          <Row label="Can open parcel">{d.allowOpen ? 'Yes' : 'No'}</Row>
          {d.notes && <Row label="Notes">{d.notes}</Row>}
        </Card>
        <Card title="Parcel">
          <Row label="Merchant">{d.merchant.name}</Row>
          {d.merchantRef && <Row label="Merchant ref">{d.merchantRef}</Row>}
          <Row label="Size">{d.size}</Row>
          {d.description && <Row label="Contents">{d.description}</Row>}
          <Row label="Route">
            {hub(d.originHubId)} → {hub(d.destinationHubId)}
          </Row>
          <Row label="Now at">{hub(d.currentHubId) || statusLabel(d.status, d.direction)}</Row>
          <Row label="Promised">{shortDate(d.promisedDate) || 'Set when it enters the network'}</Row>
          <Row label="Attempts">
            {d.attempts}
            {d.lastFailReason && <span className="ml-1 text-slate-500">({reasonLabel(d.lastFailReason)})</span>}
          </Row>
          <Row label="Created">{dateTime(d.createdAt)}</Row>
          {d.deliveredAt && <Row label="Delivered">{dateTime(d.deliveredAt)}</Row>}
        </Card>
        <Card title="Money">
          <Row label="COD to collect">{egp(d.codAmount)}</Row>
          <Row label="COD collected">{egp(d.codCollected)}</Row>
          <Row label="Shipping fee">{egp(d.shippingFee)}</Row>
          <Row label="COD fee">{egp(d.codFee)}</Row>
          <Row label="Return fee">{egp(d.returnFee)}</Row>
        </Card>
      </div>

      <Card title="Timeline">
        <ol className="relative space-y-4 border-l border-slate-200 pl-5">
          {d.events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full bg-brand-500 ring-4 ring-white" />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{e.type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>
                {e.fromStatus && e.fromStatus !== e.toStatus && (
                  <span className="text-xs text-slate-500">
                    {statusLabel(e.fromStatus)} → {statusLabel(e.toStatus)}
                  </span>
                )}
                {e.hubCode && <Badge>{e.hubCode}</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {dateTime(e.createdAt)}
                {e.userName && ` · ${e.userName}`}
              </div>
              {e.note && <div className="mt-1 text-sm text-slate-700">{e.note}</div>}
            </li>
          ))}
        </ol>
      </Card>

      {d.runItems.length > 0 && (
        <Card title="Courier runs">
          <Table head={['Run', 'Date', 'Type', 'Result', 'Reason', 'Cash', 'Received by', 'Time']}>
            {d.runItems.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono">{r.run.code}</Td>
                <Td>{shortDate(r.run.date)}</Td>
                <Td>{r.direction === 'RETURN' ? 'Return' : 'Delivery'}</Td>
                <Td>
                  <Badge tone={r.result === 'FAILED' ? 'red' : r.result === 'PENDING' ? 'amber' : 'green'}>{r.result.toLowerCase()}</Badge>
                </Td>
                <Td>{reasonLabel(r.failReason)}</Td>
                <Td className="tabular-nums">{egp(r.codCollected)}</Td>
                <Td>{r.recipient}</Td>
                <Td className="text-slate-500">{dateTime(r.resolvedAt)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
