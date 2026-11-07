'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FAIL_REASONS } from '@shiply/shared';
import { Alert, Button, Card, Field, Input, Loading, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, egp, shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { eventText } from '../events';
import { useLocations } from '../locations';

interface Event {
  id: string;
  type: string;
  toStatus: string;
  note: string;
  createdAt: string;
}
interface Parcel {
  id: string;
  trackingNumber: string;
  merchantRef: string;
  customerName: string;
  customerPhone: string;
  address: string;
  governorateCode: string;
  areaId: string | null;
  size: string;
  description: string;
  notes: string;
  allowOpen: boolean;
  codAmount: number;
  status: string;
  direction: string;
  attempts: number;
  holdReason: string | null;
  lastFailReason: string | null;
  promisedDate: string | null;
  shippingFee: number;
  codFee: number;
  returnFee: number;
  codCollected: number;
  payoutId: string | null;
  createdAt: string;
  events: Event[];
}

const reasonLabel = (code: string | null) => (code ? (FAIL_REASONS as Record<string, { label: string }>)[code]?.label ?? code : '');

export default function ParcelPage() {
  const { id } = useParams<{ id: string }>();
  const { data: p, error, loading, reload } = useLoad<Parcel>(`/merchant/shipments/${id}`);
  const { data: govs } = useLocations();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (loading && !p) return <Loading />;
  if (error || !p) return <Alert>{error ?? 'Parcel not found'}</Alert>;

  const gov = govs?.find((g) => g.code === p.governorateCode);
  const area = gov?.areas.find((a) => a.id === p.areaId);
  const canReturn = p.direction === 'FORWARD' && ['PICKED_UP', 'AT_HUB', 'IN_TRANSIT', 'ON_HOLD'].includes(p.status);

  const act = async (path: string, body: unknown, message: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setActionError(null);
    setDone(null);
    try {
      await api(`/merchant/shipments/${p.id}/${path}`, { body });
      setDone(message);
      await reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const fees =
    p.status === 'RETURNED' ? p.shippingFee + p.returnFee : p.status === 'DELIVERED' ? p.shippingFee + p.codFee : p.shippingFee + p.codFee;

  return (
    <div className="space-y-5">
      <PageHeader
        title={p.trackingNumber}
        subtitle={<>Created {dateTime(p.createdAt)}{p.merchantRef ? ` · Your ref ${p.merchantRef}` : ''}</>}
        actions={
          <>
            <a href={`/labels?ids=${p.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
              Print label
            </a>
            <Link href="/merchant" className="inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50">Back</Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={p.status} direction={p.direction} />
        {p.promisedDate && p.direction === 'FORWARD' && <span className="text-sm text-slate-600">Promised for {shortDate(p.promisedDate)}</span>}
        {p.attempts > 0 && <span className="text-sm text-slate-600">{p.attempts} failed attempt{p.attempts > 1 ? 's' : ''}</span>}
      </div>

      {done && <Alert tone="success">{done}</Alert>}
      {actionError && <Alert>{actionError}</Alert>}

      {p.status === 'ON_HOLD' && p.direction === 'FORWARD' && (
        <DecisionPanel parcel={p} busy={busy} govs={govs ?? []} onDecide={(body, msg) => act('decision', body, msg)} />
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Customer" className="lg:col-span-2">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Item label="Name">{p.customerName}</Item>
            <Item label="Mobile"><a href={`tel:${p.customerPhone}`} className="text-brand-700">{p.customerPhone}</a></Item>
            <Item label="Address" wide>{p.address}</Item>
            <Item label="Governorate">{gov?.nameEn ?? p.governorateCode}{area ? ` · ${area.nameEn}` : ''}</Item>
            <Item label="Size">{p.size}</Item>
            {p.description && <Item label="Contents">{p.description}</Item>}
            <Item label="Opening allowed">{p.allowOpen ? 'Yes' : 'No'}</Item>
            {p.notes && <Item label="Notes" wide>{p.notes}</Item>}
          </dl>
        </Card>
        <Card title="Money">
          <dl className="space-y-2 text-sm">
            <Row label="Cash to collect">{egp(p.codAmount)}</Row>
            {p.status === 'DELIVERED' && <Row label="Collected">{egp(p.codCollected)}</Row>}
            <Row label="Shipping fee">{egp(p.shippingFee)}</Row>
            {p.status !== 'RETURNED' && p.codFee > 0 && <Row label="COD fee">{egp(p.codFee)}</Row>}
            {p.status === 'RETURNED' && <Row label="Return fee">{egp(p.returnFee)}</Row>}
            <Row label="Total fees" strong>{egp(fees)}</Row>
            {p.payoutId && <p className="pt-2 text-xs text-emerald-700">Settled in a payout</p>}
          </dl>
        </Card>
      </div>

      {(p.status === 'CREATED' || canReturn) && p.status !== 'ON_HOLD' && (
        <Card title="Actions">
          <div className="flex flex-wrap gap-2">
            {p.status === 'CREATED' && (
              <Button tone="danger" disabled={busy} onClick={() => act('cancel', {}, 'Parcel cancelled', 'Cancel this parcel? This cannot be undone.')}>
                Cancel parcel
              </Button>
            )}
            {canReturn && (
              <Button tone="secondary" disabled={busy} onClick={() => act('decision', { decision: 'RETURN' }, 'The parcel is coming back to you', 'Bring this parcel back to you instead of delivering it? A return fee applies.')}>
                Return to me
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card title="History">
        <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
          {[...p.events].reverse().map((e, i) => (
            <li key={e.id} className="relative">
              <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ${i === 0 ? 'bg-brand-600' : 'bg-slate-300'}`} />
              <div className="text-sm font-medium text-slate-900">{eventText(e.type)}</div>
              {e.note && <div className="text-sm text-slate-600">{e.note}</div>}
              <div className="text-xs text-slate-500">{dateTime(e.createdAt)}</div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function DecisionPanel({
  parcel,
  busy,
  govs,
  onDecide,
}: {
  parcel: Parcel;
  busy: boolean;
  govs: { code: string; nameEn: string; served: boolean; areas: { id: string; nameEn: string }[] }[];
  onDecide: (body: unknown, message: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [governorateCode, setGovernorateCode] = useState('');
  const [areaId, setAreaId] = useState('');
  const [note, setNote] = useState('');
  const gov = govs.find((g) => g.code === (governorateCode || parcel.governorateCode));

  const tryAgain = () => {
    const body: Record<string, unknown> = { decision: 'REATTEMPT', note };
    if (phone.trim()) body.customerPhone = phone.trim();
    if (address.trim()) body.address = address.trim();
    if (governorateCode) {
      body.governorateCode = governorateCode;
      body.areaId = areaId || null;
    } else if (areaId) body.areaId = areaId;
    onDecide(body, 'We will try to deliver it again');
  };

  return (
    <Card title="Your decision is needed" className="ring-2 ring-amber-300">
      <p className="mb-4 text-sm text-slate-700">
        The courier could not deliver this parcel: <strong>{reasonLabel(parcel.holdReason ?? parcel.lastFailReason)}</strong>. It is waiting at our hub. Fix the details and try again, or bring it back to you.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Correct mobile" hint={`Now ${parcel.customerPhone}`}>
          <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Governorate" hint="Only if it changed">
          <Select value={governorateCode} onChange={(e) => { setGovernorateCode(e.target.value); setAreaId(''); }}>
            <option value="">Keep {parcel.governorateCode}</option>
            {govs.map((g) => (
              <option key={g.code} value={g.code} disabled={!g.served}>{g.nameEn}</option>
            ))}
          </Select>
        </Field>
        <Field label="Area">
          <Select value={areaId} onChange={(e) => setAreaId(e.target.value)} disabled={!gov || gov.areas.length === 0}>
            <option value="">{governorateCode ? 'Any area' : 'Keep current area'}</option>
            {gov?.areas.map((a) => (
              <option key={a.id} value={a.id}>{a.nameEn}</option>
            ))}
          </Select>
        </Field>
        <Field label="Note for the courier">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="Correct address" className="sm:col-span-2" hint="Leave empty to keep it">
          <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={parcel.address} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={tryAgain}>Try again</Button>
        <Button tone="secondary" disabled={busy} onClick={() => onDecide({ decision: 'RETURN', note }, 'The parcel is coming back to you')}>
          Return to me
        </Button>
      </div>
    </Card>
  );
}

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-900">{children}</dd>
    </div>
  );
}

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-slate-200 pt-2 font-semibold' : ''}`}>
      <dt className="text-slate-600">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
