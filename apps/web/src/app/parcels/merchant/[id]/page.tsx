'use client';
import { RouteChain } from '@/parcels/components/RouteChain';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/parcels/components/Icon';
import { StatusBar } from '@/parcels/components/StatusBar';
import {
  CashCycle,
  Field as InfoField,
  FeeLines,
  Fields,
  OrderColumns,
  OrderTabs,
  Section,
  SideBox,
  SideCard,
  Stars,
  StateBanner,
  Tag,
  type BannerTone,
} from '@/components/orders/page/OrderLayout';
import {
  Alert,
  Button,
  Field,
  Input,
  Loading,
  Select,
  StatusBadge,
  Textarea,
} from '@/parcels/components/ui';
import { api, errorMessage } from '@/parcels/lib/api';
import { dateTime, egp, shortDate } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useLocale, useT } from '@/parcels/lib/i18n';
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
  route?: string[];
  direction: string;
  attempts: number;
  holdReason: string | null;
  lastFailReason: string | null;
  promisedDate: string | null;
  shippingFee: number;
  codFee: number;
  basePrice: number;
  discount: number;
  openFee: number;
  exchangeFee: number;
  kind: string;
  deliverOn: string | null;
  customerNote: string;
  rating: number | null;
  returnFee: number;
  codCollected: number;
  payoutId: string | null;
  declaredValue: number;
  routeZone: string | null;
  payoutSchedule: string;
  payout:
    | { status: 'paid'; number: number; reference: string | null; paidAt: string | null }
    | { status: 'draft'; number: number }
    | { status: 'next'; day: string }
    | null;
  createdAt: string;
  events: Event[];
}

const RETURNABLE = [
  'PICKED_UP',
  'AT_INBOUND',
  'SORTED',
  'AT_OUTBOUND',
  'IN_TRANSIT',
  'AT_HUB',
  'ON_HOLD',
];

const ZONE_NAMES: Record<string, string> = {
  SAME: 'Same governorate',
  GC: 'Greater Cairo',
  ALX: 'Alexandria',
  DELTA: 'Delta',
  CANAL: 'Canal and Suez',
  UPPER: 'Upper Egypt',
  REMOTE: 'Remote areas',
};

const SCHEDULES: Record<string, string> = {
  daily: 'Every day',
  twice_weekly: 'Twice a week (Sunday and Wednesday)',
  weekly: 'Once a week (Sunday)',
};

/** "Sunday 9 Nov" for a YYYY-MM-DD day. */
function dayName(day: string, locale: string) {
  return new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString(
    locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB',
    { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' },
  );
}

/**
 * A next day parcel, laid out like the 60 minute order page (owner, 2026-11-08): header with
 * actions, two tabs (details and tracking), one banner in the state's colour, the sections on the
 * wide side, and money with the payout cycle on the narrow side.
 */
export default function ParcelPage() {
  const t = useT();
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const tab = search.get('tab') === 'tracking' ? 'tracking' : 'details';
  const { data: p, error, loading, reload } = useLoad<Parcel>(`/merchant/shipments/${id}`);
  const { data: govs } = useLocations();
  const reasonText = useReasonText();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (loading && !p) return <Loading />;
  if (error || !p) return <Alert>{error ?? t('Parcel not found')}</Alert>;

  const gov = govs?.find((g) => g.code === p.governorateCode);
  const area = gov?.areas.find((a) => a.id === p.areaId);
  const canReturn = p.direction === 'FORWARD' && RETURNABLE.includes(p.status);
  const name = (x: { nameEn: string; nameAr: string } | undefined) =>
    x ? (locale === 'ar' ? x.nameAr : x.nameEn) : '';
  const deliveredAt = [...p.events].reverse().find((e) => e.toStatus === 'DELIVERED')?.createdAt;
  const returnedAt = [...p.events].reverse().find((e) => e.toStatus === 'RETURNED')?.createdAt;

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

  const comingBack = p.direction === 'RETURN' || p.status === 'RETURNED';
  const fees = comingBack ? p.shippingFee + p.returnFee : p.shippingFee + p.codFee;
  const feeLines = [
    ...(p.basePrice > 0 ? [{ label: t('List price'), value: egp(p.basePrice) }] : []),
    ...(p.discount > 0 ? [{ label: t('Discount'), value: egp(-p.discount) }] : []),
    ...(p.openFee > 0 ? [{ label: t('Open package fee'), value: egp(p.openFee) }] : []),
    ...(p.exchangeFee > 0 ? [{ label: t('Exchange'), value: egp(p.exchangeFee) }] : []),
    { label: t('Shipping fee'), value: egp(p.shippingFee) },
    ...(!comingBack && p.codFee > 0 ? [{ label: t('COD fee'), value: egp(p.codFee) }] : []),
    ...(p.status === 'RETURNED' ? [{ label: t('Return fee'), value: egp(p.returnFee) }] : []),
  ];
  // Fees are booked only when the parcel is delivered or comes back.
  const charged = p.status === 'DELIVERED' || p.status === 'RETURNED';

  // One banner: where the parcel is, and what comes next.
  const banner: { tone: BannerTone; text: string; next?: string } =
    p.status === 'DELIVERED'
      ? {
          tone: 'success',
          text: t('Your parcel was delivered to the customer on {time}', {
            time: deliveredAt ? dateTime(deliveredAt) : '',
          }),
        }
      : p.status === 'RETURNED'
        ? {
            tone: 'info',
            text: t('The parcel came back to you on {time}', {
              time: returnedAt ? dateTime(returnedAt) : '',
            }),
          }
        : p.status === 'CANCELLED'
          ? { tone: 'danger', text: t('This parcel was cancelled') }
          : p.status === 'ON_HOLD'
            ? {
                tone: 'warning',
                text: t('The courier could not deliver this parcel: {reason}', {
                  reason: reasonText(p.holdReason ?? p.lastFailReason),
                }),
                next: t('Your decision is needed: try again or bring it back to you'),
              }
            : p.status === 'ATTEMPT_FAILED'
              ? {
                  tone: 'warning',
                  text: t('The courier could not deliver this parcel: {reason}', {
                    reason: reasonText(p.lastFailReason),
                  }),
                  next: t('It comes back to the hub with the courier; then you decide what to do'),
                }
              : p.status === 'LOST'
                ? {
                    tone: 'warning',
                    text: t('We lost track of this parcel and are searching for it'),
                  }
                : p.status === 'CREATED'
                  ? {
                      tone: 'info',
                      text: t('The parcel is waiting for our courier to pick it up'),
                    }
                  : {
                      tone: 'info',
                      text:
                        p.direction === 'RETURN'
                          ? t('The parcel is on its way back to you')
                          : t('The parcel is on its way through our network'),
                      next:
                        p.promisedDate && p.direction === 'FORWARD'
                          ? t('It should reach the customer on {date}', {
                              date: shortDate(p.promisedDate),
                            })
                          : undefined,
                    };

  const payout = p.payout;
  const payoutNumber =
    payout && payout.status !== 'next' ? `PAY-${String(payout.number).padStart(6, '0')}` : '';

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-h2">
              {t(p.direction === 'RETURN' ? 'Return' : 'Deliver')}{' '}
              <span className="ltr-iso">{p.trackingNumber}</span>
            </h1>
            <StatusBadge status={p.status} direction={p.direction} />
            {p.attempts > 0 && (
              <Tag tone="needs-action">{t('{n} failed attempts', { n: p.attempts })}</Tag>
            )}
          </div>
          <p className="text-body-sm text-text-muted">
            {t('Created')} <span className="ltr-iso">{dateTime(p.createdAt)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {p.status === 'CREATED' && (
            <Button
              tone="secondary"
              disabled={busy}
              onClick={() =>
                act(
                  'cancel',
                  {},
                  t('Parcel cancelled'),
                  t('Cancel this parcel? This cannot be undone.'),
                )
              }
            >
              {t('Cancel parcel')}
            </Button>
          )}
          {canReturn && p.status !== 'ON_HOLD' && (
            <Button
              tone="secondary"
              disabled={busy}
              onClick={() =>
                act(
                  'decision',
                  { decision: 'RETURN' },
                  t('The parcel is coming back to you'),
                  t(
                    'Bring this parcel back to you instead of delivering it? A return fee applies.',
                  ),
                )
              }
            >
              <Icon name="returns" size={18} />
              {t('Return to me')}
            </Button>
          )}
          <a
            href={`/parcels/labels?ids=${p.id}`}
            target="_blank"
            rel="noreferrer"
            className="btn-primary"
          >
            <Icon name="print" size={18} />
            {t('Print label')}
          </a>
        </div>
      </header>

      <OrderTabs
        tabs={[
          { href: '?', label: t('Parcel details'), active: tab === 'details' },
          { href: '?tab=tracking', label: t('Parcel tracking'), active: tab === 'tracking' },
        ]}
      />

      {done && <Alert tone="success">{done}</Alert>}
      {actionError && <Alert>{actionError}</Alert>}

      {tab === 'tracking' ? (
        <div className="space-y-4">
          <StatusBar
            flow={p.direction === 'RETURN' ? 'returnParcel' : 'parcel'}
            status={p.status}
          />
          {p.route?.length ? (
            <Section title={t('Its way through our network')}>
              <div className="px-4 py-3">
                <RouteChain route={p.route} done={['DELIVERED', 'RETURNED'].includes(p.status)} />
              </div>
            </Section>
          ) : null}
          <Section title={t('History')}>
            <ol className="relative mx-4 my-4 space-y-5 border-s-2 border-line ps-6">
              {[...p.events].reverse().map((e, i) => (
                <li key={e.id} className="relative">
                  <span
                    aria-hidden="true"
                    className={`absolute -start-[31px] top-1 h-3.5 w-3.5 rounded-pill ring-4 ring-surface ${i === 0 ? 'bg-primary' : 'bg-line-strong'}`}
                  />
                  <div className={`text-body-sm ${i === 0 ? 'font-bold' : 'font-semibold'}`}>
                    {eventText(e.type, locale)}
                  </div>
                  {e.note && <div className="text-body-sm text-text-muted">{e.note}</div>}
                  <div className="ltr-iso text-caption text-text-muted">
                    {dateTime(e.createdAt)}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      ) : (
        <div className="space-y-4">
          <StateBanner tone={banner.tone} text={banner.text} next={banner.next} />
          <OrderColumns
            main={
              <>
                {p.status === 'ON_HOLD' && p.direction === 'FORWARD' && (
                  <DecisionPanel
                    parcel={p}
                    busy={busy}
                    govs={govs ?? []}
                    onDecide={(body, msg) => act('decision', body, msg)}
                  />
                )}
                <Section title={t('Operation details')}>
                  <Fields>
                    <InfoField label={t('Delivery attempts')}>
                      {p.attempts > 0
                        ? t('{n} failed attempts', { n: p.attempts })
                        : t('No failed attempts')}
                    </InfoField>
                    <InfoField label={t('Expected delivery')}>
                      {p.promisedDate ? (
                        <span className="ltr-iso">{shortDate(p.promisedDate)}</span>
                      ) : (
                        '–'
                      )}
                    </InfoField>
                  </Fields>
                  <Fields>
                    <InfoField label={t('Delivery confirmed')}>
                      {deliveredAt ? (
                        <span className="ltr-iso">{dateTime(deliveredAt)}</span>
                      ) : (
                        <span className="text-text-muted">{t('Not delivered yet')}</span>
                      )}
                    </InfoField>
                    <InfoField label={t('Customer asked for delivery on')}>
                      {p.deliverOn ? <span className="ltr-iso">{p.deliverOn}</span> : '–'}
                    </InfoField>
                  </Fields>
                  <Fields>
                    <InfoField label={t('Customer rating')}>
                      {p.rating ? (
                        <Stars stars={p.rating} label={t('Rated {n} of 5', { n: p.rating })} />
                      ) : (
                        <span className="text-text-muted">{t('Not rated yet')}</span>
                      )}
                    </InfoField>
                    <InfoField label={t('Customer comment')}>
                      {p.customerNote || <span className="text-text-muted">{t('No comment')}</span>}
                    </InfoField>
                  </Fields>
                </Section>
                <Section title={t('Consignee details')}>
                  <Fields>
                    <InfoField label={t('Full name')}>
                      <span className="font-semibold">{p.customerName}</span>
                    </InfoField>
                    <InfoField label={t('Phone number')}>
                      <a href={`tel:${p.customerPhone}`} className="ltr-iso text-link">
                        {p.customerPhone}
                      </a>
                    </InfoField>
                  </Fields>
                  <Fields>
                    <InfoField label={t('Detailed address')} wide>
                      {p.address}
                    </InfoField>
                  </Fields>
                  <Fields>
                    <InfoField label={t('Governorate')}>{name(gov) || p.governorateCode}</InfoField>
                    <InfoField label={t('Area')}>{area ? name(area) : '–'}</InfoField>
                  </Fields>
                </Section>
                <Section title={t('Shipment details')}>
                  <Fields>
                    <InfoField label={t('Shipment type')}>
                      {t('Next day')} · {t('Size')} {p.size}
                    </InfoField>
                    <InfoField label={t('Kind')}>
                      {t(
                        p.kind === 'EXCHANGE'
                          ? 'Exchange'
                          : p.direction === 'RETURN'
                            ? 'Return'
                            : 'Deliver',
                      )}
                    </InfoField>
                  </Fields>
                  <Fields>
                    <InfoField label={t('Product description')} wide>
                      {p.description || '–'}
                    </InfoField>
                  </Fields>
                </Section>
                <Section title={t('Additional details')}>
                  <Fields>
                    <InfoField label={t('Order reference')}>
                      {p.merchantRef ? <span className="ltr-iso">{p.merchantRef}</span> : '–'}
                    </InfoField>
                    <InfoField label={t('Tracking number')}>
                      <span className="ltr-iso">{p.trackingNumber}</span>
                    </InfoField>
                  </Fields>
                  <Fields>
                    <InfoField label={t('Delivery notes')} wide>
                      {p.notes || '–'}
                    </InfoField>
                  </Fields>
                </Section>
              </>
            }
            side={
              <>
                <SideCard>
                  <SideBox
                    label={t('Collection amount')}
                    value={
                      <span className="ltr-iso">
                        {egp(p.codAmount)}
                        {p.status === 'DELIVERED'
                          ? ` · ${t('Collected')} ${egp(p.codCollected)}`
                          : ''}
                      </span>
                    }
                  />
                  <SideBox
                    label={t('Allow customer to open the parcel')}
                    value={p.allowOpen ? t('Yes') : t('No')}
                  />
                  <SideBox
                    label={t('Product value')}
                    value={
                      <span className="ltr-iso">
                        {p.declaredValue > 0 ? egp(p.declaredValue) : t('Not declared')}
                      </span>
                    }
                  />
                  {p.routeZone && (
                    <SideBox
                      label={t('Route zone')}
                      value={`${t(ZONE_NAMES[p.routeZone] ?? p.routeZone)} · ${t('Size')} ${p.size}`}
                    />
                  )}
                  <FeeLines
                    lines={feeLines}
                    total={{
                      label: charged
                        ? t('Total fees')
                        : comingBack
                          ? t('Fees when it reaches you')
                          : t('Fees when delivered'),
                      value: egp(fees),
                    }}
                  />
                  {!charged && (
                    <p className="px-1 text-caption text-text-muted">
                      {comingBack
                        ? t('The return fee is charged when the parcel reaches you')
                        : t('Nothing is charged until the parcel is delivered')}
                    </p>
                  )}
                </SideCard>
                <CashCycle
                  title={t('Payout cycle')}
                  day={
                    payout?.status === 'next'
                      ? dayName(payout.day, locale)
                      : payout?.status === 'paid' && payout.paidAt
                        ? dayName(payout.paidAt, locale)
                        : undefined
                  }
                  status={{
                    label: t('Payout'),
                    value:
                      payout?.status === 'paid'
                        ? t('Paid')
                        : payout?.status === 'draft'
                          ? t('Prepared')
                          : t('Unpaid'),
                    paid: payout?.status === 'paid',
                  }}
                  rows={[
                    {
                      label: t('Payout'),
                      value: payoutNumber ? (
                        <span className="ltr-iso">
                          {payoutNumber}
                          {payout?.status === 'paid' && payout.reference
                            ? ` · ${payout.reference}`
                            : ''}
                        </span>
                      ) : payout?.status === 'next' ? (
                        t('With the next payout on {day}', { day: dayName(payout.day, locale) })
                      ) : (
                        t('After delivery')
                      ),
                    },
                    {
                      label: t('Payout frequency'),
                      value: t(SCHEDULES[p.payoutSchedule] ?? p.payoutSchedule),
                    },
                  ]}
                />
              </>
            }
          />
        </div>
      )}
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
        {t('The courier could not deliver this parcel:')}{' '}
        <strong>{reasonText(parcel.holdReason ?? parcel.lastFailReason)}</strong>.{' '}
        {t('It is waiting at our hub. Fix the details and try again, or bring it back to you.')}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Correct mobile')} hint={t('Now {phone}', { phone: parcel.customerPhone })}>
          <Input
            inputMode="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label={t('Governorate')} hint={t('Only if it changed')}>
          <Select
            value={governorateCode}
            onChange={(e) => {
              setGovernorateCode(e.target.value);
              setAreaId('');
            }}
          >
            <option value="">{t('Keep {code}', { code: parcel.governorateCode })}</option>
            {govs.map((g) => (
              <option key={g.code} value={g.code} disabled={!g.served}>
                {name(g)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Area')}>
          <Select
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
            disabled={!gov || gov.areas.length === 0}
          >
            <option value="">{governorateCode ? t('Any area') : t('Keep current area')}</option>
            {gov?.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {name(a)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Note for the courier')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field
          label={t('Correct address')}
          className="sm:col-span-2"
          hint={t('Leave empty to keep it')}
        >
          <Textarea
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={parcel.address}
          />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button tone="accent" disabled={busy} onClick={tryAgain}>
          {t('Try again')}
        </Button>
        <Button
          tone="secondary"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                t('Bring this parcel back to you instead of delivering it? A return fee applies.'),
              )
            )
              onDecide({ decision: 'RETURN', note }, t('The parcel is coming back to you'));
          }}
        >
          <Icon name="returns" size={18} />
          {t('Return to me')}
        </Button>
      </div>
    </section>
  );
}
