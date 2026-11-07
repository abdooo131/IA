'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Alert, Button, Card, Field, Input, Loading, PageHeader, Select, StatusBadge, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, egp, shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useLocale, useT } from '@/lib/i18n';
import { eventText } from '../events';
import { useLocations, type Governorate } from '../locations';
import { useReasonText } from '../text';

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

const RETURNABLE = ['PICKED_UP', 'AT_INBOUND', 'SORTED', 'AT_OUTBOUND', 'IN_TRANSIT', 'AT_HUB', 'ON_HOLD'];

export default function ParcelPage() {
  const t = useT();
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const { data: p, error, loading, reload } = useLoad<Parcel>(`/merchant/shipments/${id}`);
  const { data: govs } = useLocations();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (loading && !p) return <Loading />;
  if (error || !p) return <Alert>{error ?? t('Parcel not found')}</Alert>;

  const gov = govs?.find((g) => g.code === p.governorateCode);
  const area = gov?.areas.find((a) => a.id === p.areaId);
  const canReturn = p.direction === 'FORWARD' && RETURNABLE.includes(p.status);
  const name = (x: { nameEn: string; nameAr: string } | undefined) => (x ? (locale === 'ar' ? x.nameAr : x.nameEn) : '');

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

  const fees = p.status === 'RETURNED' ? p.shippingFee + p.returnFee : p.shippingFee + p.codFee;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Parcel')}
        title={p.trackingNumber}
        subtitle={
          <>
            {t('Created')} <span className="ltr-iso">{dateTime(p.createdAt)}</span>
            {p.merchantRef ? (
              <>
                {' · '}
                {t('Your ref')} {p.merchantRef}
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <a href={`/labels?ids=${p.id}`} target="_blank" rel="noreferrer" className="btn-secondary">
              <Icon name="print" size={18} />
              {t('Print label')}
            </a>
            <Link href="/merchant" className="btn-ghost">{t('Back')}</Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={p.status} direction={p.direction} />
        {p.promisedDate && p.direction === 'FORWARD' && (
          <span className="text-body-sm text-text-muted">
            {t('Promised for')} <span className="ltr-iso font-bold text-text">{shortDate(p.promisedDate)}</span>
          </span>
        )}
        {p.attempts > 0 && <span className="text-body-sm text-text-muted">{t('{n} failed attempts', { n: p.attempts })}</span>}
      </div>

      {done && <Alert tone="success">{done}</Alert>}
      {actionError && <Alert>{actionError}</Alert>}

      {p.status === 'ON_HOLD' && p.direction === 'FORWARD' && (
        <DecisionPanel parcel={p} busy={busy} govs={govs ?? []} onDecide={(body, msg) => act('decision', body, msg)} />
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={t('Customer')} className="lg:col-span-2">
          <dl className="grid gap-4 text-body-sm sm:grid-cols-2">
            <Item label={t('Name')}>{p.customerName}</Item>
            <Item label={t('Mobile')}><a href={`tel:${p.customerPhone}`} className="ltr-iso text-link">{p.customerPhone}</a></Item>
            <Item label={t('Address')} wide>{p.address}</Item>
            <Item label={t('Governorate')}>{name(gov) || p.governorateCode}{area ? ` · ${name(area)}` : ''}</Item>
            <Item label={t('Size')}>{p.size}</Item>
            {p.description && <Item label={t('Contents')}>{p.description}</Item>}
            <Item label={t('Opening allowed')}>{p.allowOpen ? t('Yes') : t('No')}</Item>
            {p.notes && <Item label={t('Notes')} wide>{p.notes}</Item>}
          </dl>
        </Card>
        <Card title={t('Money')}>
          <dl className="space-y-2 text-body-sm">
            <Row label={t('Cash to collect')}>{egp(p.codAmount)}</Row>
            {p.status === 'DELIVERED' && <Row label={t('Collected')}>{egp(p.codCollected)}</Row>}
            <Row label={t('Shipping fee')}>{egp(p.shippingFee)}</Row>
            {p.status !== 'RETURNED' && p.codFee > 0 && <Row label={t('COD fee')}>{egp(p.codFee)}</Row>}
            {p.status === 'RETURNED' && <Row label={t('Return fee')}>{egp(p.returnFee)}</Row>}
            <Row label={t('Total fees')} strong>{egp(fees)}</Row>
            {p.payoutId && <p className="pt-2 text-caption font-bold text-status-delivered">{t('Settled in a payout')}</p>}
          </dl>
        </Card>
      </div>

      {(p.status === 'CREATED' || canReturn) && p.status !== 'ON_HOLD' && (
        <Card title={t('Actions')}>
          <div className="flex flex-wrap gap-2">
            {p.status === 'CREATED' && (
              <Button tone="danger" disabled={busy} onClick={() => act('cancel', {}, t('Parcel cancelled'), t('Cancel this parcel? This cannot be undone.'))}>
                {t('Cancel parcel')}
              </Button>
            )}
            {canReturn && (
              <Button
                tone="secondary"
                disabled={busy}
                onClick={() => act('decision', { decision: 'RETURN' }, t('The parcel is coming back to you'), t('Bring this parcel back to you instead of delivering it? A return fee applies.'))}
              >
                <Icon name="returns" size={18} />
                {t('Return to me')}
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card title={t('History')}>
        <ol className="relative space-y-5 border-s-2 border-line ps-6">
          {[...p.events].reverse().map((e, i) => (
            <li key={e.id} className="relative">
              <span
                aria-hidden="true"
                className={`absolute -start-[31px] top-1 h-3.5 w-3.5 rounded-pill ring-4 ring-surface ${i === 0 ? 'bg-primary' : 'bg-line-strong'}`}
              />
              <div className={`text-body-sm ${i === 0 ? 'font-bold' : 'font-semibold'}`}>{eventText(e.type, locale)}</div>
              {e.note && <div className="text-body-sm text-text-muted">{e.note}</div>}
              <div className="ltr-iso text-caption text-text-muted">{dateTime(e.createdAt)}</div>
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
  govs: Governorate[];
  onDecide: (body: unknown, message: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const reasonText = useReasonText();
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [governorateCode, setGovernorateCode] = useState('');
  const [areaId, setAreaId] = useState('');
  const [note, setNote] = useState('');
  const gov = govs.find((g) => g.code === (governorateCode || parcel.governorateCode));
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);

  const tryAgain = () => {
    const body: Record<string, unknown> = { decision: 'REATTEMPT', note };
    if (phone.trim()) body.customerPhone = phone.trim();
    if (address.trim()) body.address = address.trim();
    if (governorateCode) {
      body.governorateCode = governorateCode;
      body.areaId = areaId || null;
    } else if (areaId) body.areaId = areaId;
    onDecide(body, t('We will try to deliver it again'));
  };

  return (
    <section className="rounded-xl border-2 border-accent bg-surface p-4 shadow-md sm:p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-pill bg-accent text-on-accent">
          <Icon name="alert" size={22} />
        </span>
        <h2 className="text-h3">{t('Your decision is needed')}</h2>
      </div>
      <p className="mb-4 text-body-sm">
        {t('The courier could not deliver this parcel:')} <strong>{reasonText(parcel.holdReason ?? parcel.lastFailReason)}</strong>.{' '}
        {t('It is waiting at our hub. Fix the details and try again, or bring it back to you.')}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Correct mobile')} hint={t('Now {phone}', { phone: parcel.customerPhone })}>
          <Input inputMode="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={t('Governorate')} hint={t('Only if it changed')}>
          <Select value={governorateCode} onChange={(e) => { setGovernorateCode(e.target.value); setAreaId(''); }}>
            <option value="">{t('Keep {code}', { code: parcel.governorateCode })}</option>
            {govs.map((g) => (
              <option key={g.code} value={g.code} disabled={!g.served}>{name(g)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('Area')}>
          <Select value={areaId} onChange={(e) => setAreaId(e.target.value)} disabled={!gov || gov.areas.length === 0}>
            <option value="">{governorateCode ? t('Any area') : t('Keep current area')}</option>
            {gov?.areas.map((a) => (
              <option key={a.id} value={a.id}>{name(a)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('Note for the courier')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label={t('Correct address')} className="sm:col-span-2" hint={t('Leave empty to keep it')}>
          <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={parcel.address} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button tone="accent" disabled={busy} onClick={tryAgain}>{t('Try again')}</Button>
        <Button tone="secondary" disabled={busy} onClick={() => onDecide({ decision: 'RETURN', note }, t('The parcel is coming back to you'))}>
          <Icon name="returns" size={18} />
          {t('Return to me')}
        </Button>
      </div>
    </section>
  );
}

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-label uppercase text-text-muted">{label}</dt>
      <dd className="mt-1 break-words">{children}</dd>
    </div>
  );
}

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-line pt-2 font-bold' : ''}`}>
      <dt className="text-text-muted">{label}</dt>
      <dd className="tabular ltr-iso">{children}</dd>
    </div>
  );
}
